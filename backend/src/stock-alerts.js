import { Product, notify } from "./db.js";
import { LOW_STOCK_THRESHOLD, LOW_STOCK_REALERT_HOURS } from "./config.js";
import { variantLabel } from "./variants.js";

const REALERT_MS = LOW_STOCK_REALERT_HOURS * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly; the 24h gate does the real work
const BOOT_DELAY_MS = 30 * 1000; // let the app settle before the first sweep

/** Matches a variant whose alert clock is unset or older than the re-alert window. */
const staleClock = (cutoff) => ({
  $or: [{ low_stock_alert_at: null }, { low_stock_alert_at: { $lte: cutoff } }],
});

/**
 * Alert the admin that one size/colour of a product is running low — but at
 * most once per LOW_STOCK_REALERT_HOURS per variant, so a busy item can't spam
 * the feed. Alerts are per variant because "the dress is low" is not
 * actionable; "the dress is down to 1 in M / Forest" is.
 *
 * The timestamp is claimed with a conditional update on the variant: if two
 * orders land at once, only the first passes the guard, so exactly one
 * notification is produced.
 *
 * @param product  { _id, name }
 * @param variant  { size, color, stock } — stock as of the triggering write
 */
export async function alertLowStock(product, variant) {
  const cutoff = new Date(Date.now() - REALERT_MS);
  const claimed = await Product.updateOne(
    {
      _id: product._id,
      variants: { $elemMatch: { size: variant.size, color: variant.color, ...staleClock(cutoff) } },
    },
    { $set: { "variants.$.low_stock_alert_at": new Date() } }
  );
  if (claimed.modifiedCount === 0) return false; // alerted recently (or the variant is gone)

  const label = variantLabel(variant);
  if (variant.stock === 0) {
    notify(
      "stock_out",
      `Sold out: ${product.name} (${label})`,
      "Restock this size and colour to bring it back on sale.",
      "/admin/products"
    );
  } else {
    notify(
      "stock_low",
      `Low stock: ${product.name} (${label})`,
      `Only ${variant.stock} left — restock soon.`,
      "/admin/products"
    );
  }
  return true;
}

/**
 * Re-alert on any variant still sitting at or below the threshold. Runs hourly;
 * alertLowStock's 24h gate means each variant reappears in the feed once a day
 * until it is restocked. Returns how many alerts were raised.
 */
export async function sweepLowStock() {
  try {
    const cutoff = new Date(Date.now() - REALERT_MS);
    const products = await Product.find({
      variants: { $elemMatch: { stock: { $lte: LOW_STOCK_THRESHOLD }, ...staleClock(cutoff) } },
    }).select("_id name variants");

    let alerted = 0;
    for (const p of products) {
      for (const v of p.variants) {
        const stale = !v.low_stock_alert_at || v.low_stock_alert_at <= cutoff;
        if (v.stock <= LOW_STOCK_THRESHOLD && stale && (await alertLowStock(p, v))) alerted++;
      }
    }
    if (alerted > 0) console.log(`Low-stock sweep: re-alerted ${alerted} variant(s)`);
    return alerted;
  } catch (err) {
    console.error("Low-stock sweep failed:", err.message);
    return 0;
  }
}

/** Start the recurring sweep. Safe to call once at boot. */
export function startStockAlerts() {
  setTimeout(sweepLowStock, BOOT_DELAY_MS).unref?.();
  setInterval(sweepLowStock, SWEEP_INTERVAL_MS).unref?.();
}
