import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * The SPA shell as a crawler receives it, against a real MongoDB. A throwaway
 * dist/index.html stands in for the frontend build, so this runs in CI's
 * backend job too (which doesn't build the frontend).
 */
const dist = fs.mkdtempSync(path.join(os.tmpdir(), "bayan-dist-"));
fs.writeFileSync(path.join(dist, "index.html"), '<!doctype html><html lang="en"><head><title>x</title></head><body><div id="root"></div></body></html>');
process.env.FRONTEND_DIST = dist;
const { startHarness } = await import("./helpers/harness.js");
const h = await startHarness();

describe("seo", { skip: h.skip }, () => {
  after(async () => {
    await h.stop();
    fs.rmSync(dist, { recursive: true, force: true });
  });
  const get = (p) => fetch(h.origin + p).then(async (r) => ({ status: r.status, text: await r.text(), type: r.headers.get("content-type") }));

  test("a product URL is served with its own title, description and JSON-LD", async () => {
    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 3 }], { name: "Field Jacket", description: "Waxed cotton." });
    const r = await get(`/product/${p.slug}`);
    assert.equal(r.status, 200);
    assert.match(r.text, /<title>Field Jacket · Bayan<\/title>/);
    assert.match(r.text, /<meta name="description" content="Waxed cotton." \/>/);
    assert.match(r.text, /"@type":"Product"/);
    assert.match(r.text, new RegExp(`<link rel="canonical" href="http://shop.test/product/${p.slug}" />`), "canonical uses APP_URL");
  });

  test("missing products and unknown paths answer 404 with the app shell", async () => {
    const r = await get("/product/does-not-exist");
    assert.equal(r.status, 404);
    assert.match(r.text, /noindex/);
    assert.match(r.text, /id="root"/, "the SPA still renders its not-found page");
    assert.equal((await get("/some/random/path")).status, 404);
    assert.equal((await get("/checkout")).status, 200);
  });

  test("robots.txt and sitemap.xml", async () => {
    const robots = await get("/robots.txt");
    assert.match(robots.text, /Sitemap: http:\/\/shop.test\/sitemap.xml/);
    const map = await get("/sitemap.xml");
    assert.match(map.type, /xml/);
    assert.match(map.text, /<loc>http:\/\/shop.test\/product\/test-/);
  });
});
