import { useEffect, useState } from "react";
import { api, fmtPrice } from "../api";

const CATEGORIES = ["Women", "Men", "Kids", "Home"];

const emptyForm = {
  name: "",
  category: "Women",
  price: "",
  compare_at: "",
  description: "",
  fabric: "",
  swatch: "#2e4b3f",
  image: "",
  colors: [{ name: "", hex: "#2e4b3f" }],
  sizes: "XS, S, M, L, XL",
  stock: "40",
  featured: false,
};

function toForm(p) {
  return {
    name: p.name,
    category: p.category,
    price: String(p.price_cents / 100),
    compare_at: p.compare_at_cents ? String(p.compare_at_cents / 100) : "",
    description: p.description,
    fabric: p.fabric || "",
    swatch: p.swatch,
    image: p.image || "",
    colors: p.colors.map((c) => ({ ...c })),
    sizes: p.sizes.join(", "),
    stock: String(p.stock),
    featured: p.featured,
  };
}

function toPayload(f) {
  return {
    name: f.name,
    category: f.category,
    price_cents: Math.round(Number(f.price) * 100),
    compare_at_cents: f.compare_at ? Math.round(Number(f.compare_at) * 100) : null,
    description: f.description,
    fabric: f.fabric,
    swatch: f.swatch,
    image: f.image.trim(),
    colors: f.colors.filter((c) => c.name.trim()),
    sizes: f.sizes.split(",").map((s) => s.trim()).filter(Boolean),
    stock: Number(f.stock),
    featured: f.featured,
  };
}

export default function Products() {
  const [products, setProducts] = useState(null);
  const [form, setForm] = useState(null); // null = closed, {...} = open
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("");

  const load = () => api.products({ limit: 100 }).then((d) => setProducts(d.products));
  useEffect(() => {
    load();
  }, []);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  function setColor(i, key, value) {
    setForm((f) => {
      const colors = f.colors.map((c, idx) => (idx === i ? { ...c, [key]: value } : c));
      return { ...f, colors };
    });
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const { url } = await api.admin.uploadImage(file);
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
      setNotice(editingId ? "Product updated." : "Product created.");
      setForm(null);
      setEditingId(null);
      await load();
      setTimeout(() => setNotice(""), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(p) {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    setError("");
    try {
      await api.admin.deleteProduct(p.id);
    } catch (err) {
      setError(err.message);
    }
    load();
  }

  const shown = products?.filter(
    (p) =>
      !filter ||
      p.name.toLowerCase().includes(filter.toLowerCase()) ||
      p.category.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Products</h1>
          <p>{products ? `${products.length} in catalogue` : "Loading…"}</p>
        </div>
        <div className="tools">
          <input
            className="input-sm"
            placeholder="Filter products…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="btn btn-accent btn-sm"
            onClick={() => {
              setForm({ ...emptyForm, colors: [{ name: "", hex: "#2e4b3f" }] });
              setEditingId(null);
              setError("");
            }}
          >
            + New product
          </button>
        </div>
      </div>

      {notice && <div className="alert alert-ok">{notice}</div>}
      {error && !form && <div className="alert alert-error">{error}</div>}

      {form && (
        <form className="drawer form-grid" onSubmit={save}>
          <h3>{editingId ? "Edit product" : "New product"}</h3>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-3col">
            <div>
              <label>Name *</label>
              <input required value={form.name} onChange={set("name")} />
            </div>
            <div>
              <label>Category *</label>
              <select value={form.category} onChange={set("category")}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Fabric / material</label>
              <input value={form.fabric} onChange={set("fabric")} placeholder="e.g. 100% linen" />
            </div>
          </div>
          <div className="form-3col">
            <div>
              <label>Price (UGX) *</label>
              <input required type="number" min="1" step="1" value={form.price} onChange={set("price")} />
            </div>
            <div>
              <label>Compare-at price (UGX)</label>
              <input type="number" min="0" step="1" value={form.compare_at} onChange={set("compare_at")} placeholder="optional — shows a Sale badge" />
            </div>
            <div>
              <label>Stock *</label>
              <input required type="number" min="0" step="1" value={form.stock} onChange={set("stock")} />
            </div>
          </div>
          <div>
            <label>Description *</label>
            <textarea required rows="3" value={form.description} onChange={set("description")} />
          </div>
          <div>
            <label>Product image</label>
            <div className="color-row" style={{ alignItems: "flex-start", gap: 12 }}>
              {form.image ? (
                <img
                  src={form.image}
                  alt="preview"
                  style={{ width: 64, height: 78, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line, #ddd)" }}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              ) : (
                <span
                  className="mini-swatch"
                  style={{ width: 64, height: 78, borderRadius: 8, background: form.swatch }}
                  title="No image — the store shows generated art"
                />
              )}
              <div style={{ flex: 1 }}>
                <input
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
                <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                  Leave empty to use the generated swatch art.
                </span>
              </div>
            </div>
          </div>
          <div className="form-3col">
            <div>
              <label>Card swatch colour *</label>
              <div className="color-row">
                <input type="color" value={form.swatch} onChange={set("swatch")} />
                <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{form.swatch} — drives the product visual</span>
              </div>
            </div>
            <div>
              <label>Sizes * (comma-separated)</label>
              <input required value={form.sizes} onChange={set("sizes")} placeholder="XS, S, M, L or One size" />
            </div>
            <div className="checkbox-row" style={{ alignSelf: "end", paddingBottom: 10 }}>
              <input id="featured" type="checkbox" checked={form.featured} onChange={set("featured")} />
              <label htmlFor="featured" style={{ margin: 0 }}>Featured on home page</label>
            </div>
          </div>
          <div>
            <label>Colour options *</label>
            {form.colors.map((c, i) => (
              <div className="color-row" key={i}>
                <input type="color" value={c.hex} onChange={(e) => setColor(i, "hex", e.target.value)} />
                <input
                  className="input-sm"
                  style={{ flex: 1 }}
                  placeholder="Colour name, e.g. Forest"
                  value={c.name}
                  onChange={(e) => setColor(i, "name", e.target.value)}
                />
                {form.colors.length > 1 && (
                  <button
                    type="button"
                    className="link-btn"
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
              onClick={() => setForm((f) => ({ ...f, colors: [...f.colors, { name: "", hex: "#b06a4d" }] }))}
            >
              + Add colour
            </button>
          </div>
          <div className="tools">
            <button className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create product"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setForm(null);
                setEditingId(null);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="admin-panel">
        {!shown ? (
          <div className="spinner">Loading…</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th className="num">Price</th>
                <th className="num">Stock</th>
                <th>Featured</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="prod-cell">
                      <span className="mini-swatch" style={{ background: p.swatch }} />
                      {p.name}
                    </div>
                  </td>
                  <td>{p.category}</td>
                  <td className="num">{fmtPrice(p.price_cents)}</td>
                  <td className="num" style={{ color: p.stock <= 10 ? "var(--danger)" : "inherit" }}>{p.stock}</td>
                  <td>{p.featured ? "Yes" : "—"}</td>
                  <td className="num">
                    <div className="tools" style={{ justifyContent: "flex-end" }}>
                      <button
                        className="link-btn"
                        onClick={() => {
                          setForm(toForm(p));
                          setEditingId(p.id);
                          setError("");
                          window.scrollTo(0, 0);
                        }}
                      >
                        Edit
                      </button>
                      <button className="link-btn" style={{ color: "var(--danger)" }} onClick={() => remove(p)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
