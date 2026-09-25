# Bayan — white-label fashion storefront

A Next.co.uk-inspired shopping site, built to run several shops from one codebase: one Docker image, and one Railway service and database per shop. Everything that makes a shop *that* shop (name, logo, palette, fonts, currency, delivery pricing, copy, departments) is a settings document the owner edits at **Admin → Settings**, not code. The default settings are Bayan's "modern boutique" identity: deep pine green on warm cream, clay accent, Fraunces (display serif) + Outfit (body) type.

Onboarding a new shop: [`docs/onboarding.md`](docs/onboarding.md). Architecture and conventions: [`CLAUDE.md`](CLAUDE.md). Why it's built this way: [`SCALING.md`](SCALING.md).

## Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | React 18 + Vite, React Router, plain CSS design tokens | Fast dev server, no framework lock-in, full design control |
| Backend | Node + Express | Minimal, well-known REST API |
| Database | MongoDB via Mongoose | Document model fits orders/wishlists; same DB in dev and prod (Railway) |
| Auth | JWT + bcryptjs (async), express-rate-limit | Stateless sessions for the SPA; credential endpoints rate-limited per IP |
| Security | helmet (CSP), same-origin CORS, magic-number upload sniffing | See "Security" below |

**Requires Node 20.9+** (for sharp) and a MongoDB instance. Locally either install MongoDB Community / run `docker run -d -p 27017:27017 mongo:7`, or point `MONGODB_URI` at a hosted DB (e.g. your Railway MongoDB or Atlas free tier). Default connection: `mongodb://localhost:27017/bayan`.

## Run it

```bash
# 1. Backend (port 4000) — MongoDB must be reachable first
cd backend
npm install
npm run seed     # demo catalogue: 24 products (skips if the collection is not empty)
npm run dev

# 2. Frontend (port 5173) — separate terminal
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend.

## Features

- Home with hero, the shop's departments (from settings, each with its own colour and icon), featured products
- Catalog with category filter pills, sorting, and keyword search
- Product pages with colour + size selection, **stock per size/colour variant** (sold-out pairs are disabled, "only 2 left in S / Forest"), optional per-variant price, related items
- Cart (persists in localStorage) with quantity controls and delivery calculation
- **Checkout with cash on delivery or mobile money** (MTN MoMo / Airtel Money through Flutterwave, offered only when keys are set): guest or signed-in; server re-prices every line from the DB and reserves stock with guarded conditional updates (safe on standalone MongoDB, no replica set required)
- **Order confirmations** by email and WhatsApp to the shopper, and a new-order alert to the shop; **guest order tracking** at `/track` with the order number and phone
- Accounts: register/login (JWT), order history, wishlist, **password reset by email** (Resend; offered only when email is configured)
- Currency, delivery fee, free-delivery threshold and per-line cap come from the shop's settings (Bayan: UGX, free over UGX 200,000, otherwise UGX 10,000). They are served at `GET /api/config`, and `POST /api/orders` charges from the same cached read, so the cart never quotes a total the server won't honour
- Runtime theming: the server writes the shop's title, palette, fonts and config into `index.html` so the first paint is already theirs, and a Settings save rethemes open pages immediately
- Uploaded photos are re-encoded to 1600/800/400px WebP and served with a `srcset`, from local disk or S3/R2

## Admin dashboard

Open http://localhost:5173/admin and sign in as the super user:

- **Email:** `admin@bayan.local` — **Password:** `admin123` (development only)
- Override with `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars before first boot; the account is created automatically.
- In production (`NODE_ENV=production`) the `admin123` fallback is never used: if `ADMIN_PASSWORD` is unset, a random password is generated and printed **once** to the deploy logs. Capture it then, or set `ADMIN_PASSWORD` yourself.

Features: **Settings** (name, wordmark, logo, the twelve palette colours with a live preview, fonts, currency and locale, delivery pricing, contact details, every piece of site copy, departments), **Import** on the Products page (CSV/XLSX stock sheet, checked before anything is written), per-variant stock editor (stock, SKU and optional price for every size/colour pair), **Team** (invite more admins by email or a copyable link, revoke invites, remove access, never the last admin), **Audit log** (order-status changes, price edits, product creation, invites, password resets), analytics overview (revenue, orders, AOV, customers, 14-day revenue chart, orders-by-status and revenue-by-category donuts, top products, low stock alerts, recent orders), full product management (create / edit / delete with colour and size editors, featured flag, sale pricing), order management (filter by status, search by order number / name / phone / town, view line items, advance status: pending → confirmed → dispatched → delivered; cancelling restocks inventory), and a customer list with lifetime spend. Admin endpoints live under `/api/admin/*` and re-check the admin flag in the database on every request.

