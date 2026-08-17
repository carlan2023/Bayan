import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connectDB, Setting } from "./db.js";
import { startStockAlerts } from "./stock-alerts.js";
import { publicConfig } from "./config.js";
import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import orderRoutes from "./routes/orders.js";
import wishlistRoutes from "./routes/wishlist.js";
import adminRoutes, { UPLOAD_DIR } from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const isProd = process.env.NODE_ENV === "production";

// Railway terminates TLS and forwards, so the client IP arrives in
// X-Forwarded-For. Without this the rate limiter would key every request to the
// proxy's address and throttle all users as one.
if (isProd) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // React sets element style attributes via style={{…}} throughout the
        // UI, and the fonts come from Google. Dropping 'unsafe-inline' here
        // needs those inline styles moved into stylesheets first.
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        // Product photos are operator-supplied URLs (seed uses Unsplash, admins
        // can paste any host), so this cannot be narrowed without a proxy.
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    // Uploaded images are served from this origin to this origin; the SPA and
    // API share a host in production.
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);

// The SPA is served from this same service in production, so no CORS is needed
// at all. Set CORS_ORIGIN (comma-separated) only if a separate frontend host
// must reach this API. In development the Vite proxy makes requests same-origin
// anyway, but stay permissive there for convenience.
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (corsOrigins.length > 0) {
  app.use(cors({ origin: corsOrigins }));
} else if (!isProd) {
  app.use(cors());
}

app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "bayan-api" }));
// Storefront constants (currency, delivery pricing) — the client reads these
// instead of hard-coding them, so quoted totals always match what we charge.
app.get("/api/config", (_req, res) => res.json(publicConfig()));
// Landing-page hero media (admin-managed). Null until an admin sets one.
app.get("/api/hero", async (_req, res, next) => {
  try {
    const s = await Setting.findById("hero");
    res.json({ hero: s?.data || null });
  } catch (err) {
    next(err);
  }
});
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/admin", adminRoutes);

// Uploaded product images (persisted on a volume in production). nosniff stops
// a mislabelled file being interpreted as HTML, and the upload route only ever
// writes an allowlisted image extension.
app.use(
  "/uploads",
  express.static(UPLOAD_DIR, {
    setHeaders: (res) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  })
);

// Unknown /api routes must answer in JSON. Without this they fell through to
// Express's default HTML 404, which the client then failed to parse, surfacing
// a confusing "Request failed (404)" instead of the real problem.
app.use("/api", (_req, res) => res.status(404).json({ error: "Endpoint not found" }));

// In production (e.g. Railway) serve the built frontend from the same service,
// so the SPA and API share one origin and no CORS/proxy config is needed.
const distDir = process.env.FRONTEND_DIST || path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(distDir, "index.html")); // SPA fallback
  });
  console.log(`Serving frontend from ${distDir}`);
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Bayan API running on http://localhost:${PORT}`));
    // Daily reminders for anything still low on stock.
    startStockAlerts();
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  });
