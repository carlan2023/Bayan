/**
 * Runtime theming.
 *
 * styles.css holds every colour as a custom property on :root, so theming a
 * shop is a matter of writing its palette over those properties. The server
 * already writes the twelve palette colours and the fonts into index.html
 * (backend/src/shell.js) for first paint; applyTheme() then fills in the
 * derived tokens — tints, overlays, on-dark text — and keeps everything in
 * step when the owner edits the theme from Admin → Settings.
 *
 * The Settings key → CSS token map and the defaults are the backend's own
 * files in /shared, imported here so the two sides cannot disagree.
 */
import PALETTE_TOKENS from "../../shared/palette-tokens.json";
import DEFAULT_SETTINGS from "../../shared/default-settings.json";

export { PALETTE_TOKENS, DEFAULT_SETTINGS };

/**
 * Current value of a CSS custom property, e.g. cssVar("--pine") → "#2e4b3f".
 *
 * For the few places that need a concrete colour rather than a var()
 * reference — an <input type="color"> default, or arithmetic like the
 * generated product art's gradient. Falls back when there is no DOM or the
 * token is unset.
 */
export function cssVar(name, fallback = "") {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** True for a six-digit hex colour — the only form the colour maths accepts. */
export const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v || "");

const channels = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 0xff, n & 0xff];
};
const toHex = (rgb) =>
  `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;

/** Lighten (amt > 0) or darken (amt < 0) a hex colour by a fixed channel offset. */
export const shade = (hex, amt) => toHex(channels(hex).map((c) => c + amt));

/** Blend two hex colours: t = 0 gives `a`, t = 1 gives `b`. */
export const mix = (a, b, t) => {
  const ca = channels(a);
  const cb = channels(b);
  return toHex(ca.map((c, i) => c + (cb[i] - c) * t));
};

/** A hex colour at the given opacity. */
export const alpha = (hex, a) => `rgba(${channels(hex).join(", ")}, ${a})`;

/**
 * Every derived token in styles.css, computed from a palette. The ratios were
 * chosen so the default palette lands on (or within a shade of) the
 * hand-picked literals in styles.css; for any other palette they keep the
 * same relationships — a burgundy shop gets burgundy-tinted borders.
 */
export function deriveTokens(p) {
  return {
    "--on-primary": mix(p.bg, p.surface, 0.3),
    "--on-accent": "#ffffff",
    "--on-dark": mix(p.bg, p.primary_dark, 0.02),
    "--on-dark-soft": mix(p.bg, p.primary_dark, 0.12),
    "--on-dark-muted": mix(p.bg, p.primary_dark, 0.2),
    "--pine-mid": mix(p.primary, p.surface, 0.1),
    "--pine-line": mix(p.primary_tint, p.primary, 0.1),
    "--danger-tint": mix(p.danger, p.surface, 0.86),
    "--danger-tint-strong": mix(p.danger, p.surface, 0.8),
    "--danger-line": mix(p.danger, p.surface, 0.66),
    "--clay-tint": mix(p.accent, p.surface, 0.86),
    "--gold-tint": mix(p.highlight, p.surface, 0.78),
    "--gold-glow": alpha(p.highlight, 0.35),
    "--unread-bg": mix(p.highlight, p.surface, 0.93),
    "--surface-glass": alpha(p.surface, 0.92),
    "--hero-wash-strong": alpha(p.primary_dark, 0.88),
    "--hero-wash-mid": alpha(p.primary_dark, 0.55),
    "--hero-wash-soft": alpha(p.primary_dark, 0.25),
    "--hero-wash-mobile": alpha(p.primary_dark, 0.72),
    "--scrim": alpha(p.ink, 0.38),
    "--ink-overlay": alpha(p.ink, 0.82),
    "--ink-hairline": alpha(p.ink, 0.25),
    "--ink-hairline-soft": alpha(p.ink, 0.15),
    "--shadow": `0 10px 30px ${alpha(p.ink, 0.09)}`,
  };
}

/** Font stacks mirror styles.css (and backend/src/shell.js). */
export const fontStack = (family, kind) =>
  kind === "display" ? `"${family}", Georgia, serif` : `"${family}", "Segoe UI", sans-serif`;

/** Every token applyTheme writes for a settings object. */
export function themeVars(settings) {
  const p = { ...DEFAULT_SETTINGS.palette, ...(settings.palette || {}) };
  const vars = {};
  for (const [key, token] of Object.entries(PALETTE_TOKENS)) vars[token] = p[key];
  Object.assign(vars, deriveTokens(p));
  const fonts = { ...DEFAULT_SETTINGS.fonts, ...(settings.fonts || {}) };
  vars["--font-display"] = fontStack(fonts.display, "display");
  vars["--font-body"] = fontStack(fonts.body, "body");
  return vars;
}

const sameAsDefault = (settings) =>
  Object.keys(DEFAULT_SETTINGS.palette).every((k) => settings.palette?.[k] === DEFAULT_SETTINGS.palette[k]) &&
  settings.fonts?.display === DEFAULT_SETTINGS.fonts.display &&
  settings.fonts?.body === DEFAULT_SETTINGS.fonts.body;

/**
 * Load Google Fonts families by name. Asks for the weights the design uses; a
 * family that lacks one makes Google reject the whole request, so on error the
 * link retries with the family's default weight only.
 */
const loadedFonts = new Set(Object.values(DEFAULT_SETTINGS.fonts)); // index.html loads these
export function loadFonts(families) {
  if (typeof document === "undefined") return;
  for (const family of families) {
    if (!family || loadedFonts.has(family)) continue;
    loadedFonts.add(family);
    const name = encodeURIComponent(family).replace(/%20/g, "+");
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${name}:wght@400;500;600&display=swap`;
    link.onerror = () => {
      link.onerror = null;
      link.href = `https://fonts.googleapis.com/css2?family=${name}&display=swap`;
    };
    document.head.appendChild(link);
  }
}

/**
 * Write a shop's palette and fonts onto an element — the document root by
 * default, or a preview panel. For the default theme on the root, the inline
 * overrides are removed instead, so the hand-tuned literals in styles.css
 * apply untouched.
 */
export function applyTheme(settings, el) {
  if (typeof document === "undefined") return;
  const target = el || document.documentElement;
  const vars = themeVars(settings);
  if (target === document.documentElement && sameAsDefault(settings)) {
    for (const name of Object.keys(vars)) target.style.removeProperty(name);
    return;
  }
  for (const [name, value] of Object.entries(vars)) target.style.setProperty(name, value);
  loadFonts([settings.fonts?.display, settings.fonts?.body]);
}
