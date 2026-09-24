import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { startHarness } from "./helpers/harness.js";

/* Admin invites, team guards, price-edit auditing, uploads and headers. */
const h = await startHarness();

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(56)]);

describe("admin team, audit and security", { skip: h.skip }, () => {
  let admin;
  before(async () => {
    admin = await h.login();
  });
  after(() => h.stop());

  const upload = (buf, filename, type) => {
    const form = new FormData();
    form.append("file", new Blob([buf], { type }), filename);
    return fetch(`${h.origin}/api/admin/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${admin}` },
      body: form,
    }).then(async (r) => ({ status: r.status, body: await r.json() }));
  };

  test("invite → accept creates a second admin, audited", async () => {
    const inv = await h.api("POST", "/api/admin/invites", {
      token: admin,
      body: { email: "second@test.com", name: "Second" },
    });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    assert.equal(inv.body.emailed, true);
    const token = new URL(inv.body.accept_url).searchParams.get("token");
    assert.ok(h.outbox.at(-1).text.includes(inv.body.accept_url));

    const preview = await h.api("GET", `/api/auth/invite?token=${encodeURIComponent(token)}`);
    assert.deepEqual([preview.body.email, preview.body.existing_account], ["second@test.com", false]);

    const acc = await h.api("POST", "/api/auth/accept-invite", { body: { token, name: "Second", password: "second1" } });
    assert.equal(acc.status, 200, JSON.stringify(acc.body));
    assert.equal(acc.body.user.is_admin, true);
    assert.equal((await h.api("GET", "/api/admin/stats", { token: acc.body.token })).status, 200);

    const again = await h.api("POST", "/api/auth/accept-invite", { body: { token, name: "X", password: "second1" } });
    assert.equal(again.status, 400, "invite is single-use");

    const log = await h.api("GET", "/api/admin/audit", { token: admin });
    const actions = log.body.entries.map((e) => e.action);
    assert.ok(actions.includes("admin.invite") && actions.includes("admin.join"));
  });

  test("an invite to an existing customer needs that customer's password", async () => {
    await h.api("POST", "/api/auth/register", { body: { name: "Cust", email: "cust@test.com", password: "custpw1" } });
    const inv = await h.api("POST", "/api/admin/invites", { token: admin, body: { email: "cust@test.com" } });
    const token = new URL(inv.body.accept_url).searchParams.get("token");
    const wrong = await h.api("POST", "/api/auth/accept-invite", { body: { token, password: "hijack1" } });
    assert.equal(wrong.status, 401, "an inviter cannot set a customer's password");
    const right = await h.api("POST", "/api/auth/accept-invite", { body: { token, password: "custpw1" } });
    assert.equal(right.status, 200, "a wrong attempt did not burn the token");
    assert.equal(right.body.user.is_admin, true);
  });

  test("team guards: no self-demotion; demoting works; non-admins are shut out", async () => {
    const team = await h.api("GET", "/api/admin/team", { token: admin });
    const me = team.body.admins.find((a) => a.email === "admin@bayan.local");
    const other = team.body.admins.find((a) => a.email === "cust@test.com");
    assert.equal((await h.api("DELETE", `/api/admin/team/${me.id}`, { token: admin })).status, 400);
    assert.equal((await h.api("DELETE", `/api/admin/team/${other.id}`, { token: admin })).status, 200);
    const custToken = await h.login("cust@test.com", "custpw1");
    assert.equal((await h.api("GET", "/api/admin/team", { token: custToken })).status, 403);
  });

  test("revoking an invite makes its link dead", async () => {
    const inv = await h.api("POST", "/api/admin/invites", { token: admin, body: { email: "revoked@test.com" } });
    const token = new URL(inv.body.accept_url).searchParams.get("token");
    assert.equal((await h.api("DELETE", `/api/admin/invites/${inv.body.invite.id}`, { token: admin })).status, 200);
    assert.equal((await h.api("GET", `/api/auth/invite?token=${encodeURIComponent(token)}`)).status, 404);
  });

  test("price edits are audited with before/after; stock-only edits are not", async () => {
    const created = await h.api("POST", "/api/admin/products", {
      token: admin,
      body: {
        name: "Audit Tee",
        description: "d",
        category: "Men",
        price_cents: 3000000,
        swatch: "#112233",
        colors: [{ name: "Ink", hex: "#112233", image: "/uploads/a.jpg" }],
        sizes: ["M", "L"],
        variants: [
          { size: "M", color: "Ink", stock: 3 },
          { size: "L", color: "Ink", stock: 1 },
        ],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const p = created.body.product;
    assert.equal(p.stock, 4, "derived total");
    assert.equal(p.variants[0].sku, "AUDIT-TEE-INK-M");

    const put = (over) =>
      h.api("PUT", `/api/admin/products/${p.id}`, {
        token: admin,
        body: { ...p, variants: p.variants, ...over },
      });
    assert.equal((await put({ variants: [{ ...p.variants[0], stock: 9 }, p.variants[1]] })).status, 200);
    let log = await h.api("GET", `/api/admin/audit?action=product.price&target_type=product&target_id=${p.id}`, { token: admin });
    assert.equal(log.body.total, 0, "stock change alone is not a price change");

    assert.equal((await put({ price_cents: 2500000, variants: [p.variants[0], { ...p.variants[1], price_cents: 3500000 }] })).status, 200);
    log = await h.api("GET", `/api/admin/audit?action=product.price&target_type=product&target_id=${p.id}`, { token: admin });
    assert.equal(log.body.total, 1);
    assert.equal(log.body.entries[0].before.price_cents, 3000000);
    assert.equal(log.body.entries[0].after.price_cents, 2500000);
    assert.deepEqual(log.body.entries[0].after.variant_prices, { "L / Ink": 3500000 });
  });

  test("uploads: extension comes from the bytes, never the name or mimetype", async () => {
    const ok = await upload(PNG, "photo.html", "image/png");
    assert.equal(ok.status, 201);
    assert.match(ok.body.url, /^\/uploads\/\d+-[0-9a-f]{12}\.png$/);

    const evil = await upload(Buffer.from("<script>alert(1)</script>".padEnd(64)), "x.png", "image/png");
    assert.equal(evil.status, 400);
    const files = fs.readdirSync(process.env.UPLOAD_DIR).filter((f) => !f.startsWith("."));
    assert.equal(files.length, 1, "the rejected file never reached /uploads");
    assert.deepEqual(fs.readdirSync(path.join(process.env.UPLOAD_DIR, ".incoming")), [], "temp cleaned up");

    const served = await fetch(h.origin + ok.body.url);
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.equal(served.headers.get("content-type"), "image/png");
    const hidden = await fetch(`${h.origin}/uploads/.incoming/anything`);
    assert.equal(hidden.status, 404);
  });

  test("security headers: CSP allows fonts and Unsplash; no open CORS outside dev", async () => {
    const r = await fetch(`${h.origin}/api/health`, { headers: { Origin: "https://evil.example" } });
    const csp = r.headers.get("content-security-policy");
    assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
    assert.match(csp, /style-src [^;]*https:\/\/fonts\.googleapis\.com/);
    assert.match(csp, /img-src [^;]*https:\/\/images\.unsplash\.com/);
    assert.doesNotMatch(csp, /img-src [^;]*https:(?!\/\/)/, "no blanket https: image source");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    // NODE_ENV=test is non-production, where CORS stays permissive for dev;
    // the production branch is covered by reading server.js, not here.
  });

  test("/api/config reports whether email is available", async () => {
    const r = await h.api("GET", "/api/config");
    assert.equal(r.body.email_enabled, true, "console/test transport counts outside production");
  });
});
