import { test } from "node:test";
import assert from "node:assert/strict";
import { clampQty, stockProblem, priceOrder } from "../src/pricing.js";
import {
  deliveryFor,
  FREE_DELIVERY_THRESHOLD_CENTS,
  DELIVERY_FEE_CENTS,
  MAX_QTY_PER_LINE,
} from "../src/config.js";

/*
 * The order money path: what a customer is actually charged. Every figure here
 * is whole cents (UGX × 100), as stored.
 */

const product = (over = {}) => ({ _id: "p1", name: "Linen Dress", price_cents: 17000000, ...over });
const variant = (over = {}) => ({ size: "M", color: "Forest", sku: "LINEN-FOREST-M", stock: 5, price_cents: null, ...over });
const rules = { deliveryFor };

test("per-line quantity is clamped to [1, cap]", () => {
  assert.equal(clampQty(3, MAX_QTY_PER_LINE), 3);
  assert.equal(clampQty(MAX_QTY_PER_LINE, MAX_QTY_PER_LINE), MAX_QTY_PER_LINE);
  assert.equal(clampQty(MAX_QTY_PER_LINE + 1, MAX_QTY_PER_LINE), MAX_QTY_PER_LINE, "over the cap is cut to the cap");
  assert.equal(clampQty(10_000, MAX_QTY_PER_LINE), MAX_QTY_PER_LINE);
});

test("junk quantities never charge for more than one unit", () => {
  for (const junk of [0, -3, "abc", null, undefined, NaN, "", {}]) {
    assert.equal(clampQty(junk, MAX_QTY_PER_LINE), 1, `qty ${JSON.stringify(junk)}`);
  }
  assert.equal(clampQty("4", MAX_QTY_PER_LINE), 4, "numeric strings from JSON clients are honoured");
  assert.equal(clampQty(2.9, MAX_QTY_PER_LINE), 2, "fractions round down, never up");
});

test("lines are priced from the database, whatever the client sent", () => {
  // The client payload is never passed in — priceOrder only sees DB documents.
  const out = priceOrder([{ product: product(), variant: variant(), qty: 2 }], rules);
  assert.equal(out.items[0].price_cents, 17000000);
  assert.equal(out.subtotal_cents, 34000000);
});

test("a variant price override wins over the product price", () => {
  const out = priceOrder([{ product: product(), variant: variant({ price_cents: 19000000 }), qty: 1 }], rules);
  assert.equal(out.items[0].price_cents, 19000000);
  assert.equal(out.subtotal_cents, 19000000);
});

test("a null, zero or junk override falls back to the product price", () => {
  for (const price_cents of [null, undefined, 0, -5, 12.5]) {
    const out = priceOrder([{ product: product(), variant: variant({ price_cents }), qty: 1 }], rules);
    assert.equal(out.items[0].price_cents, 17000000, `override ${price_cents}`);
  }
});

test("subtotal sums every line; total is subtotal plus delivery", () => {
  const out = priceOrder(
    [
      { product: product({ price_cents: 5000000 }), variant: variant(), qty: 3 },
      { product: product({ _id: "p2", name: "Tee", price_cents: 2500000 }), variant: variant({ size: "L" }), qty: 1 },
    ],
    rules
  );
  assert.equal(out.subtotal_cents, 17500000);
  assert.equal(out.delivery_cents, DELIVERY_FEE_CENTS);
  assert.equal(out.total_cents, 17500000 + DELIVERY_FEE_CENTS);
});

test("delivery is charged one cent below the threshold and free at it", () => {
  const at = (price) => priceOrder([{ product: product({ price_cents: price }), variant: variant(), qty: 1 }], rules);
  const below = at(FREE_DELIVERY_THRESHOLD_CENTS - 1);
  assert.equal(below.delivery_cents, DELIVERY_FEE_CENTS);
  assert.equal(below.total_cents, FREE_DELIVERY_THRESHOLD_CENTS - 1 + DELIVERY_FEE_CENTS);
  const exactly = at(FREE_DELIVERY_THRESHOLD_CENTS);
  assert.equal(exactly.delivery_cents, 0);
  assert.equal(exactly.total_cents, FREE_DELIVERY_THRESHOLD_CENTS);
});

test("the threshold is judged on the whole basket, not per line", () => {
  const half = FREE_DELIVERY_THRESHOLD_CENTS / 2;
  const out = priceOrder([{ product: product({ price_cents: half }), variant: variant(), qty: 2 }], rules);
  assert.equal(out.delivery_cents, 0);
});

test("order lines snapshot the variant so cancel can find it again", () => {
  const out = priceOrder([{ product: product(), variant: variant(), qty: 1 }], rules);
  assert.deepEqual(out.items[0], {
    product: "p1",
    name: "Linen Dress",
    price_cents: 17000000,
    qty: 1,
    size: "M",
    color: "Forest",
    sku: "LINEN-FOREST-M",
  });
});

test("delivery rules are injected, so per-shop settings can replace the constants", () => {
  const flat = priceOrder([{ product: product(), variant: variant(), qty: 1 }], { deliveryFor: () => 123 });
  assert.equal(flat.delivery_cents, 123);
  assert.equal(flat.total_cents, 17000000 + 123);
});

test("totals stay whole cents", () => {
  const out = priceOrder([{ product: product({ price_cents: 333333 }), variant: variant(), qty: 3 }], rules);
  assert.ok(Number.isInteger(out.subtotal_cents) && Number.isInteger(out.total_cents));
});

/* ---- stock accounting ---- */

test("a line within the variant's stock is accepted", () => {
  assert.equal(stockProblem(product(), variant({ stock: 5 }), 5), null);
});

test("a line asking for more than the variant has is rejected with the real number", () => {
  assert.equal(stockProblem(product(), variant({ stock: 2 }), 3), '"Linen Dress" (M / Forest) has only 2 left in stock');
});

test("a sold-out variant is rejected as sold out", () => {
  assert.equal(stockProblem(product(), variant({ stock: 0 }), 1), '"Linen Dress" (M / Forest) is sold out');
});
