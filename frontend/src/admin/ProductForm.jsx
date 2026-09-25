import { useState } from "react";
import { api } from "../api";
import { compressImage } from "../imageCompress";
import VariantEditor, { variantsToForm, variantsToPayload } from "./VariantEditor";

const CATEGORIES = ["Women", "Men", "Kids", "Accessories"];

export const emptyForm = () => ({
  name: "",
  category: "Women",
  price: "",
  compare_at: "",
  description: "",
  fabric: "",
  swatch: "#2e4b3f",
  image: "",
  colors: [{ name: "", hex: "#2e4b3f", image: "" }],
  sizes: "XS, S, M, L, XL",
  variants: {},
  featured: false,
});

export function toForm(p) {
  return {
    name: p.name,
    category: p.category,
    price: String(p.price_cents / 100),
    compare_at: p.compare_at_cents ? String(p.compare_at_cents / 100) : "",
    description: p.description,
    fabric: p.fabric || "",
    swatch: p.swatch,
    image: p.image || "",
    // A colour without its own photo already shows the main image in the store;
    // start from that, so a product saved before per-colour photos can be edited.
    colors: p.colors.map((c) => ({ name: c.name, hex: c.hex, image: c.image || p.image || "" })),
    sizes: p.sizes.join(", "),
    variants: variantsToForm(p.variants),
    featured: p.featured,
  };
}

const parseSizes = (f) => [...new Set(f.sizes.split(",").map((s) => s.trim()).filter(Boolean))];
const colorNames = (f) => [...new Set(f.colors.map((c) => c.name.trim()).filter(Boolean))];

function toPayload(f) {
  const sizes = parseSizes(f);
  const colors = colorNames(f);
  return {
    name: f.name,
    category: f.category,
    price_cents: Math.round(Number(f.price) * 100),
    compare_at_cents: f.compare_at ? Math.round(Number(f.compare_at) * 100) : null,
    description: f.description,
    fabric: f.fabric,
    swatch: f.swatch,
    image: f.image.trim(),
    colors: f.colors
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), hex: c.hex, image: (c.image || "").trim() })),
    sizes,
    variants: variantsToPayload(f.variants, sizes, colors),
    featured: f.featured,
  };
}

