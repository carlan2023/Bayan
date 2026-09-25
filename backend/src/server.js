import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { connectDB, Setting } from "./db.js";
import { startStockAlerts } from "./stock-alerts.js";
import { publicConfig } from "./config.js";
import { emailEnabled } from "./mailer.js";
import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import orderRoutes from "./routes/orders.js";
import wishlistRoutes from "./routes/wishlist.js";
import adminRoutes, { UPLOAD_DIR } from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Exported so the route tests (test/routes/*.test.js) can drive the real app
// against a throwaway database without binding the production port.
export const app = express();
const isProd = process.env.NODE_ENV === "production";

// Railway terminates TLS and forwards, so the client IP arrives in
// X-Forwarded-For. Without this the rate limiter would key every request to the
// proxy's address and throttle all users as one.
if (isProd) app.set("trust proxy", 1);

const cspImgHosts = (process.env.CSP_IMG_HOSTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => /^https:\/\/[^\s'";]+$/.test(s));

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
        // Our own /uploads plus the hosts product photos actually come from:
        // the seed uses Unsplash. An admin who pastes a photo URL from
        // elsewhere must add that host to CSP_IMG_HOSTS (comma-separated), or
        // upload the file instead — uploads always work. data: is for the
        // generated SVG placeholders, blob: for admin upload previews.
        imgSrc: ["'self'", "data:", "blob:", "https://images.unsplash.com", ...cspImgHosts],
        // Hero banner video is always an upload (enforced in routes/admin.js).
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        // wa.me "Ask on WhatsApp" links are plain <a target="_blank">
        // navigations, which CSP does not govern — nothing to allow here.
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
// `email_enabled` tells the client whether to offer "Forgot password?" — it is
// a capability of this deployment, not a commerce constant, so it is added
// here rather than in config.js.
app.get("/api/config", (_req, res) => res.json({ ...publicConfig(), email_enabled: emailEnabled() }));
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
// A missing upload (including anything under the unserved .incoming/ dir) is a
// plain 404, never the SPA's index.html served with a 200 as if it were the image.
app.use("/uploads", (_req, res) => res.status(404).type("text/plain").send("Not found"));

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

// Boot only when run as the entry point (`node src/server.js`), not when a
// test imports `app`.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
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
}
