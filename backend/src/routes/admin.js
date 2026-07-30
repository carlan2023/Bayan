import { Router } from "express";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import multer from "multer";
import { User, Product, Order, ORDER_STATUSES } from "../db.js";
import { requireAuth } from "../auth.js";

const router = Router();

// Where uploaded product images are written. In production this is a Railway
// volume mount (UPLOAD_DIR=/data/uploads) so files survive redeploys; locally it
// falls back to backend/uploads. server.js serves this directory at /uploads.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve("uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || "") || ".jpg").toLowerCase().slice(0, 8);
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) =>
    /^image\//.test(file.mimetype) ? cb(null, true) : cb(new Error("Only image files are allowed")),
});

/** Admin gate: valid JWT + is_admin re-checked against the DB on every request. */
function requireAdmin(req, res, next) {
  requireAuth(req, res, async () => {
    try {
      const u = await User.findById(req.user.id).select("is_admin");
      if (!u?.is_admin) return res.status(403).json({ error: "Admin access required" });
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

    const low_stock = (await Product.find({ stock: { $lte: 10 } }).sort({ stock: 1 }).limit(8)).map(
      (p) => ({ id: p._id, name: p.name, category: p.category, stock: p.stock })
    );

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

    // Return stock when an order is cancelled (once)
    if (status === "cancelled" && order.status !== "cancelled") {
      await Promise.all(
        order.items.map((i) => Product.updateOne({ _id: i.product }, { $inc: { stock: i.qty } }))
      );
    }
    order.status = status;
    await order.save();
    res.json({ order });
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

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

async function uniqueSlug(name, excludeId = null) {
  const base = slugify(name) || "product";
  let slug = base;
  let n = 2;
  const clash = async (s) =>
    Product.exists(excludeId ? { slug: s, _id: { $ne: excludeId } } : { slug: s });
  while (await clash(slug)) slug = `${base}-${n++}`;
  return slug;
}

function validateProduct(body) {
  const errors = [];
  if (!body.name?.trim()) errors.push("name is required");
  if (!body.description?.trim()) errors.push("description is required");
  if (!body.category?.trim()) errors.push("category is required");
  const price = Number(body.price_cents);
  if (!Number.isInteger(price) || price <= 0) errors.push("price_cents must be a positive integer");
  if (!/^#[0-9a-fA-F]{6}$/.test(body.swatch || "")) errors.push("swatch must be a hex colour like #2e4b3f");
  if (
    !Array.isArray(body.colors) ||
    body.colors.length === 0 ||
    body.colors.some((c) => !c.name || !/^#[0-9a-fA-F]{6}$/.test(c.hex || ""))
  )
    errors.push("colors must be a non-empty array of {name, hex}");
  else if (body.colors.some((c) => !String(c.image || "").trim()))
    errors.push("each colour must have a product image");
  if (!Array.isArray(body.sizes) || body.sizes.length === 0 || body.sizes.some((s) => !String(s).trim()))
    errors.push("sizes must be a non-empty array of strings");
  const stock = Number(body.stock);
  if (!Number.isInteger(stock) || stock < 0) errors.push("stock must be a non-negative integer");
  if (body.compare_at_cents != null && body.compare_at_cents !== "") {
    const cmp = Number(body.compare_at_cents);
    if (!Number.isInteger(cmp) || cmp <= price) errors.push("compare_at_cents must be an integer greater than price");
  }
  return errors;
}

const productFields = (b) => ({
  name: b.name.trim(),
  description: b.description.trim(),
  category: b.category.trim(),
  price_cents: Number(b.price_cents),
  compare_at_cents: b.compare_at_cents ? Number(b.compare_at_cents) : null,
  swatch: b.swatch.toLowerCase(),
  // Hero image: use the explicit one, otherwise fall back to the first colour's
  // photo so every product always ships with a real image (no placeholders).
  image: b.image?.trim() || b.colors?.find((c) => c.image?.trim())?.image?.trim() || null,
  colors: b.colors.map((c) => ({
    name: String(c.name).trim(),
    hex: String(c.hex).toLowerCase(),
    image: String(c.image || "").trim() || null,
  })),
  sizes: b.sizes.map((s) => String(s).trim()),
  fabric: b.fabric?.trim() || null,
  featured: !!b.featured,
  stock: Number(b.stock),
});

router.post("/products", async (req, res, next) => {
  try {
    const errors = validateProduct(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join("; ") });
    const product = await Product.create({
      ...productFields(req.body),
      slug: await uniqueSlug(req.body.name),
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
    Object.assign(existing, productFields(req.body));
    if (existing.name !== previousName || !existing.slug) {
      existing.slug = await uniqueSlug(existing.name, existing._id);
    }
    await existing.save();
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
      // Keep order history intact — hide from the store instead
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

router.post("/uploads", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  });
});

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

export default router;
