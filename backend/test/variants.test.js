import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveVariant,
  splitStock,
  totalStock,
  variantsFromFlatStock,
  validateVariants,
  normaliseVariants,
  defaultSku,
  variantFilter,
  variantInc,
} from "../src/variants.js";
import { validateProduct } from "../src/product-fields.js";

const dress = {
  name: "Linen Dress",
  price_cents: 100,
  variants: [
    { size: "S", color: "Forest", stock: 0 },
    { size: "M", color: "Forest", stock: 3 },
    { size: "M", color: "Ivory", stock: 1 },
  ],
};

test("resolveVariant matches size and colour exactly", () => {
  assert.equal(resolveVariant(dress, "M", "Ivory").variant.stock, 1);
  assert.match(resolveVariant(dress, "S", "Ivory").error, /not made in S \/ Ivory/);
  assert.match(resolveVariant(dress, null, "Forest").error, /choose a size/);
  assert.match(resolveVariant(dress, "M", null).error, /choose a colour/);
});

test("a single-option product lets the shopper omit that option", () => {
  const tote = { name: "Tote", variants: [{ size: "One size", color: "Tan", stock: 4 }, { size: "One size", color: "Espresso", stock: 2 }] };
  assert.equal(resolveVariant(tote, null, "Espresso").variant.stock, 2);
  const hoops = { name: "Hoops", variants: [{ size: "One size", color: "Gold", stock: 4 }] };
  assert.equal(resolveVariant(hoops, null, null).variant.color, "Gold");
});

test("an unmigrated product (no variants) cannot be ordered", () => {
  assert.match(resolveVariant({ name: "Old", variants: [] }, "M", "Red").error, /not available/);
});

test("splitStock preserves the total exactly", () => {
  for (const total of [0, 1, 7, 40, 41, 999]) {
    const v = splitStock(total, ["S", "M", "L"], ["Red", "Blue"]);
    assert.equal(v.length, 6);
    assert.equal(totalStock(v), total, `total ${total}`);
    const counts = v.map((x) => x.stock);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, "spread evenly");
  }
});

test("splitStock is deterministic, so re-running a migration cannot shuffle stock", () => {
  assert.deepEqual(splitStock(41, ["S", "M"], ["Red"]), splitStock(41, ["S", "M"], ["Red"]));
});

test("variantsFromFlatStock builds the full grid with default SKUs", () => {
  const v = variantsFromFlatStock({
    slug: "linen-dress",
    stock: 10,
    sizes: ["S", "M"],
    colors: [{ name: "Forest" }, { name: "Ivory" }],
  });
  assert.equal(v.length, 4);
  assert.equal(totalStock(v), 10);
  assert.equal(v[0].sku, "LINEN-DRESS-FOREST-S");
  assert.ok(v.every((x) => x.price_cents === null && x.low_stock_alert_at === null));
});

test("defaultSku is upper-case and punctuation-free", () => {
  assert.equal(defaultSku("slim-chinos", "32", "Ink Navy"), "SLIM-CHINOS-INK-NAVY-32");
  assert.equal(defaultSku("tote", "One size", "Tan"), "TOTE-TAN-ONE-SIZE");
});

test("totalStock ignores junk and negatives", () => {
  assert.equal(totalStock([{ stock: 2 }, { stock: -5 }, { stock: "x" }, { stock: 3 }]), 5);
  assert.equal(totalStock(), 0);
});

test("validateVariants rejects pairs outside the product's options", () => {
  const errs = validateVariants(
    [
      { size: "M", color: "Forest", stock: 1 },
      { size: "XXL", color: "Forest", stock: 1 },
      { size: "M", color: "Pink", stock: 1 },
    ],
    ["S", "M"],
    ["Forest"]
  );
  assert.equal(errs.length, 2);
  assert.match(errs[0], /size "XXL"/);
  assert.match(errs[1], /colour "Pink"/);
});

test("validateVariants rejects duplicates, bad stock, bad prices and repeated SKUs", () => {
  const errs = validateVariants(
    [
      { size: "M", color: "Forest", stock: 1, sku: "A" },
      { size: "M", color: "Forest", stock: 1, sku: "B" },
      { size: "S", color: "Forest", stock: -1, sku: "A" },
      { size: "L", color: "Forest", stock: 1.5, price_cents: 0 },
    ],
    ["S", "M", "L"],
    ["Forest"]
  ).join("\n");
  assert.match(errs, /listed twice/);
  assert.match(errs, /stock must be a non-negative integer/);
  assert.match(errs, /SKU "A" is used twice/);
  assert.match(errs, /price_cents must be a positive integer/);
  assert.deepEqual(validateVariants([], ["M"], ["Red"]).length, 1);
});

test("normaliseVariants keeps an alert clock unless the pair was restocked", () => {
  const clock = new Date("2026-01-01");
  const previous = [
    { size: "M", color: "Forest", low_stock_alert_at: clock },
    { size: "L", color: "Forest", low_stock_alert_at: clock },
  ];
  const out = normaliseVariants(
    [
      { size: "M", color: "Forest", stock: 2 },
      { size: "L", color: "Forest", stock: 40, price_cents: "15000" },
    ],
    { slug: "d", previous, threshold: 5 }
  );
  assert.equal(out[0].low_stock_alert_at, clock, "still low: keep the clock");
  assert.equal(out[1].low_stock_alert_at, null, "restocked: reset the clock");
  assert.equal(out[1].price_cents, 15000);
  assert.equal(out[0].sku, "D-FOREST-M", "blank SKU gets the default");
});

test("the reservation filter guards on the variant's own stock", () => {
  assert.deepEqual(variantFilter("id", { size: "M", color: "Forest" }, 2), {
    _id: "id",
    variants: { $elemMatch: { size: "M", color: "Forest", stock: { $gte: 2 } } },
  });
  // Variant and derived total move in the same write.
  assert.deepEqual(variantInc(-2), { $inc: { "variants.$.stock": -2, stock: -2 } });
});

test("validateProduct accepts variants and checks them against sizes/colours", () => {
  const base = {
    name: "X",
    description: "d",
    category: "Women",
    price_cents: 100,
    swatch: "#112233",
    colors: [{ name: "Red", hex: "#ff0000", image: "/uploads/a.jpg" }],
    sizes: ["S", "M"],
  };
  assert.deepEqual(validateProduct({ ...base, variants: [{ size: "S", color: "Red", stock: 1 }] }), []);
  assert.match(validateProduct({ ...base, variants: [{ size: "XL", color: "Red", stock: 1 }] }).join(), /size "XL"/);
  assert.deepEqual(validateProduct({ ...base, stock: 10 }), [], "legacy flat stock is still accepted");
  assert.match(validateProduct(base).join(), /variants are required/);
});
