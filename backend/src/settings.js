/**
 * Shop settings: defaults, merging and validation.
 *
 * Everything that makes a deployment one shop rather than another — name,
 * palette, fonts, currency, delivery pricing, marketing copy, departments —
 * is data in a single Settings document (see ShopSettings in db.js), never a
 * module constant. That is the rule that lets one codebase serve several
 * shops, and the one that makes a later move to multi-tenancy cheap: the
 * document simply gains a shop_id.
 *
 * The defaults live in /shared/default-settings.json so the frontend can
 * import the very same file for its first-paint fallback — one copy of the
 * numbers, not two that drift.
 *
 * Kept free of database imports so it can be unit-tested directly.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const sharedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "shared");
const readShared = (name) => JSON.parse(fs.readFileSync(path.join(sharedDir, name), "utf8"));

/** The current Bayan values — what a database without a Settings document serves. */
export const DEFAULT_SETTINGS = Object.freeze(readShared("default-settings.json"));

/** Settings palette key → CSS custom property in frontend/src/styles.css. */
export const PALETTE_TOKENS = Object.freeze(readShared("palette-tokens.json"));
export const PALETTE_KEYS = Object.freeze(Object.keys(PALETTE_TOKENS));

/**
 * Icons a department can use on the generated product art. The SVG paths live
 * in the frontend (components/departments.js); this list is the contract.
 * "tag" is the generic fallback, so an unknown department never inherits a
 * fashion-specific picture.
 */
export const DEPARTMENT_ICONS = Object.freeze([
  "tag",
  "dress",
  "shirt",
  "child",
  "bottle",
  "bag",
  "shoe",
  "ring",
  "home",
]);

/** Copy strings may reference these; the frontend fills them in. */
export const COPY_PLACEHOLDERS = Object.freeze(["shop_name", "free_delivery_threshold", "delivery_fee"]);

/** Top-level keys a Settings document may carry — anything else is dropped. */
export const SETTINGS_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Deep-merge `patch` over `base`. Objects merge key by key; arrays and scalars
 * replace wholesale (a department list is edited as a list, not spliced);
 * `undefined` leaves the base value alone. Neither input is mutated.
 */
export function mergeSettings(base, patch) {
  if (!isPlainObject(patch)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeSettings(out[k], v) : structuredClone(v);
  }
  return out;
}

/** Only the known keys, each shaped like the default (unknown nested keys dropped too). */
function pickKnown(template, input) {
  if (!isPlainObject(input)) return undefined;
  const out = {};
  for (const k of Object.keys(template)) {
    if (!(k in input)) continue;
    const t = template[k];
    out[k] = isPlainObject(t) ? pickKnown(t, input[k]) : input[k];
  }
  return out;
}

/**
 * Resolve a stored document (or null) into a complete settings object: the
 * defaults with whatever the document sets laid over them. Internal fields
 * (_id, timestamps) never leak into the result.
 */
export function resolveSettings(doc) {
  return mergeSettings(DEFAULT_SETTINGS, pickKnown(DEFAULT_SETTINGS, doc || {}) || {});
}

/* ---------------- Validation ---------------- */

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONT = /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/; // Google Fonts family names; safe in a URL and in CSS
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WHATSAPP = /^\d{7,15}$/; // wa.me wants digits only, country code first

const str = (v) => (typeof v === "string" ? v.trim() : v);

function checkString(errors, label, value, { min = 0, max = 300 } = {}) {
  if (typeof value !== "string") return errors.push(`${label} must be text`);
  if (value.length < min) return errors.push(min === 1 ? `${label} is required` : `${label} is too short`);
  if (value.length > max) errors.push(`${label} must be at most ${max} characters`);
}

