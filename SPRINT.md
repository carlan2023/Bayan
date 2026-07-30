# Bayan — Sprint Plan

Findings from a full read of the codebase (backend routes, models, frontend pages, admin, CSS, CI, Docker). Five milestones, ordered by risk.

**Sprint cut:** Milestones 1 and 2 are the must-ship pair — one protects money and inventory, the other unlocks the majority of the traffic. Milestone 3 is cheap enough to fold in alongside them. Milestones 4 and 5 are the natural next sprint.

---

## Milestone 1 — Correctness: order integrity & one source of pricing truth ✅

Highest risk; everything else is cosmetic next to a wrong order total. The secrets hardening from Milestone 5 is pulled forward here — both are two-line changes guarding a live deployment.

- [x] **Stock leaks when order creation fails.** `backend/src/routes/orders.js:46-83` reserves stock via guarded `$inc`, then calls `Order.create(...)`. If that throws (duplicate `number` from a `nextOrderNumber` race, validation error), reserved stock is never restored — inventory silently disappears. The rollback path only exists for the reservation loop itself. → Extracted a single `release()` compensator used by both the sold-out path and a new `catch`.
- [x] **Slug never regenerates on rename.** `backend/src/routes/admin.js:300-303` compares `req.body.name` against `existing.name` *after* `Object.assign` has already overwritten it, so the condition is always false and renamed products keep their old slug forever. → Capture `previousName` before the assignment.
- [x] **Delivery constants hard-coded in four places.** `orders.js:8-9` (`20000000` / `1000000`), plus raw literals in `Cart.jsx:21` and `Checkout.jsx:23`, and the copy in `Header.jsx:24`, `Home.jsx:83-86`, `Product.jsx:123`. → New `backend/src/config.js`, served at `GET /api/config`, consumed through a `ConfigProvider` / `useDelivery` hook.
- [x] **Cart prices go stale.** `store.jsx:53-56` hydrates `price_cents` from localStorage indefinitely. → `cart.revalidate()` re-prices against the catalogue on Cart/Checkout mount and after a rejected order; `CartNotice` tells the shopper what moved.
- [x] **`JWT_SECRET` falls back to a published constant** (`auth.js:3`). → Refuses to boot when `NODE_ENV=production` and it is unset.
- [x] **`ADMIN_PASSWORD` defaults to `admin123`** (`db.js:133`, published in `README.md:47`). → Random password generated and printed once in production.
- [x] **Docs drift:** `README.md:41` and `:83` still say KES 5,000 / KES 250 and "Currency is KES" — the code moved to UGX.
- [x] *Pulled forward from M3:* cart quantity now clamps to `min(stock, max_qty_per_line)` — the `+` button disables at the ceiling instead of letting the server silently clamp.
- [x] CI smoke test extended: `/api/config`, `?ids=` filtering, and stock-accounting invariants (order decrements, cancel restores, rejected order leaks nothing).

**Not covered by tests:** the `release()` compensation inside the reservation loop only fires when a guarded `$inc` loses a race, which needs concurrency to reproduce — CI asserts the invariant via the validation path instead. Untested against a live DB locally (no MongoDB/Docker on this machine); the CI job with the `mongo:7` service container is the real verification.

## Milestone 2 — Mobile shell ✅

The store is currently unusable on a phone. For a cash-on-delivery store in Uganda this is where nearly all traffic is.

- [x] **Header overflows on mobile.** `components/Header.jsx` renders logo + 4 nav links + search + up to 5 action buttons in a single flex row, and `styles.css` has zero media queries for `.header`, `.nav`, `.search-form`, or `.header-actions`. → Hamburger drawer + magnifier-triggered search row below 900px; departments and the account actions move into the drawer, bag and wishlist stay in the bar. Drawer closes on route change and on Escape, locks body scroll, dims the page behind a tappable scrim, and focuses the search field when opened. New `MenuIcon` / `CloseIcon` / `SearchIcon`.
- [x] **Form labels are not associated with their inputs** anywhere — `Checkout.jsx`, `Auth.jsx`, and throughout `admin/Products.jsx` used bare `<label>Text</label><input/>`. → `htmlFor`/`id` pairs throughout. Also added `autoComplete` and `inputMode` on checkout and auth fields (phone/email keyboards on mobile, password-manager support), `aria-label`s on the repeated colour-editor rows, and a `.field-label` group heading with `role="group"`/`aria-labelledby` where a `<label>` would have been semantically wrong.
- [x] **Admin tables break the mobile layout.** `admin.css:127` collapses the sidebar at 760px but `.admin-table` had no scroll container — the 8-column Orders table overflowed. → `.table-scroll` wrapper on all six admin tables. The `min-width` floor is scoped to ≤760px so the narrow dashboard panels don't get scrollbars on desktop.
- [x] 44px minimum hit targets for header controls under `(pointer: coarse)`.

