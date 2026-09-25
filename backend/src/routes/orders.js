import { Router } from "express";
import mongoose from "mongoose";
import { Product, Order, nextOrderNumber, notify } from "../db.js";
import { optionalAuth, requireAuth } from "../auth.js";
import { deliveryFor, getSettings, LOW_STOCK_THRESHOLD } from "../config.js";
import { alertLowStock } from "../stock-alerts.js";
import { clampQty, stockProblem, priceOrder } from "../pricing.js";
import { resolveVariant, variantFilter, variantInc, variantLabel } from "../variants.js";
import { restoreStock } from "../inventory.js";

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
 * Create an order (Cash on Delivery).
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

    const order = await Order.create({
      number: await nextOrderNumber(),
      user: req.user?.id ?? null,
      customer_name: customer_name.trim(),
      phone: phone.trim(),
      email: email?.trim() || req.user?.email || null,
      address: address.trim(),
      city: city.trim(),
      note: note?.trim() || null,
      payment_method: "cod",
      ...priced,
    });

    // Admin activity feed. After the response is decided — never blocks checkout.
    const itemCount = lines.reduce((n, l) => n + l.qty, 0);
    notify(
      "order",
      `New order #${order.number} — ${fmtMoney(order.total_cents, settings)}`,
      `${order.customer_name}, ${order.city} · ${itemCount} item${itemCount === 1 ? "" : "s"} · cash on delivery`,
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

    res.status(201).json({ order });
  } catch (err) {
    // Order creation failed after stock was taken — put it back before bailing.
    await release().catch((releaseErr) =>
      console.error("Failed to release reserved stock after a failed order:", releaseErr)
    );
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
