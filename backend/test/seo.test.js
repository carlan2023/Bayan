import { test } from "node:test";
import assert from "node:assert/strict";
import { pageMeta, sitemapXml, robotsTxt, isKnownRoute } from "../src/seo.js";
import { renderShell } from "../src/shell.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { publicConfig } from "../src/config.js";

/* What crawlers and link previews see, without a server. */
const base = "https://shop.example";
const settings = DEFAULT_SETTINGS;
const product = {
  slug: "linen-dress",
  name: "Linen Dress",
  description: "A breezy wrap dress in washed linen. ".repeat(10),
  category: "Women",
  price_cents: 17000000,
  image: "/uploads/1-aaaaaaaaaaaa.webp",
  colors: [{ name: "Forest", image: "https://images.unsplash.com/x.jpg" }],
  variants: [
    { size: "S", color: "Forest", sku: "LD-S", stock: 0, price_cents: null },
    { size: "M", color: "Forest", sku: "LD-M", stock: 2, price_cents: 18000000 },
  ],
};

test("a product page describes the product, with an absolute image and schema.org offers", () => {
  const m = pageMeta({ path: "/product/linen-dress", settings, base, product });
  assert.equal(m.status, 200);
  assert.equal(m.title, "Linen Dress · Bayan");
  assert.ok(m.description.length <= 160 && m.description.endsWith("…"));
  assert.equal(m.canonical, "https://shop.example/product/linen-dress");
  assert.equal(m.image, "https://shop.example/uploads/1-aaaaaaaaaaaa.webp");
  const ld = m.jsonLd[0];
  assert.equal(ld["@type"], "Product");
  assert.equal(ld.offers["@type"], "AggregateOffer", "variant prices differ");
  assert.equal(ld.offers.lowPrice, "170000.00");
  assert.equal(ld.offers.highPrice, "180000.00");
  assert.equal(ld.offers.priceCurrency, "UGX");
  assert.equal(ld.offers.availability, "https://schema.org/InStock");
});

test("sold out reads as OutOfStock; a missing product is a noindexed 404", () => {
  const sold = { ...product, stock: 0, variants: product.variants.map((v) => ({ ...v, stock: 0, price_cents: null })) };
  const m = pageMeta({ path: "/product/linen-dress", settings, base, product: sold });
  assert.equal(m.jsonLd[0].offers["@type"], "Offer");
  assert.equal(m.jsonLd[0].offers.availability, "https://schema.org/OutOfStock");
  const gone = pageMeta({ path: "/product/nope", settings, base, product: null });
  assert.equal(gone.status, 404);
  assert.ok(gone.noindex);
});

test("unknown routes are 404s; private pages are noindex; search results too", () => {
  assert.equal(pageMeta({ path: "/wp-login.php", settings, base }).status, 404);
  assert.ok(isKnownRoute("/order/abc/payment"));
  for (const p of ["/admin", "/admin/orders", "/checkout", "/account", "/cart", "/track"]) {
    assert.ok(pageMeta({ path: p, settings, base }).noindex, p);
  }
  assert.ok(!pageMeta({ path: "/shop", settings, base }).noindex);
  assert.ok(pageMeta({ path: "/shop", query: { search: "x" }, settings, base }).noindex);
  assert.equal(pageMeta({ path: "/shop", query: { category: "Men & Boys" }, settings, base }).canonical, "https://shop.example/shop?category=Men%20%26%20Boys");
});

test("the home page carries Store and WebSite (with search) structured data, and filled-in copy", () => {
  const m = pageMeta({ path: "/", settings, base });
  assert.deepEqual(m.jsonLd.map((x) => x["@type"]), ["Store", "WebSite"]);
  assert.ok(!m.description.includes("{"));
});

test("the shell carries the meta, escaped, and the page language", () => {
  const html = `<!doctype html><html lang="en"><head><title>x</title></head><body></body></html>`;
  const m = pageMeta({ path: "/product/linen-dress", settings, base, product: { ...product, name: 'Say "hi" <b>' } });
  const out = renderShell(html, publicConfig({ ...settings, locale: "fr-RW" }), m);
  assert.ok(out.includes("<title>Say &quot;hi&quot; &lt;b&gt; · Bayan</title>"));
  assert.ok(out.includes('<html lang="fr">'));
  assert.ok(out.includes('<meta property="og:image" content="https://shop.example/uploads/1-aaaaaaaaaaaa.webp" />'));
  assert.ok(out.includes('<link rel="canonical" href="https://shop.example/product/linen-dress" />'));
  assert.ok(out.includes('<script type="application/ld+json">'));
  assert.ok(!out.includes("<b>"), "no raw markup from product data");
});

test("sitemap and robots", () => {
  const xml = sitemapXml(base, { products: [{ slug: "a&b", updated_at: "2026-09-01T10:00:00Z" }], categories: ["Women"] });
  assert.ok(xml.includes("<loc>https://shop.example/product/a&amp;b</loc><lastmod>2026-09-01</lastmod>"));
  assert.ok(xml.includes("<loc>https://shop.example/shop?category=Women</loc>"));
  const robots = robotsTxt(base);
  assert.ok(robots.includes("Disallow: /admin"));
  assert.ok(robots.includes("Sitemap: https://shop.example/sitemap.xml"));
});
