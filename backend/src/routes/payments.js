import { Router } from "express";
import { Order } from "../db.js";
import { webhookAuthentic } from "../flutterwave.js";
import { settlePayment } from "../payment-service.js";

const router = Router();

/**
 * Flutterwave webhook. Configure https://<shop>/api/payments/flutterwave/webhook
 * in the dashboard with a secret hash equal to FLW_SECRET_HASH.
 *
 * Idempotent by construction: the body only names a transaction (tx_ref); the
 * outcome is re-read from Flutterwave (settlePayment → verifyByReference) and
 * applied with a conditional write on the order's current payment status, so
 * repeats and out-of-order deliveries change nothing. Answers 200 for
 * references we don't know, so Flutterwave stops retrying them; 401 for a bad
 * hash; 500 when verification itself failed, so Flutterwave retries later.
 */
router.post("/flutterwave/webhook", async (req, res, next) => {
  try {
    await handle(req, res);
  } catch (err) {
    next(err);
  }
});

async function handle(req, res) {
  if (!webhookAuthentic(req.get("verif-hash"))) return res.status(401).json({ error: "Invalid signature" });
  const txRef = req.body?.data?.tx_ref || req.body?.txRef || req.body?.tx_ref;
  if (!txRef || typeof txRef !== "string") return res.json({ ok: true, ignored: "no tx_ref" });
  const order = await Order.findOne({ "payment.tx_ref": txRef });
  if (!order) return res.json({ ok: true, ignored: "unknown tx_ref" });
  try {
    // force: a failed/expired payment that was paid after all becomes refund_due.
    const settled = await settlePayment(order, { force: true });
    res.json({ ok: true, payment_status: settled.payment_status });
  } catch (err) {
    console.error(`Webhook for ${txRef} could not be verified:`, err.message);
    res.status(500).json({ error: "Verification failed; retry later" });
  }
}

export default router;
