# Bayan — E-commerce MVP

A Next.co.uk-inspired shopping site with a "modern boutique" identity: deep pine green on warm cream, clay accent, Fraunces (display serif) + Outfit (body) type.

## Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | React 18 + Vite, React Router, plain CSS design tokens | Fast dev server, no framework lock-in, full design control |
| Backend | Node + Express | Minimal, well-known REST API |
| Database | MongoDB via Mongoose | Document model fits orders/wishlists; same DB in dev and prod (Railway) |
| Auth | JWT + bcryptjs (async), express-rate-limit | Stateless sessions for the SPA; credential endpoints rate-limited per IP |
| Security | helmet (CSP), same-origin CORS, magic-number upload sniffing | See "Security" below |

**Requires Node 18+** and a MongoDB instance. Locally either install MongoDB Community / run `docker run -d -p 27017:27017 mongo:7`, or point `MONGODB_URI` at a hosted DB (e.g. your Railway MongoDB or Atlas free tier). Default connection: `mongodb://localhost:27017/bayan`.

## Run it

```bash
# 1. Backend (port 4000) — MongoDB must be reachable first
cd backend
npm install
npm run seed     # loads 24 products (skips if collection is not empty)
npm run dev

# 2. Frontend (port 5173) — separate terminal
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the backend.

## Features

- Home with hero, departments (Women / Men / Kids / Home), featured products
- Catalog with category filter pills, sorting, and keyword search
- Product pages with colour + size selection, **stock per size/colour variant** (sold-out pairs are disabled, "only 2 left in S / Forest"), optional per-variant price, related items
- Cart (persists in localStorage) with quantity controls and delivery calculation
- **Real checkout with Cash on Delivery** — guest or signed-in; server re-prices every line from the DB and reserves stock with guarded conditional updates (safe on standalone MongoDB, no replica set required)
- Accounts: register/login (JWT), order history, wishlist, **password reset by email** (Resend; offered only when email is configured)
- Free delivery over UGX 200,000, otherwise UGX 10,000 — constants live in `backend/src/config.js` and are served to the client at `GET /api/config`, so the cart can never quote a total the server won't honour

## Admin dashboard

Open http://localhost:5173/admin and sign in as the super user:

- **Email:** `admin@bayan.local` — **Password:** `admin123` (development only)
- Override with `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars before first boot; the account is created automatically.
- In production (`NODE_ENV=production`) the `admin123` fallback is never used: if `ADMIN_PASSWORD` is unset, a random password is generated and printed **once** to the deploy logs. Capture it then, or set `ADMIN_PASSWORD` yourself.

Features: per-variant stock editor (stock, SKU and optional price for every size/colour pair), **Team** (invite more admins by email or a copyable link, revoke invites, remove access, never the last admin), **Audit log** (order-status changes, price edits, product creation, invites, password resets), analytics overview (revenue, orders, AOV, customers, 14-day revenue chart, orders-by-status and revenue-by-category donuts, top products, low stock alerts, recent orders), full product management (create / edit / delete with colour and size editors, featured flag, sale pricing), order management (filter by status, search by order number / name / phone / town, view line items, advance status: pending → confirmed → dispatched → delivered; cancelling restocks inventory), and a customer list with lifetime spend. Admin endpoints live under `/api/admin/*` and re-check the admin flag in the database on every request.

The products and orders listings are paged server-side (25 per page, `?page=&limit=&search=`) and return `{ total, page, limit, pages }` alongside the rows — the whole catalogue and order history are reachable regardless of size.

## API

