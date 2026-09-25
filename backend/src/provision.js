import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pathToFileURL } from "url";
import { connectDB, disconnectDB, User, ShopSettings, SETTINGS_ID } from "./db.js";
import { applySettingsPatch, resolveSettings } from "./settings.js";
import { invalidateSettings } from "./config.js";
import { importCatalogue } from "./import-catalogue.js";

/**
 * Onboard a shop onto a fresh deployment in one command (SCALING.md M6).
 *
 *   npm run provision -- ../shops/acme.json
 *
 * The file (see shops/example.json):
 *   {
 *     "settings":  { ...any Settings fields; unset ones keep their defaults },
 *     "owner":     { "email": "owner@acme.example", "name": "Amina Okello" },
 *     "catalogue": "acme-stock.xlsx"      // optional, relative to the JSON file
 *   }
 *
 * - Settings go through the same validation as Admin → Settings; an invalid
 *   file changes nothing.
 * - The owner becomes an admin. A new account's password comes from
 *   PROVISION_OWNER_PASSWORD, or is generated and printed once — never read
 *   from the JSON, which tends to end up in a repo. An existing account keeps
 *   its password and is only promoted.
 * - Idempotent: running it again re-applies the same settings, finds the
 *   owner already there, and re-imports the catalogue in place (products are
 *   matched by slug).
 */
export async function provision(spec, { baseDir = process.cwd(), log = console.log, password = process.env.PROVISION_OWNER_PASSWORD } = {}) {
  if (!spec || typeof spec !== "object") throw new Error("The provision file must be a JSON object");

  // 1. Settings, validated as a whole before anything is written.
  const current = resolveSettings(await ShopSettings.findById(SETTINGS_ID).lean());
  const { settings, errors } = applySettingsPatch(current, spec.settings || {});
  if (errors.length) throw new Error(`Settings are invalid; nothing was changed:\n  ${errors.join("\n  ")}`);

  // 2. Owner account.
  const email = String(spec.owner?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('owner.email is required, e.g. { "owner": { "email": "owner@shop.example" } }');
  const name = String(spec.owner?.name || "").trim() || `${settings.shop_name} owner`;

  // 3. Catalogue, checked before anything is written.
  let sheet = null;
  if (spec.catalogue) {
    sheet = fs.readFileSync(path.resolve(baseDir, spec.catalogue));
    const check = await importCatalogue(sheet, { dryRun: true });
    if (check.errors.length) throw new Error(`The catalogue has problems; nothing was changed:\n  ${check.errors.join("\n  ")}`);
  }

  await ShopSettings.replaceOne({ _id: SETTINGS_ID }, { _id: SETTINGS_ID, ...settings }, { upsert: true });
  invalidateSettings();
  log(`Settings written for "${settings.shop_name}".`);

  let generated = null;
  const existing = await User.findOne({ email });
  if (existing) {
    if (!existing.is_admin) {
      existing.is_admin = true;
      await existing.save();
      log(`Promoted ${email} to admin (password unchanged).`);
    } else log(`${email} is already an admin.`);
  } else {
    const pw = password || (generated = crypto.randomBytes(12).toString("base64url"));
    await User.create({ name, email, password_hash: await bcrypt.hash(pw, 10), is_admin: true });
    log(`Created admin account ${email}.`);
    if (generated) {
      log(`\n=== Password for ${email}: ${generated}\n=== Shown once. Send it to the owner and ask them to change it (Forgot password works once email is set up).\n`);
    }
  }

  let imported = null;
  if (sheet) {
    imported = await importCatalogue(sheet);
    log(`Catalogue: ${imported.created} new, ${imported.updated} updated.`);
  }
  return { settings, owner: email, generatedPassword: generated, imported };
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run provision -- <shop.json>   (see shops/example.json)");
    process.exit(2);
  }
  // No admin bootstrap: the owner in the file is the first admin, not ADMIN_EMAIL.
  connectDB({ bootstrapAdmin: false })
    .then(() => provision(JSON.parse(fs.readFileSync(file, "utf8")), { baseDir: path.dirname(path.resolve(file)) }))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}
