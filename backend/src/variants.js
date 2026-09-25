/**
 * Per-variant inventory helpers.
 *
 * A product used to carry one `stock` integer while `sizes` and `colors` were
 * independent arrays, so nothing could say "sold out in XS, three left in L" —
 * the central inventory question in clothing. Stock now lives on
 * `variants: [{ size, color, sku, stock, price_cents? }]`, one row per
 * size/colour pair, and `product.stock` is kept as a derived total for the
 * listing, the product card and the dashboard.
 *
 * Kept free of database imports so the rules can be unit-tested directly; the
 * order route, the admin routes, the stock alerts and the migration all go
 * through these functions rather than re-deriving them.
 */

/** Identity of a variant within its product. SKUs are editable; this pair is not. */
export const variantKey = (size, color) => `${size ?? ""}|${color ?? ""}`;

/** Human label used in alerts, errors and the dashboard: "M / Forest". */
export const variantLabel = (v) => [v.size, v.color].filter(Boolean).join(" / ");

/** Sum of variant stock — the value `product.stock` must always equal. */
export const totalStock = (variants = []) =>
  variants.reduce((n, v) => n + Math.max(0, Number(v.stock) || 0), 0);

/** A line's unit price: the variant's override when set, otherwise the product's. */
export const unitPrice = (product, variant) =>
  variant && Number.isInteger(variant.price_cents) && variant.price_cents > 0
    ? variant.price_cents
    : product.price_cents;

const skuPart = (s) =>
  String(s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/** Default SKU for a size/colour pair: SLUG-COLOUR-SIZE, upper-cased. */
export const defaultSku = (slug, size, color) =>
  [skuPart(slug), skuPart(color), skuPart(size)].filter(Boolean).join("-");

/**
 * Find the variant a cart line refers to.
 *
 * A product with a single size or a single colour lets the shopper omit that
 * option (old carts and the WhatsApp flow do); otherwise both must match
 * exactly. Returns `{ variant }` or `{ error }` with a message fit for the shopper.
 */
export function resolveVariant(product, size, color) {
  const variants = product.variants || [];
  if (variants.length === 0) {
    return { error: `"${product.name}" is not available to order right now` };
  }
  const sizes = [...new Set(variants.map((v) => v.size))];
  const colors = [...new Set(variants.map((v) => v.color))];
  const wantSize = size || (sizes.length === 1 ? sizes[0] : null);
  const wantColor = color || (colors.length === 1 ? colors[0] : null);
  if (!wantSize) return { error: `Please choose a size for "${product.name}"` };
  if (!wantColor) return { error: `Please choose a colour for "${product.name}"` };

  const variant = variants.find((v) => v.size === wantSize && v.color === wantColor);
  if (!variant) {
    return { error: `"${product.name}" is not made in ${variantLabel({ size: wantSize, color: wantColor })}` };
  }
  return { variant };
}

/**
 * Split a flat stock count across every size/colour pair.
 *
 * Used by the migration and the seed. There is no right answer to "which sizes
 * did those 40 units belong to", so the total is preserved exactly and spread
 * evenly (the remainder going to the first pairs); the shop should recount per
 * variant afterwards. Deterministic, so re-running produces the same split.
 */
export function splitStock(total, sizes, colorNames) {
  const pairs = [];
  const sz = sizes?.length ? sizes : ["One size"];
  const cl = colorNames?.length ? colorNames : ["Default"];
  for (const color of cl) for (const size of sz) pairs.push({ size, color });
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const each = Math.floor(n / pairs.length);
  let rest = n - each * pairs.length;
  return pairs.map((p) => ({ ...p, stock: each + (rest-- > 0 ? 1 : 0) }));
}

/** Build variants for a product that only has a flat `stock`. */
export const variantsFromFlatStock = (product) =>
  splitStock(
    product.stock,
    product.sizes,
    (product.colors || []).map((c) => c.name)
  ).map((v) => ({
    ...v,
    sku: defaultSku(product.slug, v.size, v.color),
    price_cents: null,
    low_stock_alert_at: null,
  }));

/**
 * Validate an admin-supplied variants array against the product's own sizes and
 * colours. Returns a list of problems; empty means valid.
 */
export function validateVariants(variants, sizes, colorNames) {
  const errors = [];
  if (!Array.isArray(variants) || variants.length === 0) {
    return ["variants must be a non-empty array of {size, color, stock}"];
  }
  const sizeSet = new Set((sizes || []).map((s) => String(s).trim()));
  const colorSet = new Set((colorNames || []).map((c) => String(c).trim()));
  const seen = new Set();
  const skus = new Set();
  variants.forEach((v, i) => {
    const at = `variant ${i + 1}`;
    const size = String(v?.size ?? "").trim();
    const color = String(v?.color ?? "").trim();
    if (!sizeSet.has(size)) errors.push(`${at}: size "${size}" is not one of the product's sizes`);
    if (!colorSet.has(color)) errors.push(`${at}: colour "${color}" is not one of the product's colours`);
    const key = variantKey(size, color);
    if (seen.has(key)) errors.push(`${at}: ${variantLabel({ size, color })} is listed twice`);
    seen.add(key);
    const stock = Number(v?.stock);
    if (!Number.isInteger(stock) || stock < 0) errors.push(`${at}: stock must be a non-negative integer`);
    if (v?.price_cents != null && v.price_cents !== "") {
      const p = Number(v.price_cents);
      if (!Number.isInteger(p) || p <= 0) errors.push(`${at}: price_cents must be a positive integer`);
    }
    const sku = String(v?.sku ?? "").trim();
    if (sku) {
      if (skus.has(sku)) errors.push(`${at}: SKU "${sku}" is used twice`);
      skus.add(sku);
    }
  });
  return errors;
}

/**
 * Normalise admin-supplied variants, carrying each pair's low-stock alert clock
 * over from the stored product so an edit doesn't re-fire yesterday's alert —
 * unless the pair was restocked above `threshold`, which resets it.
 */
export function normaliseVariants(variants, { slug, previous = [], threshold = Infinity } = {}) {
  const prev = new Map(previous.map((v) => [variantKey(v.size, v.color), v]));
  return variants.map((v) => {
    const size = String(v.size).trim();
    const color = String(v.color).trim();
    const stock = Number(v.stock);
    const old = prev.get(variantKey(size, color));
    const price = v.price_cents == null || v.price_cents === "" ? null : Number(v.price_cents);
    return {
      size,
      color,
      sku: String(v.sku ?? "").trim() || defaultSku(slug, size, color),
      stock,
      price_cents: price,
      low_stock_alert_at: stock > threshold ? null : old?.low_stock_alert_at ?? null,
    };
  });
}

/** Mongo filter matching one variant of one product, optionally with enough stock. */
export const variantFilter = (productId, { size, color }, minStock = null) => ({
  _id: productId,
  variants: {
    $elemMatch: minStock == null ? { size, color } : { size, color, stock: { $gte: minStock } },
  },
});

/**
 * Update moving `qty` units in (positive) or out (negative) of a variant.
 * The positional `$` targets the element the $elemMatch filter matched, and the
 * derived total moves in the same single-document write, so the two can never
 * disagree — no transaction (and no replica set) required.
 */
export const variantInc = (qty) => ({ $inc: { "variants.$.stock": qty, stock: qty } });
