/**
 * Runtime theming helpers.
 *
 * styles.css holds every colour as a custom property on :root, so reading or
 * rewriting the theme is a matter of reading or rewriting those properties.
 */

/**
 * Current value of a CSS custom property, e.g. cssVar("--pine") → "#2e4b3f".
 *
 * For the few places that genuinely need a concrete colour rather than a
 * var() reference — an <input type="color"> default, or arithmetic like the
 * generated product art's gradient. Falls back when there is no DOM (tests,
 * prerender) or the token is unset.
 */
export function cssVar(name, fallback = "") {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** True for a six-digit hex colour — the only form the colour maths accepts. */
export const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v || "");

/** Lighten (amt > 0) or darken (amt < 0) a hex colour by a fixed channel offset. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  const r = c(n >> 16),
    g = c((n >> 8) & 0xff),
    b = c(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
