import { Router } from "express";
import mongoose from "mongoose";
import { Product } from "../db.js";

const router = Router();

const SORTS = {
  newest: { created_at: -1 },
  "price-asc": { price_cents: 1 },
  "price-desc": { price_cents: -1 },
  name: { name: 1 },
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Substring match across the searchable fields — unindexed, used as a fallback. */
const regexFilter = (term) => {
  const rx = new RegExp(escapeRegex(term), "i");
  return { $or: [{ name: rx }, { description: rx }, { category: rx }] };
};

router.get("/", async (req, res, next) => {
  try {
    const { category, search, sort, featured, limit, ids } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (featured === "1") filter.featured = true;
    // `ids` lets the cart re-price its lines in one round trip.
    if (ids !== undefined) {
      const list = String(ids)
        .split(",")
        .map((s) => s.trim())
        .filter((s) => mongoose.isValidObjectId(s))
        .slice(0, 100);
      if (list.length === 0) return res.json({ products: [], count: 0 });
      filter._id = { $in: list };
    }
    const lim = Math.min(parseInt(limit, 10) || 100, 100);
    const order = SORTS[sort] || SORTS.newest;
    const term = search ? String(search).trim() : "";

    // Index-backed whole-word search first. $text cannot match partial words
    // ("dres" would miss "Dress"), so fall back to the unindexed substring
    // scan only when it finds nothing — the minority case on a real catalogue.
    let products = [];
    if (term) {
      try {
        products = await Product.find({ ...filter, $text: { $search: term } })
          .sort(order)
          .limit(lim);
      } catch (err) {
        // IndexNotFound (27): the text index is still building or autoIndex is
        // off. Degrade to the regex scan — slower, but search keeps working.
        if (err?.code !== 27) throw err;
        products = [];
      }
      if (products.length === 0) {
        products = await Product.find({ ...filter, ...regexFilter(term) })
          .sort(order)
          .limit(lim);
      }
    } else {
      products = await Product.find(filter).sort(order).limit(lim);
    }

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
