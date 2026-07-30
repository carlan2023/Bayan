# Bayan — E-commerce MVP

A Next.co.uk-inspired shopping site with a "modern boutique" identity: deep pine green on warm cream, clay accent, Fraunces (display serif) + Outfit (body) type.

## Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | React 18 + Vite, React Router, plain CSS design tokens | Fast dev server, no framework lock-in, full design control |
| Backend | Node + Express | Minimal, well-known REST API |
| Database | MongoDB via Mongoose | Document model fits orders/wishlists; same DB in dev and prod (Railway) |
| Auth | JWT + bcryptjs | Stateless sessions for the SPA |

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
- Product pages with colour + size selection, stock indicator, related items
- Cart (persists in localStorage) with quantity controls and delivery calculation
- **Real checkout with Cash on Delivery** — guest or signed-in; server re-prices every line from the DB and reserves stock with guarded conditional updates (safe on standalone MongoDB, no replica set required)
- Accounts: register/login (JWT), order history, wishlist
- Free delivery over UGX 200,000, otherwise UGX 10,000 — constants live in `backend/src/config.js` and are served to the client at `GET /api/config`, so the cart can never quote a total the server won't honour

## Admin dashboard

Open http://localhost:5173/admin and sign in as the super user:

- **Email:** `admin@bayan.local` — **Password:** `admin123` (development only)
- Override with `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars before first boot; the account is created automatically.
- In production (`NODE_ENV=production`) the `admin123` fallback is never used: if `ADMIN_PASSWORD` is unset, a random password is generated and printed **once** to the deploy logs. Capture it then, or set `ADMIN_PASSWORD` yourself.

Features: analytics overview (revenue, orders, AOV, customers, 14-day revenue chart, orders-by-status and revenue-by-category donuts, top products, low stock alerts, recent orders), full product management (create / edit / delete with colour and size editors, featured flag, sale pricing), order management (filter by status, view line items, advance status: pending → confirmed → dispatched → delivered; cancelling restocks inventory), and a customer list with lifetime spend. Admin endpoints live under `/api/admin/*` and re-check the admin flag in the database on every request.

## API

```
GET    /api/config                 (currency + delivery pricing)
GET    /api/products?category=&search=&sort=&featured=&limit=&ids=
GET    /api/products/categories
GET    /api/products/:slug
POST   /api/auth/register | /api/auth/login
GET    /api/auth/me                (auth)
POST   /api/orders                 (guest or auth, COD)
GET    /api/orders                 (auth — own history)
GET    /api/wishlist               (auth)
POST   /api/wishlist/:productId    (auth)
DELETE /api/wishlist/:productId    (auth)
```

## Deployment (Railway)

CI/CD lives in `.github/workflows/ci-cd.yml`. On every push/PR to `main` it syntax-checks the backend, spins up a MongoDB 7 service container, seeds it and smoke-tests the full API (health, catalog, search, auth, guest COD order, admin stats, order status, admin gate), and builds the frontend. On pushes to `main` that pass, it deploys to Railway via the Railway CLI.

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
  src/routes/            auth, products, orders, wishlist
frontend/
  src/styles.css         Design system (tokens at the top)
  src/api.js             API client + price formatting
  src/store.jsx          Auth + Cart contexts
  src/components/        Header, Footer, ProductCard, ProductImage
  src/pages/             Home, Catalog, Product, Cart, Checkout, Auth, Account, Wishlist
```
