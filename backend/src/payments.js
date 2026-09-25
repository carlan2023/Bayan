/**
 * The payment state machine (SCALING.md M8), kept pure so every transition is
 * unit-tested (test/payments.test.js).
 *
 *   cash on delivery:  on_delivery ──(admin marks delivered)──▶ paid
 *
 *   mobile money:      pending ──▶ paid        verified successful, full amount, right currency
 *                         │  ├──▶ review      verified successful but short or wrong currency: a human decides
 *                         │  ├──▶ failed      provider says failed        (stock released, order cancelled)
 *                         │  └──▶ expired     no success by the deadline  (stock released, order cancelled)
 *                      paid ─────▶ refund_due  the shop cancelled an order that was paid
 *              failed/expired ──▶ refund_due  money arrived after we gave the stock back
 *                      review ───▶ paid | failed | refund_due   (admin)
 *                  refund_due ───▶ refunded                     (admin, after refunding in Flutterwave)
 *
 * Stock is reserved when the payment starts (the order is created with its
 * units taken, exactly like cash on delivery). Confirmation commits it by doing
 * nothing; failure and expiry release it, once, through the order's
 * stock_released claim.
 *
 * Every transition is applied with a conditional write on the current status,
 * so a webhook delivered twice, a webhook racing the status poll, or the
 * expiry sweep racing a late confirmation all resolve to one winner.
 */

export const PAYMENT_TTL_MS = 30 * 60 * 1000; // how long a mobile money prompt may stay unpaid

export const TRANSITIONS = {
  on_delivery: ["paid"],
  pending: ["paid", "review", "failed", "expired"],
  paid: ["refund_due"],
  review: ["paid", "failed", "refund_due"],
  failed: ["refund_due"],
  expired: ["refund_due"],
  refund_due: ["refunded"],
  refunded: [],
};

/** Transitions an admin may make by hand (the rest follow from the provider). */
export const MANUAL = {
  review: ["paid", "failed", "refund_due"],
  refund_due: ["refunded"],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

/** Statuses in which the order may be fulfilled (confirmed, dispatched, delivered). */
export const FULFILLABLE = ["on_delivery", "paid"];

/**
 * What a verified provider result means for an order.
 *
 * @param order     { payment_status, total_cents, status }
 * @param verified  { status: "successful"|"failed"|"pending", amount_cents, currency }
 * @param currency  the shop's currency the order was priced in
 * @returns { next, reason } — next is null when nothing should change
 */
export function decideOutcome(order, verified, currency) {
  const from = order.payment_status;
  if (!verified || verified.status === "pending") return { next: null, reason: "still pending" };

  if (verified.status === "successful") {
    const full = verified.currency === currency && Number(verified.amount_cents) >= order.total_cents;
    if (from === "pending") {
      // Paid in full, but the shop cancelled while the prompt was open: the
      // stock is gone and the money is here — someone has to refund it.
      if (full && order.status === "cancelled") return { next: "refund_due", reason: "paid after the order was cancelled" };
      return full
        ? { next: "paid", reason: "verified" }
        : { next: "review", reason: `paid ${verified.amount_cents} ${verified.currency}, expected ${order.total_cents} ${currency}` };
    }
    if (from === "failed" || from === "expired") return { next: "refund_due", reason: "paid after the stock was released" };
    return { next: null, reason: `already ${from}` };
  }

  // Anything else the provider reports as final is a failure.
  if (from === "pending") return { next: "failed", reason: verified.reason || `provider status ${verified.status}` };
  return { next: null, reason: `already ${from}` };
}

/**
 * Normalise a phone number to international digits for mobile money and
 * WhatsApp: "0772 123 456" → "256772123456" with a Uganda default.
 */
export function internationalPhone(raw, countryCode = "256") {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0")) return countryCode + digits.slice(1);
  if (digits.length <= 9) return countryCode + digits;
  return digits;
}

/** Calling codes for the shop locales we expect; the locale's region decides. */
const CALLING_CODES = { UG: "256", KE: "254", TZ: "255", RW: "250", NG: "234", GH: "233", ZA: "27", ZM: "260", MW: "265", GB: "44", US: "1" };
export function callingCodeFor(locale) {
  const region = String(locale || "").split("-")[1]?.toUpperCase();
  return CALLING_CODES[region] || "256";
}

/** Two phone numbers are the same line when their national parts match. */
export function samePhone(a, b, countryCode = "256") {
  const x = internationalPhone(a, countryCode);
  const y = internationalPhone(b, countryCode);
  return x.length >= 9 && x.slice(-9) === y.slice(-9);
}
