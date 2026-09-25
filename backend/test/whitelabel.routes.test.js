import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startHarness, orderBody } from "./helpers/harness.js";

/*
 * White-label operations against a real MongoDB: settings drive what is
 * charged, the catalogue importer, and provisioning.
 */
const h = await startHarness();
const shopsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "shops");

const csv = (rows) => Buffer.from(rows.map((r) => r.join(",")).join("\n"));
const HEAD = ["handle", "name", "category", "description", "price", "size", "color", "color_hex", "image", "stock", "variant_price"];

describe("white-label operations", { skip: h.skip }, () => {
  let admin;
  before(async () => {
    admin = await h.login();
  });
  after(() => h.stop());

  const importFile = (buf, { dry = false, name = "stock.csv" } = {}) => {
    const form = new FormData();
    form.append("file", new Blob([buf]), name);
    return fetch(`${h.origin}/api/admin/import${dry ? "?dry=1" : ""}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${admin}` },
      body: form,
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  };

  test("/api/config serves the settings shape and keeps the original keys", async () => {
    const r = await h.api("GET", "/api/config");
    assert.equal(r.status, 200);
    for (const k of ["currency", "free_delivery_threshold_cents", "delivery_fee_cents", "max_qty_per_line", "urgency_stock_threshold"]) {
      assert.ok(k in r.body, k);
    }
    for (const k of ["shop_name", "palette", "fonts", "copy", "departments", "locale"]) assert.ok(k in r.body, k);
  });

  test("a changed delivery fee is quoted and charged at once, and audited", async () => {
    const put = await h.api("PUT", "/api/admin/settings", { token: admin, body: { delivery_fee_cents: 777700, max_qty_per_line: 2 } });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal((await h.api("GET", "/api/config")).body.delivery_fee_cents, 777700);

    const p = await h.makeProduct([{ size: "M", color: "Red", stock: 10 }]);
    const r = await h.api("POST", "/api/orders", { body: orderBody([{ product_id: p.id, size: "M", color: "Red", qty: 5 }]) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.order.items[0].qty, 2, "the per-line cap comes from settings too");
    assert.equal(r.body.order.delivery_cents, 777700);
    assert.equal(r.body.order.total_cents, 2 * 5000000 + 777700);

    const log = await h.api("GET", "/api/admin/audit?action=settings.update", { token: admin });
    assert.match(log.body.entries[0].summary, /delivery_fee_cents/);
    assert.equal(log.body.entries[0].before.delivery_fee_cents, 1000000);
  });

  test("invalid settings are refused whole", async () => {
    const r = await h.api("PUT", "/api/admin/settings", {
      token: admin,
      body: { delivery_fee_cents: 5, palette: { primary: "red" } },
    });
    assert.equal(r.status, 400);
    assert.notEqual((await h.api("GET", "/api/config")).body.delivery_fee_cents, 5);
  });

  test("catalogue import: dry run reports, apply writes variants, re-import updates in place", async () => {
    const rows = [
      HEAD,
      ["tee", "Plain Tee", "Tops", "A tee.", "25000", "S", "White", "#ffffff", "https://images.unsplash.com/x.jpg", "3", ""],
      ["tee", "", "", "", "", "M", "White", "", "", "5", "27000"],
      ["", "Wool Scarf", "Accessories", "Warm.", '"40,000"', "One size", "Grey", "#888888", "https://images.unsplash.com/y.jpg", "7", ""],
    ];
    const dry = await importFile(csv(rows), { dry: true });
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.equal(dry.body.written, false);
    assert.equal(dry.body.created, 2);
    assert.equal(await h.db.Product.countDocuments({ slug: "tee" }), 0, "a dry run writes nothing");

    const r = await importFile(csv(rows));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const tee = await h.db.Product.findOne({ slug: "tee" }).lean();
    assert.equal(tee.price_cents, 2500000);
    assert.equal(tee.stock, 8);
    assert.deepEqual(
      tee.variants.map((v) => [v.size, v.stock, v.price_cents]),
      [["S", 3, null], ["M", 5, 2700000]]
    );
    assert.equal(tee.variants[0].sku, "TEE-WHITE-S");
    assert.equal((await h.db.Product.findOne({ slug: "wool-scarf" }).lean()).price_cents, 4000000);

    rows[1][4] = "26000";
    rows[1][9] = "1";
    const again = await importFile(csv(rows));
    assert.equal(again.body.updated, 2);
    assert.equal(await h.db.Product.countDocuments({ slug: "tee" }), 1, "no duplicate");
    const tee2 = await h.db.Product.findOne({ slug: "tee" }).lean();
    assert.equal(tee2.price_cents, 2600000);
    assert.equal(tee2.stock, 6);
    const audit = await h.api("GET", "/api/admin/audit?action=product.price", { token: admin });
    assert.ok(audit.body.entries.some((e) => /Plain Tee/.test(e.summary)), "import price edits are audited");
  });

  test("an import with any bad row writes nothing and names the rows", async () => {
    const r = await importFile(
      csv([
        HEAD,
        ["good", "Good One", "Tops", "Fine.", "1000", "M", "Blue", "#0000ff", "https://images.unsplash.com/z.jpg", "1", ""],
        ["bad", "Bad One", "Tops", "Broken.", "not-a-price", "M", "Blue", "blue", "https://images.unsplash.com/z.jpg", "1", ""],
      ])
    );
    assert.equal(r.status, 422);
    assert.ok(r.body.errors.some((e) => /Row 3/.test(e)), r.body.errors.join(" | "));
    assert.equal(await h.db.Product.countDocuments({ slug: "good" }), 0);
  });

  test("the importer rejects a file without the required columns", async () => {
    const r = await importFile(Buffer.from("name,price\nShirt,100\n"));
    assert.equal(r.status, 422);
    assert.ok(r.body.errors.some((e) => /Missing column "category"/.test(e)));
  });

  test("provision is idempotent: settings, owner and catalogue", async () => {
    const { provision } = await import("../src/provision.js");
    const spec = JSON.parse(fs.readFileSync(path.join(shopsDir, "example.json"), "utf8"));
    const quiet = { baseDir: shopsDir, log: () => {}, password: "owner-pass-1" };

    const first = await provision(spec, quiet);
    assert.equal(first.imported.created, 3);
    const cfg = (await h.api("GET", "/api/config")).body;
    assert.equal(cfg.shop_name, "Acme Wear");
    assert.equal(cfg.currency, "KES");
    assert.equal(cfg.palette.primary, "#5b2333");
    assert.equal(cfg.palette.bg, "#f6f1e7", "unset palette keys keep their defaults");
    await h.login("owner@acme.example", "owner-pass-1");

    const second = await provision(spec, { ...quiet, password: "a-different-one" });
    assert.equal(second.imported.created, 0);
    assert.equal(second.imported.updated, 3);
    assert.equal(await h.db.User.countDocuments({ email: "owner@acme.example" }), 1);
    await h.login("owner@acme.example", "owner-pass-1"); // an existing owner's password is never reset
  });

  test("provision refuses invalid settings without changing anything", async () => {
    const { provision } = await import("../src/provision.js");
    const before = (await h.api("GET", "/api/config")).body.shop_name;
    await assert.rejects(
      provision({ settings: { currency: "pounds" }, owner: { email: "x@y.example" } }, { log: () => {} }),
      /Currency/
    );
    assert.equal((await h.api("GET", "/api/config")).body.shop_name, before);
    assert.equal(await h.db.User.countDocuments({ email: "x@y.example" }), 0);
  });
});
