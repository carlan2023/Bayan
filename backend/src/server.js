import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { connectDB, Setting } from "./db.js";
import { startStockAlerts } from "./stock-alerts.js";
import { getSettings, publicConfig } from "./config.js";
import { renderShell } from "./shell.js";
import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import orderRoutes from "./routes/orders.js";
import wishlistRoutes from "./routes/wishlist.js";
import adminRoutes, { UPLOAD_DIR } from "./routes/admin.js";
import adminSettingsRoutes from "./routes/admin-settings.js";

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

// Uptime monitors and Railway's healthcheck hit this. It reports the database
// too: a process that is up but has lost Mongo cannot take an order, and a
// monitor that only saw "ok" would never page anyone about it.
app.get("/api/health", (_req, res) => {
  const db = mongoose.connection.readyState === 1;
  res.status(db ? 200 : 503).json({ ok: db, db, service: "bayan-api" });
});
// The shop's public settings: brand, palette, fonts, copy, departments and the
// commerce rules (currency, delivery pricing, per-line cap). The client quotes
// totals from these, and routes/orders.js charges from the same cached read.
app.get("/api/config", async (_req, res, next) => {
  try {
    res.json(publicConfig(await getSettings()));
  } catch (err) {
    next(err);
  }
});
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
// Mounted before the general admin router; each applies the admin gate itself.
app.use("/api/admin/settings", adminSettingsRoutes);
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
  // index: false — "/" must go through the personalised shell below rather
  // than being served as the raw built file.
  app.use(express.static(distDir, { index: false }));
  const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  app.get("*", async (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    try {
      // SPA fallback, with this shop's title, theme and config written in so
      // the first paint is already theirs (see src/shell.js).
      const html = renderShell(indexHtml, publicConfig(await getSettings()));
      res.set("Cache-Control", "no-cache").type("html").send(html);
    } catch {
      res.sendFile(path.join(distDir, "index.html")); // settings unreadable: default shell
    }
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
