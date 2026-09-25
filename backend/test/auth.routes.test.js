import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { startHarness } from "./helpers/harness.js";
import { hashToken } from "../src/auth-tokens.js";

/* Password reset and admin invites, end to end, with mail captured. */
const h = await startHarness();

const linkToken = (msg) => new URL(msg.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");

describe("password reset", { skip: h.skip }, () => {
  after(() => h.stop());

  test("full flow: single-use token, stored hashed, old sessions revoked", async () => {
    const reg = await h.api("POST", "/api/auth/register", {
      body: { name: "Resetter", email: "reset@test.com", password: "oldpass1" },
    });
    const oldToken = reg.body.token;

    const f = await h.api("POST", "/api/auth/forgot", { body: { email: "RESET@test.com" } });
    assert.equal(f.status, 200);
    const mail = h.outbox.at(-1);
    assert.equal(mail.to, "reset@test.com");
    assert.match(mail.text, /^[\s\S]*http:\/\/shop\.test\/reset-password\?token=/, "link uses APP_URL, not Host");
    const raw = linkToken(mail);

    const { AuthToken } = await import("../src/auth-tokens.js");
    const row = await AuthToken.findOne({ kind: "password_reset", email: "reset@test.com" }).lean();
    assert.equal(row.token_hash, hashToken(raw));
    assert.ok(!JSON.stringify(row).includes(raw), "raw token is never stored");

    // Make the old session measurably older than the change (iat is seconds).
    await new Promise((r) => setTimeout(r, 2100));
    const r1 = await h.api("POST", "/api/auth/reset", { body: { token: raw, password: "newpass1" } });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.ok(r1.body.token);

    const r2 = await h.api("POST", "/api/auth/reset", { body: { token: raw, password: "another1" } });
    assert.equal(r2.status, 400, "token is single-use");

    assert.equal((await h.api("POST", "/api/auth/login", { body: { email: "reset@test.com", password: "oldpass1" } })).status, 401);
    assert.equal((await h.api("POST", "/api/auth/login", { body: { email: "reset@test.com", password: "newpass1" } })).status, 200);
    assert.equal((await h.api("GET", "/api/auth/me", { token: oldToken })).status, 401, "pre-reset session revoked");
    assert.equal((await h.api("GET", "/api/auth/me", { token: r1.body.token })).status, 200);
  });

  test("an expired token is refused", async () => {
    await h.api("POST", "/api/auth/forgot", { body: { email: "reset@test.com" } });
    const raw = linkToken(h.outbox.at(-1));
    const { AuthToken } = await import("../src/auth-tokens.js");
    await AuthToken.updateOne({ token_hash: hashToken(raw) }, { $set: { expires_at: new Date(Date.now() - 1000) } });
    const r = await h.api("POST", "/api/auth/reset", { body: { token: raw, password: "whatever1" } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /expired/);
  });

  test("a new request invalidates the previous link", async () => {
    await h.api("POST", "/api/auth/forgot", { body: { email: "reset@test.com" } });
    const first = linkToken(h.outbox.at(-1));
    await h.api("POST", "/api/auth/forgot", { body: { email: "reset@test.com" } });
    const second = linkToken(h.outbox.at(-1));
    assert.equal((await h.api("POST", "/api/auth/reset", { body: { token: first, password: "x12345" } })).status, 400);
    assert.equal((await h.api("POST", "/api/auth/reset", { body: { token: second, password: "x12345" } })).status, 200);
  });

  test("unknown addresses get the same answer and no email", async () => {
    const before = h.outbox.length;
    const r = await h.api("POST", "/api/auth/forgot", { body: { email: "nobody@test.com" } });
    assert.equal(r.status, 200);
    assert.equal(h.outbox.length, before);
  });

  test("forgot-password is rate limited", async () => {
    // Four requests above plus this loop exceed the budget of 5 per window.
    let last;
    for (let i = 0; i < 3; i++) last = await h.api("POST", "/api/auth/forgot", { body: { email: "nobody@test.com" } });
    assert.equal(last.status, 429);
    assert.ok(last.headers.get("ratelimit-policy") || last.headers.get("ratelimit"));
  });
});
