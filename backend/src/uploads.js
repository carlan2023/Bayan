import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Upload type detection.
 *
 * The stored extension decides the Content-Type express.static serves back, so
 * it must come from neither the uploaded filename nor the client's mimetype —
 * both are attacker-controlled. A file called "x.html" sent as image/png used
 * to be written and served as HTML from our own origin (stored XSS).
 *
 * Instead, the file's first bytes (its "magic number") are read after upload
 * and the extension is chosen from what they actually are. Anything that
 * isn't one of the allowlisted formats is deleted and rejected. The client
 * mimetype is only used as a cheap early reject before bytes are written.
 */

/** Product/hero images: the formats every browser renders and nothing executes. */
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
/** Hero banner video. */
export const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov"];

/**
 * ISO-BMFF brands (bytes 8–11 after "ftyp") we accept as MP4/QuickTime.
 * AVIF/HEIC share the container ("avif", "heic", "mif1") and must not slip
 * through as video, so this is an allowlist, not "anything with ftyp".
 */
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VP", "dash", "mmp4", "MSNV"]);
const MOV_BRANDS = new Set(["qt  "]);

const ascii = (buf, start, end) => buf.subarray(start, end).toString("latin1");

/**
 * Identify a file from its leading bytes.
 * @returns {{ ext: string, kind: "image"|"video", mime: string } | null}
 */
export function sniffType(buf) {
  if (!buf || buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: ".jpg", kind: "image", mime: "image/jpeg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: ".png", kind: "image", mime: "image/png" };
  }
  // WebP: "RIFF" <size> "WEBP"
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") {
    return { ext: ".webp", kind: "image", mime: "image/webp" };
  }
  // MP4 / QuickTime: <size> "ftyp" <major brand>
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (MOV_BRANDS.has(brand)) return { ext: ".mov", kind: "video", mime: "video/quicktime" };
    if (MP4_BRANDS.has(brand)) return { ext: ".mp4", kind: "video", mime: "video/mp4" };
    return null;
  }
  // WebM: EBML header 1A 45 DF A3 with DocType "webm" early in the header
  // (a Matroska .mkv shares the magic but says "matroska").
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    if (ascii(buf, 0, Math.min(buf.length, 64)).includes("webm")) {
      return { ext: ".webm", kind: "video", mime: "video/webm" };
    }
    return null;
  }
  return null;
}

/** How many leading bytes sniffType needs. */
export const SNIFF_BYTES = 64;

/** Cheap pre-filter on the client's claimed type, before any bytes land on disk. */
export const claimsImage = (mimetype) => typeof mimetype === "string" && mimetype.startsWith("image/");
export const claimsHeroMedia = (mimetype) =>
  typeof mimetype === "string" && (mimetype.startsWith("image/") || mimetype.startsWith("video/"));

/** Random, collision-resistant name with an allowlisted extension. */
export function uploadFilename(ext) {
  if (![...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS].includes(ext)) {
    throw new Error(`Refusing to store disallowed extension: ${ext}`);
  }
  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
}

async function readHead(file) {
  const fh = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Promote a freshly uploaded temp file to its public name, or delete it.
 *
 * multer writes to `<UPLOAD_DIR>/.incoming/`, which express.static never serves
 * (dot-directories are ignored by default), so a file is only reachable once
 * it has been sniffed and renamed here. Same filesystem, so the rename is
 * atomic — there is no window in which an unverified file is public.
 *
 * @param kinds  which kinds this endpoint accepts, e.g. ["image"]
 * @returns {{ filename, kind, mime }} on success
 * @throws  Error with a user-facing message, after deleting the temp file
 */
export async function finaliseUpload(tempPath, uploadDir, kinds) {
  try {
    const type = sniffType(await readHead(tempPath));
    if (!type || !kinds.includes(type.kind)) {
      const err = new Error(
        kinds.includes("video")
          ? "That file isn't a JPEG, PNG or WebP image, or an MP4, WebM or MOV video."
          : "That file isn't a JPEG, PNG or WebP image."
      );
      err.status = 400;
      throw err;
    }
    const filename = uploadFilename(type.ext);
    await fs.promises.rename(tempPath, path.join(uploadDir, filename));
    return { filename, kind: type.kind, mime: type.mime };
  } catch (err) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw err;
  }
}
