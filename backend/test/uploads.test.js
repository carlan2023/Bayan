import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_IMAGE_TYPES, isAllowedImage, uploadFilename } from "../src/uploads.js";

test("only inert image extensions are ever written", () => {
  // A stored .html/.svg/.js would be served from our own origin with that
  // Content-Type — the stored-XSS path this allowlist exists to close.
  const dangerous = [".html", ".htm", ".svg", ".js", ".mjs", ".json", ".xml", ".php"];
  for (const ext of Object.values(ALLOWED_IMAGE_TYPES)) {
    assert.ok(!dangerous.includes(ext), `${ext} must not be storable`);
    assert.match(ext, /^\.[a-z0-9]+$/, `${ext} must be a simple lowercase extension`);
  }
});

test("disallowed mimetypes are rejected", () => {
  assert.equal(isAllowedImage("text/html"), false);
  assert.equal(isAllowedImage("image/svg+xml"), false, "SVG can carry script");
  assert.equal(isAllowedImage("application/javascript"), false);
  assert.equal(isAllowedImage(""), false);
  assert.equal(isAllowedImage(undefined), false);
});

test("prototype keys do not sneak past the allowlist", () => {
  // Object.hasOwn, not `in` — otherwise "constructor" would look allowed.
  assert.equal(isAllowedImage("constructor"), false);
  assert.equal(isAllowedImage("toString"), false);
  assert.equal(isAllowedImage("__proto__"), false);
});

test("allowed mimetypes map to their extension", () => {
  assert.equal(isAllowedImage("image/png"), true);
  assert.match(uploadFilename("image/png"), /^\d+-[0-9a-f]{12}\.png$/);
  assert.match(uploadFilename("image/jpeg"), /\.jpg$/);
  assert.match(uploadFilename("image/webp"), /\.webp$/);
});

test("the filename ignores anything the client sent", () => {
  // Two uploads of the same type must not collide, and neither name can be
  // influenced by the original filename — it is never passed in.
  const a = uploadFilename("image/png");
  const b = uploadFilename("image/png");
  assert.notEqual(a, b);
  assert.equal(uploadFilename.length, 1, "takes only a mimetype");
});

test("storing a disallowed mimetype throws rather than falling back", () => {
  assert.throws(() => uploadFilename("text/html"), /disallowed mimetype/);
});
