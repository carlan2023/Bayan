import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { compressImage } from "../imageCompress";
import { useConfigActions, moneyFormatter } from "../store";
import { applyTheme, DEFAULT_SETTINGS } from "../theme";
import { DEPARTMENT_ICON_PATHS } from "../components/departments";

/**
 * Admin → Settings: the shop owner edits their own name, logo, colours, fonts,
 * currency, delivery pricing, contact details, marketing copy and departments.
 * Without this page every one of those is a support call.
 *
 * The server validates the whole document on save (backend/src/settings.js),
 * so this page only shapes input; it never decides what is valid.
 */

const PALETTE_LABELS = {
  bg: "Page background",
  surface: "Cards & panels",
  ink: "Text",
  ink_soft: "Secondary text",
  primary: "Primary (buttons, header)",
  primary_dark: "Primary, dark (footer, admin)",
  primary_tint: "Primary tint (selected)",
  accent: "Accent (calls to action)",
  accent_dark: "Accent, dark (links)",
  highlight: "Highlight (badges)",
  line: "Borders",
  danger: "Errors & sale",
};

const toMajor = (cents) => (cents == null ? "" : String(cents / 100));
const toCents = (v) => Math.round(Number(v) * 100);

function Section({ title, hint, children }) {
  return (
    <section className="admin-panel form-grid settings-section">
      <h3>{title}</h3>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

function Field({ id, label, hint, children }) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export default function Settings() {
  const { replace } = useConfigActions();
  const [s, setS] = useState(null); // working copy of the settings
  const [icons, setIcons] = useState(Object.keys(DEPARTMENT_ICON_PATHS));
  const [money, setMoney] = useState({ threshold: "", fee: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const previewRef = useRef(null);

  useEffect(() => {
    api.admin
      .settings()
      .then(({ settings, icons }) => {
        setS(settings);
        if (icons?.length) setIcons(icons);
        setMoney({
          threshold: toMajor(settings.free_delivery_threshold_cents),
          fee: toMajor(settings.delivery_fee_cents),
        });
      })
      .catch((e) => setError(e.message));
  }, []);

  // The preview panel wears the draft theme; the rest of the admin keeps the saved one.
  useEffect(() => {
    if (s && previewRef.current) applyTheme(s, previewRef.current);
  }, [s]);

  if (!s) {
    return error ? (
      <div className="alert alert-error" role="alert">
        {error}
      </div>
    ) : (
      <div className="spinner">Loading…</div>
    );
  }

  /** Immutable set at a dotted path: set("copy.hero.cta", "Shop"). */
  const set = (path, value) =>
    setS((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let o = next;
      for (const k of keys.slice(0, -1)) o = o[k];
      o[keys.at(-1)] = value;
      return next;
    });
  const bind = (path) => ({
    value: path.split(".").reduce((o, k) => o?.[k], s) ?? "",
    onChange: (e) => set(path, e.target.value),
  });

  const setDept = (i, key, value) =>
    set(
      "departments",
      s.departments.map((d, idx) => (idx === i ? { ...d, [key]: value } : d))
    );
  const moveDept = (i, dir) => {
    const list = [...s.departments];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set("departments", list);
  };

  async function onLogo(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const { url } = await api.admin.uploadImage(await compressImage(file));
      set("logo_url", url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const body = {
        ...s,
        free_delivery_threshold_cents: toCents(money.threshold),
        delivery_fee_cents: toCents(money.fee),
        max_qty_per_line: Number(s.max_qty_per_line),
      };
      const { settings, config } = await api.admin.saveSettings(body);
      setS(settings);
      replace(config); // the whole app re-themes and re-prices at once
      setNotice("Settings saved. The shop is using them now.");
    } catch (err) {
      setError(err.message);
      window.scrollTo(0, 0);
    } finally {
      setSaving(false);
    }
  }

  let fmt;
  try {
    fmt = moneyFormatter(s.currency, s.locale);
  } catch {
    fmt = (c) => String(c / 100);
  }

  return (
    <form onSubmit={save} className="settings-page">
      <div className="admin-head">
        <div>
          <h1>Settings</h1>
          <p>Your shop's name, look, prices and words.</p>
        </div>
        <div className="tools">
          <button className="btn btn-primary btn-sm" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert alert-ok" role="status">
          {notice}
        </div>
      )}

      <Section title="Identity">
        <div className="form-3col">
          <Field id="set-name" label="Shop name *">
            <input id="set-name" required maxLength={60} {...bind("shop_name")} />
          </Field>
          <Field id="set-wordmark" label="Wordmark *" hint="Shown as the logo when no image is uploaded.">
            <input id="set-wordmark" required maxLength={40} {...bind("wordmark")} />
          </Field>
          <Field id="set-title" label="Browser tab title *">
            <input id="set-title" required maxLength={120} {...bind("page_title")} />
          </Field>
        </div>
        <Field id="set-logo" label="Logo image" hint="Optional. An uploaded image or an https:// URL.">
          <div className="color-row" style={{ gap: 12 }}>
            {s.logo_url && <img src={s.logo_url} alt="Current logo" className="logo-preview" />}
            <input id="set-logo" style={{ flex: 1 }} value={s.logo_url || ""} onChange={(e) => set("logo_url", e.target.value || null)} />
            <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }}>
              {uploading ? "Uploading…" : "Upload"}
              <input type="file" accept="image/*" hidden onChange={onLogo} disabled={uploading} />
            </label>
            {s.logo_url && (
              <button type="button" className="link-btn" onClick={() => set("logo_url", null)}>
                Remove
              </button>
            )}
          </div>
        </Field>
      </Section>

      <Section title="Colours and fonts" hint="Font names are Google Fonts families, e.g. Playfair Display.">
        <div className="settings-theme">
          <div className="palette-grid">
            {Object.keys(PALETTE_LABELS).map((key) => (
              <div className="palette-row" key={key}>
                <input
                  type="color"
                  id={`pal-${key}`}
                  value={s.palette[key]}
                  onChange={(e) => set(`palette.${key}`, e.target.value)}
                />
                <label htmlFor={`pal-${key}`}>{PALETTE_LABELS[key]}</label>
              </div>
            ))}
            <div className="form-2col">
              <Field id="set-font-display" label="Headings font">
                <input id="set-font-display" {...bind("fonts.display")} />
              </Field>
              <Field id="set-font-body" label="Body font">
                <input id="set-font-body" {...bind("fonts.body")} />
              </Field>
            </div>
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                setS((prev) => ({ ...prev, palette: { ...DEFAULT_SETTINGS.palette }, fonts: { ...DEFAULT_SETTINGS.fonts } }))
              }
            >
              Reset colours and fonts to the defaults
            </button>
          </div>
          {/* Wears the draft theme via applyTheme(s, previewRef.current). */}
          <div className="theme-preview" ref={previewRef} aria-label="Preview of the draft theme">
            <div className="tp-top">{s.copy.topbar ? "Top bar" : ""}</div>
            <div className="tp-body">
              <div className="tp-logo">{s.wordmark}</div>
              <div className="tp-card">
                <div className="tp-eyebrow">{s.copy.hero.eyebrow}</div>
                <div className="tp-head">{s.copy.hero.headline}</div>
                <p>Body text looks like this.</p>
                <div className="tp-btns">
                  <span className="tp-btn primary">Primary</span>
                  <span className="tp-btn accent">{s.copy.hero.cta}</span>
                  <span className="tp-badge">Sale</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Money and delivery"
        hint="Checkout prices every order from these values. Changes apply to the next order placed."
      >
        <div className="form-3col">
          <Field id="set-currency" label="Currency *" hint="Three letters, e.g. UGX, KES, USD.">
            <input id="set-currency" required maxLength={3} {...bind("currency")} />
          </Field>
          <Field id="set-locale" label="Number format *" hint="A language tag, e.g. en-UG, en-KE, fr-RW.">
            <input id="set-locale" required {...bind("locale")} />
          </Field>
          <Field id="set-cap" label="Most of one item per order *">
            <input id="set-cap" type="number" min="1" max="100" required {...bind("max_qty_per_line")} />
          </Field>
        </div>
        <div className="form-3col">
          <Field id="set-threshold" label={`Free delivery from (${s.currency}) *`} hint={`Shows as ${fmt(toCents(money.threshold) || 0)}.`}>
            <input
              id="set-threshold"
              type="number"
              min="0"
              step="1"
              required
              value={money.threshold}
              onChange={(e) => setMoney((m) => ({ ...m, threshold: e.target.value }))}
            />
          </Field>
          <Field id="set-fee" label={`Delivery fee below that (${s.currency}) *`} hint={`Shows as ${fmt(toCents(money.fee) || 0)}.`}>
            <input
              id="set-fee"
              type="number"
              min="0"
              step="1"
              required
              value={money.fee}
              onChange={(e) => setMoney((m) => ({ ...m, fee: e.target.value }))}
            />
          </Field>
        </div>
      </Section>

      <Section title="Contact">
        <div className="form-3col">
          <Field id="set-email" label="Support email">
            <input id="set-email" type="email" {...bind("support_email")} />
          </Field>
          <Field id="set-phone" label="Support phone">
            <input id="set-phone" type="tel" {...bind("support_phone")} />
          </Field>
          <Field id="set-wa" label="WhatsApp number" hint="Country code first, digits only. Leave empty to hide WhatsApp buttons.">
            <input id="set-wa" inputMode="numeric" {...bind("whatsapp_number")} />
          </Field>
        </div>
      </Section>

      <Section
        title="Words on the site"
        hint="You can write {shop_name}, {free_delivery_threshold} and {delivery_fee}; they fill in with the current values."
      >
        <Field id="set-topbar" label="Top bar" hint="Leave empty to hide the bar.">
          <input id="set-topbar" {...bind("copy.topbar")} />
        </Field>
        <div className="form-2col">
          <Field id="set-eyebrow" label="Hero eyebrow">
            <input id="set-eyebrow" {...bind("copy.hero.eyebrow")} />
          </Field>
          <Field id="set-cta" label="Hero button *">
            <input id="set-cta" required {...bind("copy.hero.cta")} />
          </Field>
          <Field id="set-headline" label="Hero headline *">
            <input id="set-headline" required {...bind("copy.hero.headline")} />
          </Field>
          <Field id="set-emph" label="Hero headline, emphasised part">
            <input id="set-emph" {...bind("copy.hero.headline_emphasis")} />
          </Field>
        </div>
        <Field id="set-herobody" label="Hero text">
          <textarea id="set-herobody" rows="2" {...bind("copy.hero.body")} />
        </Field>
        <div className="form-3col">
          {s.copy.perks.map((_, i) => (
            <div key={i} className="perk-edit">
              <Field id={`set-perk-${i}`} label={`Promise ${i + 1} title *`}>
                <input id={`set-perk-${i}`} required {...bind(`copy.perks.${i}.title`)} />
              </Field>
              <Field id={`set-perkb-${i}`} label={`Promise ${i + 1} text`}>
                <textarea id={`set-perkb-${i}`} rows="3" {...bind(`copy.perks.${i}.body`)} />
              </Field>
            </div>
          ))}
        </div>
        <Field id="set-tagline" label="Footer tagline">
          <textarea id="set-tagline" rows="2" {...bind("copy.footer_tagline")} />
        </Field>
        <Field id="set-promises" label="Footer lines" hint="One per line, up to six.">
          <textarea
            id="set-promises"
            rows="3"
            value={s.copy.footer_promises.join("\n")}
            onChange={(e) => set("copy.footer_promises", e.target.value.split("\n").filter((l, i, a) => l.trim() || i === a.length - 1))}
            onBlur={(e) => set("copy.footer_promises", e.target.value.split("\n").map((l) => l.trim()).filter(Boolean))}
          />
        </Field>
        <div className="form-3col">
          <Field id="set-search" label="Search box placeholder">
            <input id="set-search" {...bind("copy.search_placeholder")} />
          </Field>
          <Field id="set-signup" label="Sign-up prompt">
            <input id="set-signup" {...bind("copy.signup_prompt")} />
          </Field>
          <Field id="set-greeting" label="WhatsApp greeting">
            <input id="set-greeting" {...bind("copy.whatsapp_greeting")} />
          </Field>
        </div>
      </Section>

      <Section
        title="Departments"
        hint="The menu, in this order. Each needs a colour for its home-page tile and an icon for products without photos."
      >
        {s.departments.map((d, i) => (
          <div className="dept-row" key={i}>
            <svg viewBox="0 0 100 100" className="dept-icon" aria-hidden="true" style={{ background: d.colour }}>
              <path d={DEPARTMENT_ICON_PATHS[d.icon] || DEPARTMENT_ICON_PATHS.tag} style={{ fill: "var(--on-accent)" }} />
            </svg>
            <input
              className="input-sm"
              aria-label={`Department ${i + 1} name`}
              value={d.name}
              required
              onChange={(e) => setDept(i, "name", e.target.value)}
            />
            <input
              type="color"
              aria-label={`Department ${i + 1} colour`}
              value={d.colour}
              onChange={(e) => setDept(i, "colour", e.target.value)}
            />
            <select
              className="input-sm"
              aria-label={`Department ${i + 1} icon`}
              value={d.icon}
              onChange={(e) => setDept(i, "icon", e.target.value)}
            >
              {icons.map((ic) => (
                <option key={ic}>{ic}</option>
              ))}
            </select>
            <button type="button" className="link-btn" aria-label={`Move ${d.name} up`} disabled={i === 0} onClick={() => moveDept(i, -1)}>
              ↑
            </button>
            <button
              type="button"
              className="link-btn"
              aria-label={`Move ${d.name} down`}
              disabled={i === s.departments.length - 1}
              onClick={() => moveDept(i, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="link-btn"
              style={{ color: "var(--danger)" }}
              onClick={() => set("departments", s.departments.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        {s.departments.length < 12 && (
          <button
            type="button"
            className="link-btn"
            onClick={() => set("departments", [...s.departments, { name: "", colour: s.palette.primary, icon: "tag" }])}
          >
            + Add department
          </button>
        )}
      </Section>

      <div className="tools" style={{ marginTop: 20 }}>
        <button className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
