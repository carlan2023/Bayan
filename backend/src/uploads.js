import crypto from "crypto";

/**
 * Extensions we are willing to write to disk, keyed by mimetype.
 *
 * The stored extension decides the Content-Type express.static serves back, so
 * it must never come from the uploaded filename — a file called "x.html" sent
 * with a Content-Type of image/png would otherwise be served as HTML from our
 * own origin. The mimetype is still client-supplied, but it can only ever map
 * to one of these inert image extensions.
 */
export const ALLOWED_IMAGE_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

export const isAllowedImage = (mimetype) => Object.hasOwn(ALLOWED_IMAGE_TYPES, mimetype);

/** Video types accepted for the hero banner. Same extension-from-mimetype rule. */
export const ALLOWED_VIDEO_TYPES = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov", // what iPhones record; browsers play the H.264 ones
};

export const isAllowedVideo = (mimetype) => Object.hasOwn(ALLOWED_VIDEO_TYPES, mimetype);
export const isAllowedHeroMedia = (mimetype) => isAllowedImage(mimetype) || isAllowedVideo(mimetype);

/** Random, collision-resistant name with an allowlisted extension. */
export function uploadFilename(mimetype) {
  const ext = ALLOWED_IMAGE_TYPES[mimetype] || ALLOWED_VIDEO_TYPES[mimetype];
  if (!ext) throw new Error(`Refusing to store disallowed mimetype: ${mimetype}`);
  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
}
