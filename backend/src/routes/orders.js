import { Router } from "express";
import mongoose from "mongoose";
import { Product, Order, nextOrderNumber, notify } from "../db.js";
import { optionalAuth, requireAuth } from "../auth.js";
import { deliveryFor, getSettings, LOW_STOCK_THRESHOLD } from "../config.js";
import { alertLowStock } from "../stock-alerts.js";
import { clampQty, stockProblem, priceOrder } from "../pricing.js";
import { resolveVariant, variantFilter, variantInc, variantLabel } from "../variants.js";
import { restoreStock } from "../inventory.js";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { mobileMoneyEnabled, MOBILE_MONEY_NETWORKS } from "../flutterwave.js";
import { internationalPhone, callingCodeFor, samePhone } from "../payments.js";
import { newTxRef, hashToken, startMobileMoney, settlePayment, paymentDeadline } from "../payment-service.js";
import { sendOrderConfirmations } from "../order-notifications.js";

/** The admin feed quotes totals in the shop's own currency, not a hard-coded one. */
function fmtMoney(cents, { currency, locale }) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${currency} ${Math.round(cents / 100).toLocaleString("en-US")}`;
  }
}

const router = Router();

/**
 * Create an order, paid by cash on delivery or by mobile money.
 * Works for guests; if logged in, the order is linked to the account.
 * Prices are always re-read from the DB — the client only sends product ids,
 * size, colour and qty. Stock is reserved per size/colour variant with guarded
 * conditional updates (compensated on failure), which stays correct on
 * standalone MongoDB instances without replica-set transactions.
 */
router.post("/", optionalAuth, async (req, res, next) => {
  // Stock we have already taken. Every exit path below — sold out, validation
  // error, or a throw from Order.create — must give it back, or the units are
  // stranded: decremented from the catalogue with no order to account for them.
  const reserved = [];
  // splice(0) empties the list as it releases, so a second call (a throw after
  // the sold-out path already released) cannot restock the same units twice.
  const release = () =>
    restoreStock(
      reserved
        .splice(0)
        .map((l) => ({ product_id: l.product._id, size: l.variant.size, color: l.variant.color, qty: l.qty }))
    );

  try {
    const { customer_name, phone, email, address, city, note, items } = req.body || {};
    const payment_method = req.body?.payment_method || "cod";

    if (!customer_name?.trim() || !phone?.trim() || !address?.trim() || !city?.trim()) {
      return res.status(400).json({ error: "Name, phone, address and city are required" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }
    if (items.some((i) => !mongoose.isValidObjectId(i.product_id))) {
      return res.status(400).json({ error: "Cart contains an invalid product — please clear it and re-add items" });
    }

    // One settings snapshot prices the whole order — the same source (and the
    // same cache) GET /api/config quoted the shopper from.
    const settings = await getSettings();

    // Mobile money: checked before any stock is touched.
    let momo = null;
    if (payment_method === "mobile_money") {
      if (!mobileMoneyEnabled(settings.currency)) {
        return res.status(400).json({ error: "Mobile money isn't available right now. Please choose cash on delivery." });
      }
      const network = String(req.body?.momo_network || "").toUpperCase();
      if (!MOBILE_MONEY_NETWORKS.includes(network)) {
        return res.status(400).json({ error: "Choose MTN or Airtel for mobile money" });
      }
      const payer = internationalPhone(req.body?.momo_phone || phone, callingCodeFor(settings.locale));
      if (payer.length < 11) return res.status(400).json({ error: "Enter the mobile money number to charge" });
      momo = { network, payer };
    } else if (payment_method !== "cod") {
      return res.status(400).json({ error: "Unknown payment method" });
    }

    const lines = [];
    for (const item of items) {
      const qty = clampQty(item.qty, settings.max_qty_per_line);
      const product = await Product.findById(item.product_id);
      if (!product) return res.status(400).json({ error: `Product ${item.product_id} not found` });
      const { variant, error } = resolveVariant(product, item.size || null, item.color || null);
      if (error) return res.status(400).json({ error });
      const problem = stockProblem(product, variant, qty);
      if (problem) return res.status(409).json({ error: problem });
      lines.push({ product, variant, qty });
    }

    // Reserve stock on each variant: a conditional decrement that only matches
    // while that size/colour still has enough, rolled back if any line fails.
    for (const l of lines) {
      const updated = await Product.findOneAndUpdate(
        variantFilter(l.product._id, l.variant, l.qty),
        variantInc(-l.qty),
        { new: true } // read the post-decrement stock for the alerts below
      );
      if (!updated) {
        await release();
        return res.status(409).json({
          error: `"${l.product.name}" (${variantLabel(l.variant)}) just sold out — please adjust your bag`,
        });
      }
      reserved.push(l);
      l.stockAfter = updated.variants.find((v) => v.size === l.variant.size && v.color === l.variant.color)?.stock;
    }

    const priced = priceOrder(lines, { deliveryFor: (subtotal) => deliveryFor(subtotal, settings) });

    const number = await nextOrderNumber();
    // Lets this browser poll its own payment without an account.
    const accessToken = crypto.randomBytes(24).toString("base64url");
    const order = await Order.create({
      number,
      user: req.user?.id ?? null,
      customer_name: customer_name.trim(),
      phone: phone.trim(),
      email: email?.trim() || req.user?.email || null,
      address: address.trim(),
      city: city.trim(),
      note: note?.trim() || null,
      ...priced,
      ...(momo
        ? {
            payment_method: "mobile_money",
            payment_status: "pending",
            payment: {
              provider: "flutterwave",
              network: momo.network,
              payer_phone: momo.payer,
              tx_ref: newTxRef(number),
              expires_at: paymentDeadline(),
            },
          }
        : { payment_method: "cod", payment_status: "on_delivery" }),
      access_token_hash: hashToken(accessToken),
    });
    // From here the order owns its units: only releaseOrderStock() (cancel,
    // failed or expired payment) may give them back, never the catch below.
    reserved.length = 0;

    // Mobile money: the stock is held for the order while the shopper
    // approves the prompt. If the charge can't even start, the order is
    // failed (which gives the stock back) and the shopper can choose again.
    let payment = null;
    if (momo) {
      try {
        const started = await startMobileMoney(order, settings);
        payment = {
          status: "pending",
          redirect_url: started.redirect_url,
          expires_at: order.payment.expires_at,
        };
      } catch (err) {
        console.error(`Mobile money for order #${order.number} could not start:`, err.message);
        return res.status(502).json({
          error: "We couldn't start the mobile money payment, and nothing was charged. Please try again or choose cash on delivery.",
        });
      }
    }

    // Admin activity feed. After the response is decided — never blocks checkout.
    const itemCount = lines.reduce((n, l) => n + l.qty, 0);
    notify(
      "order",
      `New order #${order.number} — ${fmtMoney(order.total_cents, settings)}`,
      `${order.customer_name}, ${order.city} · ${itemCount} item${itemCount === 1 ? "" : "s"} · ${
        momo ? `mobile money (${momo.network}), awaiting payment` : "cash on delivery"
      }`,
      "/admin/orders"
    );
    // Stock alerts are per variant, rate-limited to once a day each and
    // repeated daily until restocked — see src/stock-alerts.js.
    for (const l of lines) {
      if (l.stockAfter != null && l.stockAfter <= LOW_STOCK_THRESHOLD) {
        alertLowStock(
          { _id: l.product._id, name: l.product.name },
          { size: l.variant.size, color: l.variant.color, stock: l.stockAfter }
        ).catch((e) => console.error("Low-stock alert failed:", e.message));
      }
    }

    // Cash on delivery is confirmed now; mobile money only once it's paid.
    if (!momo) sendOrderConfirmations(order._id);

    res.status(201).json({ order, payment, access_token: accessToken });
  } catch (err) {
    // Order creation failed after stock was taken — put it back before bailing.
    await release().catch((releaseErr) =>
      console.error("Failed to release reserved stock after a failed order:", releaseErr)
    );
    next(err);
  }
});

