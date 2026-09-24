import { test } from "node:test";
import assert from "node:assert/strict";
import { renderShell, safeJson, themeCss } from "../src/shell.js";
import { publicConfig } from "../src/config.js";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings.js";

const HTML = `<!doctype html><html><head><title>Bayan — Considered Clothing &amp; Home</title></head><body><div id="root"></div></body></html>`;

test("the default shop adds no theme overrides", () => {
  assert.equal(themeCss(DEFAULT_SETTINGS), "");
  const out = renderShell(HTML, publicConfig(DEFAULT_SETTINGS));
  assert.ok(!out.includes('id="shop-theme"'));
  assert.ok(!out.includes('id="shop-fonts"'));
  assert.ok(out.includes('id="shop-config"'), "config is always embedded");
});

test("a rethemed shop gets its palette, fonts and title on first paint", () => {
  const s = mergeSettings(DEFAULT_SETTINGS, {
    page_title: "Acme <Bridal>",
    palette: { primary: "#6b1d2f" },
    fonts: { display: "Playfair Display" },
  });
  const out = renderShell(HTML, publicConfig(s));
  assert.ok(out.includes("<title>Acme &lt;Bridal&gt;</title>"), "title escaped");
  assert.ok(out.includes("--pine:#6b1d2f"), "palette key maps to its CSS token");
  assert.ok(out.includes('--font-display:"Playfair Display", Georgia, serif'));
  assert.ok(out.includes("family=Playfair+Display"));
});

test("embedded config cannot break out of its script element", () => {
  const s = mergeSettings(DEFAULT_SETTINGS, { shop_name: "</script><script>alert(1)</script>" });
  const out = renderShell(HTML, publicConfig(s));
  const block = out.slice(out.indexOf('id="shop-config"'));
  assert.equal((block.match(/<\/script>/g) || []).length, 1, "only the block's own closing tag");
  const json = block.slice(block.indexOf(">") + 1, block.indexOf("</script>"));
  assert.equal(JSON.parse(json).shop_name, s.shop_name, "still round-trips");
});

test("safeJson escapes line separators", () => {
  const out = safeJson({ a: String.fromCharCode(0x2028) });
  assert.ok(!out.includes(String.fromCharCode(0x2028)));
});
