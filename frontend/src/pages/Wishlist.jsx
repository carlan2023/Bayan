import { useState } from "react";
import { usePageTitle } from "../usePageTitle";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth, useWishlist } from "../store";
import { useAsync } from "../useAsync";
import ProductCard from "../components/ProductCard";
import ErrorState from "../components/ErrorState";
import { HeartIcon } from "../components/Icons";

export default function Wishlist() {
  usePageTitle("Wishlist");
  const { user } = useAuth();
  const { toggle } = useWishlist();
  const { data, error, loading, reload } = useAsync(
    () => (user ? api.wishlist() : Promise.resolve({ products: [] })),
    [user?.id]
  );

  // Local copy so a removal disappears immediately without a refetch.
  const [removed, setRemoved] = useState([]);
  const [removeError, setRemoveError] = useState("");

  if (!user) return <Navigate to="/login" replace />;

  const products = (data?.products ?? []).filter((p) => !removed.includes(p.id));

  async function removeItem(id) {
    setRemoveError("");
    try {
      await toggle(id); // shared state, so hearts elsewhere update too
      setRemoved((prev) => [...prev, id]);
    } catch (err) {
      setRemoveError(err.message);
    }
  }

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div className="page-title">
        <h1>Wishlist</h1>
      </div>

      {removeError && <div className="alert alert-error">{removeError}</div>}

      {error ? (
        <ErrorState title="We couldn't load your wishlist" message={error} onRetry={reload} />
      ) : loading ? (
        <div className="spinner">Loading…</div>
      ) : products.length === 0 ? (
        <div className="empty">
          <h2>Nothing saved yet</h2>
          <p style={{ marginBottom: 24, display: "flex", justifyContent: "center", alignItems: "center", gap: 6 }}>
            Tap the <HeartIcon size={16} /> on any product to keep it here.
          </p>
          <Link to="/shop" className="btn btn-primary">
            Browse products
          </Link>
        </div>
      ) : (
        <div className="grid">
          {products.map((p) => (
            <div key={p.id}>
              <ProductCard product={p} />
              <button className="link-btn" style={{ marginTop: 8 }} onClick={() => removeItem(p.id)}>
                Remove from wishlist
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
