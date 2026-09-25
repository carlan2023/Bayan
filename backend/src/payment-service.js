import crypto from "crypto";
import { Order, notify } from "./db.js";
import { getSettings } from "./config.js";
import { appUrl } from "./mailer.js";
import { releaseOrderStock } from "./inventory.js";
import { chargeMobileMoney, verifyByReference } from "./flutterwave.js";
import { canTransition, decideOutcome, PAYMENT_TTL_MS } from "./payments.js";
import { sendOrderConfirmations } from "./order-notifications.js";
import { variantLabel } from "./variants.js";

/**
 * Applying the payment state machine (src/payments.js) to stored orders.
 * Callers: the order route (start), the webhook and the shopper's status poll
 * (settle), the admin (manual transitions) and a background sweep (expiry).
 */

export const newTxRef = (number) => `order-${number}-${crypto.randomBytes(6).toString("hex")}`;
export const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

/**
 * Move an order's payment from `from` to `to`, if it is still in `from`.
 * Returns the updated order, or null when another path got there first.
 * Side effects run only for the winner.
 */
export async function transition(order, from, to, { set = {}, reason = null, actor = null } = {}) {
  if (!canTransition(from, to)) throw new Error(`Payment can't go from ${from} to ${to}`);
  const extra = { ...set };
  if (to === "paid") extra["payment.paid_at"] = new Date();
  if (reason) extra["payment.failure_reason"] = reason;
  // A verified mobile money payment is the confirmation; a failed or expired
  // one cancels the order it was for.
  if (to === "paid" && order.payment_method === "mobile_money" && order.status === "pending") extra.status = "confirmed";
  if ((to === "failed" || to === "expired") && order.status !== "cancelled") extra.status = "cancelled";

  const updated = await Order.findOneAndUpdate(
    { _id: order._id, payment_status: from },
    { $set: { payment_status: to, ...extra } },
    { new: true }
  );
  if (!updated) return null;

  if (to === "failed" || to === "expired") {
    const { skipped } = await releaseOrderStock(updated);
    if (skipped.length) {
      notify(
        "stock_low",
        `Order #${updated.number} ${to}: ${skipped.length} line(s) not restocked`,
        skipped.map((s) => `${s.qty} × ${s.name} (${variantLabel(s)})`).join(", ") + " — that size/colour no longer exists.",
        "/admin/products"
      );
    }
  }
  if (to === "paid" && updated.payment_method === "mobile_money") {
    notify("order", `Order #${updated.number} paid by mobile money`, `${updated.customer_name}, ${updated.city}`, "/admin/orders");
    sendOrderConfirmations(updated._id); // fire and forget; logs its own failures
  }
  if (to === "review" || to === "refund_due") {
    notify(
      "order",
      `Order #${updated.number}: payment needs attention`,
      to === "review" ? `Paid amount doesn't match (${reason}). Check it in Flutterwave.` : `Money received but the order can't be fulfilled (${reason}). Refund it in Flutterwave.`,
      "/admin/orders"
    );
  }
  if (actor || to === "review" || to === "refund_due") {
    const { audit } = await import("./audit.js");
    await audit(actor, "order.payment", {
      target_type: "order",
      target_id: updated._id,
      summary: `Order #${updated.number} payment: ${from} → ${to}${reason ? ` (${reason})` : ""}`,
      before: { payment_status: from },
      after: { payment_status: to },
    });
  }
  return updated;
}

/**
 * Start the mobile money charge for a freshly created (pending) order. On any
 * failure the order is failed, which releases its stock.
 */
export async function startMobileMoney(order, settings) {
  const base = appUrl();
  try {
    const r = await chargeMobileMoney({
      tx_ref: order.payment.tx_ref,
      amount_cents: order.total_cents,
      currency: settings.currency,
      // Flutterwave requires an email; guests may not have given one.
      email: order.email || settings.support_email || "orders@example.com",
      phone: order.payment.payer_phone,
      network: order.payment.network,
      fullname: order.customer_name,
      redirect_url: base ? `${base}/order/${order._id}/payment` : undefined,
    });
    await Order.updateOne({ _id: order._id }, { $set: { "payment.provider_id": r.provider_id } });
    return r;
  } catch (err) {
    await transition(order, "pending", "failed", { reason: `could not start: ${err.message}` });
    throw err;
  }
}

/**
 * Ask the provider about an order's payment and apply the result. Safe to call
 * any number of times from anywhere (webhook, poll, sweep).
 */
export async function settlePayment(order, { force = false } = {}) {
  if (order.payment_method !== "mobile_money" || !order.payment?.tx_ref) return order;
  if (!["pending", "failed", "expired"].includes(order.payment_status)) return order;
  // A paid order that later fails can't happen; only unsettled or abandoned
  // payments are worth asking about. Abandoned ones only on a webhook (force),
  // to catch money that arrived after we gave up.
  if (order.payment_status !== "pending" && !force) return order;

  const settings = await getSettings();
  const verified = await verifyByReference(order.payment.tx_ref);
  await Order.updateOne({ _id: order._id }, { $set: { "payment.last_checked_at": new Date() } });
  const { next, reason } = decideOutcome(order, verified, settings.currency);
  if (!next) return order;
  const set = {};
  if (verified.amount_cents != null && !Number.isNaN(verified.amount_cents)) set["payment.amount_cents"] = verified.amount_cents;
  if (verified.currency) set["payment.currency"] = verified.currency;
  if (verified.provider_id) set["payment.provider_id"] = verified.provider_id;
  return (await transition(order, order.payment_status, next, { set, reason })) || (await Order.findById(order._id));
}

/** Pending payments past their deadline: check once more, then expire. */
export async function sweepExpiredPayments(now = new Date()) {
  const stale = await Order.find({ payment_status: "pending", "payment.expires_at": { $lte: now } }).limit(100);
  for (const order of stale) {
    try {
      const settled = await settlePayment(order);
      if (settled.payment_status === "pending") {
        await transition(settled, "pending", "expired", { reason: "not paid in time" });
      }
    } catch (err) {
      console.error(`Payment sweep for order #${order.number} failed:`, err.message);
    }
  }
  return stale.length;
}

export function startPaymentSweeper() {
  const tick = () => sweepExpiredPayments().catch((e) => console.error("Payment sweep failed:", e.message));
  setInterval(tick, 60 * 1000).unref?.();
}

export const paymentDeadline = () => new Date(Date.now() + PAYMENT_TTL_MS);
