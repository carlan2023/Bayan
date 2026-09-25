import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAsync } from "../useAsync";
import { usePageTitle } from "../usePageTitle";
import ProductCard from "../components/ProductCard";
import ErrorState from "../components/ErrorState";

const SORTS = [
  ["newest", "Newest"],
  ["price-asc", "Price: low to high"],
  ["price-desc", "Price: high to low"],
  ["name", "Name A–Z"],
];

export default function Catalog() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") || "";
  const search = params.get("search") || "";
  const sort = params.get("sort") || "newest";

  // Filter pills are non-critical chrome — if they fail to load the grid still
  // works, so this failure stays silent rather than blocking the page.
  const { data: catData } = useAsync(() => api.categories(), []);
  const cats = catData?.categories ?? [];

  const {
    data: productData,
    error,
    loading,
    reload,
  } = useAsync(() => api.products({ category, search, sort }), [category, search, sort]);
  const products = productData?.products ?? null;

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  const title = search ? `Results for “${search}”` : category || "All products";
  usePageTitle(title);

  return (
    <div className="container">
      <div className="page-title">
        <h1>{title}</h1>
        {products && <p>{products.length} pieces</p>}
      </div>

      <div className="catalog-bar">
        <div className="pill-row">
          <button className={`pill ${!category ? "active" : ""}`} onClick={() => setParam("category", "")}>
            All
          </button>
          {cats.map((c) => (
            <button
              key={c.category}
              className={`pill ${category === c.category ? "active" : ""}`}
              onClick={() => setParam("category", c.category)}
            >
              {c.category}
            </button>
          ))}
        </div>
        <select className="pill" aria-label="Sort products" value={sort} onChange={(e) => setParam("sort", e.target.value)}>
          {SORTS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading || !products ? (
        <div className="spinner">Loading…</div>
      ) : products.length === 0 ? (
        <div className="empty">
          <h2>Nothing found</h2>
          <p>Try a different search or browse a department instead.</p>
        </div>
      ) : (
        <section aria-labelledby="catalog-results">
        <h2 id="catalog-results" className="sr-only">
          {products.length} product{products.length === 1 ? "" : "s"}
        </h2>
        <div className="grid" style={{ paddingBottom: 40 }}>
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
        </section>
      )}
    </div>
  );
}