/* ---------------- Payment status & guest lookup ---------------- */

const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many lookups. Please wait a few minutes and try again." },
});

// The payment page polls every few seconds for up to half an hour; the token
// already stops strangers, so this only caps runaway clients.
const pollLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Checking too often. Please wait a moment." },
});

/** What a shopper may see of an order: no internal ids, notes or tokens. */
const publicOrder = (o) => ({
  id: o._id.toString(),
  number: o.number,
  status: o.status,
  payment_method: o.payment_method,
  payment_status: o.payment_status,
  payment_network: o.payment?.network || null,
  payment_expires_at: o.payment?.expires_at || null,
  customer_name: o.customer_name,
  city: o.city,
  items: o.items.map((i) => ({ name: i.name, qty: i.qty, size: i.size, color: i.color, price_cents: i.price_cents })),
  subtotal_cents: o.subtotal_cents,
  delivery_cents: o.delivery_cents,
  total_cents: o.total_cents,
  created_at: o.created_at,
});

/**
 * A guest has no account to see their order in. Order number plus the phone
 * number it was placed with is enough to find it; both must match, the answer
 * is the same "not found" either way, and the endpoint is rate-limited so it
 * can't be used to walk order numbers.
 */
router.get("/lookup", lookupLimiter, async (req, res, next) => {
  try {
    const number = parseInt(String(req.query.number || "").replace(/^#/, ""), 10);
    const phone = String(req.query.phone || "");
    if (!Number.isInteger(number) || phone.replace(/\D/g, "").length < 7) {
      return res.status(400).json({ error: "Enter your order number and the phone number you ordered with" });
    }
    const settings = await getSettings();
    const order = await Order.findOne({ number });
    if (!order || !samePhone(order.phone, phone, callingCodeFor(settings.locale))) {
      return res.status(404).json({ error: "We couldn't find an order with that number and phone. Check both and try again." });
    }
    res.json({ order: publicOrder(order) });
  } catch (err) {
    next(err);
  }
});

/**
 * The payment page polls this while the shopper approves the prompt. The
 * browser that placed the order proves it with the token it was given (or the
 * owning account). A pending payment is checked with the provider at most
 * every 10 seconds, so polling also settles orders whose webhook is late.
 */
router.get("/:id/payment", optionalAuth, pollLimiter, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Order not found" });
    let order = await Order.findById(req.params.id);
    const owner = order && req.user && order.user && String(order.user) === String(req.user.id);
    const tokenOk = order && req.query.token && order.access_token_hash === hashToken(req.query.token);
    if (!order || !(owner || tokenOk)) return res.status(404).json({ error: "Order not found" });

    const last = order.payment?.last_checked_at?.getTime() || 0;
    if (order.payment_status === "pending" && Date.now() - last > 10_000) {
      try {
        order = await settlePayment(order);
      } catch (err) {
        console.error(`Payment check for order #${order.number} failed:`, err.message);
      }
    }
    res.json({ order: publicOrder(order) });
  } catch (err) {
    next(err);
  }
});

/** Order history for the logged-in user. */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ created_at: -1 });
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

export default router;
