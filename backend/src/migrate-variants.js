import path from "path";
import { pathToFileURL } from "url";
import { connectDB, disconnectDB, Product } from "./db.js";
import { variantsFromFlatStock, totalStock } from "./variants.js";

/**
 * Convert flat product `stock` into per-variant stock (SCALING.md M7).
 *
 *   npm run migrate:variants            # apply
 *   npm run migrate:variants -- --dry   # report only
 *
 * Idempotent: only products with no variants are touched, and each is written
 * with a conditional update that re-checks "still has no variants", so running
 * it twice — or concurrently with an admin saving the product in the new
 * editor — never splits stock a second time. Safe to run on every boot.
 *
 * The flat count is spread evenly across the size/colour grid with the total
 * preserved exactly (see splitStock). That is a guess by construction: the old
 * schema never recorded which sizes the units were, so the shop should recount
 * per variant in the admin editor afterwards.
 *
 * Also drops the old product-level `low_stock_alert_at`; alert clocks now live
 * on each variant.
 *
 * Rehearse against a copy of the live database first:
 *   mongodump --uri "$MONGODB_URI" --archive=bayan.bak
 *   mongorestore --uri "mongodb://localhost:27017/bayan_rehearsal" --archive=bayan.bak --nsFrom 'bayan.*' --nsTo 'bayan_rehearsal.*'
 *   MONGODB_URI=mongodb://localhost:27017/bayan_rehearsal npm run migrate:variants
 */
export async function migrateVariants({ dryRun = false, log = console.log } = {}) {
  const pending = await Product.find({
    $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }],
  })
    .select("_id slug name stock sizes colors")
    .lean();

  let migrated = 0;
  for (const p of pending) {
    const variants = variantsFromFlatStock(p);
    const total = totalStock(variants);
    if (dryRun) {
      log(`  would split ${p.stock ?? 0} × "${p.name}" across ${variants.length} variant(s)`);
      continue;
    }
    const { modifiedCount } = await Product.updateOne(
      { _id: p._id, $or: [{ variants: { $exists: false } }, { variants: { $size: 0 } }] },
      { $set: { variants, stock: total }, $unset: { low_stock_alert_at: "" } },
      // The old field is no longer in the schema; strict mode would silently
      // drop the $unset.
      { strict: false }
    );
    migrated += modifiedCount;
  }

  // Products migrated by an earlier run may still carry the old field.
  const cleaned = dryRun
    ? { modifiedCount: 0 }
    : await Product.updateMany({ low_stock_alert_at: { $exists: true } }, { $unset: { low_stock_alert_at: "" } }, { strict: false });

  log(
    dryRun
      ? `Dry run: ${pending.length} product(s) would be migrated to per-variant stock.`
      : `Migrated ${migrated} product(s) to per-variant stock` +
          (cleaned.modifiedCount ? `; removed the old alert clock from ${cleaned.modifiedCount} more.` : ".")
  );
  return { pending: pending.length, migrated };
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  connectDB()
    .then(() => migrateVariants({ dryRun: process.argv.includes("--dry") }))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}