The products and orders listings are paged server-side (25 per page, `?page=&limit=&search=`) and return `{ total, page, limit, pages }` alongside the rows — the whole catalogue and order history are reachable regardless of size.

## API

```
GET    /api/config                 (shop settings: brand, palette, fonts, copy, departments, currency, delivery pricing)
GET    /api/products?category=&search=&sort=&featured=&limit=&ids=
GET    /api/products/categories
GET    /api/products/:slug
POST   /api/auth/register | /api/auth/login      (rate-limited)
GET    /api/auth/me                (auth)
POST   /api/auth/forgot            (emails a single-use reset link; same answer whether or not the account exists)
POST   /api/auth/reset             ({ token, password } → signs in; revokes older sessions)
GET    /api/auth/invite?token=     (who an admin invite is for)
POST   /api/auth/accept-invite     ({ token, name?, password })
POST   /api/orders                 (guest or auth; payment_method cod | mobile_money + momo_network, momo_phone)
GET    /api/orders/lookup?number=&phone=   (guest order lookup, rate-limited)
GET    /api/orders/:id/payment?token=      (payment status for the browser that placed the order; re-checks the provider)
POST   /api/payments/flutterwave/webhook   (verif-hash checked; outcome re-verified with Flutterwave)
GET    /api/orders                 (auth — own history)
GET    /api/wishlist               (auth)
POST   /api/wishlist/:productId    (auth)
DELETE /api/wishlist/:productId    (auth)

GET    /api/admin/stats                              (admin)
GET    /api/admin/products?page=&limit=&search=      (admin, paged)
GET    /api/admin/orders?status=&page=&limit=&search= (admin, paged)
PATCH  /api/admin/orders/:id                         (admin; unpaid mobile money can't be fulfilled)
PATCH  /api/admin/orders/:id/payment                 (admin: resolve review → paid/failed/refund_due, refund_due → refunded)
POST   /api/admin/products                           (admin)
PUT    /api/admin/products/:id                       (admin)
DELETE /api/admin/products/:id                       (admin)
POST   /api/admin/uploads                            (admin, multipart)
GET    /api/admin/customers                          (admin)
GET    /api/admin/team                               (admin: admins + pending invites)
POST   /api/admin/invites                            (admin: { email, name? } → accept_url)
DELETE /api/admin/invites/:id | /api/admin/team/:id  (admin: revoke invite | remove admin access)
GET    /api/admin/audit?action=&page=                (admin, paged)
GET    /api/admin/settings | PUT /api/admin/settings (admin: read / validate-and-save; audited)
POST   /api/admin/import?dry=1                       (admin, multipart CSV/XLSX; dry=1 only reports)
GET    /api/admin/import/template                    (admin: starter CSV)
```

Catalogue search uses a MongoDB text index on name / description / category (weighted, name highest). `$text` only matches whole words, so a partial term like `lin` falls back to an unindexed substring scan — that fallback also covers the window while the index is still building.

## Tests

```bash
cd backend
npm test                  # unit tests (pricing, variants, uploads, config) + route tests
npm run test:unit         # unit tests only, no database needed
```

Route tests drive the real Express app against a real MongoDB: set `MONGO_TEST_URI=mongodb://localhost:27017` (CI points it at its `mongo:7` service), or let `mongodb-memory-server` download a `mongod` on first run. With neither available the route tests are **skipped with the reason**, not failed, so check the summary line for `skipped 0`. Each test file uses and drops its own database.

## Per-variant stock

Stock lives on `product.variants: [{ size, color, sku, stock, price_cents? }]`, one row per size/colour pair. `product.stock` is a derived total, moved in the same single-document write as the variant, so the two never disagree and no replica set is needed. Orders reserve on the variant with a guarded `$inc`, the compensator and admin cancel restore the same variant, and low-stock alerts are per variant.

`npm run migrate:variants` converts products that only have a flat `stock` by spreading it evenly across the size/colour grid (the total is preserved exactly; recount per variant afterwards). It is idempotent and runs on every boot in the Dockerfile. Rehearse it against a copy of the live database first: `MONGODB_URI=<copy> npm run migrate:variants`.

## Security

- Login, register, forgot, reset and invite endpoints are rate-limited per IP (separate budgets); bcrypt runs async so a burst of attempts can't block the event loop.
- CORS is off in production (the SPA is same-origin). Set `CORS_ORIGIN` (comma-separated) only for a separate frontend host. helmet sets a CSP; `CSP_IMG_HOSTS` adds image hosts.
- Uploads land in an unserved `.incoming/` dir and are identified by magic number (JPEG/PNG/WebP; MP4/WebM/MOV for the hero video) before being renamed into `/uploads` with a random name and an allowlisted extension. `/uploads` is served with `X-Content-Type-Options: nosniff` and a sandboxing CSP. multer is 2.x.
- Reset and invite tokens are stored hashed, single-use and expiring. A reset revokes sessions issued before it.