**Not verified visually:** the Chrome extension isn't connected in this session, so the breakpoint behaviour has not been seen rendered — only the build, the CSS cascade order (`.hamburger`/`.search-toggle` correctly override `.icon-btn`'s `display: inline-flex` in both directions), and a full audit that every `<label>` now resolves to a control. Worth a look on a real phone before it ships.

## Milestone 3 — Resilience: no more dead-end screens

Small diffs, disproportionate UX payoff.

- [ ] **Unhandled rejections leave permanent spinners.** `Product.jsx:26`, `Catalog.jsx:28`, and `Home.jsx:18-21` call `api.*(...).then(...)` with no `.catch`. A 404 slug or dropped connection leaves "Loading…" on screen forever. Add error state + retry.
- [ ] **No catch-all route.** `App.jsx:36-53` defines no `path="*"`, so any typo'd URL renders a completely blank white page — not even the header. Add a 404 page inside `ShopLayout`.
- [ ] **Unknown API routes return HTML.** `server.js:34-37` passes `/api/*` to Express's default 404 handler, which emits HTML; `api.js:18` then fails to parse it. Add a JSON 404 for `/api/*` before the SPA fallback.
- [ ] **Wishlist state is write-only.** `Product.jsx:18` tracks `wished` locally only — revisiting a saved product shows "Wishlist", not "Saved", and there's no heart affordance on `ProductCard`. Lift the wishlist into a context alongside cart.
- [ ] **Cart quantity has no ceiling.** `Cart.jsx:51` increments without bound while `orders.js:34` silently clamps to 20 and the stock check rejects at checkout.

## Milestone 4 — Admin at scale

Works at 24 products; breaks quietly as the catalogue grows.

- [ ] **Admin catalogue is capped at 100.** `admin/Products.jsx:68` loads through the *public* `GET /api/products`, which `routes/products.js:25` hard-caps at 100. Product #101 becomes uneditable and undeletable with no error shown. Add `GET /api/admin/products` with pagination and search.
- [ ] **Admin orders capped at 200.** `admin.js:181` has no paging or date filter — order #201 disappears from the admin UI permanently.
- [ ] **React key bug.** `admin/Orders.jsx:70` maps to a shorthand `<>…</>` fragment, which cannot carry a key. The `key` on line 71 is on the inner `<tr>`, not the list child, so React warns and mis-reconciles rows when the status filter changes. Use `<Fragment key={o.id}>`.
- [ ] **Unindexed product search.** `products.js:21-24` builds an `$or` regex across three fields — a full collection scan per keystroke-driven query. Add a text index and switch to `$text`.

## Milestone 5 — Security & release hygiene

Nothing exotic, but this is a live deployment taking customer addresses and phone numbers.

- [ ] **No rate limiting on `/api/auth/login`** (`routes/auth.js:39`) — unlimited brute force, and a CPU-exhaustion vector since `bcrypt.compareSync` blocks the single-threaded event loop. Add `express-rate-limit`, switch to async `bcrypt.compare`.
- [ ] **`cors()` is fully open** (`server.js:16`) even though the frontend is served same-origin in production. Restrict it, add `helmet`.
- [ ] **Upload extension is attacker-controlled.** `admin.js:21` takes the extension from `file.originalname`; the `fileFilter` only checks the client-supplied mimetype. A file named `x.html` sent as `image/png` is written and served as `text/html` from `/uploads` (`server.js:27`) — stored XSS on your own origin. Admin-only, so low severity. Allowlist `.jpg/.jpeg/.png/.webp`, set `X-Content-Type-Options`.
- [ ] **`multer@1.4.5-lts.1`** is EOL with known DoS advisories; upgrade to `2.x`.
- [ ] **No test suite.** CI (`.github/workflows/ci-cd.yml`) is a curl smoke test with `sleep 3` and no assertions on money math. The order-pricing path deserves real unit tests.
