import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../store";
import ProductCard from "../components/ProductCard";
import { HeartIcon } from "../components/Icons";

export default function Wishlist() {
  const { user } = useAuth();
  const [products, setProducts] = useState(null);

  useEffect(() => {
    if (user) api.wishlist().then((d) => setProducts(d.products)).catch(() => setProducts([]));
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  async function removeItem(id) {
    await api.removeWish(id);
    setProducts((p) => p.filter((x) => x.id !== id));
  }

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div className="page-title">
        <h1>Wishlist</h1>
      </div>
      {!products ? (
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
