/**
 * Commerce configuration — the single source of truth for delivery pricing.
 *
 * Currency, the free-delivery threshold, the delivery fee and the per-line
 * quantity cap used to be constants exported from this module, baked in when
 * it loaded. They now live in the shop's Settings document (see settings.js)
 * and are read per request through a short-lived cache, so:
 *
 *   - the shop owner can change a fee from Admin → Settings without a
 *     redeploy, and
 *   - the order route (routes/orders.js) prices from exactly the source the
 *     client was quoted from at GET /api/config. If those two ever read
 *     different values, the server charges a total the shopper never saw.
 *
 * Nothing here reads configuration at import time — the rule that keeps the
 * door open for one process to serve several shops later.
 */
import { resolveSettings } from "./settings.js";

/**
 * Operational stock thresholds. These are how the software behaves, not how a
 * shop presents itself, so they stay constants.
 *
 * LOW_STOCK_THRESHOLD drives the admin's restock alerts (repeated every
 * LOW_STOCK_REALERT_HOURS until the item is replenished).
 * URGENCY_STOCK_THRESHOLD is the tighter number at which shoppers see an
 * "only N left" banner — served to the client so both agree.
 */
export const LOW_STOCK_THRESHOLD = 5;
export const URGENCY_STOCK_THRESHOLD = 3;
export const LOW_STOCK_REALERT_HOURS = 24;

/* ---------------- Settings cache ---------------- */

/**
 * How long a read of the Settings document is reused. Writes through the
 * admin API invalidate immediately, so this only bounds staleness across
 * processes (a second replica, or `npm run provision` run from a laptop).
 */
const CACHE_MS = Math.max(0, Number(process.env.SETTINGS_CACHE_MS ?? 30_000));

/** Default loader: the singleton document. Imported lazily so tests never touch Mongoose. */
async function loadFromDb() {
  const { ShopSettings, SETTINGS_ID } = await import("./db.js");
  return ShopSettings.findById(SETTINGS_ID).lean();
}

let loader = loadFromDb;
let cached = null; // { value, at }
let inflight = null;

/**
 * The shop's resolved settings (defaults with the stored document laid over
 * them). Concurrent callers share one database read; a failed read falls back
 * to the last good value rather than failing checkout on a blip, and only
 * throws when there has never been a good read.
 */
export async function getSettings() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (!inflight) {
    inflight = Promise.resolve()
      .then(() => loader())
      .then((doc) => {
        const value = Object.freeze(resolveSettings(doc));
        cached = { value, at: Date.now() };
        return value;
      })
      .catch((err) => {
        if (cached) {
          console.error("Settings read failed; serving the last good copy:", err.message);
          return cached.value;
        }
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Drop the cached copy — called after every write so the next request sees it. */
export function invalidateSettings() {
  cached = null;
}

/** Swap the loader (tests, and scripts that already hold a document). Clears the cache. */
export function setSettingsLoader(fn) {
  loader = fn || loadFromDb;
  cached = null;
  inflight = null;
}

/** Express middleware: one consistent settings snapshot for the whole request. */
export async function withSettings(req, _res, next) {
  try {
    req.settings = await getSettings();
    next();
  } catch (err) {
    next(err);
  }
}

/* ---------------- Pricing ---------------- */

/**
 * Delivery charge for a subtotal under the given settings. Takes the settings
 * explicitly — there is deliberately no zero-argument form that could quietly
 * fall back to a default fee.
 */
export function deliveryFor(subtotalCents, settings) {
  if (!settings) throw new Error("deliveryFor needs the shop settings");
  return subtotalCents >= settings.free_delivery_threshold_cents ? 0 : settings.delivery_fee_cents;
}

/**
 * Shape served at GET /api/config: the whole settings object, which keeps the
 * original top-level keys (currency, free_delivery_threshold_cents,
 * delivery_fee_cents, max_qty_per_line) so older clients keep working, plus
 * the urgency threshold the product pages use.
 */
export const publicConfig = (settings) => ({
  ...settings,
  urgency_stock_threshold: URGENCY_STOCK_THRESHOLD,
});