function checkInt(errors, label, value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${label} must be a whole number between ${min} and ${max}`);
  }
}

/** Accept "1000000" from a form as well as 1000000; anything else is left for the validator to reject. */
const toInt = (v) => (typeof v === "string" && /^\s*-?\d+\s*$/.test(v) ? Number(v) : v);

/** Trim strings and coerce numeric fields, recursively over the known shape. */
function normalise(s) {
  const out = structuredClone(s);
  const walk = (o) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") o[k] = str(v);
      else if (Array.isArray(v)) o[k] = v.map((x) => (typeof x === "string" ? str(x) : isPlainObject(x) ? (walk(x), x) : x));
      else if (isPlainObject(v)) walk(v);
    }
  };
  walk(out);
  for (const k of ["free_delivery_threshold_cents", "delivery_fee_cents", "max_qty_per_line"]) {
    out[k] = toInt(out[k]);
  }
  if (out.logo_url === "") out.logo_url = null;
  if (typeof out.currency === "string") out.currency = out.currency.toUpperCase();
  if (typeof out.whatsapp_number === "string") out.whatsapp_number = out.whatsapp_number.replace(/[\s+()-]/g, "");
  return out;
}

/** Returns a list of human-readable problems with a complete settings object; empty means valid. */
export function validateSettings(s) {
  const errors = [];

  checkString(errors, "Shop name", s.shop_name, { min: 1, max: 60 });
  checkString(errors, "Wordmark", s.wordmark, { min: 1, max: 40 });
  checkString(errors, "Page title", s.page_title, { min: 1, max: 120 });

  if (s.logo_url !== null) {
    // Only files we host or an https URL — never javascript:, data: or http:.
    if (typeof s.logo_url !== "string" || !/^(\/uploads\/|https:\/\/)[^\s"'<>]+$/.test(s.logo_url) || s.logo_url.length > 500) {
      errors.push("Logo must be an uploaded image or an https:// URL");
    }
  }

  if (!isPlainObject(s.palette)) errors.push("Palette is missing");
  else {
    for (const key of PALETTE_KEYS) {
      if (!HEX.test(s.palette[key] || "")) errors.push(`Palette colour "${key}" must be a hex colour like #2e4b3f`);
    }
  }

  if (!isPlainObject(s.fonts)) errors.push("Fonts are missing");
  else {
    for (const key of ["display", "body"]) {
      if (!FONT.test(s.fonts[key] || "")) {
        errors.push(`The ${key} font must be a Google Fonts family name (letters, digits and spaces)`);
      }
    }
  }

  let localeOk = true;
  try {
    Intl.getCanonicalLocales(s.locale);
  } catch {
    localeOk = false;
    errors.push("Locale must be a language tag like en-UG");
  }
  if (!/^[A-Z]{3}$/.test(s.currency || "")) errors.push("Currency must be a three-letter code like UGX");
  else if (localeOk) {
    try {
      new Intl.NumberFormat(s.locale, { style: "currency", currency: s.currency });
    } catch {
      errors.push(`Currency ${s.currency} is not supported`);
    }
  }

  checkInt(errors, "Free-delivery threshold", s.free_delivery_threshold_cents);
  checkInt(errors, "Delivery fee", s.delivery_fee_cents);
  checkInt(errors, "Per-line quantity cap", s.max_qty_per_line, { min: 1, max: 100 });

  if (s.support_email !== "" && !(typeof s.support_email === "string" && EMAIL.test(s.support_email))) {
    errors.push("Support email must be a valid email address");
  }
  checkString(errors, "Support phone", s.support_phone, { max: 30 });
  if (s.whatsapp_number !== "" && !WHATSAPP.test(s.whatsapp_number || "")) {
    errors.push("WhatsApp number must be 7–15 digits including the country code, e.g. 256740399767");
  }

  const c = s.copy;
  if (!isPlainObject(c)) errors.push("Copy is missing");
  else {
    checkString(errors, "Top bar", c.topbar, { max: 160 });
    if (!isPlainObject(c.hero)) errors.push("Hero copy is missing");
    else {
      checkString(errors, "Hero eyebrow", c.hero.eyebrow, { max: 80 });
      checkString(errors, "Hero headline", c.hero.headline, { min: 1, max: 120 });
      checkString(errors, "Hero headline emphasis", c.hero.headline_emphasis, { max: 80 });
      checkString(errors, "Hero body", c.hero.body, { max: 400 });
      checkString(errors, "Hero button", c.hero.cta, { min: 1, max: 40 });
    }
    if (!Array.isArray(c.perks) || c.perks.length !== 3) errors.push("There must be exactly three perks");
    else {
      c.perks.forEach((p, i) => {
        if (!isPlainObject(p)) return errors.push(`Perk ${i + 1} is malformed`);
        checkString(errors, `Perk ${i + 1} title`, p.title, { min: 1, max: 80 });
        checkString(errors, `Perk ${i + 1} text`, p.body, { max: 300 });
      });
    }
    checkString(errors, "Footer tagline", c.footer_tagline, { max: 300 });
    if (!Array.isArray(c.footer_promises) || c.footer_promises.length > 6) {
      errors.push("Footer promises must be a list of at most six lines");
    } else {
      c.footer_promises.forEach((p, i) => checkString(errors, `Footer promise ${i + 1}`, p, { min: 1, max: 80 }));
    }
    checkString(errors, "Search placeholder", c.search_placeholder, { max: 60 });
    checkString(errors, "Sign-up prompt", c.signup_prompt, { max: 80 });
    checkString(errors, "WhatsApp greeting", c.whatsapp_greeting, { max: 120 });
  }

  if (!Array.isArray(s.departments) || s.departments.length > 12) {
    errors.push("Departments must be a list of at most twelve");
  } else {
    const seen = new Set();
    s.departments.forEach((d, i) => {
      if (!isPlainObject(d)) return errors.push(`Department ${i + 1} is malformed`);
      checkString(errors, `Department ${i + 1} name`, d.name, { min: 1, max: 40 });
      const key = String(d.name || "").toLowerCase();
      if (key && seen.has(key)) errors.push(`Department "${d.name}" is listed twice`);
      seen.add(key);
      if (!HEX.test(d.colour || "")) errors.push(`Department "${d.name}" needs a hex colour`);
      if (!DEPARTMENT_ICONS.includes(d.icon)) {
        errors.push(`Department "${d.name}" icon must be one of: ${DEPARTMENT_ICONS.join(", ")}`);
      }
    });
  }

  return errors;
}

/**
 * Apply an edit to the current settings.
 *
 * Unknown keys are dropped, the result is normalised (trimmed, numbers
 * coerced) and validated as a whole — so a partial PUT from the admin page
 * and a full JSON file from `npm run provision` go through the same gate.
 * Returns { settings, errors }; settings is only meaningful when errors is empty.
 */
export function applySettingsPatch(current, patch) {
  if (!isPlainObject(patch)) return { settings: current, errors: ["Settings must be a JSON object"] };
  const merged = mergeSettings(current, pickKnown(DEFAULT_SETTINGS, patch) || {});
  const settings = normalise(merged);
  return { settings, errors: validateSettings(settings) };
}
