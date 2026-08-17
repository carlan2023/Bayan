/**
 * Product payload validation and normalisation.
 *
 * Kept free of database and filesystem imports so it can be unit-tested
 * directly — this is the code that guards catalogue integrity and pricing.
 */

export const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Returns an array of human-readable problems; empty means valid. */
export function validateProduct(body) {
  const errors = [];
  if (!body.name?.trim()) errors.push("name is required");
  if (!body.description?.trim()) errors.push("description is required");
  if (!body.category?.trim()) errors.push("category is required");

  const price = Number(body.price_cents);
  if (!Number.isInteger(price) || price <= 0) errors.push("price_cents must be a positive integer");

  if (!HEX.test(body.swatch || "")) errors.push("swatch must be a hex colour like #2e4b3f");

  if (
    !Array.isArray(body.colors) ||
    body.colors.length === 0 ||
    body.colors.some((c) => !c.name || !HEX.test(c.hex || ""))
  ) {
    errors.push("colors must be a non-empty array of {name, hex}");
  } else if (body.colors.some((c) => !String(c.image || "").trim())) {
    errors.push("each colour must have a product image");
  }

  if (!Array.isArray(body.sizes) || body.sizes.length === 0 || body.sizes.some((s) => !String(s).trim())) {
    errors.push("sizes must be a non-empty array of strings");
  }

  const stock = Number(body.stock);
  if (!Number.isInteger(stock) || stock < 0) errors.push("stock must be a non-negative integer");

  if (body.compare_at_cents != null && body.compare_at_cents !== "") {
    const cmp = Number(body.compare_at_cents);
    if (!Number.isInteger(cmp) || cmp <= price) {
      errors.push("compare_at_cents must be an integer greater than price");
    }
  }
  return errors;
}

/** Normalised, trimmed fields ready to assign onto a Product document. */
export const productFields = (b) => ({
  name: b.name.trim(),
  description: b.description.trim(),
  category: b.category.trim(),
  price_cents: Number(b.price_cents),
  compare_at_cents: b.compare_at_cents ? Number(b.compare_at_cents) : null,
  swatch: b.swatch.toLowerCase(),
  // Hero image: use the explicit one, otherwise fall back to the first colour's
  // photo so every product always ships with a real image (no placeholders).
  image: b.image?.trim() || b.colors?.find((c) => c.image?.trim())?.image?.trim() || null,
  colors: b.colors.map((c) => ({
    name: String(c.name).trim(),
    hex: String(c.hex).toLowerCase(),
    image: String(c.image || "").trim() || null,
  })),
  sizes: b.sizes.map((s) => String(s).trim()),
  fabric: b.fabric?.trim() || null,
  featured: !!b.featured,
  stock: Number(b.stock),
});
