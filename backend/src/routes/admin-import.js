import { Router } from "express";
import multer from "multer";
import { requireAdmin } from "./admin.js";
import { importCatalogue } from "../import-catalogue.js";

/**
 * Admin → Products → Import: upload a CSV or XLSX of the shop's stock. The
 * page sends it first with ?dry=1 to show what would change, then again to
 * apply. Format: src/catalogue-import.js; a starter file is at GET /template.
 */
const router = Router();
router.use(requireAdmin);

const sheet = multer({
  storage: multer.memoryStorage(), // parsed straight from memory, never written to disk or served
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
});

router.post("/", (req, res, next) => {
  sheet.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Choose a CSV or XLSX file to import" });
    try {
      const result = await importCatalogue(req.file.buffer, { dryRun: req.query.dry === "1", actor: req.user });
      res.status(result.errors.length ? 422 : 200).json(result);
    } catch (e) {
      // An unreadable workbook is the shop's file, not our fault.
      if (/spreadsheet|zip|xlsx|sheet/i.test(e.message)) {
        return res.status(400).json({ error: "That file couldn't be read as a spreadsheet. Save it as .xlsx or .csv and try again." });
      }
      next(e);
    }
  });
});

const TEMPLATE = [
  "handle,name,category,description,price,compare_at_price,fabric,featured,image,size,color,color_hex,color_image,sku,stock,variant_price",
  'linen-dress,Linen Wrap Dress,Women,"A breezy wrap dress in washed linen.",175000,,100% linen,yes,https://example.com/dress.jpg,S,Forest,#2e4b3f,,,4,',
  "linen-dress,,,,,,,,,M,Forest,,,,6,",
  "linen-dress,,,,,,,,,L,Forest,,,,2,185000",
  "linen-dress,,,,,,,,,M,Ivory,#f1eadb,https://example.com/dress-ivory.jpg,,3,",
].join("\r\n");

router.get("/template", (_req, res) => {
  res.set("Content-Disposition", 'attachment; filename="catalogue-template.csv"');
  res.type("text/csv").send(TEMPLATE + "\r\n");
});

export default router;
