import { Router } from "express";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { User, Product, Order, Notification, Setting, ORDER_STATUSES, notify } from "../db.js";
import { requireAuth, issuedBeforePasswordChange } from "../auth.js";
import { claimsImage, claimsHeroMedia, finaliseUpload } from "../uploads.js";
import { slugify, validateProduct, productFields, variantFields } from "../product-fields.js";
import { LOW_STOCK_THRESHOLD } from "../config.js";
import { variantLabel } from "../variants.js";
import { restoreStock } from "../inventory.js";
import { audit, AuditLog, AUDIT_ACTIONS, priceSnapshot, samePrices } from "../audit.js";
import { AuthToken, issueToken, INVITE_TTL_MS } from "../auth-tokens.js";
import { sendEmail, appUrl, emailEnabled, escapeHtml } from "../mailer.js";

const router = Router();

// Where uploaded product images are written. In production this is a Railway
// volume mount (UPLOAD_DIR=/data/uploads) so files survive redeploys; locally it
// falls back to backend/uploads. server.js serves this directory at /uploads.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve("uploads");
// Unverified uploads land here first. express.static ignores dot-directories,
// so nothing in it is ever served; finaliseUpload() sniffs each file and
// renames it into UPLOAD_DIR (same filesystem, so the move is atomic).
const INCOMING_DIR = path.join(UPLOAD_DIR, ".incoming");
fs.mkdirSync(INCOMING_DIR, { recursive: true });

const incomingStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, INCOMING_DIR),
  // Random and extensionless: neither the client's filename nor its claimed
  // type ever reaches the stored name — see src/uploads.js for why.
  filename: (_req, _file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.part`),
});

const upload = multer({
  storage: incomingStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 }, // 5 MB
  // Early reject only; the real decision is made from the file's bytes.
  fileFilter: (_req, file, cb) =>
    claimsImage(file.mimetype) ? cb(null, true) : cb(new Error("Only JPEG, PNG or WebP images are allowed")),
});

// Hero banner media: images or short videos. Videos can't be compressed in the
// browser the way photos are, so the cap is far higher than product images.
const heroUpload = multer({
  storage: incomingStorage,
  limits: { fileSize: 60 * 1024 * 1024, files: 1, fields: 10 }, // 60 MB
  fileFilter: (_req, file, cb) =>
    claimsHeroMedia(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Only images (JPEG, PNG, WebP) or videos (MP4, WebM, MOV) are allowed")),
});

/**
 * Admin gate: valid JWT + is_admin re-checked against the DB on every request,
 * and the session must post-date the account's last password reset — so
 * resetting a leaked admin password immediately locks out the old token.
 * Exported for the admin sub-routers mounted separately in server.js
 * (settings, catalogue import).
 */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, async () => {
    try {
      const u = await User.findById(req.user.id).select("is_admin email password_changed_at");
      if (!u?.is_admin) return res.status(403).json({ error: "Admin access required" });
      if (issuedBeforePasswordChange(req.user, u)) {
        return res.status(401).json({ error: "Your password was changed. Please sign in again." });
      }
      // Audit entries use the current address, not the one baked into the JWT.
      req.user.email = u.email;
      next();
    } catch (err) {
      next(err);
    }
  });
}
router.use(requireAdmin);

const NOT_CANCELLED = { status: { $ne: "cancelled" } };

/** Clamped page/limit for the admin listings. */
function paging(query, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(query.limit, 10) || defaultLimit), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ================= Hero media ================= */

const HERO_KEY = "hero";

/** Clamp helper for the saved framing numbers. */
const clampNum = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Run a multer middleware, then sniff and publish the file. Responds itself;
 * `kinds` is what this endpoint accepts (["image"] or ["image", "video"]).
 */
function handleUpload(middleware, kinds, respond) {
  return (req, res, next) => {
    middleware(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      try {
        const stored = await finaliseUpload(req.file.path, UPLOAD_DIR, kinds);
        res.status(201).json(respond(stored));
      } catch (e) {
        if (e.status === 400) return res.status(400).json({ error: e.message });
        next(e);
      }
    });
  };
}

router.post(
  "/hero/upload",
  handleUpload(heroUpload.single("file"), ["image", "video"], (f) => ({
    url: `/uploads/${f.filename}`,
    media_type: f.kind,
  }))
);

router.put("/hero", async (req, res, next) => {
  try {
    const { url, media_type, x, y, zoom } = req.body || {};
    if (!url) {
      // No url = remove the custom banner; the storefront falls back to its
      // own gradient.
      await Setting.deleteOne({ _id: HERO_KEY });
      return res.json({ hero: null });
    }
    // Only media we host ourselves — an arbitrary URL here would let a stolen
    // admin token point the homepage at any external content.
    if (typeof url !== "string" || !url.startsWith("/uploads/")) {
      return res.status(400).json({ error: "Hero media must be an uploaded file" });
    }
    if (!["image", "video"].includes(media_type)) {
      return res.status(400).json({ error: "media_type must be image or video" });
    }
    const data = {
      url,
      media_type,
      // Framing: focal point (% of the media) and zoom factor.
      x: clampNum(x, 0, 100, 50),
      y: clampNum(y, 0, 100, 50),
      zoom: clampNum(zoom, 1, 3, 1),
    };
    await Setting.updateOne({ _id: HERO_KEY }, { $set: { data } }, { upsert: true });
    res.json({ hero: data });
  } catch (err) {
    next(err);
  }
});

/* ================= Notifications ================= */

// Latest activity plus the unread count in one round trip — the client polls
// this, so keep it a single cheap query pair.
router.get("/notifications", async (req, res, next) => {
  try {
    const { limit } = paging(req.query, { defaultLimit: 30, maxLimit: 100 });
    const [notifications, unread] = await Promise.all([
      Notification.find().sort({ created_at: -1 }).limit(limit),
      Notification.countDocuments({ read: false }),
    ]);
    res.json({ notifications, unread });
  } catch (err) {
    next(err);
  }
});

router.patch("/notifications/read-all", async (_req, res, next) => {
  try {
    await Notification.updateMany({ read: false }, { $set: { read: true } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch("/notifications/:id/read", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid notification id" });
    }
    await Notification.updateOne({ _id: req.params.id }, { $set: { read: true } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ================= Analytics ================= */

router.get("/stats", async (_req, res, next) => {
  try {
    const [revAgg] = await Order.aggregate([
      { $match: NOT_CANCELLED },
      {
        $group: {
          _id: null,
          revenue_cents: { $sum: "$total_cents" },
          active_orders: { $sum: 1 },
          units_sold: { $sum: { $sum: "$items.qty" } },
        },
      },
    ]);
    const revenue_cents = revAgg?.revenue_cents || 0;
    const active_orders = revAgg?.active_orders || 0;

    const [orders, pending_orders, customers, products] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ status: "pending" }),
      User.countDocuments({ is_admin: false }),
      Product.countDocuments(),
    ]);

    const totals = {
      revenue_cents,
      orders,
      pending_orders,
      active_orders,
      customers,
      products,
      units_sold: revAgg?.units_sold || 0,
      aov_cents: active_orders > 0 ? Math.round(revenue_cents / active_orders) : 0,
    };

    // Revenue per day, last 14 days (missing days filled with 0)
    const since = new Date(Date.now() - 13 * 86400000);
    since.setUTCHours(0, 0, 0, 0);
    const dayRows = await Order.aggregate([
      { $match: { ...NOT_CANCELLED, created_at: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
          revenue_cents: { $sum: "$total_cents" },
          orders: { $sum: 1 },
        },
      },
    ]);
    const byDay = Object.fromEntries(dayRows.map((r) => [r._id, r]));
    const revenue_by_day = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      revenue_by_day.push({
        day: d,
        revenue_cents: byDay[d]?.revenue_cents || 0,
        orders: byDay[d]?.orders || 0,
      });
    }

    const orders_by_status = (
      await Order.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 }, revenue_cents: { $sum: "$total_cents" } } },
        { $sort: { _id: 1 } },
      ])
    ).map((r) => ({ status: r._id, count: r.count, revenue_cents: r.revenue_cents }));

    const top_products = (
      await Order.aggregate([
        { $match: NOT_CANCELLED },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.product",
            name: { $first: "$items.name" },
            units: { $sum: "$items.qty" },
            revenue_cents: { $sum: { $multiply: ["$items.qty", "$items.price_cents"] } },
          },
        },
        { $sort: { revenue_cents: -1 } },
        { $limit: 6 },
      ])
    ).map((r) => ({ product_id: r._id, name: r.name, units: r.units, revenue_cents: r.revenue_cents }));

    const revenue_by_category = (
      await Order.aggregate([
        { $match: NOT_CANCELLED },
        { $unwind: "$items" },
        { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "p" } },
        { $unwind: "$p" },
        {
          $group: {
            _id: "$p.category",
            revenue_cents: { $sum: { $multiply: ["$items.qty", "$items.price_cents"] } },
            units: { $sum: "$items.qty" },
          },
        },
        { $sort: { revenue_cents: -1 } },
      ])
    ).map((r) => ({ category: r._id, revenue_cents: r.revenue_cents, units: r.units }));

    // Per size/colour: a product with 60 units can still be sold out in M.
    const low_stock = (
      await Product.aggregate([
        { $unwind: "$variants" },
        { $match: { "variants.stock": { $lte: 10 } } },
        { $sort: { "variants.stock": 1, name: 1 } },
        { $limit: 8 },
        {
          $project: {
            name: 1,
            category: 1,
            size: "$variants.size",
            color: "$variants.color",
            sku: "$variants.sku",
            stock: "$variants.stock",
          },
        },
      ])
    ).map((r) => ({
      id: r._id,
      name: r.name,
      category: r.category,
      variant: variantLabel(r),
      sku: r.sku || null,
      stock: r.stock,
    }));

    const recent_orders = (await Order.find().sort({ created_at: -1 }).limit(8)).map((o) => ({
      id: o._id,
      number: o.number,
      customer_name: o.customer_name,
      city: o.city,
      status: o.status,
      total_cents: o.total_cents,
      created_at: o.created_at,
    }));

    res.json({
      totals,
      revenue_by_day,
      orders_by_status,
      top_products,
      revenue_by_category,
      low_stock,
      recent_orders,
    });
  } catch (err) {
    next(err);
  }
});

/* ================= Orders ================= */

router.get("/orders", async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const filter = status && ORDER_STATUSES.includes(status) ? { status } : {};

    // Find a specific order by number, customer, phone or town — without this,
    // anything past the current page was unreachable.
    const term = search ? String(search).trim() : "";
    if (term) {
      const rx = new RegExp(escapeRegex(term), "i");
      filter.$or = [
        { customer_name: rx },
        { phone: rx },
        { city: rx },
        { email: rx },
        ...(/^\d+$/.test(term) ? [{ number: Number(term) }] : []),
      ];
    }

    const { page, limit, skip } = paging(req.query, { defaultLimit: 25 });
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
      Order.countDocuments(filter),
    ]);
    res.json({ orders, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
});

router.patch("/orders/:id", async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${ORDER_STATUSES.join(", ")}` });
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const previous = order.status;
    if (previous === status) return res.json({ order, restock_skipped: [] });

    // Claim the transition with a conditional write before touching stock: two
    // admins cancelling the same order at once must restock it exactly once.
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: previous },
      { $set: { status } },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({ error: "This order was just changed by someone else — reload and try again." });
    }

    // Return stock to the exact size/colour when an order is cancelled (once).
    let restock_skipped = [];
    if (status === "cancelled") {
      const skipped = await restoreStock(
        order.items.map((i) => ({ product_id: i.product, size: i.size, color: i.color, qty: i.qty, name: i.name }))
      );
      restock_skipped = skipped.map((s) => ({ name: s.name, variant: variantLabel(s), qty: s.qty }));
      if (skipped.length) {
        // The variant was removed since the order was placed; don't guess
        // where the units should go — tell a human.
        notify(
          "stock_low",
          `Order #${order.number} cancelled: ${skipped.length} line(s) not restocked`,
          restock_skipped.map((s) => `${s.qty} × ${s.name} (${s.variant})`).join(", ") +
            " — that size/colour no longer exists. Adjust stock by hand.",
          "/admin/products"
        );
      }
    }

    await audit(req.user, "order.status", {
      target_type: "order",
      target_id: order._id,
      summary: `Order #${order.number}: ${previous} → ${status}`,
      before: { status: previous },
      after: { status, ...(restock_skipped.length ? { restock_skipped } : {}) },
    });
    res.json({ order: updated, restock_skipped });
  } catch (err) {
    next(err);
  }
});

