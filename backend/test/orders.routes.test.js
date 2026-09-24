import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness, orderBody } from "./helpers/harness.js";
import { DELIVERY_FEE_CENTS } from "../src/config.js";

/*
 * Order creation and cancellation against a real MongoDB: the per-variant
 * reservation guard, its compensator, and the admin cancel-restock path.
 */
const h = await startHarness();

describe("orders × variants", { skip: h.skip }, () => {
  let admin;
  before(async () => {
    admin = await h.login();
  });
  after(() => h.stop());

  const variantStock = async (id, size, color) => {
    const p = await h.db.Product.findById(id);
    return { variant: p.variants.find((v) => v.size === size && v.color === color).stock, total: p.stock };
  };

  test("an in-stock variant is reserved; its siblings and the total move correctly", async () => {
    const p = await h.makeProduct([
      { size: "S", color: "Red", stock: 4 },
      { size: "M", color: "Red", stock: 6 },
    ]);
    const r = await h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "M", color: "Red", qty: 2 }]),
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(await variantStock(p.id, "M", "Red"), { variant: 4, total: 8 });
    assert.equal((await variantStock(p.id, "S", "Red")).variant, 4, "sibling untouched");
    assert.equal(r.body.order.items[0].size, "M");
    assert.equal(r.body.order.total_cents, 2 * 5000000 + DELIVERY_FEE_CENTS);
  });

  test("a partially-available line (asks for 3, variant has 2) is rejected whole", async () => {
    const p = await h.makeProduct([
      { size: "M", color: "Red", stock: 2 },
      { size: "L", color: "Red", stock: 50 },
    ]);
    const r = await h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "M", color: "Red", qty: 3 }]),
    });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /only 2 left/);
    assert.deepEqual(await variantStock(p.id, "M", "Red"), { variant: 2, total: 52 }, "nothing reserved");
  });

  test("a sold-out variant is rejected even while the product has stock", async () => {
    const p = await h.makeProduct([
      { size: "S", color: "Red", stock: 0 },
      { size: "M", color: "Red", stock: 9 },
    ]);
    const r = await h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "S", color: "Red", qty: 1 }]),
    });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /sold out/);
    assert.equal((await variantStock(p.id, "M", "Red")).total, 9);
  });

  test("an unknown size/colour pair is a 400, not a silent product-level sale", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 9 }]);
    const r = await h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "XL", color: "Red", qty: 1 }]),
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not made in XL \/ Red/);
  });

  test("when a later line loses the race, earlier reservations are released", async () => {
    const a = await h.makeProduct([{ size: "M", color: "Red", stock: 5 }]);
    const b = await h.makeProduct([{ size: "M", color: "Blue", stock: 1 }]);
    // Same variant twice: each line passes the pre-check (1 <= 1), but the
    // second guarded decrement finds nothing left — the compensator must run.
    const r = await h.api("POST", "/api/orders", {
      body: orderBody([
        { product_id: a.id, size: "M", color: "Red", qty: 2 },
        { product_id: b.id, size: "M", color: "Blue", qty: 1 },
        { product_id: b.id, size: "M", color: "Blue", qty: 1 },
      ]),
    });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /just sold out/);
    assert.deepEqual(await variantStock(a.id, "M", "Red"), { variant: 5, total: 5 }, "line 1 released");
    assert.deepEqual(await variantStock(b.id, "M", "Blue"), { variant: 1, total: 1 }, "line 2 released");
  });

  test("a variant price override is what the customer is charged", async () => {
    const p = await h.makeProduct([
      { size: "M", color: "Red", stock: 5 },
      { size: "XL", color: "Red", stock: 5, price_cents: 6000000 },
    ]);
    const r = await h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "XL", color: "Red", qty: 1, price_cents: 1 }]),
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.order.items[0].price_cents, 6000000, "client-sent price ignored");
    assert.equal(r.body.order.subtotal_cents, 6000000);
  });

  test("cancelling restores the exact variant, once, and is audited", async () => {
    const p = await h.makeProduct([
      { size: "M", color: "Red", stock: 5 },
      { size: "L", color: "Red", stock: 5 },
    ]);
    const o = await h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "L", color: "Red", qty: 3 }]),
    });
    assert.equal(o.status, 201);
    assert.equal((await variantStock(p.id, "L", "Red")).variant, 2);

    const cancel = () =>
      h.api("PATCH", `/api/admin/orders/${o.body.order.id}`, { token: admin, body: { status: "cancelled" } });
    const [c1, c2] = await Promise.all([cancel(), cancel()]);
    assert.ok([c1.status, c2.status].includes(200));
    assert.deepEqual(await variantStock(p.id, "L", "Red"), { variant: 5, total: 10 }, "restocked exactly once");
    assert.equal((await variantStock(p.id, "M", "Red")).variant, 5);

    const log = await h.api("GET", "/api/admin/audit?action=order.status", { token: admin });
    const entry = log.body.entries.find((e) => e.target_id === o.body.order.id);
    assert.ok(entry, "status change was audited");
    assert.equal(entry.actor_email, "admin@bayan.local");
    assert.deepEqual(entry.before, { status: "pending" });
    assert.equal(entry.after.status, "cancelled");
  });

  test("cancelling after the variant was removed reports it instead of guessing", async () => {
    const p = await h.makeProduct([
      { size: "M", color: "Red", stock: 5 },
      { size: "L", color: "Red", stock: 5 },
    ]);
    const o = await h.api("POST", "/api/orders", {
      body: orderBody([{ product_id: p.id, size: "L", color: "Red", qty: 1 }]),
    });
    await h.db.Product.updateOne({ _id: p._id }, { $pull: { variants: { size: "L" } } });
    const c = await h.api("PATCH", `/api/admin/orders/${o.body.order.id}`, {
      token: admin,
      body: { status: "cancelled" },
    });
    assert.equal(c.status, 200);
    assert.equal(c.body.restock_skipped.length, 1);
    assert.equal(c.body.restock_skipped[0].variant, "L / Red");
  });

  test("the dashboard lists low stock per variant", async () => {
    await h.makeProduct([
      { size: "M", color: "Teal", stock: 0 },
      { size: "L", color: "Teal", stock: 80 },
    ], { name: "Plenty But Not In M" });
    const s = await h.api("GET", "/api/admin/stats", { token: admin });
    const row = s.body.low_stock.find((r) => r.name === "Plenty But Not In M");
    assert.ok(row, "a product with 80 units still shows its sold-out size");
    assert.equal(row.variant, "M / Teal");
    assert.equal(row.stock, 0);
  });

  test("public product JSON exposes variants without internal alert clocks", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 1, low_stock_alert_at: new Date() }]);
    const r = await h.api("GET", `/api/products/${p.slug}`);
    assert.equal(r.body.product.variants[0].stock, 1);
    assert.ok(!("low_stock_alert_at" in r.body.product.variants[0]));
  });
});
