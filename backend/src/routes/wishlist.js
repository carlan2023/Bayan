import { Router } from "express";
import mongoose from "mongoose";
import { User, Product, notify } from "../db.js";
import { requireAuth } from "../auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).populate("wishlist");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ products: user.wishlist });
  } catch (err) {
    next(err);
  }
});

router.post("/:productId", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.productId)) {
      return res.status(400).json({ error: "Invalid product id" });
    }
    const product = await Product.findById(req.params.productId);
    if (!product) return res.status(404).json({ error: "Product not found" });
    // $addToSet reports whether this was a fresh save or a repeat click; only
    // fresh saves are worth telling the admin about.
    const result = await User.updateOne(
      { _id: req.user.id },
      { $addToSet: { wishlist: product._id } }
    );
    if (result.modifiedCount > 0) {
      notify(
        "wishlist",
        `${req.user.name} saved "${product.name}"`,
        "Added to their wishlist — interest worth watching.",
        "/admin/products"
      );
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:productId", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.productId)) {
      return res.status(400).json({ error: "Invalid product id" });
    }
    await User.updateOne({ _id: req.user.id }, { $pull: { wishlist: req.params.productId } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
