# Bayan — Scaling Plan

How to serve several fashion shops from this codebase without forking it.

Written after a full read of the current tree (backend routes and models, frontend
pages, admin, CSS, CI, Docker, `README.md`, `SPRINT.md`). Continues the milestone
numbering in `SPRINT.md`, whose M1–M4 are done and whose **M5 (security) is still
open** and is folded in below as M9.

---

## The decision: don't fork

Three ways to serve shop #2, #3 and #4.

| | Fork per shop | **One codebase, one deploy per shop** | Full multi-tenant SaaS |
|---|---|---|---|
| Repos | N | 1 | 1 |
| Deploys | N | N | 1 |
| Databases | N | N | 1, partitioned by `shop_id` |
| Ship a bugfix | N manual ports | 1 commit, N redeploys | 1 commit, 1 deploy |
| Data isolation | Absolute | Absolute | Query-discipline only |
| Blast radius of a bad deploy | 1 shop | 1 shop at a time | Every shop |
| Onboarding cost | A day of editing | Env vars + a settings form | Self-serve |
| Refactor needed now | None | Moderate (this doc) | Large |
| Right at | Never | ~2–12 shops | ~12+, or self-serve signup |

**Take the middle column.** Same Docker image, one Railway service and one Mongo
database per shop, everything shop-specific supplied as data rather than code.

Why not fork: the four open items in `SPRINT.md` M5 are a fair sample of what
you'd be hand-porting into every copy forever — and the copies drift, so by shop
#4 the port no longer applies cleanly. You'd be maintaining four subtly different
stores while each client thinks they're getting your full attention.

Why not full SaaS yet: it means adding `shop_id` to every document and every
query in `backend/src/routes/`, and the failure mode is that one query missing its
`shop_id` shows shop A's orders to shop B. That's a business-ending bug, and it's
not worth taking on for three clients. Per-shop databases give you that isolation
for free — a mistake in a query simply cannot cross a database boundary.

The crossover comes when per-instance ops work (N redeploys, N sets of env vars, N
Mongo upgrades, N monitoring dashboards) costs more than the refactor. In practice
that's around a dozen shops, or the day you want someone to sign up without you.

### Keeping the SaaS door open

Everything in M6 below is work full multi-tenancy needs anyway. Two rules make the
eventual migration cheap, and both cost nothing today:

1. **One `Settings` document per database, never module constants.** When you go
   multi-tenant, that document gains a `shop_id` and becomes one row among many.
   If the same values live in `config.js` and `styles.css`, they have to be
   excavated first.
2. **Never read config at import time.** `backend/src/config.js` currently exports
   constants that are baked in when the module loads. Read settings per request
   (cached) instead, so the same process can one day serve two shops.

---

## What "config-driven" costs: the audit

The shop's identity is currently spread across 14 files. Every one of these forces
a code edit and a rebuild per client.

**Brand name and wordmark** — the `Ba<em>y</em>an` markup is copy-pasted in three
places: `components/Header.jsx:87`, `components/Footer.jsx:7`,
`admin/AdminLayout.jsx:23`. Plus `index.html:6` (page title),
`components/Header.jsx:103` and `:158` (search placeholders),
`pages/Auth.jsx:74` ("New to Bayan?"), and — baked into an SVG —
`components/ProductImage.jsx:73` renders the literal text `BAYAN` on every
generated product visual.

**Palette and fonts** — `styles.css:5-22` defines the tokens, but **26 hex
literals bypass them**: 15 in `styles.css` itself below the `:root` block, 11 in
`admin/admin.css` (which has no tokens at all). Five JSX files hardcode colours
too: `admin/Charts.jsx` (6), `admin/Dashboard.jsx` (5), `components/ProductImage.jsx`
(5), `admin/Products.jsx` (4), `pages/Home.jsx` (4). Fonts are pinned to
Fraunces + Outfit at `index.html:10`, `styles.css:21-22`, and again inline at
`admin/Charts.jsx:82` and `components/ProductImage.jsx:71`. **Runtime theming is
impossible until the literals are swept into tokens** — that sweep is the real
cost of M6 and should be done first.

