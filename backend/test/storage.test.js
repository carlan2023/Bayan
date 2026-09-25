import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";
import { localStore, s3Store, publishUpload, renditionKey, IMAGE_WIDTHS } from "../src/storage.js";

/*
 * Upload storage: resizing on the way in, and the local and S3/R2 drivers.
 * The S3 driver is exercised with a fake client, so no bucket is needed.
 */

const tmpRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bayan-store-"));
  fs.mkdirSync(path.join(root, ".incoming"));
  return root;
};

async function stagedJpeg(root, { width = 3000, height = 2000, orientation } = {}) {
  let img = sharp({ create: { width, height, channels: 3, background: "#2e4b3f" } }).jpeg();
  if (orientation) img = img.withMetadata({ orientation });
  const file = path.join(root, ".incoming", `${Math.random()}.part`);
  fs.writeFileSync(file, await img.toBuffer());
  return file;
}

test("an uploaded photo becomes three WebP renditions, largest at 1600px", async () => {
  const root = tmpRoot();
  const staged = await stagedJpeg(root);
  const { url, kind } = await publishUpload(staged, ["image"], localStore(root));
  assert.equal(kind, "image");
  const m = url.match(/^\/uploads\/(\d+-[0-9a-f]{12})\.webp$/);
  assert.ok(m, url);
  for (const w of IMAGE_WIDTHS) {
    const meta = await sharp(path.join(root, renditionKey(m[1], w))).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, w);
  }
  assert.ok(!fs.existsSync(staged), "the staged original is removed");
});

test("small images are never enlarged, and EXIF orientation is applied then stripped", async () => {
  const root = tmpRoot();
  // 600×300 stored sideways (orientation 6 = rotate 90° to display).
  const staged = await stagedJpeg(root, { width: 600, height: 300, orientation: 6 });
  const { url } = await publishUpload(staged, ["image"], localStore(root));
  const main = await sharp(path.join(root, path.basename(url))).metadata();
  assert.equal(main.width, 300, "rotated upright, not enlarged");
  assert.equal(main.height, 600);
  assert.equal(main.orientation, undefined, "no EXIF survives");
});

test("a file with image magic that can't be decoded is a 400, and nothing is stored", async () => {
  const root = tmpRoot();
  const staged = path.join(root, ".incoming", "bad.part");
  fs.writeFileSync(staged, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]));
  await assert.rejects(publishUpload(staged, ["image"], localStore(root)), (e) => e.status === 400);
  assert.deepEqual(fs.readdirSync(root).filter((f) => !f.startsWith(".")), []);
  assert.ok(!fs.existsSync(staged));
});

test("S3/R2: objects go to the bucket under the prefix, served from the public URL", async () => {
  const root = tmpRoot();
  const sent = [];
  class PutObjectCommand {
    constructor(input) {
      this.input = input;
    }
  }
  const store = s3Store({
    bucket: "shop-media",
    publicUrl: "https://cdn.example.com/",
    prefix: "/acme/",
    client: { send: async (cmd) => sent.push(cmd.input) },
    PutObjectCommand,
  });
  const { url } = await publishUpload(await stagedJpeg(root), ["image"], store);
  assert.match(url, /^https:\/\/cdn\.example\.com\/acme\/\d+-[0-9a-f]{12}\.webp$/);
  assert.equal(sent.length, 3);
  for (const put of sent) {
    assert.equal(put.Bucket, "shop-media");
    assert.match(put.Key, /^acme\/\d+-[0-9a-f]{12}(-\d+w)?\.webp$/);
    assert.equal(put.ContentType, "image/webp");
    assert.match(put.CacheControl, /immutable/);
  }
  assert.equal(sent.at(-1).Key, url.replace("https://cdn.example.com/", ""), "the canonical file is written last");
  assert.ok(store.owns(url));
  assert.ok(!store.owns("https://evil.example/x.webp"));
  assert.equal(store.publicOrigin, "https://cdn.example.com");
});

test("videos are stored as uploaded, under their sniffed extension", async () => {
  const root = tmpRoot();
  const staged = path.join(root, ".incoming", "v.part");
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(100)]);
  fs.writeFileSync(staged, mp4);
  const { url, kind } = await publishUpload(staged, ["image", "video"], localStore(root));
  assert.equal(kind, "video");
  assert.match(url, /\.mp4$/);
  assert.deepEqual(fs.readFileSync(path.join(root, path.basename(url))), mp4);
});
