# CLAUDE.md

Notes for working on this repository. Read `README.md` for setup and the API,
`SCALING.md` for why the architecture is the way it is, `docs/onboarding.md`
for how a shop is deployed.

## What this is

A white-label fashion storefront: React SPA + Express + MongoDB, deployed as
**one Docker image, one Railway service and one database per shop**. Nothing
shop-specific lives in code. Name, palette, fonts, currency, delivery pricing,
copy and departments are a `ShopSettings` document (`backend/src/settings.js`,
defaults in `shared/default-settings.json`). Do not fork per shop, and do not add
`shop_id` multi-tenancy without reading SCALING.md first.

## Layout

```
backend/src/
  server.js            app wiring, helmet/CSP, /api/config, SPA shell; exports `app`
  config.js            getSettings() (cached 30s, invalidated on write), deliveryFor(), publicConfig()
  settings.js          settings defaults, merge, validation (pure)
  shell.js             writes title/theme/config into index.html for first paint
  pricing.js           order money math (pure)          → test/pricing.test.js
  variants.js          per-variant stock rules (pure)   → test/variants.test.js
  inventory.js         restoreStock(): the only way stock goes back
  storage.js           local disk or S3/R2, WebP renditions via sharp
  uploads.js           magic-number sniffing
  catalogue-import.js  CSV/XLSX → products (pure); import-catalogue.js writes
  provision.js         one-command shop onboarding
  mailer.js            Resend or console; auth-tokens.js; audit.js
  routes/              auth, products, orders, wishlist, admin, admin-settings, admin-import
backend/test/          node:test: *.test.js unit, *.routes.test.js against real Mongo
frontend/src/
  store.jsx            Config (+ useMoney, useCopy), Auth, Wishlist, Cart providers
  theme.js             runtime palette/fonts (applyTheme)
  variants.js          client view of variant stock
  admin/               dashboard, products (ProductForm, VariantEditor, ImportPanel), orders,
                       customers, storefront, settings, team, audit
shared/                JSON both halves import (settings defaults, palette→token map)
shops/                 provision files and deploy.json (the per-shop CI matrix)
```

## Rules that matter

- **Money is integer cents** everywhere (`price_cents`, `*_cents`). The server
  re-prices every order from the database and one `getSettings()` snapshot. The
  client only ever sends ids, size, colour and qty. The client's quote and the
  server's charge must read the same source (`/api/config` ↔ `getSettings()`).
- **Stock lives on `product.variants[]`** (one row per size/colour);
  `product.stock` is a derived total moved in the same write. Reserve with
  `variantFilter` + `variantInc` (guarded `$inc`, no transactions, works on
  standalone Mongo); give back only through `restoreStock()`. Any new exit path
  in order creation must release what it reserved.
- **Never read shop config at import time.** Use `getSettings()` per request.
  No module-level currency, fees or brand strings in either half.
- **No colour literals below the `:root` token blocks** in `styles.css` /
  `admin.css`, and no hex in JSX. Use `var(--token)`. SVG needs
  `style={{ fill: "var(--x)" }}`, not the `fill` attribute. Runtime theming
  depends on this.
- **Prices in the UI go through `useMoney()`**; copy through `useCopy()` (fills
  `{shop_name}`, `{free_delivery_threshold}`, `{delivery_fee}`).
- **Uploads**: never trust the filename or client mimetype. Stage in
  `.incoming/`, sniff, then `publishUpload()`.
- **Admin routes** re-check `is_admin` in the DB on every request
  (`requireAdmin`); use it for any new admin router. Changes to prices, order
  status, team or settings are written to the audit log (`audit()`).
- Settings, product and import payloads are validated whole on the server;
  pure validators live apart from the DB so they can be unit-tested.

## Commands

```bash
# backend (needs MongoDB; route tests use MONGO_TEST_URI or mongodb-memory-server)
cd backend && npm ci
npm run dev                    # :4000
npm run seed                   # demo catalogue (opt-in)
MONGO_TEST_URI=mongodb://localhost:27017 npm test
npm run test:unit              # no database
npm run provision -- ../shops/example.json
npm run import:catalogue -- file.xlsx [--dry]
npm run migrate:variants | migrate:storage [-- --dry]

# frontend
cd frontend && npm ci && npm run dev   # :5173, proxies /api
npm run build
```

Before pushing: `npm test` must report `skipped 0` (a skip means the route
tests never ran), and `npm run build` must pass. CI
(`.github/workflows/ci-cd.yml`) runs both plus a curl smoke test, then
deploys `shops/deploy.json` ring 0, then ring 1.

## Conventions

- ES modules, no TypeScript, no ORM beyond Mongoose, plain CSS.
- Comments explain *why* (the failure mode prevented), not what.
- Scripts are idempotent and safe to re-run; migrations take `--dry`.
- Keep SPRINT.md / SCALING.md checkboxes honest: tick only what is done and
  verified, and say what wasn't verified.
