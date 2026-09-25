import express from "express";
import cors from "cors";
import helmet from "helmet";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import mongoose from "mongoose";
import { connectDB, Setting, Product } from "./db.js";
import { startStockAlerts } from "./stock-alerts.js";
import { getSettings, publicConfig } from "./config.js";
import { renderShell } from "./shell.js";
import { emailEnabled } from "./mailer.js";
import { storageOrigin } from "./storage.js";
import { pageMeta, sitemapXml, robotsTxt } from "./seo.js";
import { appUrl } from "./mailer.js";
import authRoutes from "./routes/auth.js";
import productRoutes from "./routes/products.js";
import orderRoutes from "./routes/orders.js";
import wishlistRoutes from "./routes/wishlist.js";
import adminRoutes, { UPLOAD_DIR } from "./routes/admin.js";
import adminSettingsRoutes from "./routes/admin-settings.js";
import adminImportRoutes from "./routes/admin-import.js";
import paymentRoutes from "./routes/payments.js";
import { startPaymentSweeper } from "./payment-service.js";
import { mobileMoneyEnabled, MOBILE_MONEY_NETWORKS } from "./flutterwave.js";

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
const storageHosts = [storageOrigin()].filter(Boolean);

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
        // With S3/R2 storage, uploads are served from the bucket's public origin.
        imgSrc: ["'self'", "data:", "blob:", "https://images.unsplash.com", ...cspImgHosts, ...storageHosts],
        // Hero banner video is always an upload (enforced in routes/admin.js).
        mediaSrc: ["'self'", "blob:", ...storageHosts],
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
// `email_enabled` tells the client whether to offer "Forgot password?" — a
// capability of this deployment rather than a shop setting.
/**
 * What the client is told: the shop's settings plus what this deployment can
 * do (email for password reset; which payment methods are live — mobile money
 * only with Flutterwave keys and a currency it serves).
 */
async function clientConfig() {
  const settings = await getSettings();
  const momo = mobileMoneyEnabled(settings.currency);
  return {
    ...publicConfig(settings),
    email_enabled: emailEnabled(),
    payment_methods: momo ? ["cod", "mobile_money"] : ["cod"],
    mobile_money_networks: momo ? MOBILE_MONEY_NETWORKS : [],
  };
}
app.get("/api/config", async (_req, res, next) => {
  try {
    res.json(await clientConfig());
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
app.use("/api/payments", paymentRoutes);
app.use("/api/wishlist", wishlistRoutes);
// Mounted before the general admin router; each applies the admin gate itself.
app.use("/api/admin/settings", adminSettingsRoutes);
app.use("/api/admin/import", adminImportRoutes);
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

/** Absolute origin for canonical URLs and the sitemap: APP_URL, else this request's. */
const siteBase = (req) => appUrl() || `${req.protocol}://${req.get("host")}`;

app.get("/robots.txt", (req, res) => res.type("text/plain").send(robotsTxt(siteBase(req))));
app.get("/sitemap.xml", async (req, res, next) => {
  try {
    const [products, categories] = await Promise.all([
      Product.find({}).select("slug updated_at").sort({ updated_at: -1 }).limit(45000).lean(),
      Product.distinct("category"),
    ]);
    res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(sitemapXml(siteBase(req), { products, categories }));
  } catch (err) {
    next(err);
  }
});

/** Title, description, canonical, Open Graph and JSON-LD for this URL (src/seo.js). */
async function metaFor(req, settings) {
  const slug = req.path.match(/^\/product\/([^/]+)\/?$/)?.[1];
  const product = slug ? await Product.findOne({ slug: decodeURIComponent(slug) }).lean() : null;
  const hero = req.path === "/" ? (await Setting.findById("hero").lean())?.data : null;
  return pageMeta({
    path: req.path,
    query: req.query,
    settings,
    base: siteBase(req),
    product,
    heroImage: hero?.media_type === "image" ? hero.url : null,
  });
}

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
      const config = await clientConfig();
      const meta = await metaFor(req, await getSettings());
      const html = renderShell(indexHtml, config, meta);
      // Unknown URLs and missing products still render the SPA's own 404 page,
      // but with a 404 status so they aren't indexed as real pages.
      res.status(meta.status).set("Cache-Control", "no-cache").type("html").send(html);
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

// Boot only when run as the entry point (`node src/server.js`), not when a
// test imports `app`.
const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  connectDB()
    .then(() => {
      app.listen(PORT, () => console.log(`Bayan API running on http://localhost:${PORT}`));
      // Daily reminders for anything still low on stock.
      startStockAlerts();
      // Expire mobile money payments nobody approved, giving their stock back.
      startPaymentSweeper();
    })
    .catch((err) => {
      console.error("Failed to connect to MongoDB:", err.message);
      process.exit(1);
    });
}
