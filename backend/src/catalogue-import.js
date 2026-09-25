/**
 * Catalogue import from a spreadsheet (CSV or XLSX), so a real shop can load
 * its own stock instead of the demo seed.
 *
 * One row per size/colour variant. Rows that share a `handle` (or, without
 * one, a `name`) are one product; product-level columns are read from the
 * first row that fills them in, so they need only appear once.
 *
 *   handle            optional; groups rows and becomes the URL slug
 *   name *            product name
 *   category *        e.g. Women (appears in the menu once it's a department)
 *   description *
 *   price *           in the shop's currency, major units: 175000 for USh 175,000
 *   compare_at_price  optional "was" price, above price
 *   fabric            optional
 *   featured          yes / no
 *   image             product photo URL (also used for colours without their own)
 *   size *            e.g. M, or "One size"
 *   color *           e.g. Forest
 *   color_hex         #rrggbb (defaults to the product's swatch)
 *   color_image       photo of that colour
 *   sku               optional; generated when empty
 *   stock *           units of this size/colour
 *   variant_price     optional override for this size/colour
 *
 * Header names are matched case-insensitively, ignoring spaces and
 * punctuation, so "Compare at price" and "compare_at_price" both work.
 *
 * Products are upserted by slug: re-importing an edited sheet updates prices,
 * copy and stock in place rather than duplicating. Nothing is written unless
 * every product in the file is valid, so a typo on row 300 can't leave half a
 * catalogue behind.
 *
 * Kept free of database imports; routes/admin-import.js and
 * src/import-catalogue.js (the CLI) do the writing.
 */
import { slugify, validateProduct, productFields, variantFields } from "./product-fields.js";

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_ROWS = 5000;

/** Header aliases → canonical column. */
const COLUMNS = {
  handle: ["handle", "slug", "productid", "productcode"],
  name: ["name", "productname", "title"],
  category: ["category", "department", "type"],
  description: ["description", "desc", "details"],
  price: ["price", "unitprice"],
  compare_at_price: ["compareatprice", "compareat", "wasprice", "originalprice", "rrp"],
  fabric: ["fabric", "material"],
  featured: ["featured"],
  image: ["image", "imageurl", "photo", "productimage"],
  size: ["size"],
  color: ["color", "colour"],
  color_hex: ["colorhex", "colourhex", "hex", "swatch"],
  color_image: ["colorimage", "colourimage", "colorphoto", "colourphoto"],
  sku: ["sku", "barcode", "variantsku"],
  stock: ["stock", "quantity", "qty", "inventory"],
  variant_price: ["variantprice", "sizeprice", "priceoverride"],
};
const norm = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIAS = new Map(Object.entries(COLUMNS).flatMap(([col, names]) => names.map((n) => [n, col])));

/* ---------------- Parsing ---------------- */

/**
 * RFC 4180 CSV: quoted fields may contain commas, quotes ("") and newlines.
 * A UTF-8 BOM (what Excel writes) is dropped. Returns an array of string arrays.
 */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

/** Read a sheet from an uploaded buffer, by its bytes (XLSX is a zip: "PK"). */
export async function readSheetRows(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const { readSheet } = await import("read-excel-file/node");
    const rows = await readSheet(buffer);
    return rows.map((r) => r.map((v) => (v == null ? "" : v))).filter((r) => r.some((v) => String(v).trim() !== ""));
  }
  return parseCsv(buffer.toString("utf8"));
}

/* ---------------- Mapping rows to products ---------------- */

const text = (v) => (v == null ? "" : String(v).trim());
/** Major units → cents; accepts "175,000", "USh 175000", 175000. NaN when not a number. */
export function toCents(v) {
  if (typeof v === "number") return Math.round(v * 100);
  const cleaned = text(v).replace(/[^0-9.-]/g, "");
  if (!cleaned) return NaN;
  return Math.round(Number(cleaned) * 100);
}
const yes = (v) => /^(y|yes|true|1|x)$/i.test(text(v));

