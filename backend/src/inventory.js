import { Product, Order } from "./db.js";
import { variantFilter, variantInc } from "./variants.js";

/**
 * Give units back to their size/colour variants.
 *
 * One function for the three places stock returns to the shelf — a sold-out
 * line rolling back the rest of its order, a failed Order.create, and an admin
 * cancelling an order — so they cannot drift apart. Each `$inc` moves the
 * variant and the derived product total in one write (see variantInc).
 *
 * @param lines  [{ product_id, size, color, qty }]
 * @returns the lines whose variant no longer exists (removed in admin since
 *          the order was placed), so the caller can tell a human rather than
 *          silently dropping the units.
 */
export async function restoreStock(lines) {
  const results = await Promise.all(
    lines.map((l) =>
      Product.updateOne(variantFilter(l.product_id, { size: l.size, color: l.color }), variantInc(l.qty))
    )
  );
  return lines.filter((_l, i) => results[i].modifiedCount === 0);
}

/**
 * Give an order's units back, once. Every path that can abandon an order —
 * an admin cancelling it, a mobile money payment failing or expiring — goes
 * through here, and the stock_released flag is claimed with a conditional
 * write first, so two of them racing restock it exactly once.
 *
 * @returns { released, skipped } — skipped as restoreStock()
 */
export async function releaseOrderStock(order) {
  const claimed = await Order.updateOne({ _id: order._id, stock_released: { $ne: true } }, { $set: { stock_released: true } });
  if (claimed.modifiedCount !== 1) return { released: false, skipped: [] };
  const skipped = await restoreStock(
    order.items.map((i) => ({ product_id: i.product, size: i.size, color: i.color, qty: i.qty, name: i.name }))
  );
  return { released: true, skipped };
}
