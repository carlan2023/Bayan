import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseCsv, readSheetRows, rowsToProducts, toCents, toDocument } from "../src/catalogue-import.js";

/* Catalogue import: parsing and mapping, no database. */
const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "catalogue.xlsx");

test("CSV: quoted commas, doubled quotes, embedded newlines, CRLF and a BOM", () => {
  const rows = parseCsv('﻿a,b,c\r\n"1,5","say ""hi""","two\nlines"\r\n\r\nx,,z');
  assert.deepEqual(rows, [
    ["a", "b", "c"],
    ["1,5", 'say "hi"', "two\nlines"],
    ["x", "", "z"],
  ]);
});

test("prices are read in major units whatever the formatting", () => {
  assert.equal(toCents("175,000"), 17500000);
  assert.equal(toCents("USh 175000"), 17500000);
  assert.equal(toCents(99.5), 9950);
  assert.ok(Number.isNaN(toCents("")));
});

test("XLSX is read by its bytes, and header aliases map to columns", async () => {
  const rows = await readSheetRows(fs.readFileSync(fixture));
  const { products, errors } = rowsToProducts(rows);
  assert.deepEqual(errors, []);
  assert.equal(products.length, 1);
  const p = products[0].payload;
  assert.equal(products[0].slug, "field-jacket");
  assert.equal(p.category, "Men");
  assert.equal(p.price_cents, 32000000);
  assert.equal(p.compare_at_cents, 38000000);
  assert.deepEqual(p.sizes, ["M", "L"]);
  assert.deepEqual(p.variants.map((v) => v.stock), [4, 2]);
  assert.equal(p.colors[0].image, "https://images.unsplash.com/a.jpg", "the product image fills a colour without its own");
});

test("missing size/colour pairs are made with zero stock, so the grid is complete", () => {
  const { products, errors } = rowsToProducts([
    ["name", "category", "description", "price", "size", "color", "color_hex", "image", "stock"],
    ["Tee", "Tops", "A tee", "100", "S", "Red", "#ff0000", "https://x.test/a.jpg", "1"],
    ["Tee", "", "", "", "M", "Blue", "#0000ff", "", "2"],
  ]);
  assert.deepEqual(errors, []);
  const v = products[0].payload.variants.map((x) => `${x.size}/${x.color}:${x.stock}`).sort();
  assert.deepEqual(v, ["M/Blue:2", "M/Red:0", "S/Blue:0", "S/Red:1"]);
});

test("toDocument generates SKUs and keeps alert clocks on re-import", () => {
  const { products } = rowsToProducts([
    ["handle", "name", "category", "description", "price", "size", "color", "color_hex", "image", "stock"],
    ["tee", "Tee", "Tops", "A tee", "100", "S", "Red", "#ff0000", "https://x.test/a.jpg", "1"],
  ]);
  const at = new Date();
  const doc = toDocument(products[0], { variants: [{ size: "S", color: "Red", low_stock_alert_at: at }] }, 5);
  assert.equal(doc.variants[0].sku, "TEE-RED-S");
  assert.equal(doc.variants[0].low_stock_alert_at, at);
});
