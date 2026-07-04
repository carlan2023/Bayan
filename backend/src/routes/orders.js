import { Router } from "express";
import mongoose from "mongoose";
import { Product, Order, nextOrderNumber } from "../db.js";
import { optionalAuth, requireAuth } from "../auth.js";

const router = Router();

const FREE_DELIVERY_THRESHOLD = 500000; // in cents
const DELIVERY_FEE = 25000; // in cents

/**
 * Create an order (Cash on Delivery).
 * Works for guests; if logged in, the order is linked to the account.
 * Prices are always re-read from the DB — the client only sends product ids/qty.
 * Stock is decremented with guarded conditional updates (compensated on failure),
 * which stays correct on standalone MongoDB instances without replica-set transactions.
 */
router.post("/", optionalAuth, async (req, res, next) => {
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

    const lines = [];
    for (const item of items) {
      const qty = Math.max(1, Math.min(parseInt(item.qty, 10) || 1, 20));
      const product = await Product.findById(item.product_id);
      if (!product) return res.status(400).json({ error: `Product ${item.product_id} not found` });
      if (product.stock < qty) {
        return res.status(409).json({ error: `"${product.name}" has only ${product.stock} left in stock` });
      }
      lines.push({ product, qty, size: item.size || null, color: item.color || null });
    }

    // Reserve stock: conditional decrements, rolled back if any line fails
    const reserved = [];
    for (const l of lines) {
      const updated = await Product.findOneAndUpdate(
        { _id: l.product._id, stock: { $gte: l.qty } },
        { $inc: { stock: -l.qty } }
      );
      if (!updated) {
        await Promise.all(
          reserved.map((r) => Product.updateOne({ _id: r.product._id }, { $inc: { stock: r.qty } }))
        );
        return res.status(409).json({ error: `"${l.product.name}" just sold out — please adjust your bag` });
      }
      reserved.push(l);
    }

    const subtotal = lines.reduce((sum, l) => sum + l.product.price_cents * l.qty, 0);
    const delivery = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;

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
      items: lines.map((l) => ({
        product: l.product._id,
        name: l.product.name,
        price_cents: l.product.price_cents,
        qty: l.qty,
        size: l.size,
        color: l.color,
      })),
      subtotal_cents: subtotal,
      delivery_cents: delivery,
      total_cents: subtotal + delivery,
    });

    res.status(201).json({ order });
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
