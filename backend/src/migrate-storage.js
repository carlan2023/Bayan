import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDB, disconnectDB, Product, Setting, ShopSettings, SETTINGS_ID } from "./db.js";
import { getStore, uploadDir } from "./storage.js";
import { invalidateSettings } from "./config.js";

/**
 * Move files already on the local volume into S3/R2 and repoint every stored
 * URL at them (SCALING.md M10: images off local disk).
 *
 *   S3_BUCKET=… S3_PUBLIC_URL=… npm run migrate:storage          # apply
 *   S3_BUCKET=… S3_PUBLIC_URL=… npm run migrate:storage -- --dry # report only
 *
 * Copies each referenced /uploads/<file> under the same name (and, for WebP
 * uploads, its -800w/-400w renditions), then rewrites product images, colour
 * photos, the hero media and the logo. Files are copied as they are; older
 * uploads are not re-encoded. Idempotent: a URL already pointing at the bucket
 * is left alone, and re-uploading an object is harmless. The local files are
 * not deleted — remove the volume once the shop has been checked.
 */

const LOCAL = /^\/uploads\/([^/?#]+)$/;
const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

export async function migrateStorage({ dryRun = false, log = console.log, store: target } = {}) {
  const store = target || (await getStore());
  if (store.driver === "local") throw new Error("Set S3_BUCKET and S3_PUBLIC_URL first: there is nowhere to move the files to.");
  const dir = uploadDir();
  const moved = new Map(); // local url → new url
  const missing = new Set();

  async function move(url) {
    const m = typeof url === "string" && url.match(LOCAL);
    if (!m) return url;
    if (moved.has(url)) return moved.get(url);
    const file = path.join(dir, m[1]);
    if (!fs.existsSync(file)) {
      missing.add(url);
      return url; // leave it: pointing at a missing object would be no better
    }
    const ext = path.extname(m[1]).toLowerCase();
    const siblings = ext === ".webp" ? ["-800w.webp", "-400w.webp"].map((s) => m[1].replace(/\.webp$/, s)) : [];
    let next = url;
    if (!dryRun) {
      for (const name of siblings) {
        if (fs.existsSync(path.join(dir, name))) await store.put(name, path.join(dir, name), "image/webp");
      }
      next = await store.put(m[1], file, CONTENT_TYPES[ext] || "application/octet-stream");
    }
    moved.set(url, next);
    return next;
  }

  let products = 0;
  for (const p of await Product.find({}).select("image colors")) {
    let changed = false;
    const image = await move(p.image);
    if (image !== p.image) {
      p.image = image;
      changed = true;
    }
    for (const c of p.colors) {
      const img = await move(c.image);
      if (img !== c.image) {
        c.image = img;
        changed = true;
      }
    }
    if (changed && !dryRun) {
      // Only the URL fields: the variants and stock may be moving under us.
      await Product.updateOne({ _id: p._id }, { $set: { image: p.image, colors: p.colors } });
    }
    if (changed) products++;
  }

  const hero = await Setting.findById("hero");
  if (hero?.data?.url) {
    const url = await move(hero.data.url);
    if (url !== hero.data.url && !dryRun) await Setting.updateOne({ _id: "hero" }, { $set: { "data.url": url } });
  }

  const settings = await ShopSettings.findById(SETTINGS_ID).lean();
  if (settings?.logo_url) {
    const url = await move(settings.logo_url);
    if (url !== settings.logo_url && !dryRun) {
      await ShopSettings.updateOne({ _id: SETTINGS_ID }, { $set: { logo_url: url } });
      invalidateSettings();
    }
  }

  log(
    `${dryRun ? "Dry run: would move" : "Moved"} ${moved.size} file(s) to ${store.driver}; ` +
      `${products} product(s) ${dryRun ? "would be" : ""} repointed.` +
      (missing.size ? ` ${missing.size} referenced file(s) were missing locally and left as they are: ${[...missing].join(", ")}` : "")
  );
  return { moved: moved.size, products, missing: [...missing] };
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  connectDB({ bootstrapAdmin: false })
    .then(() => migrateStorage({ dryRun: process.argv.includes("--dry") }))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}
