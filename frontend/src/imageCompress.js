/**
 * Client-side image downscaling before upload.
 *
 * Phone cameras produce 4–12 MB photos that exceeded the server's 5 MB upload
 * cap and wasted mobile data. Product imagery never needs more than ~1600px,
 * so we decode, scale, and re-encode to JPEG in the browser. If the browser
 * can't decode the file (odd format), the original is returned and the server
 * remains the judge of it.
 */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

export async function compressImage(file) {
  // GIFs would lose animation; leave small files alone — already cheap.
  if (file.type === "image/gif" || file.size < 400 * 1024) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    // JPEG has no alpha — flatten onto the store's ivory rather than black.
    ctx.fillStyle = "#f7f3ea";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;

    // Only keep the re-encode when it actually helped.
    if (blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // undecodable in this browser — let the server decide
  }
}