/* ================= Products ================= */

/**
 * Admin catalogue listing. The dashboard previously read the public
 * GET /api/products, which caps at 100 — product 101 was uneditable and
 * undeletable with no error shown. This one pages through everything.
 */
router.get("/products", async (req, res, next) => {
  try {
    const { search, category } = req.query;
    const filter = {};
    if (category) filter.category = category;
    const term = search ? String(search).trim() : "";
    if (term) {
      const rx = new RegExp(escapeRegex(term), "i");
      filter.$or = [{ name: rx }, { category: rx }, { slug: rx }];
    }

    const { page, limit, skip } = paging(req.query, { defaultLimit: 25 });
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
      Product.countDocuments(filter),
    ]);
    res.json({ products, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
});

/** Appends -2, -3, … until the slug is free. Needs the model, so it stays here. */
async function uniqueSlug(name, excludeId = null) {
  const base = slugify(name) || "product";
  let slug = base;
  let n = 2;
  const clash = async (s) =>
    Product.exists(excludeId ? { slug: s, _id: { $ne: excludeId } } : { slug: s });
  while (await clash(slug)) slug = `${base}-${n++}`;
  return slug;
}

router.post("/products", async (req, res, next) => {
  try {
    const errors = validateProduct(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });
    const slug = await uniqueSlug(req.body.name);
    const product = await Product.create({
      ...productFields(req.body),
      variants: variantFields(req.body, { slug }),
      slug,
    });
    await audit(req.user, "product.create", {
      target_type: "product",
      target_id: product._id,
      summary: `Created "${product.name}"`,
      after: priceSnapshot(product),
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
});

router.put("/products/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid product id" });
    }
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Product not found" });
    const errors = validateProduct(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });

    // Capture the old name first: Object.assign below overwrites existing.name,
    // so comparing against it afterwards would never detect a rename.
    const previousName = existing.name;
    const pricesBefore = priceSnapshot(existing);
    const previousVariants = existing.variants.map((v) => v.toObject());
    Object.assign(existing, productFields(req.body));
    if (existing.name !== previousName || !existing.slug) {
      existing.slug = await uniqueSlug(existing.name, existing._id);
    }
    // Each variant keeps its alert clock unless it was restocked past the
    // threshold, which resets it so the daily reminder stops and a future dip
    // alerts immediately rather than waiting out the old 24h window.
    existing.variants = variantFields(req.body, {
      slug: existing.slug,
      previous: previousVariants,
      threshold: LOW_STOCK_THRESHOLD,
    });
    await existing.save();

    const pricesAfter = priceSnapshot(existing);
    if (!samePrices(pricesBefore, pricesAfter)) {
      await audit(req.user, "product.price", {
        target_type: "product",
        target_id: existing._id,
        summary: `Price change on "${existing.name}"`,
        before: pricesBefore,
        after: pricesAfter,
      });
    }
    res.json({ product: existing });
  } catch (err) {
    next(err);
  }
});