### Environment variables

| Variable | Needed | What it does |
|---|---|---|
| `MONGODB_URI` | yes | Database (Railway: `${{ MongoDB.MONGO_URL }}`) |
| `JWT_SECRET` | yes in production | Signs sessions; the server refuses to boot in production without it |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first boot | Bootstrap admin account |
| `APP_URL` | for email links | Public origin used in reset and invite links (e.g. `https://shop.example`). Never derived from the request |
| `RESEND_API_KEY` / `EMAIL_FROM` | optional | Email via Resend. Without a key, production sends nothing and hides "Forgot password?"; development prints emails to the console |
| `CORS_ORIGIN` | optional | Comma-separated origins for a separately hosted frontend |
| `CSP_IMG_HOSTS` | optional | Extra image hosts for the CSP |
| `UPLOAD_DIR` | optional | Where uploads are staged, and stored when S3 isn't configured (Docker: `/data/uploads`) |
| `S3_BUCKET`, `S3_PUBLIC_URL` | optional | Store uploads in S3/R2 instead of on disk; objects are served from `S3_PUBLIC_URL` (added to the CSP) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX` | with S3 | R2 needs `S3_ENDPOINT`; `S3_REGION` defaults to `auto`; `S3_PREFIX` lets shops share a bucket |
| `SEED_DEMO` | optional | `1` loads the demo catalogue into an empty database on boot. Unset for real shops |
| `PROVISION_OWNER_PASSWORD` | provisioning | Initial password for the owner created by `npm run provision` (otherwise generated and printed once) |
| `SETTINGS_CACHE_MS` | optional | How long settings are cached per process (default 30000) |
| `FLW_SECRET_KEY`, `FLW_SECRET_HASH` | for mobile money | Flutterwave secret key and webhook secret hash. Without the key, checkout offers cash on delivery only |
| `FLW_API_BASE` | optional | Override the Flutterwave API base (testing) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | for WhatsApp | Cloud API credentials; without them no WhatsApp messages are sent |
| `WHATSAPP_TEMPLATE_ORDER`, `WHATSAPP_TEMPLATE_SHOP`, `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_API_VERSION` | optional | Template names (default `order_confirmation`, `new_order_alert`), language (`en`), Graph version (`v21.0`) |

## Payments

Every order has a fulfilment `status` and a separate `payment_status`, moved only by the state machine in `backend/src/payments.js`:

- **Cash on delivery:** `on_delivery` → `paid` when the order is marked delivered.
- **Mobile money:** stock is reserved when the order is created and the charge starts (`pending`, 30 minutes). A verified full payment makes it `paid` (and the order `confirmed`); a failure or timeout makes it `failed`/`expired`, cancels the order and releases the stock exactly once. A short or wrong-currency payment goes to `review`; money arriving after a cancel or expiry becomes `refund_due`. Admins resolve those by hand on the Orders page.

The webhook is only a hint: its body names a transaction, and the outcome is always re-read from Flutterwave's verify endpoint and applied with a conditional write, so duplicates and replays change nothing. The shopper's payment page polls the same verification, and a sweep expires unpaid prompts every minute.

Setup (per shop): set `FLW_SECRET_KEY` and `FLW_SECRET_HASH`, and in the Flutterwave dashboard point the webhook at `https://<shop>/api/payments/flutterwave/webhook` with the same secret hash. Mobile money is offered for UGX shops. **Before going live, place one test-mode order per network**: this was built against Flutterwave's v3 API from memory, because its docs were unreachable from the environment that wrote it (see `backend/src/flutterwave.js`).

Notifications go out when an order becomes real: at creation for cash on delivery, and on confirmed payment for mobile money. Email uses the Resend setup above. WhatsApp uses the Cloud API and needs two approved templates (`order_confirmation`, `new_order_alert`; parameters are listed in `backend/src/whatsapp.js`). Each side is sent once per order however many times a webhook fires.

## Shop operations

```bash
cd backend
npm run provision -- ../shops/acme.json         # settings + owner account + catalogue, idempotent
npm run import:catalogue -- stock.xlsx [--dry]  # load or update the catalogue from a sheet
npm run migrate:storage [-- --dry]              # move local uploads to S3/R2 and repoint URLs
```

The import format (one row per size/colour, products grouped by `handle`) is documented at the top of `backend/src/catalogue-import.js`; `shops/example-catalogue.csv` is a worked example. Everything is validated before anything is written.