**Departments** — hardcoded as `["Women", "Men", "Kids", "Accessories"]` at
`components/Header.jsx:7`, and two lookup tables are keyed on those exact strings:
`pages/Home.jsx:8-13` (`CAT_COLORS`) and `components/ProductImage.jsx:9-15`
(`ICONS`). A shop selling Bridal, Menswear and Shoes gets the Accessories gradient
and a perfume-bottle icon for all three. Note that `GET /api/products/categories`
already derives the real list from the catalogue — the nav just ignores it.

**Currency is served but never used.** `GET /api/config` returns `currency`
(`backend/src/config.js:18`), and nothing in the frontend reads it — confirmed by
grep. `fmtPrice` at `api.js:82-85` hardcodes `en-UG` and `UGX`. It's a plain
module function called from **12 files**, so it can't read context. Two options:

- Convert to a `useMoney()` hook — correct, but touches all 12 call sites.
- Have `ConfigProvider` assign a module-level `locale`/`currency` that `fmtPrice`
  closes over — a one-file change, at the cost of a brief first-paint flash in the
  wrong currency and a value that's mutable global state.

Recommend the hook. It's a mechanical change and the alternative is the kind of
shortcut you regret at shop #5.

**Marketing copy** — the hero (`pages/Home.jsx:34-44`), the three perks
(`:98-117`), the delivery topbar (`components/Header.jsx:68`), and the footer
tagline, promises and support email (`components/Footer.jsx:10-16`) are all
Bayan's voice, and several are COD-specific. `components/Footer.jsx:20` still ships
the string "MVP demo — not a real store", which must not reach a paying client's
storefront.

**Commerce rules** — currency, free-delivery threshold, delivery fee and per-line
cap are module constants at `backend/src/config.js:8-11`, duplicated as frontend
defaults at `store.jsx:10-15`. A shop in a different city with different delivery
economics needs a code change and a redeploy today.

---

## M6 — White-label the shell ✅

Goal: onboarding a shop is env vars plus a settings form, with zero code edits.
Ordered so nothing is blocked on anything after it.

- [x] **Sweep the colour literals into tokens first.** 26 CSS hex literals plus 5
      JSX files (see audit). Add tokens to `admin/admin.css`, which has none.
      Convert the `Charts.jsx` / `Dashboard.jsx` / `ProductImage.jsx` palettes to
      read `getComputedStyle` custom properties or accept colours as props. Until
      this lands, nothing downstream can retheme anything.
- [x] **`Settings` model** — a singleton document in `db.js`: shop name, wordmark
      (plain string, dropping the `<em>` markup trick), logo URL, palette (the
      `:root` token set), display/body font families, currency + locale, delivery
      threshold and fee, per-line cap, support email and phone, WhatsApp number,
      topbar copy, hero eyebrow/headline/body/CTA, the three perk blocks, footer
      tagline, and a `departments` array of `{name, colour, icon}` replacing the
      three hardcoded tables.
- [x] **Expand `GET /api/config`** to serve it, keeping the current keys so nothing
      breaks. Refactor `backend/src/config.js` from exported constants to a cached
      per-request read, so `deliveryFor()` and `MAX_QTY_PER_LINE` resolve from the
      document. **`routes/orders.js:41` and `:64` are the money path** — they must
      read the same source the client is quoted from, or the server charges a total
      the shopper never agreed to.
- [x] **Inject the palette at runtime.** `ConfigProvider` (`store.jsx:19`) writes
      the token set onto `document.documentElement.style` and loads the two Google
      Fonts by name. Ship the current values as the fallback so first paint isn't
      unstyled.
- [x] **`useMoney()` hook** replacing `fmtPrice`, reading locale + currency from
      config. 12 call sites.