router.delete("/products/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid product id" });
    }
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Product not found" });

    const hasOrders = await Order.exists({ "items.product": existing._id });
    if (hasOrders) {
      // Keep order history intact — hide from the store instead. Zero every
      // variant; the derived total follows on save.
      existing.variants.forEach((v) => {
        v.stock = 0;
      });
      existing.stock = 0;
      existing.featured = false;
      await existing.save();
      return res.status(409).json({
        error: "This product has orders and cannot be deleted. Its stock was set to 0 instead.",
      });
    }
    await User.updateMany({}, { $pull: { wishlist: existing._id } });
    await existing.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ================= Image upload ================= */

router.post(
  "/uploads",
  handleUpload(upload.single("file"), ["image"], (f) => ({ url: `/uploads/${f.filename}` }))
);

/* ================= Customers ================= */

router.get("/customers", async (_req, res, next) => {
  try {
    const customers = (
      await User.aggregate([
        { $match: { is_admin: false } },
        { $lookup: { from: "orders", localField: "_id", foreignField: "user", as: "ords" } },
        {
          $project: {
            name: 1,
            email: 1,
            created_at: 1,
            orders: { $size: "$ords" },
            spent_cents: {
              $sum: {
                $map: {
                  input: {
                    $filter: { input: "$ords", cond: { $ne: ["$$this.status", "cancelled"] } },
                  },
                  in: "$$this.total_cents",
                },
              },
            },
          },
        },
        { $sort: { spent_cents: -1 } },
        { $limit: 200 },
      ])
    ).map((c) => ({ ...c, id: c._id, _id: undefined }));
    res.json({ customers });
  } catch (err) {
    next(err);
  }
});

