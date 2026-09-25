/** Shopper- and admin-facing words for payment states (backend/src/payments.js). */
export const PAYMENT_LABELS = {
  on_delivery: "Cash on delivery",
  pending: "Awaiting payment",
  paid: "Paid",
  failed: "Payment failed",
  expired: "Payment expired",
  review: "Payment needs review",
  refund_due: "Refund due",
  refunded: "Refunded",
};

export const NETWORK_LABELS = { MTN: "MTN MoMo", AIRTEL: "Airtel Money" };

/** Remember the token that lets this browser follow its own order's payment. */
export function rememberOrderToken(orderId, token) {
  try {
    localStorage.setItem(`order_token_${orderId}`, token);
  } catch {
    /* private mode: the link in the confirmation still works while the tab is open */
  }
}
export function orderToken(orderId) {
  try {
    return localStorage.getItem(`order_token_${orderId}`);
  } catch {
    return null;
  }
}
