import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness } from "./helpers/harness.js";

/*
 * The flat-stock → variants migration against a real MongoDB. It runs on
 * every boot (Dockerfile), so it must be a no-op the second time.
 */
const h = await startHarness();

describe("migrate:variants", { skip: h.skip }, () => {
  after(() => h.stop());

  /** A pre-M7 product: flat stock, no variants, product-level alert clock. */
  const legacy = (slug, stock, sizes, colors) =>
    h.db.Product.collection.insertOne({
      slug,
      name: slug,
      description: "legacy",
      category: "Men",
      price_cents: 100,
      swatch: "#000000",
      colors: colors.map((name) => ({ name, hex: "#000000", image: null })),
      sizes,
      stock,
      low_stock_alert_at: new Date(),
    });

  test("converts flat stock, preserves totals, and is idempotent", async () => {
    const { migrateVariants } = await import("../src/migrate-variants.js");
    await legacy("legacy-a", 41, ["S", "M", "L"], ["Red", "Blue"]);
    await legacy("legacy-b", 0, ["One size"], ["Gold"]);
    const modern = await h.makeProduct([{ size: "M", color: "Red", stock: 7 }]);

    const quiet = () => {};
    const first = await migrateVariants({ log: quiet });
    assert.equal(first.migrated, 2, "only the two legacy products");

    const a = await h.db.Product.findOne({ slug: "legacy-a" }).lean();
    assert.equal(a.variants.length, 6);
    assert.equal(a.variants.reduce((n, v) => n + v.stock, 0), 41, "total preserved");
    assert.equal(a.stock, 41);
    assert.ok(!("low_stock_alert_at" in a), "old product-level clock removed");
    assert.equal(a.variants[0].sku, "LEGACY-A-RED-S");

    const before = await h.db.Product.find().sort({ slug: 1 }).lean();
    const second = await migrateVariants({ log: quiet });
    assert.deepEqual(second, { pending: 0, migrated: 0 });
    const afterRun = await h.db.Product.find().sort({ slug: 1 }).lean();
    assert.deepEqual(afterRun, before, "second run changes nothing");

    const untouched = await h.db.Product.findById(modern._id).lean();
    assert.equal(untouched.variants[0].stock, 7, "already-migrated products are left alone");
  });

  test("a dry run reports without writing", async () => {
    const { migrateVariants } = await import("../src/migrate-variants.js");
    await legacy("legacy-dry", 5, ["M"], ["Red"]);
    const r = await migrateVariants({ dryRun: true, log: () => {} });
    assert.equal(r.pending, 1);
    const p = await h.db.Product.findOne({ slug: "legacy-dry" }).lean();
    assert.ok(!p.variants?.length);
  });
});