/**
 * Turn sheet rows (first row = headers) into product payloads.
 * @returns {{ products: [{ slug, payload, rows }], errors: string[] }}
 */
export function rowsToProducts(rows) {
  const errors = [];
  if (!rows.length) return { products: [], errors: ["The file is empty"] };
  if (rows.length - 1 > MAX_ROWS) return { products: [], errors: [`At most ${MAX_ROWS} rows per import`] };

  const header = rows[0].map((h) => ALIAS.get(norm(h)) || null);
  for (const col of ["name", "category", "description", "price", "size", "color", "stock"]) {
    if (!header.includes(col)) errors.push(`Missing column "${col}"`);
  }
  if (errors.length) return { products: [], errors };

  const groups = new Map();
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2; // spreadsheet row number, counting the header
    const r = {};
    header.forEach((col, j) => {
      if (col && r[col] === undefined) r[col] = cells[j];
    });
    const key = slugify(text(r.handle) || text(r.name));
    if (!key) return errors.push(`Row ${line}: a name (or handle) is required`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ line, r });
  });

  const products = [];
  for (const [slug, lines] of groups) {
    const first = (col) => lines.map(({ r }) => text(r[col])).find(Boolean) || "";
    const at = `"${first("name") || slug}" (row${lines.length > 1 ? "s" : ""} ${lines.map((l) => l.line).join(", ")})`;
    const price = toCents(first("price"));
    const compare = first("compare_at_price") ? toCents(first("compare_at_price")) : null;
    const image = first("image");

    const colors = [];
    const sizes = [];
    const variants = [];
    for (const { line, r } of lines) {
      const size = text(r.size);
      const color = text(r.color);
      if (!size || !color) {
        errors.push(`Row ${line}: size and colour are required`);
        continue;
      }
      if (!sizes.includes(size)) sizes.push(size);
      let c = colors.find((x) => x.name === color);
      if (!c) {
        c = { name: color, hex: "", image: "" };
        colors.push(c);
      }
      const hex = text(r.color_hex);
      if (hex && !c.hex) {
        if (!HEX.test(hex)) errors.push(`Row ${line}: colour hex "${hex}" must look like #2e4b3f`);
        else c.hex = hex.toLowerCase();
      }
      if (text(r.color_image) && !c.image) c.image = text(r.color_image);

      const stock = Number(text(r.stock) || 0);
      const vp = text(r.variant_price) ? toCents(r.variant_price) : null;
      if (vp !== null && !(vp > 0)) errors.push(`Row ${line}: variant price must be a positive number`);
      variants.push({ size, color, sku: text(r.sku), stock, price_cents: vp });
    }

    const swatch = colors.find((c) => c.hex)?.hex || "#555555";
    for (const c of colors) {
      if (!c.hex) c.hex = swatch;
      if (!c.image) c.image = image;
    }

    // Every size/colour pair must exist; a pair the sheet doesn't list is made with zero stock.
    for (const c of colors) {
      for (const size of sizes) {
        if (!variants.some((v) => v.size === size && v.color === c.name)) {
          variants.push({ size, color: c.name, sku: "", stock: 0, price_cents: null });
        }
      }
    }

    const payload = {
      name: first("name"),
      category: first("category"),
      description: first("description"),
      price_cents: price,
      compare_at_cents: compare,
      fabric: first("fabric"),
      featured: lines.some(({ r }) => yes(r.featured)),
      swatch,
      image,
      colors,
      sizes,
      variants,
    };
    const problems = validateProduct(payload);
    for (const p of problems) errors.push(`${at}: ${p}`);
    products.push({ slug, payload, rows: lines.map((l) => l.line) });
  }
  return { products, errors };
}

/**
 * Validated product rows → the fields to write, with variants normalised
 * (SKUs generated, alert clocks carried over from `existing` when updating).
 */
export function toDocument({ slug, payload }, existing = null, threshold) {
  return {
    ...productFields(payload),
    variants: variantFields(payload, { slug, previous: existing?.variants || [], threshold }),
  };
}
