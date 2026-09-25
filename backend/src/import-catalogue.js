import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { connectDB, disconnectDB, Product } from "./db.js";
import { readSheetRows, rowsToProducts, toDocument } from "./catalogue-import.js";
import { audit, priceSnapshot, samePrices } from "./audit.js";
import { LOW_STOCK_THRESHOLD } from "./config.js";

/**
 * Write an import (see src/catalogue-import.js for the file format).
 *
 *   npm run import:catalogue -- stock.xlsx          # apply
 *   npm run import:catalogue -- stock.csv --dry     # validate and report only
 *
 * All-or-nothing on validation: if any product in the file is invalid nothing
 * is written. Products are matched by slug; an existing one is updated in place
 * (variant alert clocks carried over) and a new one created.
 *
 * @returns {{ created, updated, errors, products: [{ slug, name, action, variants, stock }] }}
 */
export async function importCatalogue(buffer, { dryRun = false, actor = null } = {}) {
  const { products, errors } = rowsToProducts(await readSheetRows(buffer));
  const existing = new Map(
    (await Product.find({ slug: { $in: products.map((p) => p.slug) } })).map((d) => [d.slug, d])
  );
  const report = products.map((p) => ({
    slug: p.slug,
    name: p.payload.name,
    action: existing.has(p.slug) ? "update" : "create",
    variants: p.payload.variants.length,
    stock: p.payload.variants.reduce((n, v) => n + (Number(v.stock) || 0), 0),
  }));
  const summary = {
    created: report.filter((r) => r.action === "create").length,
    updated: report.filter((r) => r.action === "update").length,
    errors,
    products: report,
  };
  if (errors.length || dryRun) return { ...summary, written: false };

  for (const p of products) {
    const doc = existing.get(p.slug);
    if (doc) {
      const before = priceSnapshot(doc);
      doc.set(toDocument(p, { variants: doc.variants.map((v) => v.toObject()) }, LOW_STOCK_THRESHOLD));
      await doc.save(); // save, not updateOne: the derived stock total is kept by the schema hook
      const after = priceSnapshot(doc);
      if (actor && !samePrices(before, after)) {
        await audit(actor, "product.price", {
          target_type: "product",
          target_id: doc._id,
          summary: `Price change on "${doc.name}" (catalogue import)`,
          before,
          after,
        });
      }
    } else {
      await Product.create({ ...toDocument(p), slug: p.slug });
    }
  }
  if (actor) {
    await audit(actor, "catalogue.import", {
      summary: `Imported the catalogue: ${summary.created} new, ${summary.updated} updated`,
      after: { created: summary.created, updated: summary.updated },
    });
  }
  return { ...summary, written: true };
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntryPoint) {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const dryRun = process.argv.includes("--dry");
  if (!file) {
    console.error("Usage: npm run import:catalogue -- <file.csv|file.xlsx> [--dry]");
    process.exit(2);
  }
  connectDB({ bootstrapAdmin: false })
    .then(async () => {
      const r = await importCatalogue(fs.readFileSync(file), { dryRun });
      for (const p of r.products) console.log(`  ${p.action.padEnd(6)} ${p.slug}  (${p.variants} variants, ${p.stock} units)`);
      if (r.errors.length) {
        console.error(`\n${r.errors.length} problem(s); nothing was written:\n  ${r.errors.join("\n  ")}`);
        process.exitCode = 1;
      } else {
        console.log(`\n${r.written ? "Imported" : "Dry run:"} ${r.created} new, ${r.updated} updated.`);
      }
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => disconnectDB());
}
