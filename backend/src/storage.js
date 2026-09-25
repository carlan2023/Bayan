/**
 * Where uploaded media lives, and the resizing that happens on the way in.
 *
 * Two drivers behind one interface — `put(key, body, contentType) → url`:
 *
 * - **local** (default): files under UPLOAD_DIR, served by this process at
 *   /uploads. Fine for development and a single Railway volume, but a volume
 *   doesn't survive service recreation cleanly and has no CDN.
 * - **s3**: any S3-compatible bucket — AWS S3, Cloudflare R2, Backblaze B2,
 *   MinIO. Chosen when S3_BUCKET is set. Objects are public-read through
 *   S3_PUBLIC_URL (a CDN or the bucket's public domain), so images are served
 *   from the edge rather than from the app.
 *
 *   S3_BUCKET           bucket name (required for this driver)
 *   S3_PUBLIC_URL       public base URL objects are served from (required)
 *   S3_ENDPOINT         custom endpoint, e.g. https://<account>.r2.cloudflarestorage.com
 *   S3_REGION           default "auto" (what R2 expects); e.g. eu-west-1 for AWS
 *   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 *   S3_PREFIX           optional key prefix, so several shops can share a bucket
 *
 * Images are re-encoded by sharp before storing: EXIF orientation applied and
 * then stripped (no GPS coordinates from a shop owner's phone reach the
 * public), and three WebP renditions written — 1600, 800 and 400px wide. The
 * main URL is the 1600px one; the storefront derives a srcset from its name
 * (frontend/src/imageSrc.js), so a phone on mobile data downloads the 400px
 * file instead of a 5 MB original. Videos are stored as uploaded.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { identifyUpload, uploadFilename } from "./uploads.js";

/** Widths written for every uploaded image; the largest is the canonical URL. */
export const IMAGE_WIDTHS = [1600, 800, 400];
const WEBP_QUALITY = 80;

/** Random, collision-resistant base name (no extension). */
export const newBaseName = () => `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

/** Key for one rendition: the largest keeps the plain name, smaller ones add -<w>w. */
export const renditionKey = (base, width) =>
  width === IMAGE_WIDTHS[0] ? `${base}.webp` : `${base}-${width}w.webp`;

/* ---------------- Drivers ---------------- */

export function localStore(dir, { urlPrefix = "/uploads" } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    driver: "local",
    publicOrigin: null,
    async put(key, body) {
      // Write beside the target, then rename: the file is never visible half-written.
      const target = path.join(dir, key);
      const tmp = path.join(dir, `.incoming`, `${key}.${crypto.randomBytes(4).toString("hex")}.tmp`);
      await fs.promises.mkdir(path.dirname(tmp), { recursive: true });
      if (typeof body === "string") await fs.promises.copyFile(body, tmp);
      else await fs.promises.writeFile(tmp, body);
      await fs.promises.rename(tmp, target);
      return `${urlPrefix}/${key}`;
    },
    owns: (url) => typeof url === "string" && url.startsWith(`${urlPrefix}/`),
  };
}

/**
 * @param opts.client  an object with send(command) — the AWS SDK's S3Client in
 *                     production, a fake in tests
 */
export function s3Store({ bucket, publicUrl, prefix = "", client, PutObjectCommand }) {
  if (!bucket || !publicUrl) throw new Error("S3 storage needs S3_BUCKET and S3_PUBLIC_URL");
  const base = publicUrl.replace(/\/+$/, "");
  const pre = prefix ? `${prefix.replace(/^\/+|\/+$/g, "")}/` : "";
  return {
    driver: "s3",
    publicOrigin: new URL(base).origin,
    async put(key, body, contentType) {
      const Body = typeof body === "string" ? await fs.promises.readFile(body) : body;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: pre + key,
          Body,
          ContentType: contentType,
          // Names are random and never reused, so the edge may cache forever.
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
      return `${base}/${pre}${key}`;
    },
    owns: (url) => typeof url === "string" && url.startsWith(`${base}/`),
  };
}

let store = null;

/** The configured store (built once, from the environment). */
export async function getStore() {
  if (store) return store;
  if (process.env.S3_BUCKET) {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      credentials: process.env.S3_ACCESS_KEY_ID
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
    });
    store = s3Store({
      bucket: process.env.S3_BUCKET,
      publicUrl: process.env.S3_PUBLIC_URL,
      prefix: process.env.S3_PREFIX,
      client,
      PutObjectCommand,
    });
  } else {
    store = localStore(uploadDir());
  }
  return store;
}

/** Tests swap the store; null resets to the environment's. */
export function setStore(s) {
  store = s;
}

export const uploadDir = () => process.env.UPLOAD_DIR || path.resolve("uploads");

/** Public origin of the object store, for the CSP (null when local). */
export function storageOrigin() {
  const url = process.env.S3_BUCKET && process.env.S3_PUBLIC_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/* ---------------- Publishing ---------------- */

/** Encode one image into every rendition. Throws a 400 when sharp can't read it. */
export async function renderImage(input) {
  try {
    const image = sharp(input, { failOn: "error" }).rotate(); // apply EXIF orientation, then metadata is dropped
    return await Promise.all(
      IMAGE_WIDTHS.map(async (width) => ({
        width,
        body: await image.clone().resize({ width, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer(),
      }))
    );
  } catch (cause) {
    const err = new Error("That image couldn't be read. Please try a different file.");
    err.status = 400;
    err.cause = cause;
    throw err;
  }
}

/**
 * Sniff, resize and store an upload; the temp file is always removed.
 * @returns {{ url, kind }}
 */
export async function publishUpload(tempPath, kinds, target) {
  const type = await identifyUpload(tempPath, kinds); // deletes the temp file itself on rejection
  const s = target || (await getStore());
  try {
    if (type.kind === "image") {
      const base = newBaseName();
      const renditions = await renderImage(tempPath);
      // Smaller renditions first, so the canonical URL never points at a set
      // whose srcset members are still being written.
      const [main, ...smaller] = renditions;
      for (const r of smaller.reverse()) await s.put(renditionKey(base, r.width), r.body, "image/webp");
      return { url: await s.put(renditionKey(base, main.width), main.body, "image/webp"), kind: "image" };
    }
    return { url: await s.put(uploadFilename(type.ext), tempPath, type.mime), kind: type.kind };
  } finally {
    await fs.promises.unlink(tempPath).catch(() => {});
  }
}