- [x] **Departments from data.** `Header.jsx:7` reads `config.departments`;
      `Home.jsx` and `ProductImage.jsx` look up colour and icon by name with a
      sane generic fallback instead of a fashion-specific one.
- [x] **Copy from data.** Header topbar, hero, perks, footer, page title,
      search placeholder, `Auth.jsx` sign-up prompt. Delete the "MVP demo" string.
- [x] **Admin → Settings page.** A new `/admin/settings` route so the shop owner
      changes their own name, colours, delivery fees and copy without calling you.
      This is what makes the model actually scale — otherwise you're still the
      bottleneck, just with fewer git branches.
- [x] **Onboarding script.** `npm run provision` writes a `Settings` document from
      a JSON file and creates the owner's admin account, so a new shop is one
      command plus a catalogue import.
- [x] **Optional demo seed.** `seed.js` currently hardcodes 24 fashion products
      with Unsplash URLs and KES→UGX conversion. Split into "demo data" (opt-in,
      for showing prospects) and a CSV/XLSX catalogue import a real client can use
      to load their own stock. Note `Dockerfile:35` runs the seed on every boot.
- [x] Extend the CI smoke test: `/api/config` serves the settings shape, a changed
      delivery fee is honoured by `POST /api/orders`, and the provision script is
      idempotent.

**Deliberately not included:** per-shop custom domains and TLS. Railway handles
that per service; it's ops, not code.

