# Onboarding a shop

The checklist for putting a new shop on this codebase: one Railway service and
one MongoDB per shop, the same image for all of them, everything shop-specific
held as data. Follow it top to bottom so shop #5 gets the same setup as shop #2.
Most of the elapsed time is waiting on the client's logo, colours and stock sheet.

## Before you start, from the client

- [ ] Shop name, and the wordmark (the name as it should appear as a logo), plus a logo image if they have one
- [ ] Colours (at least a primary and an accent) and, optionally, two Google Fonts
- [ ] Currency and country (sets the number format, e.g. `KES` / `en-KE`)
- [ ] Delivery pricing: the fee, and the order total above which delivery is free
- [ ] Support email, phone and WhatsApp number
- [ ] Departments for the menu (e.g. Women, Men, Shoes)
- [ ] Their stock as a spreadsheet. Send them the template: Admin → Products → Import → *Download the template*, or `shops/example-catalogue.csv`
- [ ] The owner's name and email; the owner becomes the first admin

## 1. Railway

1. New project → **Deploy from GitHub repo** → this repository. `railway.json` builds the `Dockerfile`.
2. In the same project: **New → Database → MongoDB**.
3. Service variables:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | `${{ MongoDB.MONGO_URL }}` |
   | `JWT_SECRET` | a new long random string (`openssl rand -base64 48`). **Never reuse one across shops**: a shared secret lets a token from one shop sign in to another |
   | `APP_URL` | the shop's public URL, e.g. `https://shop.example.com` (used in reset and invite emails) |
   | `RESEND_API_KEY`, `EMAIL_FROM` | optional; turns on password reset and emailed invites. `EMAIL_FROM` must be on a domain verified in Resend |
   | `S3_BUCKET`, `S3_PUBLIC_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX` | image storage (step 2). Without them, uploads go to a volume |
   | `SEED_DEMO` | leave unset. `1` loads the 24-product demo catalogue into an empty database, for showing prospects only |

   Do **not** set `ADMIN_EMAIL`/`ADMIN_PASSWORD` for a client shop: provisioning creates the owner instead.
4. Custom domain: service → Settings → Networking → add the domain and set the DNS record Railway shows.

## 2. Image storage

Pick one:

- **Cloudflare R2 (recommended).** Create a bucket (one per shop, or one shared bucket with `S3_PREFIX=<shop>`), enable its public `r2.dev` URL or attach a custom domain, and create an API token with Object Read & Write on it. Then set `S3_BUCKET`, `S3_PUBLIC_URL` (the public URL), `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. `S3_REGION` defaults to `auto`.
- **AWS S3.** The same variables, with `S3_REGION` set and `S3_ENDPOINT` left empty. The bucket must allow public reads of objects (or sit behind CloudFront, whose URL is `S3_PUBLIC_URL`).
- **Volume.** Add a volume mounted at `/data`. Fine to start with; it has no CDN and doesn't survive re-creating the service.

Uploads are re-encoded to 1600/800/400px WebP either way. A shop that started on a volume moves with `npm run migrate:storage` (it copies the files and repoints every URL; run `-- --dry` first).

## 3. Provision

Write `shops/<name>.json` (copy `shops/example.json`): the settings, the owner, and the path to their stock sheet. Settings are validated before anything is written. Then, with the shop's database URL (Railway: MongoDB → Connect → public URL):

```bash
cd backend
MONGODB_URI='<public mongo url>' PROVISION_OWNER_PASSWORD='<temporary password>' npm run provision -- ../shops/<name>.json
```

Leave `PROVISION_OWNER_PASSWORD` out to have one generated and printed once. It is never read from the JSON file, because that file gets committed. Send the owner the password and ask them to change it. Running provision again is safe: it re-applies the settings, finds the owner, and updates the catalogue in place.

## 4. Hand over to the owner

1. They sign in at `/login`, then go to **Admin → Settings**: upload the logo, check the colours against the preview, read through every piece of copy (the defaults mention cash on delivery), and check delivery pricing.
2. **Admin → Products**: spot-check the import and add photos per colour where the sheet had none.
3. **Admin → Team**: invite anyone else who runs the shop.
4. **Admin → Storefront**: the home-page hero image or video.

## 5. CI, backups, uptime

Add the shop to `shops/deploy.json`:

```json
{ "name": "acme", "ring": 1, "hold": false, "url": "https://shop.acme.example",
  "railway_token_secret": "ACME_RAILWAY_TOKEN", "railway_service_secret": "ACME_RAILWAY_SERVICE_ID",
  "mongo_uri_secret": "ACME_MONGODB_URI" }
```

and add those three repository secrets (Settings → Secrets and variables → Actions). Then:

- **Deploys**: every push to `main` that passes CI deploys ring 0 (the canary, normally your own shop) first, then every ring-1 shop once the canary built and answered `/api/health`. `"hold": true` keeps a shop on its current release. *Actions → CI/CD → Run workflow* deploys chosen shops by name.
- **Backups**: `backup.yml` dumps every shop with a `mongo_uri_secret` nightly. Set `BACKUP_PASSPHRASE` (encrypts the archive; it holds customers' addresses and phone numbers) and, for off-GitHub storage, `BACKUP_S3_BUCKET` / `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` / `BACKUP_S3_ENDPOINT`. Without a bucket the archive is kept as a 14-day workflow artifact.
- **Uptime**: `uptime.yml` checks each `url` hourly and fails (so GitHub emails you) when one is down. For faster alerts, also point an external monitor at `https://<shop>/api/health`, which answers 503 when the database is unreachable.

Run the backup workflow once by hand and check the archive restores (below) before calling the shop live.

## Restoring a backup

```bash
gpg --decrypt acme-2026-09-25T0117Z.archive.gz.gpg > acme.archive.gz    # if encrypted
mongorestore --uri '<target mongo url>' --archive=acme.archive.gz --gzip --drop
```

Rehearse into a scratch database first: add `--nsFrom '<source db>.*' --nsTo 'rehearsal.*'` to restore under another name. The same rehearsal is how to test a migration such as `npm run migrate:variants` against real data before it ships.

## Offboarding

Remove the shop from `shops/deploy.json` and delete its secrets, take a final backup, then delete the Railway service, database and bucket.