/* ================= Team (admins + invites) ================= */

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get("/team", async (_req, res, next) => {
  try {
    const [admins, invites] = await Promise.all([
      User.find({ is_admin: true }).select("name email created_at").sort({ created_at: 1 }),
      AuthToken.find({ kind: "admin_invite", used_at: null, expires_at: { $gt: new Date() } })
        .sort({ created_at: -1 })
        .populate("created_by", "name email"),
    ]);
    res.json({
      admins: admins.map((u) => ({ id: u._id.toString(), name: u.name, email: u.email, created_at: u.created_at })),
      invites: invites.map((i) => ({
        id: i._id.toString(),
        email: i.email,
        name: i.name,
        expires_at: i.expires_at,
        created_at: i.created_at,
        invited_by: i.created_by ? i.created_by.name || i.created_by.email : null,
      })),
      email_enabled: emailEnabled(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Invite a second (third, …) admin. Previously `is_admin` could only be set by
 * the boot-time bootstrap or by hand in the database.
 *
 * The accept link is returned to the inviting admin as well as emailed: with
 * no email provider configured it is the only way to deliver it, and the
 * inviter is already an admin, so handing them the link grants nothing new.
 */
router.post("/invites", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim() || null;
    if (!EMAIL_RX.test(email)) return res.status(400).json({ error: "A valid email address is required" });
    if (await User.exists({ email, is_admin: true })) {
      return res.status(409).json({ error: "That person is already an admin" });
    }
    const base = appUrl();
    if (!base) {
      return res.status(503).json({ error: "APP_URL is not set on the server, so an invite link can't be built." });
    }

    const { raw, doc } = await issueToken("admin_invite", {
      email,
      name,
      created_by: req.user.id,
      ttlMs: INVITE_TTL_MS,
    });
    const accept_url = `${base}/accept-invite?token=${encodeURIComponent(raw)}`;

    let emailed = false;
    if (emailEnabled()) {
      try {
        const r = await sendEmail({
          to: email,
          subject: "You've been invited to help run the shop",
          text:
            `${req.user.name || req.user.email} has invited you to be an admin of the shop.\n\n` +
            `Accept the invite here. The link works once and expires in 7 days:\n${accept_url}\n\n` +
            "If you weren't expecting this, you can ignore it.",
          html:
            `<p>${escapeHtml(req.user.name || req.user.email)} has invited you to be an admin of the shop.</p>` +
            `<p><a href="${escapeHtml(accept_url)}">Accept the invite</a>. The link works once and expires in 7 days.</p>` +
            "<p>If you weren't expecting this, you can ignore it.</p>",
        });
        emailed = Boolean(r?.sent);
      } catch (err) {
        console.error("Failed to send admin invite email:", err.message);
      }
    }

    await audit(req.user, "admin.invite", {
      target_type: "invite",
      target_id: doc._id,
      summary: `Invited ${email} to be an admin`,
      after: { email, expires_at: doc.expires_at },
    });
    res.status(201).json({
      invite: { id: doc._id.toString(), email, name, expires_at: doc.expires_at },
      accept_url,
      emailed,
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/invites/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid invite id" });
    const invite = await AuthToken.findOneAndDelete({ _id: req.params.id, kind: "admin_invite", used_at: null });
    if (!invite) return res.status(404).json({ error: "Invite not found (it may already have been accepted)" });
    await audit(req.user, "admin.invite_revoke", {
      target_type: "invite",
      target_id: invite._id,
      summary: `Revoked the admin invite for ${invite.email}`,
      before: { email: invite.email },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Remove someone's admin rights (their customer account and order history
 * stay). Refuses to demote yourself or the last admin — either would leave a
 * shop that can lock itself out with one click.
 */
router.delete("/team/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: "Invalid user id" });
    if (req.params.id === String(req.user.id)) {
      return res.status(400).json({ error: "You can't remove your own admin access. Ask another admin." });
    }
    if ((await User.countDocuments({ is_admin: true })) <= 1) {
      return res.status(400).json({ error: "A shop must keep at least one admin." });
    }
    const u = await User.findOneAndUpdate(
      { _id: req.params.id, is_admin: true },
      { $set: { is_admin: false } },
      { new: true }
    );
    if (!u) return res.status(404).json({ error: "Admin not found" });
    await audit(req.user, "admin.demote", {
      target_type: "user",
      target_id: u._id,
      summary: `Removed admin access from ${u.email}`,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ================= Audit log ================= */

router.get("/audit", async (req, res, next) => {
  try {
    const filter = {};
    if (AUDIT_ACTIONS.includes(req.query.action)) filter.action = req.query.action;
    if (req.query.target_type && req.query.target_id) {
      filter.target_type = String(req.query.target_type);
      filter.target_id = String(req.query.target_id);
    }
    const { page, limit, skip } = paging(req.query, { defaultLimit: 25 });
    const [entries, total] = await Promise.all([
      AuditLog.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ entries, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    next(err);
  }
});

export default router;
