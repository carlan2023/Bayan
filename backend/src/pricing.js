/**
 * Order money math, isolated from Express and Mongo.
 *
 * This is the code that decides what a customer is charged. It used to live
 * inline in routes/orders.js where it could only be exercised by a curl smoke
 * test; a regression here overcharges real customers, so it is pure and
 * unit-tested (test/pricing.test.js).
 *
 * Commerce rules (delivery pricing, the per-line cap) are passed in rather than
 * imported, so the same functions keep working when those values move from
 * module constants to per-shop settings.
 */
import { unitPrice, variantLabel } from "./variants.js";

/**
 * Quantity the server will honour for a requested line: an integer in
 * [1, maxQty]. Junk ("abc", null, -3, 2.7) never raises a charge above what
 * the shopper could have asked for.
 */
export function clampQty(raw, maxQty) {
  const n = parseInt(raw, 10);
  return Math.max(1, Math.min(Number.isFinite(n) ? n : 1, maxQty));
}

/**
 * Check a resolved line against the variant's current stock. Returns an error
 * string for the shopper, or null when the line can be reserved. Nothing is
 * ever partially fulfilled: a line asking for 3 of a variant with 2 left is
 * rejected whole, with the real number, so the shopper decides.
 */
export function stockProblem(product, variant, qty) {
  const label = variantLabel(variant);
  if (variant.stock <= 0) return `"${product.name}" (${label}) is sold out`;
  if (variant.stock < qty) return `"${product.name}" (${label}) has only ${variant.stock} left in stock`;
  return null;
}

/**
 * Price resolved lines from database values only — the client sends ids,
 * options and quantities, never prices.
 *
 * @param lines  [{ product, variant, qty }]
 * @param rules  { deliveryFor(subtotalCents) -> cents }
 * @returns { items, subtotal_cents, delivery_cents, total_cents }
 */
export function priceOrder(lines, { deliveryFor }) {
  const items = lines.map(({ product, variant, qty }) => {
    const price = unitPrice(product, variant);
    return {
      product: product._id,
      name: product.name,
      price_cents: price,
      qty,
      size: variant?.size ?? null,
      color: variant?.color ?? null,
      sku: variant?.sku ?? null,
      line_cents: price * qty,
    };
  });
  const subtotal = items.reduce((sum, i) => sum + i.line_cents, 0);
  const delivery = deliveryFor(subtotal);
  return {
    items: items.map(({ line_cents: _omit, ...i }) => i),
    subtotal_cents: subtotal,
    delivery_cents: delivery,
    total_cents: subtotal + delivery,
  };
}