/** Create/edit drawer for one product. `initial` is a form object from emptyForm()/toForm(). */
export default function ProductForm({ initial, editingId, onSaved, onCancel, currency = "UGX" }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [colorUploading, setColorUploading] = useState(null); // index currently uploading

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  function setColor(i, key, value) {
    setForm((f) => ({ ...f, colors: f.colors.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)) }));
  }

  async function upload(file) {
    const { url } = await api.admin.uploadImage(await compressImage(file));
    return url;
  }

  async function onColorUpload(i, e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError("");
    setColorUploading(i);
    try {
      setColor(i, "image", await upload(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setColorUploading(null);
    }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const url = await upload(file);
      setForm((f) => ({ ...f, image: url }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const payload = toPayload(form);
      if (editingId) await api.admin.updateProduct(editingId, payload);
      else await api.admin.createProduct(payload);
      onSaved(editingId ? "Product updated." : "Product created.");
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="drawer form-grid" onSubmit={save}>
      <h3>{editingId ? "Edit product" : "New product"}</h3>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-3col">
        <div>
          <label htmlFor="p-name">Name *</label>
          <input id="p-name" required value={form.name} onChange={set("name")} />
        </div>
        <div>
          <label htmlFor="p-category">Category *</label>
          <select id="p-category" value={form.category} onChange={set("category")}>
            {[...new Set([...CATEGORIES, form.category])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="p-fabric">Fabric / material</label>
          <input id="p-fabric" value={form.fabric} onChange={set("fabric")} placeholder="e.g. 100% linen" />
        </div>
      </div>
      <div className="form-3col">
        <div>
          <label htmlFor="p-price">Price ({currency}) *</label>
          <input id="p-price" required type="number" min="1" step="1" value={form.price} onChange={set("price")} />
        </div>
        <div>
          <label htmlFor="p-compare">Compare-at price ({currency})</label>
          <input
            id="p-compare"
            type="number"
            min="0"
            step="1"
            value={form.compare_at}
            onChange={set("compare_at")}
            placeholder="optional — shows a Sale badge"
          />
        </div>
        <div className="checkbox-row" style={{ alignSelf: "end", paddingBottom: 10 }}>
          <input id="featured" type="checkbox" checked={form.featured} onChange={set("featured")} />
          <label htmlFor="featured" style={{ margin: 0 }}>
            Featured on home page
          </label>
        </div>
      </div>
      <div>
        <label htmlFor="p-description">Description *</label>
        <textarea id="p-description" required rows="3" value={form.description} onChange={set("description")} />
      </div>
      <div>
        <label htmlFor="p-image">Main image (optional — defaults to the first colour's photo)</label>
        <div className="color-row" style={{ alignItems: "flex-start", gap: 12 }}>
          {form.image ? (
            <img
              src={form.image}
              alt="Main image preview"
              className="thumb-preview"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span
              className="mini-swatch thumb-preview"
              style={{ background: form.swatch }}
              title="No image — the store shows generated art"
            />
          )}
          <div style={{ flex: 1 }}>
            <input
              id="p-image"
              style={{ width: "100%" }}
              placeholder="Paste an image URL, or upload a file →"
              value={form.image}
              onChange={set("image")}
            />
            <div className="tools" style={{ marginTop: 8 }}>
              <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }}>
                {uploading ? "Uploading…" : "Upload file"}
                <input type="file" accept="image/*" hidden onChange={onUpload} disabled={uploading} />
              </label>
              {form.image && (
                <button type="button" className="link-btn" onClick={() => setForm((f) => ({ ...f, image: "" }))}>
                  Remove image
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="form-3col">
        <div>
          <label htmlFor="p-swatch">Card swatch colour *</label>
          <div className="color-row">
            <input id="p-swatch" type="color" value={form.swatch} onChange={set("swatch")} />
            <span className="hint">{form.swatch} — drives the product visual</span>
          </div>
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label htmlFor="p-sizes">Sizes * (comma-separated)</label>
          <input id="p-sizes" required value={form.sizes} onChange={set("sizes")} placeholder="XS, S, M, L or One size" />
        </div>
      </div>
      {/* A <label> would be wrong here — this heading names a group of rows,
          not one control. Each row's own inputs are labelled individually. */}
      <div role="group" aria-labelledby="p-colors-label">
        <span className="field-label" id="p-colors-label">
          Colour options * — upload the product photo for each colour
        </span>
        {form.colors.map((c, i) => (
          <div className="color-row" key={i} style={{ alignItems: "center" }}>
            {c.image ? (
              <img
                src={c.image}
                alt={c.name || "colour"}
                className="thumb-preview sm"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <span className="mini-swatch thumb-preview sm" style={{ background: c.hex }} title="No photo yet for this colour" />
            )}
            <input
              type="color"
              aria-label={`Colour ${i + 1} swatch`}
              value={c.hex}
              onChange={(e) => setColor(i, "hex", e.target.value)}
            />
            <input
              className="input-sm"
              style={{ flex: 1 }}
              aria-label={`Colour ${i + 1} name`}
              placeholder="Colour name, e.g. Forest"
              value={c.name}
              onChange={(e) => setColor(i, "name", e.target.value)}
            />
            <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }}>
              {colorUploading === i ? "Uploading…" : c.image ? "Replace photo" : "Upload photo"}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => onColorUpload(i, e)}
                disabled={colorUploading !== null}
              />
            </label>
            {form.colors.length > 1 && (
              <button
                type="button"
                className="link-btn"
                aria-label={`Remove colour ${c.name || i + 1}`}
                onClick={() => setForm((f) => ({ ...f, colors: f.colors.filter((_, idx) => idx !== i) }))}
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="link-btn"
          onClick={() => setForm((f) => ({ ...f, colors: [...f.colors, { name: "", hex: f.swatch, image: "" }] }))}
        >
          + Add colour
        </button>
      </div>

      <VariantEditor
        sizes={parseSizes(form)}
        colorNames={colorNames(form)}
        value={form.variants}
        currency={currency}
        onChange={(variants) => setForm((f) => ({ ...f, variants }))}
      />

      <div className="tools">
        <button className="btn btn-primary btn-sm" disabled={saving}>
          {saving ? "Saving…" : editingId ? "Save changes" : "Create product"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
