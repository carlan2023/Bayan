import { describe, test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, orderBody } from "./helpers/harness.js";

/*
 * Mobile money, notifications and guest lookup against a real MongoDB, with
 * Flutterwave and WhatsApp replaced by fakes (no network).
 */
process.env.FLW_SECRET_KEY = "FLWSECK_TEST-fake";
process.env.FLW_SECRET_HASH = "hook-secret";
process.env.WHATSAPP_TOKEN = "wa-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
const h = await startHarness();
const flw = await import("../src/flutterwave.js");
const wa = await import("../src/whatsapp.js");

/** What the fake Flutterwave says, per tx_ref; and every call it received. */
const verdicts = new Map();
const flwCalls = [];
let chargeFails = false;
flw.setFetch(async (url, init) => {
  flwCalls.push({ url, body: init.body ? JSON.parse(init.body) : null });
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
  if (url.includes("/charges?type=mobile_money_uganda")) {
    if (chargeFails) return json(400, { status: "error", message: "Invalid phone number" });
    return json(200, { status: "success", message: "Charge initiated", data: { id: 777 }, meta: { authorization: { mode: "redirect", redirect: "https://checkout.flutterwave.test/otp" } } });
  }
  const ref = decodeURIComponent(url.split("tx_ref=")[1] || "");
  const v = verdicts.get(ref);
  if (!v) return json(404, { status: "error", message: "No transaction was found for this id" });
  return json(200, { status: "success", data: { id: 777, tx_ref: ref, ...v } });
});
const waSent = [];
wa.setFetch(async (url, init) => {
  waSent.push(JSON.parse(init.body));
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.1" }] }) };
});

const settle = () => new Promise((r) => setTimeout(r, 150)); // let fire-and-forget notifications finish

