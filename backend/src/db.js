import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Railway's MongoDB plugin exposes MONGO_URL; MONGODB_URI is the conventional override.
const uri =
  process.env.MONGODB_URI || process.env.MONGO_URL || "mongodb://localhost:27017/bayan";

const timestamps = { createdAt: "created_at", updatedAt: "updated_at" };

/** Shared toJSON: expose `id`, hide internals — keeps the API shape the frontend expects. */
const baseToJSON = {
  virtuals: false,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.password_hash;
    return ret;
  },
};

/* ---------------- Schemas ---------------- */

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    is_admin: { type: Boolean, default: false },
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
  },
  { timestamps, toJSON: baseToJSON }
);

const productSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    category: { type: String, required: true, index: true },
    price_cents: { type: Number, required: true, min: 1 },
    compare_at_cents: { type: Number, default: null },
    swatch: { type: String, required: true },
    image: { type: String, default: null },
    colors: [{ _id: false, name: String, hex: String, image: { type: String, default: null } }],
    sizes: [String],
    fabric: { type: String, default: null },
    featured: { type: Boolean, default: false },
    stock: { type: Number, default: 50, min: 0 },
    // When the admin was last told this item is running low. Drives the
    // 24-hourly re-alert and is cleared the moment it's restocked.
    low_stock_alert_at: { type: Date, default: null },
  },
  { timestamps, toJSON: baseToJSON }
);

// Catalogue search used an unindexed $or of three regexes — a full collection
// scan per query. A text index serves whole-word matches from the index; the
// route keeps a regex fallback for partial words, which $text cannot do.
productSchema.index(
  { name: "text", description: "text", category: "text" },
  { weights: { name: 10, category: 5, description: 1 }, name: "product_text" }
);
// Supports the default catalogue sort and the admin listing.
productSchema.index({ created_at: -1 });

export const ORDER_STATUSES = ["pending", "confirmed", "dispatched", "delivered", "cancelled"];

const orderSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    customer_name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: null },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    note: { type: String, default: null },
    payment_method: { type: String, default: "cod" },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        name: { type: String, required: true },
        price_cents: { type: Number, required: true },
        qty: { type: Number, required: true, min: 1 },
        size: { type: String, default: null },
        color: { type: String, default: null },
      },
    ],
    subtotal_cents: { type: Number, required: true },
    delivery_cents: { type: Number, default: 0 },
    total_cents: { type: Number, required: true },
  },
  {
    timestamps,
    toJSON: {
      versionKey: false,
      transform(_doc, ret) {
        ret.id = ret._id.toString();
        ret.user_id = ret.user ? ret.user.toString() : null;
        ret.items = (ret.items || []).map((i) => ({
          id: i._id?.toString(),
          product_id: i.product?.toString(),
          name: i.name,
          price_cents: i.price_cents,
          qty: i.qty,
          size: i.size,
          color: i.color,
        }));
        delete ret._id;
        delete ret.user;
        return ret;
      },
    },
  }
);

// The admin order list filters by status and always sorts newest-first; the
// customer's own history filters by user and does the same.
orderSchema.index({ status: 1, created_at: -1 });
orderSchema.index({ user: 1, created_at: -1 });

const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } });

/* ---------------- Notifications ----------------
   In-app activity feed for the admin: new orders, wishlist saves, stock
   alerts, new customers. Rows are small and pruned, so the collection can't
   grow without bound. */
export const NOTIFICATION_TYPES = ["order", "wishlist", "stock_low", "stock_out", "customer"];

const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    // Where the admin should land when they click it (client-side route).
    link: { type: String, default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps, toJSON: baseToJSON }
);
notificationSchema.index({ read: 1, created_at: -1 });
notificationSchema.index({ created_at: -1 });

/* Free-form storefront settings (hero media, future banners). One document
   per key; the shape of `data` is owned by the route that writes it. */
const settingSchema = new mongoose.Schema(
  { _id: String, data: { type: mongoose.Schema.Types.Mixed, default: {} } },
  { timestamps }
);

export const User = mongoose.model("User", userSchema);
export const Product = mongoose.model("Product", productSchema);
export const Order = mongoose.model("Order", orderSchema);
export const Counter = mongoose.model("Counter", counterSchema);
export const Notification = mongoose.model("Notification", notificationSchema);
export const Setting = mongoose.model("Setting", settingSchema);

const MAX_NOTIFICATIONS = 500;

/**
 * Record an admin notification. Fire-and-forget by design: a notification
 * failure must never break the checkout/wishlist/register flow it decorates,
 * so errors are logged and swallowed.
 */
export function notify(type, title, body = "", link = null) {
  Notification.create({ type, title, body, link })
    .then(async () => {
      // Occasional prune keeps the collection bounded without a TTL job.
      if (Math.random() < 0.05) {
        const cutoff = await Notification.find()
          .sort({ created_at: -1 })
          .skip(MAX_NOTIFICATIONS)
          .limit(1)
          .select("created_at");
        if (cutoff.length > 0) {
          await Notification.deleteMany({ created_at: { $lt: cutoff[0].created_at } });
        }
      }
    })
    .catch((err) => console.error("Failed to record notification:", err.message));
}

/** Sequential, human-friendly order numbers (#1001, #1002, …). */
export async function nextOrderNumber() {
  const c = await Counter.findByIdAndUpdate(
    "order",
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return 1000 + c.seq;
}

/* ---------------- Bootstrap ---------------- */

export async function connectDB() {
  await mongoose.connect(uri);
  console.log(`MongoDB connected (${mongoose.connection.name})`);

  // Ensure a super user exists
  const adminExists = await User.exists({ is_admin: true });
  if (!adminExists) {
    const email = (process.env.ADMIN_EMAIL || "admin@bayan.local").toLowerCase();
    // "admin123" is published in the README — never use it in production. Mint a
    // random password instead and print it once for the operator to capture.
    const generated = !process.env.ADMIN_PASSWORD && process.env.NODE_ENV === "production";
    const password = generated
      ? crypto.randomBytes(12).toString("base64url")
      : process.env.ADMIN_PASSWORD || "admin123";
    const existing = await User.findOne({ email });
    if (existing) {
      existing.is_admin = true;
      await existing.save();
      console.log(`Promoted existing user ${email} to admin.`);
    } else {
      await User.create({
        name: "Bayan Admin",
        email,
        password_hash: bcrypt.hashSync(password, 10),
        is_admin: true,
      });
      if (generated) {
        console.log(
          `\n=== Created admin account: ${email}\n=== Generated password: ${password}\n=== Save it now — it is not stored anywhere and will not be shown again.\n=== Set ADMIN_PASSWORD to choose your own next time.\n`
        );
      } else {
        console.log(
          `Created admin account: ${email} / ${password} (set ADMIN_EMAIL / ADMIN_PASSWORD env vars to override)`
        );
      }
    }
  }
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
