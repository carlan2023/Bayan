import { useState } from "react";

/**
 * Stock, SKU and optional price per size/colour pair.
 *
 * Rows are derived from the product's current sizes and colours, so adding a
 * size adds a row for every colour. Values are kept by the pair's key, which
 * means renaming a colour starts its rows again from zero. That's deliberate:
 * a renamed colour is a different thing on the shelf.
 */

export const variantKey = (size, color) => `${size}|${color}`;

/** Pairs in display order: colour by colour, sizes in the order the admin typed them. */
export function variantRows(sizes, colorNames) {
  const rows = [];
  for (const color of colorNames) for (const size of sizes) rows.push({ size, color, key: variantKey(size, color) });
  return rows;
}

/** Form state for a stored product: { [key]: { sku, stock, price } } with price in major units. */
export function variantsToForm(variants = []) {
  const out = {};
  for (const v of variants) {
    out[variantKey(v.size, v.color)] = {
      sku: v.sku || "",
      stock: String(v.stock ?? 0),
      price: v.price_cents ? String(v.price_cents / 100) : "",
    };
  }
  return out;
}

/** API payload for every pair in the grid. Missing rows are sent as zero stock. */
export function variantsToPayload(form, sizes, colorNames) {
  return variantRows(sizes, colorNames).map(({ size, color, key }) => {
    const v = form[key] || {};
    const stock = parseInt(v.stock, 10);
    return {
      size,
      color,
      sku: (v.sku || "").trim(),
      stock: Number.isFinite(stock) && stock > 0 ? stock : 0,
      price_cents: v.price ? Math.round(Number(v.price) * 100) : null,
    };
  });
}

export default function VariantEditor({ sizes, colorNames, value, onChange, currency }) {
  const [fill, setFill] = useState("");
  const rows = variantRows(sizes, colorNames);
  const total = rows.reduce((n, r) => n + (parseInt(value[r.key]?.stock, 10) || 0), 0);

  const setField = (key, field, v) => onChange({ ...value, [key]: { ...(value[key] || {}), [field]: v } });

  function fillAll() {
    const n = parseInt(fill, 10);
    if (!Number.isFinite(n) || n < 0) return;
    const next = { ...value };
    for (const r of rows) next[r.key] = { ...(next[r.key] || {}), stock: String(n) };
    onChange(next);
  }

  if (rows.length === 0) {
    return (
      <div className="empty-mini">Add at least one size and one named colour to set stock per variant.</div>
    );
  }

  return (
    <div role="group" aria-labelledby="p-variants-label" className="variant-editor">
      <div className="variant-head">
        <span className="field-label" id="p-variants-label">
          Stock per size and colour * <span className="muted-sku">({total} in total)</span>
        </span>
        <div className="tools">
          <input
            className="input-sm"
            type="number"
            min="0"
            step="1"
            style={{ width: 90 }}
            aria-label="Stock to set on every variant"
            placeholder="e.g. 5"
            value={fill}
            onChange={(e) => setFill(e.target.value)}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={fillAll}>
            Set all
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="admin-table variant-table">
          <thead>
            <tr>
              <th scope="col">Colour</th>
              <th scope="col">Size</th>
              <th scope="col">SKU</th>
              <th scope="col" className="num">Stock</th>
              <th scope="col" className="num">Price override ({currency})</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ size, color, key }) => {
              const v = value[key] || {};
              const label = `${size} / ${color}`;
              const out = !(parseInt(v.stock, 10) > 0);
              return (
                <tr key={key} className={out ? "variant-out" : ""}>
                  <td>{color}</td>
                  <td>{size}</td>
                  <td>
                    <input
                      className="input-sm"
                      aria-label={`SKU for ${label}`}
                      placeholder="auto"
                      value={v.sku || ""}
                      onChange={(e) => setField(key, "sku", e.target.value)}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="input-sm"
                      type="number"
                      min="0"
                      step="1"
                      style={{ width: 80 }}
                      aria-label={`Stock for ${label}`}
                      value={v.stock ?? ""}
                      placeholder="0"
                      onChange={(e) => setField(key, "stock", e.target.value)}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="input-sm"
                      type="number"
                      min="1"
                      step="1"
                      style={{ width: 110 }}
                      aria-label={`Price override for ${label}`}
                      placeholder="same"
                      value={v.price || ""}
                      onChange={(e) => setField(key, "price", e.target.value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span className="hint">
        Leave SKU empty to generate one. Leave the price empty to use the product price. A pair at 0 shows as sold
        out on the product page.
      </span>
    </div>
  );
}
