/**
 * Route-test harness: the real Express app against a throwaway MongoDB.
 *
 * Database, in order of preference:
 *   1. MONGO_TEST_URI — CI points this at its mongo:7 service container.
 *   2. mongodb-memory-server-core — downloads a mongod binary on first use
 *      (~150 MB, cached under ~/.cache/mongodb-binaries) and runs it locally.
 *   3. Neither available → every route test is skipped with the reason, rather
 *      than failing a machine that simply has no MongoDB.
 *
 * Each test file gets its own uniquely named database, dropped at the end, so
 * files can run in parallel against one server.
 *
 * Environment is set before the app is imported, because db.js reads
 * MONGODB_URI and admin.js creates UPLOAD_DIR at import time.
 */
import fs from "fs";
import os from "os";
import path from "path";

export async function startHarness() {
  let base = process.env.MONGO_TEST_URI;
  let mem = null;
  if (!base) {
    try {
      const { MongoMemoryServer } = await import("mongodb-memory-server-core");
      mem = await MongoMemoryServer.create();
      base = mem.getUri();
    } catch (err) {
      return { skip: `no MongoDB for route tests (set MONGO_TEST_URI): ${err.message}` };
    }
  }

  const url = new URL(base);
  url.pathname = `/bayan_test_${process.pid}_${Date.now()}`;
  process.env.MONGODB_URI = url.toString();
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bayan-uploads-"));
  process.env.NODE_ENV = "test";
  delete process.env.RESEND_API_KEY;
  process.env.APP_URL = "http://shop.test";

  const db = await import("../../src/db.js");
  const { app } = await import("../../src/server.js");
  const mailer = await import("../../src/mailer.js");
  const mongoose = (await import("mongoose")).default;
  await db.connectDB();

  const outbox = [];
  mailer.setTransport(async (msg) => {
    outbox.push(msg);
    return { sent: true, provider: "test" };
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  /** JSON request helper → { status, body, headers }. */
  async function api(method, pathname, { body, token, headers = {} } = {}) {
    const res = await fetch(origin + pathname, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  async function login(email = "admin@bayan.local", password = "admin123") {
    const r = await api("POST", "/api/auth/login", { body: { email, password } });
    if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.token;
  }

  /** Insert a product with explicit variants (bypasses the admin API). */
  async function makeProduct(variants, over = {}) {
    const n = Math.random().toString(36).slice(2, 8);
    const colors = [...new Set(variants.map((v) => v.color))];
    const sizes = [...new Set(variants.map((v) => v.size))];
    return db.Product.create({
      slug: `test-${n}`,
      name: `Test Product ${n}`,
      description: "A product made for a test.",
      category: "Women",
      price_cents: 5000000,
      swatch: "#2e4b3f",
      image: "/uploads/x.jpg",
      colors: colors.map((name) => ({ name, hex: "#2e4b3f", image: "/uploads/x.jpg" })),
      sizes,
      variants: variants.map((v) => ({ sku: "", price_cents: null, ...v })),
      ...over,
    });
  }

  async function stop() {
    await new Promise((r) => server.close(r));
    await mongoose.connection.dropDatabase().catch(() => {});
    await db.disconnectDB();
    if (mem) await mem.stop();
    fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
  }

  return { api, login, makeProduct, db, outbox, origin, stop };
}

export const orderBody = (items, over = {}) => ({
  customer_name: "Test Shopper",
  phone: "0700000000",
  address: "1 Test Street",
  city: "Kampala",
  items,
  ...over,
});
