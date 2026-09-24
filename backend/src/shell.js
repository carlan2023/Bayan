/**
 * Server-side personalisation of the SPA's index.html.
 *
 * Without this, every shop's first paint would be the built-in default — its
 * page title, palette and fonts — until the client fetched /api/config and
 * swapped them, a visible flash of somebody else's brand. The server already
 * holds the settings, so it writes them into the page it sends:
 *
 *   - the <title>,
 *   - a <style> with the shop's palette and font tokens (only when they differ
 *     from the defaults baked into styles.css),
 *   - a Google Fonts <link> for non-default families, and
 *   - the full public config as a JSON data block, which the client reads
 *     synchronously at startup instead of waiting on a fetch.
 *
 * The data block is <script type="application/json">: browsers never execute
 * it, so it needs no CSP script-src allowance. Inline <style> is already
 * permitted by the CSP (see server.js).
 *
 * Pure string manipulation — no Express, no database — so it is unit-tested.
 */
import { DEFAULT_SETTINGS, PALETTE_TOKENS } from "./settings.js";

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * JSON that is safe inside a <script> element: "</script>" and "<!--" cannot
 * appear once every "<" is escaped, and U+2028/2029 are escaped for old parsers.
 */
const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");
const BS = String.fromCharCode(0x5c); // a literal backslash, spelled out to survive tooling
export const safeJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, BS + "u003c")
    .replace(LS, BS + "u2028")
    .replace(PS, BS + "u2029");

/** Font stacks mirror styles.css: the shop's family first, then the same fallbacks. */
export const fontStack = (family, kind) =>
  kind === "display" ? `"${family}", Georgia, serif` : `"${family}", "Segoe UI", sans-serif`;

/** Google Fonts CSS2 URL for the given families (names were validated in settings.js). */
export const googleFontsHref = (families) =>
  `https://fonts.googleapis.com/css2?${[...new Set(families)]
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600`)
    .join("&")}&display=swap`;

/** CSS declarations for whatever differs from the defaults; empty when nothing does. */
export function themeCss(settings) {
  const decls = [];
  for (const [key, cssVar] of Object.entries(PALETTE_TOKENS)) {
    const value = settings.palette?.[key];
    if (value && value !== DEFAULT_SETTINGS.palette[key]) decls.push(`${cssVar}:${value}`);
  }
  if (settings.fonts?.display && settings.fonts.display !== DEFAULT_SETTINGS.fonts.display) {
    decls.push(`--font-display:${fontStack(settings.fonts.display, "display")}`);
  }
  if (settings.fonts?.body && settings.fonts.body !== DEFAULT_SETTINGS.fonts.body) {
    decls.push(`--font-body:${fontStack(settings.fonts.body, "body")}`);
  }
  return decls.length ? `:root{${decls.join(";")}}` : "";
}

/** Rewrite the built index.html for this shop. `config` is the GET /api/config payload. */
export function renderShell(html, config) {
  const head = [];
  const css = themeCss(config);
  if (css) head.push(`<style id="shop-theme">${css}</style>`);

  const customFonts = ["display", "body"]
    .map((k) => config.fonts?.[k])
    .filter((f, i) => f && f !== DEFAULT_SETTINGS.fonts[["display", "body"][i]]);
  if (customFonts.length) {
    head.push(`<link rel="stylesheet" id="shop-fonts" href="${escapeHtml(googleFontsHref(customFonts))}" />`);
  }
  head.push(`<script type="application/json" id="shop-config">${safeJson(config)}</script>`);

  let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(config.page_title)}</title>`);
  out = out.replace(/<\/head>/i, `${head.join("\n")}\n</head>`);
  return out;
}
