/**
 * Commerce constants — the single source of truth for delivery pricing.
 *
 * The frontend reads these from GET /api/config rather than hard-coding them,
 * so the cart can never quote a total the server won't honour.
 */

export const CURRENCY = "UGX";
export const FREE_DELIVERY_THRESHOLD_CENTS = 20000000; // UGX 200,000 (stored as cents)
export const DELIVERY_FEE_CENTS = 1000000; // UGX 10,000 (stored as cents)
export const MAX_QTY_PER_LINE = 20;

export const deliveryFor = (subtotalCents) =>
  subtotalCents >= FREE_DELIVERY_THRESHOLD_CENTS ? 0 : DELIVERY_FEE_CENTS;

/** Shape served at GET /api/config. */
export const publicConfig = () => ({
  currency: CURRENCY,
  free_delivery_threshold_cents: FREE_DELIVERY_THRESHOLD_CENTS,
  delivery_fee_cents: DELIVERY_FEE_CENTS,
  max_qty_per_line: MAX_QTY_PER_LINE,
});
