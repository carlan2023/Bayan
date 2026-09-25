/**
 * Flutterwave (v3 API) for MTN MoMo and Airtel Money.
 *
 * Inert without keys: mobileMoneyEnabled() is false unless FLW_SECRET_KEY is
 * set, and checkout then offers cash on delivery only.
 *
 *   FLW_SECRET_KEY    secret key (test keys start FLWSECK_TEST-)
 *   FLW_SECRET_HASH   the "secret hash" set in the Flutterwave dashboard's
 *                     webhook settings; sent back to us in the verif-hash header
 *   FLW_API_BASE      default https://api.flutterwave.com/v3
 *
 * Trust model: a webhook only tells us *which* transaction to look at. Its
 * body is never believed. Every state change is decided from
 * verifyByReference(), which asks Flutterwave directly, so a forged or replayed
 * webhook can at most make us check a real transaction again.
 *
 * Built against the v3 docs as known when this was written; the docs site was
 * not reachable from the session that wrote it. Before going live, run one
 * test-mode charge per network and compare the responses with
 * normaliseVerify() and chargeMobileMoney() below.
 */

const base = () => (process.env.FLW_API_BASE || "https://api.flutterwave.com/v3").replace(/\/+$/, "");

/** Charge types by currency. Mobile money is only offered where one exists. */
const CHARGE_TYPES = { UGX: "mobile_money_uganda" };
export const MOBILE_MONEY_NETWORKS = ["MTN", "AIRTEL"];

export const mobileMoneyEnabled = (currency) =>
  Boolean(process.env.FLW_SECRET_KEY) && Boolean(CHARGE_TYPES[currency]);

let fetchImpl = (...args) => fetch(...args);
/** Tests swap the transport; null restores the real fetch. */
export function setFetch(fn) {
  fetchImpl = fn || ((...args) => fetch(...args));
}

async function call(method, path, body) {
  const res = await fetchImpl(base() + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/**
 * Start a mobile money charge. The shopper gets a prompt on their phone (and
 * Flutterwave may first send them through a redirect page to confirm).
 *
 * @returns {{ provider_id, redirect_url, message }}
 * @throws  Error with a message fit for the shopper when the charge can't start
 */
export async function chargeMobileMoney({ tx_ref, amount_cents, currency, email, phone, network, fullname, redirect_url }) {
  const type = CHARGE_TYPES[currency];
  if (!type) throw new Error(`Mobile money isn't available for ${currency}`);
  const r = await call("POST", `/charges?type=${type}`, {
    tx_ref,
    amount: amount_cents / 100,
    currency,
    email,
    phone_number: phone,
    network,
    fullname,
    redirect_url,
  });
  if (!r.ok || r.data?.status !== "success") {
    const err = new Error(r.data?.message || `Flutterwave returned ${r.status}`);
    err.provider = true;
    throw err;
  }
  const auth = r.data?.meta?.authorization || {};
  return {
    provider_id: r.data?.data?.id != null ? String(r.data.data.id) : null,
    redirect_url: auth.mode === "redirect" && auth.redirect ? auth.redirect : null,
    message: r.data?.message || "Charge initiated",
  };
}

/** Flutterwave's transaction record → the shape decideOutcome() expects. */
export function normaliseVerify(data) {
  if (!data) return null;
  const raw = String(data.status || "").toLowerCase();
  const status = raw === "successful" ? "successful" : raw === "failed" || raw === "cancelled" ? "failed" : "pending";
  return {
    status,
    amount_cents: Math.round(Number(data.amount) * 100),
    currency: data.currency,
    provider_id: data.id != null ? String(data.id) : null,
    reason: data.processor_response || raw || null,
  };
}

/**
 * Ask Flutterwave what happened to our reference. A reference it doesn't know
 * yet (the charge never reached it) reads as pending, not failed.
 */
export async function verifyByReference(tx_ref) {
  const r = await call("GET", `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`);
  if (r.ok && r.data?.status === "success") return normaliseVerify(r.data.data);
  if (r.status === 404 || /no transaction/i.test(r.data?.message || "")) return { status: "pending" };
  throw new Error(`Couldn't verify ${tx_ref}: ${r.data?.message || r.status}`);
}

/** Constant-time check of the webhook's verif-hash header. */
export function webhookAuthentic(headerValue) {
  const expected = process.env.FLW_SECRET_HASH;
  if (!expected || typeof headerValue !== "string") return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