## Deployment (Railway)

CI/CD lives in `.github/workflows/ci-cd.yml`. On every push/PR to `main` it syntax-checks the backend, runs `npm test` (unit + route tests against a MongoDB 7 service container), checks the variants migration is a no-op on a fresh seed, boots the server (polling `/api/health` for readiness rather than sleeping) and smoke-tests the full API (health, catalog, search, auth, guest COD order on a real variant, per-variant stock accounting, admin stats, order status, admin gate, security headers), and builds the frontend. It also checks that the demo seed is opt-in, that `npm run provision` is idempotent, and that a changed delivery fee is quoted by `/api/config` and charged by `POST /api/orders`.

On pushes to `main` that pass, it deploys **every shop in `shops/deploy.json`**: ring 0 (the canary) first, then ring 1 once every canary built and answered `/api/health`. `"hold": true` keeps a shop on its current release, and a manual run (*Run workflow*) can deploy named shops only. `backup.yml` takes a nightly `mongodump` of each shop and `uptime.yml` checks each shop's `/api/health` hourly. See `docs/onboarding.md`.

Setup, one time:

1. Create a Railway project with a service pointing at this repo. `railway.json` builds the `Dockerfile`: the frontend is built, the backend installed, and on boot the (opt-in) seed, the variants migration and the server run as a **single service** (the backend serves the built frontend, so no CORS or proxy config is needed).
2. Add a **MongoDB database** to the Railway project (New → Database → MongoDB), then on the app service set `MONGODB_URI` to a reference to the database's connection string: `${{ MongoDB.MONGO_URL }}`. No volume is needed — data lives in the database service.
3. Set service variables: `JWT_SECRET` (long random string), and optionally `ADMIN_EMAIL` / `ADMIN_PASSWORD` before the first boot.
4. In the GitHub repo, add the Actions secrets named for the shop in `shops/deploy.json` (for Bayan: `RAILWAY_TOKEN` and `RAILWAY_SERVICE_ID`, plus `BAYAN_MONGODB_URI` for backups).

`/api/health` is Railway's healthcheck; it answers 503 when the database is unreachable.

## Notes

- Products without a photo (or whose photo fails to load) get generated art from the swatch colour and the department's icon.
- Currency and number format are settings (`currency`, `locale`); every price goes through the `useMoney()` hook.
- Set `JWT_SECRET`, `PORT`, `MONGODB_URI` via environment variables in production. **The server refuses to start when `NODE_ENV=production` and `JWT_SECRET` is unset** — the development fallback is published in this repo, so anyone could forge a token with it.
- To reseed the demo catalogue, run `RESEED=1 npm run seed` (drops and reinserts products).
- Orders get sequential human-friendly numbers (#1001, #1002, …) via a counters collection.

## Structure

```
backend/
  src/server.js          Express app
  src/config.js          getSettings() cache, deliveryFor(), publicConfig() (/api/config)
  src/settings.js        Shop settings defaults, merge, validation
  src/shell.js           Writes the shop's theme and config into index.html
  src/storage.js         Local or S3/R2 storage, WebP renditions
  src/catalogue-import.js, src/import-catalogue.js   CSV/XLSX catalogue import
  src/provision.js       One-command shop onboarding
  src/db.js              Mongoose models, connection, admin bootstrap
  src/seed.js            24-product demo catalogue (opt-in)
  src/auth.js            JWT sign/verify middleware
  src/pricing.js         Order money math (pure, unit-tested)
  src/variants.js        Per-variant stock rules (pure, unit-tested)
  src/inventory.js       restoreStock(): the one way stock goes back
  src/auth-tokens.js     Hashed single-use reset/invite tokens
  src/mailer.js          Email (Resend or console)
  src/audit.js           Append-only admin audit log
  src/uploads.js         Upload sniffing
  src/migrate-variants.js  Flat stock → variants (idempotent)
  src/routes/            auth, products, orders, wishlist, admin, admin-settings, admin-import
  test/                  node:test unit and route tests
shared/                  Settings defaults + palette→CSS token map (both halves import them)
shops/                   Provision files and deploy.json (per-shop CI matrix)
docs/onboarding.md       Per-shop runbook
frontend/
  src/styles.css         Design system (tokens at the top)
  src/api.js             API client
  src/store.jsx          Config (useMoney, useCopy), Auth, Wishlist, Cart contexts
  src/theme.js           Runtime palette and fonts
  src/components/        Header, Footer, ProductCard, ProductImage
  src/pages/             Home, Catalog, Product, Cart, Checkout, Auth, Account, Wishlist
```
