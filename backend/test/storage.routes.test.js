import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { startHarness } from "./helpers/harness.js";
import { s3Store } from "../src/storage.js";

/* migrate:storage against a real MongoDB, with a fake S3 client. */
const h = await startHarness();

describe("migrate:storage", { skip: h.skip }, () => {
  after(() => h.stop());

  test("copies local uploads to the bucket, repoints URLs, and is idempotent", async () => {
    const { migrateStorage } = await import("../src/migrate-storage.js");
    const dir = process.env.UPLOAD_DIR;
    for (const f of ["111-aaaaaaaaaaaa.webp", "111-aaaaaaaaaaaa-800w.webp", "111-aaaaaaaaaaaa-400w.webp", "222-bbbbbbbbbbbb.jpg"]) {
      fs.writeFileSync(path.join(dir, f), f);
    }
    const p = await h.makeProduct([{ size: "M", color: "Ink", stock: 3 }], { image: "/uploads/111-aaaaaaaaaaaa.webp" });
    await h.db.Product.updateOne(
      { _id: p._id },
      { $set: { "colors.0.image": "/uploads/222-bbbbbbbbbbbb.jpg" } }
    );
    const other = await h.makeProduct([{ size: "M", color: "Ink", stock: 1 }], { image: "/uploads/gone.jpg" });

    const puts = [];
    class PutObjectCommand {
      constructor(input) {
        this.input = input;
      }
    }
    const store = s3Store({
      bucket: "b",
      publicUrl: "https://cdn.test",
      client: { send: async (c) => puts.push(c.input.Key) },
      PutObjectCommand,
    });

    const first = await migrateStorage({ store, log: () => {} });
    assert.equal(first.moved, 2);
    assert.ok(first.missing.includes("/uploads/gone.jpg"), "a referenced file missing locally is reported");
    assert.deepEqual(puts.sort(), [
      "111-aaaaaaaaaaaa-400w.webp",
      "111-aaaaaaaaaaaa-800w.webp",
      "111-aaaaaaaaaaaa.webp",
      "222-bbbbbbbbbbbb.jpg",
    ]);
    const after1 = await h.db.Product.findById(p._id).lean();
    assert.equal(after1.image, "https://cdn.test/111-aaaaaaaaaaaa.webp");
    assert.equal(after1.colors[0].image, "https://cdn.test/222-bbbbbbbbbbbb.jpg");
    assert.equal(after1.variants[0].stock, 3, "stock untouched");
    assert.equal((await h.db.Product.findById(other._id).lean()).image, "/uploads/gone.jpg", "missing files are left alone");

    puts.length = 0;
    const second = await migrateStorage({ store, log: () => {} });
    assert.equal(second.products, 0, "nothing left to repoint");
    assert.deepEqual(puts, []);
  });
});
