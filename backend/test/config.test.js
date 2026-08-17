import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deliveryFor,
  publicConfig,
  FREE_DELIVERY_THRESHOLD_CENTS,
  DELIVERY_FEE_CENTS,
  MAX_QTY_PER_LINE,
  URGENCY_STOCK_THRESHOLD,
} from "../src/config.js";

test("delivery is charged below the free-delivery threshold", () => {
  assert.equal(deliveryFor(0), DELIVERY_FEE_CENTS);
  assert.equal(deliveryFor(1), DELIVERY_FEE_CENTS);
  assert.equal(deliveryFor(FREE_DELIVERY_THRESHOLD_CENTS - 1), DELIVERY_FEE_CENTS);
});

test("delivery is free at and above the threshold", () => {
  assert.equal(deliveryFor(FREE_DELIVERY_THRESHOLD_CENTS), 0, "exactly at the threshold qualifies");
  assert.equal(deliveryFor(FREE_DELIVERY_THRESHOLD_CENTS + 1), 0);
});

test("publicConfig exposes what the client needs to quote a total", () => {
  const cfg = publicConfig();
  assert.deepEqual(Object.keys(cfg).sort(), [
    "currency",
    "delivery_fee_cents",
    "free_delivery_threshold_cents",
    "max_qty_per_line",
    "urgency_stock_threshold",
  ]);
  assert.equal(cfg.free_delivery_threshold_cents, FREE_DELIVERY_THRESHOLD_CENTS);
  assert.equal(cfg.delivery_fee_cents, DELIVERY_FEE_CENTS);
  assert.equal(cfg.max_qty_per_line, MAX_QTY_PER_LINE);
  assert.equal(cfg.urgency_stock_threshold, URGENCY_STOCK_THRESHOLD);
});

test("prices are whole cents, so totals never carry float error", () => {
  assert.ok(Number.isInteger(FREE_DELIVERY_THRESHOLD_CENTS));
  assert.ok(Number.isInteger(DELIVERY_FEE_CENTS));
});