```
GET    /api/config                 (currency + delivery pricing)
GET    /api/products?category=&search=&sort=&featured=&limit=&ids=
GET    /api/products/categories
GET    /api/products/:slug
POST   /api/auth/register | /api/auth/login      (rate-limited)
GET    /api/auth/me                (auth)
POST   /api/auth/forgot            (emails a single-use reset link; same answer whether or not the account exists)
POST   /api/auth/reset             ({ token, password } → signs in; revokes older sessions)
GET    /api/auth/invite?token=     (who an admin invite is for)
POST   /api/auth/accept-invite     ({ token, name?, password })
POST   /api/orders                 (guest or auth, COD)
GET    /api/orders                 (auth — own history)
GET    /api/wishlist               (auth)
POST   /api/wishlist/:productId    (auth)
DELETE /api/wishlist/:productId    (auth)

GET    /api/admin/stats                              (admin)
GET    /api/admin/products?page=&limit=&search=      (admin, paged)
GET    /api/admin/orders?status=&page=&limit=&search= (admin, paged)
PATCH  /api/admin/orders/:id                         (admin)
POST   /api/admin/products                           (admin)
PUT    /api/admin/products/:id                       (admin)
DELETE /api/admin/products/:id                       (admin)
POST   /api/admin/uploads                            (admin, multipart)
GET    /api/admin/customers                          (admin)
GET    /api/admin/team                               (admin: admins + pending invites)
POST   /api/admin/invites                            (admin: { email, name? } → accept_url)
DELETE /api/admin/invites/:id | /api/admin/team/:id  (admin: revoke invite | remove admin access)
GET    /api/admin/audit?action=&page=                (admin, paged)
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
| `UPLOAD_DIR` | optional | Where uploads are written (Docker: `/data/uploads`) |

## Deployment (Railway)

CI/CD lives in `.github/workflows/ci-cd.yml`. On every push/PR to `main` it syntax-checks the backend, runs `npm test` (unit + route tests against a MongoDB 7 service container), checks the variants migration is a no-op on a fresh seed, boots the server (polling `/api/health` for readiness rather than sleeping) and smoke-tests the full API (health, catalog, search, auth, guest COD order on a real variant, per-variant stock accounting, admin stats, order status, admin gate, security headers), and builds the frontend. On pushes to `main` that pass, it deploys to Railway via the Railway CLI.

Setup, one time:

1. Create a Railway project with a service pointing at this repo. `railway.json` tells it to build the frontend, install the backend, then run seed + server as a **single service** (the backend serves the built frontend, so no CORS or proxy config is needed). `nixpacks.toml` pins Node 22.
2. Add a **MongoDB database** to the Railway project (New → Database → MongoDB), then on the app service set `MONGODB_URI` to a reference to the database's connection string: `${{ MongoDB.MONGO_URL }}`. No volume is needed — data lives in the database service.
3. Set service variables: `JWT_SECRET` (long random string), and optionally `ADMIN_EMAIL` / `ADMIN_PASSWORD` before the first boot.
4. In the GitHub repo, add Actions secrets: `RAILWAY_TOKEN` (Railway account/project token) and `RAILWAY_SERVICE_ID` (from the service's settings).

The seed script is idempotent (skips if products exist), and `/api/health` is configured as Railway's healthcheck.

## Notes

- Product visuals are generated SVGs derived from each product's swatch colour (fully offline). Swap `frontend/src/components/ProductImage.jsx` for `<img>` tags when real photography exists.
- Currency is UGX; change `CURRENCY` in `backend/src/config.js` and `fmtPrice` in `frontend/src/api.js` to switch. Delivery pricing copy reads from `/api/config`, so it updates everywhere on its own.
- Set `JWT_SECRET`, `PORT`, `MONGODB_URI` via environment variables in production. **The server refuses to start when `NODE_ENV=production` and `JWT_SECRET` is unset** — the development fallback is published in this repo, so anyone could forge a token with it.
- To reseed, drop the `products` collection (e.g. `mongosh bayan --eval 'db.products.drop()'`) and run `npm run seed` again.
- Orders get sequential human-friendly numbers (#1001, #1002, …) via a counters collection.

## Structure

```
backend/
  src/server.js          Express app
  src/config.js          Currency + delivery constants (served at /api/config)
  src/db.js              Mongoose models, connection, admin bootstrap
  src/seed.js            24-product catalog seed
  src/auth.js            JWT sign/verify middleware
  src/pricing.js         Order money math (pure, unit-tested)
  src/variants.js        Per-variant stock rules (pure, unit-tested)
  src/inventory.js       restoreStock(): the one way stock goes back
  src/auth-tokens.js     Hashed single-use reset/invite tokens
  src/mailer.js          Email (Resend or console)
  src/audit.js           Append-only admin audit log
  src/uploads.js         Upload sniffing
  src/migrate-variants.js  Flat stock → variants (idempotent)
  src/routes/            auth, products, orders, wishlist, admin
  test/                  node:test unit and route tests
frontend/
  src/styles.css         Design system (tokens at the top)
  src/api.js             API client + price formatting
  src/store.jsx          Auth + Cart contexts
  src/components/        Header, Footer, ProductCard, ProductImage
  src/pages/             Home, Catalog, Product, Cart, Checkout, Auth, Account, Wishlist
```
