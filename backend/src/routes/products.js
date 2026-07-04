import { Router } from "express";
import { Product } from "../db.js";

const router = Router();

const SORTS = {
  newest: { created_at: -1 },
  "price-asc": { price_cents: 1 },
  "price-desc": { price_cents: -1 },
  name: { name: 1 },
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/", async (req, res, next) => {
  try {
    const { category, search, sort, featured, limit } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (featured === "1") filter.featured = true;
    if (search) {
      const rx = new RegExp(escapeRegex(String(search)), "i");
      filter.$or = [{ name: rx }, { description: rx }, { category: rx }];
    }
    const lim = Math.min(parseInt(limit, 10) || 100, 100);
    const products = await Product.find(filter)
      .sort(SORTS[sort] || SORTS.newest)
      .limit(lim);
    res.json({ products, count: products.length });
  } catch (err) {
    next(err);
  }
});

router.get("/categories", async (_req, res, next) => {
  try {
    const rows = await Product.aggregate([
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ categories: rows.map((r) => ({ category: r._id, count: r.count })) });
  } catch (err) {
    next(err);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });
    if (!product) return res.status(404).json({ error: "Product not found" });
    const related = await Product.find({ category: product.category, _id: { $ne: product._id } }).limit(4);
    res.json({ product, related });
  } catch (err) {
    next(err);
  }
});

export default router;
