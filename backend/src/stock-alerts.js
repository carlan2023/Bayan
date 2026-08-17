import { Product, notify } from "./db.js";
import { LOW_STOCK_THRESHOLD, LOW_STOCK_REALERT_HOURS } from "./config.js";

const REALERT_MS = LOW_STOCK_REALERT_HOURS * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly; the 24h gate does the real work
const BOOT_DELAY_MS = 30 * 1000; // let the app settle before the first sweep

/**
 * Alert the admin that a product is running low — but at most once per
 * LOW_STOCK_REALERT_HOURS, so a busy item can't spam the feed.
 *
 * The timestamp is written with a conditional update: if two orders land at
 * once, only the first passes the `low_stock_alert_at` guard, so exactly one
 * notification is produced.
 */
export async function alertLowStock(product) {
  const cutoff = new Date(Date.now() - REALERT_MS);
  const claimed = await Product.findOneAndUpdate(
    {
      _id: product._id,
      $or: [{ low_stock_alert_at: null }, { low_stock_alert_at: { $lte: cutoff } }],
    },
    { $set: { low_stock_alert_at: new Date() } }
  );
  if (!claimed) return false; // already alerted recently

  if (product.stock === 0) {
    notify("stock_out", `Sold out: ${product.name}`, "Restock to bring it back on sale.", "/admin/products");
  } else {
    notify(
      "stock_low",
      `Low stock: ${product.name}`,
      `Only ${product.stock} left — restock soon.`,
      "/admin/products"
    );
  }
  return true;
}

/** Clear the alert clock once an item is comfortably back in stock. */
export async function clearLowStockAlert(productId) {
  await Product.updateOne({ _id: productId }, { $set: { low_stock_alert_at: null } });
}

/**
 * Re-alert on anything still sitting at or below the threshold. Runs hourly;
 * alertLowStock's 24h gate means each product reappears in the feed once a
 * day until it is restocked.
 */
export async function sweepLowStock() {
  try {
    const cutoff = new Date(Date.now() - REALERT_MS);
    const stale = await Product.find({
      stock: { $lte: LOW_STOCK_THRESHOLD },
      $or: [{ low_stock_alert_at: null }, { low_stock_alert_at: { $lte: cutoff } }],
    }).select("_id name stock");

    for (const p of stale) await alertLowStock(p);
    if (stale.length > 0) {
      console.log(`Low-stock sweep: re-alerted ${stale.length} product(s)`);
    }
  } catch (err) {
    console.error("Low-stock sweep failed:", err.message);
  }
}

/** Start the recurring sweep. Safe to call once at boot. */
export function startStockAlerts() {
  setTimeout(sweepLowStock, BOOT_DELAY_MS).unref?.();
  setInterval(sweepLowStock, SWEEP_INTERVAL_MS).unref?.();
}
