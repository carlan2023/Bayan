/**
 * Responsive sources for uploaded images.
 *
 * The backend stores every uploaded photo as three WebP renditions
 * (backend/src/storage.js): `<name>.webp` at 1600px, plus `<name>-800w.webp`
 * and `<name>-400w.webp`, on local disk or S3/R2 alike. Their names are the
 * contract, so the srcset can be derived from the one URL a product stores —
 * a phone on mobile data then fetches the 400px file, not a 1600px one.
 * Anything else (a pasted URL, an older upload) gets no srcset.
 */
const RENDITION = /^(.*\/\d+-[0-9a-f]{12})\.webp$/;

export function srcSetFor(url) {
  const m = typeof url === "string" && url.match(RENDITION);
  if (!m) return undefined;
  return `${m[1]}-400w.webp 400w, ${m[1]}-800w.webp 800w, ${url} 1600w`;
}
