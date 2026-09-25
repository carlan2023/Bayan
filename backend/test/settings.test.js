import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  PALETTE_KEYS,
  applySettingsPatch,
  mergeSettings,
  resolveSettings,
  validateSettings,
} from "../src/settings.js";

test("the shipped defaults are themselves valid", () => {
  assert.deepEqual(validateSettings(DEFAULT_SETTINGS), []);
});

test("the defaults no longer carry the demo disclaimer", () => {
  assert.ok(!JSON.stringify(DEFAULT_SETTINGS).includes("MVP demo"));
});

test("every palette key has a default colour", () => {
  for (const k of PALETTE_KEYS) assert.match(DEFAULT_SETTINGS.palette[k], /^#[0-9a-f]{6}$/i);
});

test("a partial patch merges over the current settings", () => {
  const { settings, errors } = applySettingsPatch(DEFAULT_SETTINGS, {
    shop_name: "  Acme Bridal  ",
    palette: { primary: "#6b1d2f" },
  });
  assert.deepEqual(errors, []);
  assert.equal(settings.shop_name, "Acme Bridal", "trimmed");
  assert.equal(settings.palette.primary, "#6b1d2f");
  assert.equal(settings.palette.accent, DEFAULT_SETTINGS.palette.accent, "untouched keys survive");
});

test("numeric fields from a form are coerced, then range-checked", () => {
  const ok = applySettingsPatch(DEFAULT_SETTINGS, { delivery_fee_cents: "500000" });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.settings.delivery_fee_cents, 500000);

  for (const bad of [-1, 1.5, "abc", null]) {
    const r = applySettingsPatch(DEFAULT_SETTINGS, { delivery_fee_cents: bad });
    assert.ok(r.errors.some((e) => /Delivery fee/.test(e)), `rejects ${bad}`);
  }
  assert.ok(applySettingsPatch(DEFAULT_SETTINGS, { max_qty_per_line: 0 }).errors.length);
});

test("arrays replace rather than splice", () => {
  const { settings } = applySettingsPatch(DEFAULT_SETTINGS, {
    departments: [{ name: "Bridal", colour: "#6b1d2f", icon: "dress" }],
  });
  assert.equal(settings.departments.length, 1);
});

test("unknown keys are dropped", () => {
  const { settings } = applySettingsPatch(DEFAULT_SETTINGS, { is_admin: true, palette: { evil: "#000000" } });
  assert.ok(!("is_admin" in settings));
  assert.ok(!("evil" in settings.palette));
});

test("rejects values that would be unsafe in CSS, URLs or markup", () => {
  const cases = [
    [{ palette: { primary: "red;}body{display:none" } }, /primary/],
    [{ fonts: { display: "Inter');@import url(x" } }, /display font/],
    [{ logo_url: "javascript:alert(1)" }, /Logo/],
    [{ logo_url: "http://insecure.example/logo.png" }, /Logo/],
    [{ currency: "XX" }, /Currency/],
    [{ locale: "not a locale!" }, /Locale/],
    [{ whatsapp_number: "call me" }, /WhatsApp/],
    [{ support_email: "nope" }, /email/],
  ];
  for (const [patch, rx] of cases) {
    const { errors } = applySettingsPatch(DEFAULT_SETTINGS, patch);
    assert.ok(errors.some((e) => rx.test(e)), `${JSON.stringify(patch)} → ${errors}`);
  }
});

test("accepts an uploaded or https logo and clears an empty one", () => {
  assert.deepEqual(applySettingsPatch(DEFAULT_SETTINGS, { logo_url: "/uploads/1-abc.png" }).errors, []);
  assert.deepEqual(applySettingsPatch(DEFAULT_SETTINGS, { logo_url: "https://cdn.example/l.png" }).errors, []);
  assert.equal(applySettingsPatch(DEFAULT_SETTINGS, { logo_url: "" }).settings.logo_url, null);
});

test("WhatsApp numbers are normalised to wa.me digits", () => {
  const { settings, errors } = applySettingsPatch(DEFAULT_SETTINGS, { whatsapp_number: "+256 (740) 399-767" });
  assert.deepEqual(errors, []);
  assert.equal(settings.whatsapp_number, "256740399767");
});

test("departments need unique names, a colour and a known icon", () => {
  const { errors } = applySettingsPatch(DEFAULT_SETTINGS, {
    departments: [
      { name: "Shoes", colour: "#111111", icon: "shoe" },
      { name: "shoes", colour: "#222222", icon: "shoe" },
      { name: "Hats", colour: "blue", icon: "crown" },
    ],
  });
  assert.ok(errors.some((e) => /listed twice/.test(e)));
  assert.ok(errors.some((e) => /hex colour/.test(e)));
  assert.ok(errors.some((e) => /icon must be one of/.test(e)));
});

test("exactly three perks", () => {
  const { errors } = applySettingsPatch(DEFAULT_SETTINGS, { copy: { perks: [{ title: "x", body: "" }] } });
  assert.ok(errors.some((e) => /three perks/.test(e)));
});

test("resolveSettings fills gaps in an old or partial document from the defaults", () => {
  const s = resolveSettings({ shop_name: "Acme", copy: { hero: { headline: "Hi" } } });
  assert.equal(s.shop_name, "Acme");
  assert.equal(s.copy.hero.headline, "Hi");
  assert.equal(s.copy.hero.cta, DEFAULT_SETTINGS.copy.hero.cta);
  assert.deepEqual(s.departments, DEFAULT_SETTINGS.departments);
  assert.deepEqual(resolveSettings(null), mergeSettings(DEFAULT_SETTINGS, {}));
});
