import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  deliveryFor,
  publicConfig,
  getSettings,
  invalidateSettings,
  setSettingsLoader,
  URGENCY_STOCK_THRESHOLD,
} from "../src/config.js";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings.js";

// Every test drives getSettings() through an in-memory "database" instead of
// Mongoose. `stored` stands in for the Settings document; `reads` counts how
// often the cache actually went to it.
let stored;
let reads;
beforeEach(() => {
  stored = null;
  reads = 0;
  setSettingsLoader(async () => {
    reads++;
    return stored;
  });
});

const D = DEFAULT_SETTINGS;

test("delivery is charged below the free-delivery threshold", () => {
  assert.equal(deliveryFor(0, D), D.delivery_fee_cents);
  assert.equal(deliveryFor(D.free_delivery_threshold_cents - 1, D), D.delivery_fee_cents);
});

test("delivery is free at and above the threshold", () => {
  assert.equal(deliveryFor(D.free_delivery_threshold_cents, D), 0, "exactly at the threshold qualifies");
  assert.equal(deliveryFor(D.free_delivery_threshold_cents + 1, D), 0);
});

test("deliveryFor refuses to guess when it is not given the settings", () => {
  // A zero-argument call used to be valid and read module constants. A silent
  // default would let un-migrated code charge the wrong fee.
  assert.throws(() => deliveryFor(100), /needs the shop settings/);
});

test("a database without a Settings document serves the defaults", async () => {
  const s = await getSettings();
  assert.equal(s.currency, "UGX");
  assert.equal(s.delivery_fee_cents, D.delivery_fee_cents);
  assert.equal(s.shop_name, "Bayan");
});

test("reads are cached, and concurrent callers share one read", async () => {
  await Promise.all([getSettings(), getSettings(), getSettings()]);
  await getSettings();
  assert.equal(reads, 1);
});

test("invalidation makes the next read see a changed document", async () => {
  assert.equal((await getSettings()).delivery_fee_cents, D.delivery_fee_cents);
  stored = { delivery_fee_cents: 555500 };
  assert.equal((await getSettings()).delivery_fee_cents, D.delivery_fee_cents, "still cached");
  invalidateSettings();
  assert.equal((await getSettings()).delivery_fee_cents, 555500);
  assert.equal(reads, 2);
});

test("a changed delivery fee is what an order is priced with", async () => {
  // Mirrors routes/orders.js: one getSettings() snapshot, then
  // deliveryFor(subtotal, settings). The admin PUT writes the document and
  // invalidates — which is what the next two lines simulate.
  stored = { delivery_fee_cents: 750000, free_delivery_threshold_cents: 50000000 };
  invalidateSettings();
  const settings = await getSettings();
  const subtotal = 30000000; // under the new threshold, over the old one
  assert.equal(deliveryFor(subtotal, settings), 750000);
  assert.equal(deliveryFor(subtotal, D), 0, "the old defaults would have made it free");

  // …and the client is quoted from the same values.
  const cfg = publicConfig(settings);
  assert.equal(cfg.delivery_fee_cents, 750000);
  assert.equal(cfg.free_delivery_threshold_cents, 50000000);
});

test("a failed first read surfaces the error", async () => {
  setSettingsLoader(async () => {
    throw new Error("db down");
  });
  await assert.rejects(getSettings(), /db down/);
});

test("publicConfig keeps the original keys and adds the settings shape", async () => {
  const cfg = publicConfig(await getSettings());
  for (const k of [
    "currency",
    "free_delivery_threshold_cents",
    "delivery_fee_cents",
    "max_qty_per_line",
    "urgency_stock_threshold",
  ]) {
    assert.ok(k in cfg, `${k} must stay for existing clients`);
  }
  assert.equal(cfg.urgency_stock_threshold, URGENCY_STOCK_THRESHOLD);
  for (const k of ["shop_name", "palette", "fonts", "locale", "copy", "departments"]) {
    assert.ok(k in cfg, `${k} is part of the settings shape`);
  }
});

test("stored internals never leak into the resolved settings", async () => {
  stored = { _id: "shop", __v: 0, created_at: new Date(), shop_name: "Acme", hacker: true };
  invalidateSettings();
  const s = await getSettings();
  assert.equal(s.shop_name, "Acme");
  for (const k of ["_id", "__v", "created_at", "hacker"]) assert.ok(!(k in s), `${k} leaked`);
});

test("default money values are whole cents and cannot be mutated", () => {
  assert.ok(Number.isInteger(D.free_delivery_threshold_cents));
  assert.ok(Number.isInteger(D.delivery_fee_cents));
  mergeSettings(D, { delivery_fee_cents: 1 });
  assert.equal(D.delivery_fee_cents, 1000000);
});
