import { Router } from "express";
import { ShopSettings, SETTINGS_ID } from "../db.js";
import { requireAdmin } from "./admin.js";
import { getSettings, invalidateSettings, publicConfig } from "../config.js";
import { applySettingsPatch, DEPARTMENT_ICONS, PALETTE_KEYS } from "../settings.js";

/**
 * Admin → Settings. The shop owner edits their own name, colours, fonts,
 * currency, delivery pricing, copy and departments here — without this page
 * every change is a support call to whoever runs the deployment.
 *
 * Mounted at /api/admin/settings in server.js, separately from routes/admin.js,
 * so the settings surface stays self-contained.
 */
const router = Router();
router.use(requireAdmin);

/** Current settings plus the vocabularies the editor needs (icon names, palette keys). */
router.get("/", async (_req, res, next) => {
  try {
    const settings = await getSettings();
    res.json({ settings, icons: DEPARTMENT_ICONS, palette_keys: PALETTE_KEYS });
  } catch (err) {
    next(err);
  }
});

/**
 * Partial or full update. The patch is merged over the current settings and
 * the result validated as a whole, then written in one replace so the stored
 * document is always a complete, valid snapshot. The cache is dropped before
 * responding, so the very next order is priced from the new values.
 */
router.put("/", async (req, res, next) => {
  try {
    invalidateSettings(); // edit against the freshest copy, not a 30s-old one
    const current = await getSettings();
    const { settings, errors } = applySettingsPatch(current, req.body);
    if (errors.length) return res.status(400).json({ error: errors.join("; "), errors });

    await ShopSettings.replaceOne({ _id: SETTINGS_ID }, { _id: SETTINGS_ID, ...settings }, { upsert: true });
    invalidateSettings();
    const fresh = await getSettings();
    res.json({ settings: fresh, config: publicConfig(fresh) });
  } catch (err) {
    next(err);
  }
});

export default router;
