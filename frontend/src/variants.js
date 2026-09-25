/**
 * Client-side view of per-variant stock. Mirrors backend/src/variants.js: a
 * product carries `variants: [{ size, color, sku, stock, price_cents }]`, one
 * row per size/colour pair, and `product.stock` is only the derived total.
 *
 * The server re-checks everything at checkout; these helpers only decide what
 * the shopper is offered, so a sold-out pair is disabled instead of failing
 * at the last step.
 */

/** The variant for a size/colour pair, or null. A single-option product may omit that option. */
export function findVariant(product, size, color) {
  const variants = product?.variants || [];
  if (variants.length === 0) return null;
  const sizes = [...new Set(variants.map((v) => v.size))];
  const colors = [...new Set(variants.map((v) => v.color))];
  const s = size || (sizes.length === 1 ? sizes[0] : null);
  const c = color || (colors.length === 1 ? colors[0] : null);
  if (!s || !c) return null;
  return variants.find((v) => v.size === s && v.color === c) || null;
}

/** Units available for a pair (0 when the pair isn't made). */
export const stockOf = (product, size, color) => findVariant(product, size, color)?.stock ?? 0;

/** Is any size in stock for this colour? */
export const colorAvailable = (product, color) =>
  (product?.variants || []).some((v) => v.color === color && v.stock > 0);

/** Unit price for a pair: the variant's override when set, else the product's. */
export function priceOf(product, size, color) {
  const v = findVariant(product, size, color);
  return v && Number.isInteger(v.price_cents) && v.price_cents > 0 ? v.price_cents : product.price_cents;
}

/** Lowest and highest price across in-stock variants, for "from" pricing. */
export function priceRange(product) {
  const prices = (product?.variants || []).map((v) =>
    Number.isInteger(v.price_cents) && v.price_cents > 0 ? v.price_cents : product.price_cents
  );
  if (prices.length === 0) return { min: product.price_cents, max: product.price_cents };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