describe("payments", { skip: h.skip }, () => {
  let admin;
  before(async () => {
    admin = await h.login();
  });
  after(async () => {
    flw.setFetch(null);
    wa.setFetch(null);
    await h.stop();
  });
  beforeEach(() => {
    chargeFails = false;
  });

  const stockOf = async (id) => (await h.db.Product.findById(id).lean()).variants[0].stock;
  const momoOrder = async (p, over = {}) =>
    h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "M", color: "Red", qty: 2 }], {
        payment_method: "mobile_money",
        momo_network: "MTN",
        email: "shopper@test.example",
        ...over,
      }),
    });
  const webhook = (tx_ref, hash = "hook-secret") =>
    h.api("POST", "/api/payments/flutterwave/webhook", {
      headers: { "verif-hash": hash },
      body: { event: "charge.completed", data: { tx_ref, status: "successful", amount: 999999999 } },
    });
  const txRefOf = async (id) => (await h.db.Order.findById(id).lean()).payment.tx_ref;

  test("config advertises mobile money only with keys and a supported currency", async () => {
    const c = (await h.api("GET", "/api/config")).body;
    assert.deepEqual(c.payment_methods, ["cod", "mobile_money"]);
    assert.deepEqual(c.mobile_money_networks, ["MTN", "AIRTEL"]);
  });

  test("starting a payment reserves stock, and a verified webhook commits it once", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const r = await momoOrder(p);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.order.payment_status, "pending");
    assert.equal(r.body.payment.redirect_url, "https://checkout.flutterwave.test/otp");
    assert.ok(r.body.access_token);
    assert.equal(await stockOf(p.id), 3, "reserved at initiation");
    const charge = flwCalls.find((c) => c.url.includes("/charges"));
    assert.equal(charge.body.phone_number, "256700000000");
    assert.equal(charge.body.network, "MTN");
    assert.equal(charge.body.amount, (r.body.order.total_cents) / 100);

    // Unpaid mobile money can't be dispatched.
    const early = await h.api("PATCH", `/api/admin/orders/${r.body.order.id}`, { token: admin, body: { status: "dispatched" } });
    assert.equal(early.status, 409);

    const ref = await txRefOf(r.body.order.id);
    assert.equal((await webhook(ref, "wrong")).status, 401);
    assert.equal((await h.db.Order.findById(r.body.order.id)).payment_status, "pending", "a forged webhook changes nothing");

    verdicts.set(ref, { status: "successful", amount: r.body.order.total_cents / 100, currency: "UGX" });
    const before = h.outbox.length;
    const w1 = await webhook(ref);
    assert.equal(w1.body.payment_status, "paid");
    const w2 = await webhook(ref);
    assert.equal(w2.status, 200);
    await settle();
    const o = await h.db.Order.findById(r.body.order.id);
    assert.equal(o.payment_status, "paid");
    assert.equal(o.status, "confirmed");
    assert.equal(await stockOf(p.id), 3, "committed: still taken, not returned");
    const mails = h.outbox.slice(before).filter((m) => m.to === "shopper@test.example");
    assert.equal(mails.length, 1, "one confirmation email despite two webhooks");
    assert.match(mails[0].subject, new RegExp(`#${o.number}`));
    assert.equal(waSent.filter((m) => m.to === "256700000000" && m.template.name === "order_confirmation").length >= 1, true);
  });

  test("the webhook body is never believed: only the verified record counts", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const r = await momoOrder(p);
    const ref = await txRefOf(r.body.order.id);
    // Provider has no record yet → still pending, whatever the body claimed.
    const w = await webhook(ref);
    assert.equal(w.body.payment_status, "pending");
  });

  test("a failed payment releases the stock exactly once, and a later cancel doesn't restock again", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const r = await momoOrder(p);
    const ref = await txRefOf(r.body.order.id);
    verdicts.set(ref, { status: "failed", processor_response: "Insufficient funds" });
    await Promise.all([webhook(ref), webhook(ref), webhook(ref)]);
    const o = await h.db.Order.findById(r.body.order.id);
    assert.equal(o.payment_status, "failed");
    assert.equal(o.status, "cancelled");
    assert.equal(await stockOf(p.id), 5, "released once despite three concurrent webhooks");
    await h.api("PATCH", `/api/admin/orders/${o._id}`, { token: admin, body: { status: "pending" } });
    await h.api("PATCH", `/api/admin/orders/${o._id}`, { token: admin, body: { status: "cancelled" } });
    assert.equal(await stockOf(p.id), 5, "no second restock");
  });

  test("a short payment goes to review, and an admin can accept it", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const r = await momoOrder(p);
    const ref = await txRefOf(r.body.order.id);
    verdicts.set(ref, { status: "successful", amount: 10, currency: "UGX" });
    assert.equal((await webhook(ref)).body.payment_status, "review");
    assert.equal(await stockOf(p.id), 3, "stock held while a human decides");
    const bad = await h.api("PATCH", `/api/admin/orders/${r.body.order.id}/payment`, { token: admin, body: { payment_status: "refunded" } });
    assert.equal(bad.status, 400);
    const ok = await h.api("PATCH", `/api/admin/orders/${r.body.order.id}/payment`, { token: admin, body: { payment_status: "paid" } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.order.payment_status, "paid");
    const log = await h.api("GET", "/api/admin/audit?action=order.payment", { token: admin });
    assert.ok(log.body.entries.some((e) => /review → paid/.test(e.summary)));
  });

  test("a charge that can't start fails the order and gives the stock back", async () => {
    chargeFails = true;
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const r = await momoOrder(p);
    assert.equal(r.status, 502);
    assert.match(r.body.error, /nothing was charged/);
    assert.equal(await stockOf(p.id), 5);
    const o = await h.db.Order.findOne({}).sort({ created_at: -1 });
    assert.equal(o.payment_status, "failed");
  });

  test("an unpaid prompt expires, releases stock, and money arriving later is owed back", async () => {
    const { sweepExpiredPayments } = await import("../src/payment-service.js");
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const r = await momoOrder(p);
    await h.db.Order.updateOne({ _id: r.body.order.id }, { $set: { "payment.expires_at": new Date(Date.now() - 1000) } });
    await sweepExpiredPayments();
    let o = await h.db.Order.findById(r.body.order.id);
    assert.equal(o.payment_status, "expired");
    assert.equal(await stockOf(p.id), 5);

    const ref = await txRefOf(r.body.order.id);
    verdicts.set(ref, { status: "successful", amount: o.total_cents / 100, currency: "UGX" });
    await webhook(ref);
    o = await h.db.Order.findById(r.body.order.id);
    assert.equal(o.payment_status, "refund_due");
    assert.equal(await stockOf(p.id), 5, "the late payment doesn't take stock again");
  });

  test("the payment page polls with its token; nobody else can", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const r = await momoOrder(p);
    const ok = await h.api("GET", `/api/orders/${r.body.order.id}/payment?token=${r.body.access_token}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.order.payment_status, "pending");
    assert.equal(ok.body.order.address, undefined, "no address in the public view");
    assert.equal((await h.api("GET", `/api/orders/${r.body.order.id}/payment?token=nope`)).status, 404);
    assert.equal((await h.api("GET", `/api/orders/${r.body.order.id}/payment`)).status, 404);
  });

  test("cash on delivery confirms at once, alerts the shop, and is paid on delivery", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const before = h.outbox.length;
    const r = await h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "M", color: "Red", qty: 1 }], { email: "cod@test.example" }),
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.order.payment_status, "on_delivery");
    await settle();
    const sent = h.outbox.slice(before);
    assert.equal(sent.filter((m) => m.to === "cod@test.example").length, 1);
    assert.equal(sent.filter((m) => m.to === "support@bayan.example").length, 1, "shop alert to the support address");
    assert.ok(waSent.some((m) => m.to === "256740399767" && m.template.name === "new_order_alert"), "shop alert on WhatsApp");

    for (const status of ["confirmed", "dispatched", "delivered"]) {
      const s = await h.api("PATCH", `/api/admin/orders/${r.body.order.id}`, { token: admin, body: { status } });
      assert.equal(s.status, 200, JSON.stringify(s.body));
    }
    assert.equal((await h.db.Order.findById(r.body.order.id)).payment_status, "paid");
  });

  test("guest lookup needs the order number and the same phone, in any format", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const r = await h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "M", color: "Red", qty: 1 }], { phone: "0772 123 456" }),
    });
    const n = r.body.order.number;
    const found = await h.api("GET", `/api/orders/lookup?number=%23${n}&phone=%2B256772123456`);
    assert.equal(found.status, 200, JSON.stringify(found.body));
    assert.equal(found.body.order.number, n);
    assert.equal(found.body.order.items.length, 1);
    assert.equal(found.body.order.phone, undefined);
    assert.equal((await h.api("GET", `/api/orders/lookup?number=${n}&phone=0772123457`)).status, 404);
    assert.equal((await h.api("GET", `/api/orders/lookup?number=999999&phone=0772123456`)).status, 404);
    assert.equal((await h.api("GET", `/api/orders/lookup?number=abc&phone=1`)).status, 400);
  });

  test("without Flutterwave keys, mobile money is refused before any stock moves", async () => {
    delete process.env.FLW_SECRET_KEY;
    try {
      const p = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
      const r = await momoOrder(p);
      assert.equal(r.status, 400);
      assert.equal(await stockOf(p.id), 5);
      assert.deepEqual((await h.api("GET", "/api/config")).body.payment_methods, ["cod"]);
    } finally {
      process.env.FLW_SECRET_KEY = "FLWSECK_TEST-fake";
    }
  });
});
