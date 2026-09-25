import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useConfig, useMoney } from "../store";
import Pager from "./Pager";
import ProductForm, { emptyForm, toForm } from "./ProductForm";

const PAGE_SIZE = 25;

/** How many size/colour pairs are at zero, for the listing's stock column. */
const soldOutCount = (p) => (p.variants || []).filter((v) => v.stock <= 0).length;

export default function Products() {
  const money = useMoney();
  const { currency, departments } = useConfig();
  const [page, setPage] = useState(1);
  // Server-side search: the old client-side filter could only narrow the 100
  // products the public endpoint would return, so the rest were unreachable.
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [form, setForm] = useState(null); // null = closed, {...} = initial values of the open form
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(
    () =>
      api.admin
        .products({ page, limit: PAGE_SIZE, search: query })
        .then(setResult)
        .catch((e) => setError(e.message)),
    [page, query]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Debounce typing so each keystroke isn't a request.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(filter.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [filter]);

  const products = result?.products ?? null;

  // Deleting the last row on the last page would otherwise strand us past the end.
  useEffect(() => {
    if (result && result.page > result.pages) setPage(result.pages);
  }, [result]);

  async function onSaved(message) {
    setNotice(message);
    setForm(null);
    setEditingId(null);
    await load();
    setTimeout(() => setNotice(""), 3000);
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

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Products</h1>
          <p>
            {result
              ? `${result.total} in catalogue${query ? ` matching “${query}”` : ""}`
              : "Loading…"}
          </p>
        </div>
        <div className="tools">
          <input
            className="input-sm"
            aria-label="Filter products"
            placeholder="Filter products…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="btn btn-accent btn-sm"
            onClick={() => {
              setForm(emptyForm(departments));
              setEditingId(null);
              setError("");
            }}
          >
            + New product
          </button>
        </div>
      </div>

      {notice && <div className="alert alert-ok">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {form && (
        <ProductForm
          // Remount per product so switching Edit targets resets the form.
          key={editingId || "new"}
          initial={form}
          editingId={editingId}
          onSaved={onSaved}
          currency={currency}
          categories={(departments || []).map((d) => d.name)}
          onCancel={() => {
            setForm(null);
            setEditingId(null);
          }}
        />
      )}

      <div className="admin-panel">
        {!products ? (
          <div className="spinner">Loading…</div>
        ) : products.length === 0 ? (
          <div className="empty-mini">
            {query ? `No products match “${query}”.` : "No products yet — create the first one."}
          </div>
        ) : (
          <div className="table-scroll">
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
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="prod-cell">
                      <span className="mini-swatch" style={{ background: p.swatch }} />
                      {p.name}
                    </div>
                  </td>
                  <td>{p.category}</td>
                  <td className="num">{money(p.price_cents)}</td>
                  <td className="num">
                    <span style={{ color: p.stock <= 10 ? "var(--danger)" : "inherit" }}>{p.stock}</span>
                    {soldOutCount(p) > 0 && (
                      <span className="muted-sku"> · {soldOutCount(p)} sold out</span>
                    )}
                  </td>
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
          </div>
        )}

        {result && (
          <Pager
            page={result.page}
            pages={result.pages}
            total={result.total}
            limit={result.limit}
            label="products"
            onPage={setPage}
          />
        )}
      </div>
    </>
  );
}
