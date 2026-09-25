import { test } from "node:test";
import assert from "node:assert/strict";
import { decideOutcome, canTransition, internationalPhone, samePhone, callingCodeFor } from "../src/payments.js";
import { normaliseVerify, webhookAuthentic } from "../src/flutterwave.js";

/* The payment state machine and its helpers, without a database. */

const order = (over = {}) => ({ payment_status: "pending", status: "pending", total_cents: 5000000, ...over });
const ok = (over = {}) => ({ status: "successful", amount_cents: 5000000, currency: "UGX", ...over });

test("a verified full payment in the right currency is paid", () => {
  assert.equal(decideOutcome(order(), ok(), "UGX").next, "paid");
  assert.equal(decideOutcome(order(), ok({ amount_cents: 5000100 }), "UGX").next, "paid", "overpayment still pays");
});

test("short or wrong-currency payments go to review, never straight to paid", () => {
  assert.equal(decideOutcome(order(), ok({ amount_cents: 4999999 }), "UGX").next, "review");
  assert.equal(decideOutcome(order(), ok({ currency: "KES" }), "UGX").next, "review");
});

test("pending stays pending; failures fail", () => {
  assert.equal(decideOutcome(order(), { status: "pending" }, "UGX").next, null);
  assert.equal(decideOutcome(order(), null, "UGX").next, null);
  assert.equal(decideOutcome(order(), { status: "failed" }, "UGX").next, "failed");
});

test("money arriving after the stock was released, or after a cancel, is owed back", () => {
  assert.equal(decideOutcome(order({ payment_status: "expired" }), ok(), "UGX").next, "refund_due");
  assert.equal(decideOutcome(order({ payment_status: "failed" }), ok(), "UGX").next, "refund_due");
  assert.equal(decideOutcome(order({ status: "cancelled" }), ok(), "UGX").next, "refund_due");
});

test("settled payments ignore repeats (idempotency at the decision level)", () => {
  assert.equal(decideOutcome(order({ payment_status: "paid" }), ok(), "UGX").next, null);
  assert.equal(decideOutcome(order({ payment_status: "paid" }), { status: "failed" }, "UGX").next, null);
  assert.equal(decideOutcome(order({ payment_status: "expired" }), { status: "failed" }, "UGX").next, null);
});

test("only the drawn transitions are allowed", () => {
  assert.ok(canTransition("pending", "paid"));
  assert.ok(canTransition("on_delivery", "paid"));
  assert.ok(canTransition("refund_due", "refunded"));
  assert.ok(!canTransition("paid", "failed"), "a paid order can't fail");
  assert.ok(!canTransition("paid", "pending"));
  assert.ok(!canTransition("refunded", "paid"));
  assert.ok(!canTransition("on_delivery", "failed"));
});

test("phones normalise to international digits and compare by line", () => {
  assert.equal(internationalPhone("0772 123 456"), "256772123456");
  assert.equal(internationalPhone("+256 772-123-456"), "256772123456");
  assert.equal(internationalPhone("00256772123456"), "256772123456");
  assert.equal(internationalPhone("0712345678", "254"), "254712345678");
  assert.ok(samePhone("0772123456", "+256772123456"));
  assert.ok(!samePhone("0772123456", "0772123457"));
  assert.ok(!samePhone("", ""));
  assert.equal(callingCodeFor("en-KE"), "254");
  assert.equal(callingCodeFor("fr"), "256");
});

test("Flutterwave records normalise to cents and three outcomes", () => {
  assert.deepEqual(normaliseVerify({ id: 42, status: "successful", amount: 50000, currency: "UGX" }), {
    status: "successful",
    amount_cents: 5000000,
    currency: "UGX",
    provider_id: "42",
    reason: "successful",
  });
  assert.equal(normaliseVerify({ status: "failed" }).status, "failed");
  assert.equal(normaliseVerify({ status: "cancelled" }).status, "failed");
  assert.equal(normaliseVerify({ status: "pending" }).status, "pending");
});

test("the webhook hash must match exactly", () => {
  process.env.FLW_SECRET_HASH = "s3cret-hash";
  assert.ok(webhookAuthentic("s3cret-hash"));
  assert.ok(!webhookAuthentic("s3cret-hasH"));
  assert.ok(!webhookAuthentic("s3cret"));
  assert.ok(!webhookAuthentic(undefined));
  delete process.env.FLW_SECRET_HASH;
  assert.ok(!webhookAuthentic("s3cret-hash"), "no configured hash accepts nothing");
});
