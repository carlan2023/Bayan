import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  sniffType,
  uploadFilename,
  identifyUpload,
  claimsImage,
} from "../src/uploads.js";

// Leading bytes of real files, padded to the 64 bytes the sniffer reads.
const pad = (bytes) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(64)]).subarray(0, 64);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = pad([...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
const ftyp = (brand) => pad([0, 0, 0, 0x20, ...Buffer.from("ftyp"), ...Buffer.from(brand), 0, 0, 2, 0]);
const WEBM = pad([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, ...Buffer.from("webm")]);
const MKV = pad([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88, ...Buffer.from("matroska")]);

test("only inert extensions are ever written", () => {
  // A stored .html/.svg/.js would be served from our own origin with that
  // Content-Type — the stored-XSS path this allowlist exists to close.
  const dangerous = [".html", ".htm", ".svg", ".js", ".mjs", ".json", ".xml", ".php", ".gif", ".avif"];
  for (const ext of [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]) {
    assert.ok(!dangerous.includes(ext), `${ext} must not be storable`);
    assert.match(ext, /^\.[a-z0-9]+$/);
  }
  assert.deepEqual(IMAGE_EXTENSIONS, [".jpg", ".jpeg", ".png", ".webp"]);
});

test("images are identified by their magic number", () => {
  assert.equal(sniffType(JPEG).ext, ".jpg");
  assert.equal(sniffType(PNG).ext, ".png");
  assert.equal(sniffType(WEBP).ext, ".webp");
  for (const b of [JPEG, PNG, WEBP]) assert.equal(sniffType(b).kind, "image");
});

test("videos are identified by container and brand", () => {
  assert.deepEqual(sniffType(ftyp("isom")), { ext: ".mp4", kind: "video", mime: "video/mp4" });
  assert.equal(sniffType(ftyp("mp42")).ext, ".mp4");
  assert.equal(sniffType(ftyp("qt  ")).ext, ".mov");
  assert.equal(sniffType(WEBM).ext, ".webm");
});

test("look-alike containers are rejected, not guessed", () => {
  // AVIF and HEIC share the MP4 container; Matroska shares WebM's magic.
  assert.equal(sniffType(ftyp("avif")), null, "AVIF must not pass as MP4");
  assert.equal(sniffType(ftyp("heic")), null);
  assert.equal(sniffType(MKV), null);
});

test("anything else is refused whatever it claims to be", () => {
  assert.equal(sniffType(pad([...Buffer.from("<html><script>alert(1)</script>")])), null);
  assert.equal(sniffType(pad([...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')])), null);
  assert.equal(sniffType(pad([...Buffer.from("GIF89a")])), null, "GIF is no longer accepted");
  assert.equal(sniffType(Buffer.from([0xff, 0xd8])), null, "too short to judge");
  assert.equal(sniffType(null), null);
});

test("the stored name is random and carries only an allowlisted extension", () => {
  assert.match(uploadFilename(".png"), /^\d+-[0-9a-f]{12}\.png$/);
  assert.notEqual(uploadFilename(".jpg"), uploadFilename(".jpg"));
  assert.throws(() => uploadFilename(".html"), /disallowed extension/);
  assert.throws(() => uploadFilename("png"), /disallowed extension/);
});

test("the client's claimed type is only a coarse pre-filter", () => {
  assert.equal(claimsImage("image/png"), true);
  assert.equal(claimsImage("text/html"), false);
  assert.equal(claimsImage(undefined), false);
});

function tempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bayan-upload-"));
  const incoming = path.join(root, ".incoming");
  fs.mkdirSync(incoming);
  return { root, incoming };
}

test("identifyUpload vouches for a real image and leaves it in place", async () => {
  const { incoming } = tempDirs();
  const tmp = path.join(incoming, "x.part");
  fs.writeFileSync(tmp, PNG);
  const type = await identifyUpload(tmp, ["image"]);
  assert.equal(type.ext, ".png");
  assert.ok(fs.existsSync(tmp), "publishing (and removing the temp file) is the caller's job");
});

test("identifyUpload deletes an HTML file sent as image/png", async () => {
  const { root, incoming } = tempDirs();
  const tmp = path.join(incoming, "x.part");
  fs.writeFileSync(tmp, "<html><body><script>alert(document.cookie)</script></body></html>");
  await assert.rejects(identifyUpload(tmp, ["image"]), /isn't a JPEG, PNG or WebP/);
  assert.ok(!fs.existsSync(tmp), "rejected upload is removed");
  assert.deepEqual(fs.readdirSync(root), [".incoming"], "nothing reached the public directory");
});

test("identifyUpload refuses video on the image-only endpoint", async () => {
  const { incoming } = tempDirs();
  const tmp = path.join(incoming, "x.part");
  fs.writeFileSync(tmp, ftyp("isom"));
  await assert.rejects(identifyUpload(tmp, ["image"]));
  const tmp2 = path.join(incoming, "y.part");
  fs.writeFileSync(tmp2, ftyp("isom"));
  const ok = await identifyUpload(tmp2, ["image", "video"]);
  assert.equal(ok.kind, "video");
});