**Done.** Settings live in one `ShopSettings` document (defaults in
`shared/default-settings.json`, validation in `backend/src/settings.js`),
cached per request and invalidated on write; `routes/orders.js` prices from the
same `getSettings()` snapshot `/api/config` serves. The server writes the
theme, fonts, title and config into `index.html`, so first paint is the shop's
own. The importer takes CSV or XLSX (one row per size/colour) through
`npm run import:catalogue` or Admin → Products → Import, and the demo seed only
runs with `npm run seed` / `SEED_DEMO=1`. Beyond the plan: Settings edits are
audited, and whole-number prices drop their minor units (KES 200,000, not
200,000.00). **Not verified:** rendering in a real client's fonts beyond the
two tried here (Fraunces/Outfit, and the Acme example's palette).

---

## M7 — Per-variant inventory ✅ (bar the live rehearsal)

**Do this before onboarding anyone.** `stock` is a single integer on the product
(`db.js:50`) while `sizes` (`:47`) and `colors` (`:46`) are independent arrays.
Nothing can express "sold out in XS, three left in L" — which is the central
inventory question in clothing, and the first thing a real shop will notice is
missing. Migrating it later means migrating every tenant database that already has
live order history, with money on the line.

- [x] Replace the flat `stock` with a `variants: [{ size, color, sku, stock, price_cents? }]`
      subdocument; keep a derived total for the low-stock panel at `admin.js:156`.
- [x] Rework the reservation loop in `routes/orders.js:51-61` to guard on the
      variant rather than the product. The existing `release()` compensator
      (`:21-24`) and the cancel-restock path (`admin.js:229-233`) both move with it.
- [x] `Product.jsx` disables unavailable size/colour pairs instead of a single
      product-level "Out of stock"; `store.jsx` clamps per variant (`:191`, `:232`, `:250`).
- [x] Variant editor in `admin/Products.jsx` (already the largest file at 467 lines
      — worth splitting while you're in there).
- [x] Migration script (`npm run migrate:variants`, idempotent, runs on boot).
- [ ] Rehearsal against a copy of the live database. Not done: this session has no access to the production data. Run `MONGODB_URI=<copy> npm run migrate:variants` against a `mongodump` restore before the deploy that ships it.
- [x] CI: the existing stock-accounting assertions re-pointed at variants, and a
      new case for a partially-available line.

The admin form is now `admin/Products.jsx` (list), `admin/ProductForm.jsx` and `admin/VariantEditor.jsx`.

---

## M8 — Payments and notifications

COD-only is a hard ceiling on what you can sell, and the first request from every
client.

- [ ] **Mobile Money** — MTN MoMo and Airtel Money, most simply through an
      aggregator (Flutterwave covers both plus cards in the region). Needs a real
      payment state machine: `payment_status` alongside the existing `status`
      (`db.js:78`), an idempotent webhook receiver, and stock reserved on
      *initiation* but only committed on confirmation. Do not bolt this onto the
      current create-order path — the reservation semantics are different.
- [ ] **WhatsApp order confirmation** to the shopper and a new-order alert to the
      shop. Higher engagement than email in this market, and the number is already
      collected at checkout.
- [ ] **Order confirmation email** where an address exists (`db.js:73`).
- [ ] **Guest order lookup.** Guests can order (`routes/orders.js:16`, `optionalAuth`)
      but there is no way for them to see the order afterwards — `GET /api/orders`
      requires auth. Order number + phone is enough.
- [ ] Verify against current provider docs before estimating — fees, settlement
      times and sandbox availability all move.

---

## M9 — Security and correctness (carries `SPRINT.md` M5) ✅

M5 was acceptable while this was your own shop. It isn't once someone else's
customers' addresses and phone numbers are in the database.

- [x] **No rate limiting on `/api/auth/login`** (`routes/auth.js:39`) — unlimited
      brute force, and `bcrypt.compareSync` at `:44` blocks the single-threaded
      event loop, so it's also a cheap way to take a shop offline. Add
      `express-rate-limit`, switch to async `bcrypt.compare` (also at `:30`).
- [x] **`cors()` is fully open** (`server.js:17`) though the SPA is served
      same-origin in production (`:40-48`). Restrict it; add `helmet`.
- [x] **Upload extension is attacker-controlled** — `admin.js:21` takes it from
      `file.originalname` and the `fileFilter` (`:26`) only checks the
      client-supplied mimetype. `x.html` sent as `image/png` is written and served
      as HTML from `/uploads` (`server.js:31`) — stored XSS on your own origin.
      Admin-only, so low severity, but allowlist `.jpg/.jpeg/.png/.webp` and set
      `X-Content-Type-Options: nosniff`.
- [x] **`multer@1.4.5-lts.1`** is EOL with known DoS advisories → 2.x.
- [x] **No password reset anywhere.** `routes/auth.js` is register/login/me only.
      A locked-out shop owner has no recovery path and becomes a support call you
      can't resolve. Needs a token-based reset flow and an email sender —
      pair it with M8's notification work.
- [x] **No second-admin flow.** `is_admin` (`db.js:30`) can only be set by the
      bootstrap in `connectDB` (`:141-178`) or by hand in the database. A shop with
      two staff can't be served. Add admin invites.
- [x] **No tests on the money math.** CI is a curl script with `sleep 3`. The
      re-pricing and delivery logic in `routes/orders.js:63-64` deserves real unit
      tests before N shops depend on it — a regression there overcharges real
      customers in several stores at once.
- [x] Consider audit logging on admin order-status changes and price edits.

UI: `/forgot-password`, `/reset-password`, `/accept-invite`, `/admin/team` and `/admin/audit`. Audited actions: order status, product create, price edits, invites and their revocation, joins, demotions, password resets.

---

## M10 — Platform operations ✅ (bar the first live runs)

- [x] **Images off local disk.** `UPLOAD_DIR` (`admin.js:14`) is a Railway volume;
      it doesn't survive service recreation cleanly, has no CDN, and serves
      full-size originals to phones on mobile data. Move to S3/R2/Cloudinary with
      resizing. This matters more than it sounds — product photography is most of
      the page weight in a fashion store, on the slowest connections.
- [x] **Per-shop onboarding runbook** (draft below) as a checklist you actually
      follow, so shop #5 doesn't get a subtly different setup.
- [x] **Shared CI, per-shop deploy.** `ci-cd.yml:203-219` deploys a single
      `RAILWAY_SERVICE_ID`. Make it a matrix over shops, with the option to hold a
      shop back — you want one client on a new release before all of them.
- [x] **Uptime monitoring** per shop against the existing `/api/health`
      (`server.js:20`), and database backups. Neither exists today.
- [x] **Doc drift.** `README.md` describes the stack accurately, but a stale
      `backend/bayan.db*` trio is sitting in your working tree (gitignored, so
      never committed — just delete it) and `nixpacks.toml:1` still
      claims Node 22 is pinned "for the built-in node:sqlite driver" — both left
      over from before the Mongo migration. `railway.json:4` uses the Dockerfile
      builder, so `nixpacks.toml` may be dead entirely; confirm and delete.
- [x] **Add a `CLAUDE.md`** capturing the architecture and conventions, so future
      sessions don't re-derive them.

---

**Done:** `backend/src/storage.js` stores uploads on disk or in any
S3-compatible bucket (R2, S3, B2), re-encoding photos to 1600/800/400px WebP
with EXIF stripped; the storefront picks a rendition with `srcset`.
`npm run migrate:storage` moves an existing volume across. The runbook is
`docs/onboarding.md`. `shops/deploy.json` drives a deploy matrix: ring 0 is
the canary, ring 1 follows once it's healthy, and `hold` skips a shop.
`backup.yml` does a nightly `mongodump` per shop (optionally gpg-encrypted, to
a bucket or a 14-day artifact); `uptime.yml` checks `/api/health` hourly.
`nixpacks.toml` was dead (`railway.json` uses the Dockerfile builder) and is
deleted. `CLAUDE.md` is written.

**Not verified:** none of the three workflows has run for real yet. They pass
actionlint, but the deploy matrix runs for the first time on the next push to
`main`, and backups need `BAYAN_MONGODB_URI` (and ideally `BACKUP_PASSPHRASE`)
added as secrets. Bayan's `url` in `shops/deploy.json` is empty, so its
post-deploy health check and uptime check are skipped until it is filled in.
The stale `backend/bayan.db*` files are gitignored on the owner's machine, not
in the repository, so they can only be deleted there. S3 uploads were tested
against a fake client, not a real bucket.

---

## Per-shop onboarding runbook (target state, after M6)

1. Railway project → service from this repo, plus a MongoDB database.
2. Service variables: `MONGODB_URI=${{ MongoDB.MONGO_URL }}`, `JWT_SECRET`
   (unique per shop — never shared), `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
   `UPLOAD_DIR` (or the object-store credentials once M10 lands).
3. `npm run provision shops/<name>.json` — writes `Settings`, creates the owner.
4. Owner signs in at `/admin/settings`, uploads their logo, picks their colours.
5. Catalogue import from the shop's spreadsheet.
6. Custom domain on the Railway service; add the shop to the CI deploy matrix.
7. Uptime check and backup schedule.

Target: under an hour, most of it waiting on the client's assets.

---

## Sequencing

**M6 → M7 → M9 → M8 → M10.**

M6 first because it's what you chose and because everything else is easier once
shop-specific values are data. M7 second because it's the only item that gets
*more* expensive with every client onboarded. M9 before M8 because taking payments
raises the stakes on an unhardened login, and because M8 needs the email sender
that M9's password reset introduces anyway. M10 is continuous.

Do not onboard a paying client before M7 and M9 are done.

## Open questions

- How many shops realistically, and over what period? Three changes nothing about
  this plan; a stated ambition of thirty argues for full multi-tenancy sooner.
- What's the commercial model — one-off build fee, or a monthly fee you keep
  earning? A recurring fee justifies M10's ops work; a one-off fee means you want
  each shop as self-sufficient as possible, which pushes the admin Settings page
  and the catalogue importer up the list.
- Are all the shops in Uganda, or does currency/locale need to be real from day
  one? It changes how much of the `useMoney()` work is urgent versus tidy.
- Do any of them already have a catalogue in a spreadsheet? That decides the
  importer's input format.
