import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtPrice } from "../api";
import { useAuth, useCart } from "../store";
import ProductImage from "../components/ProductImage";
import ProductCard from "../components/ProductCard";
import { HeartIcon, CheckIcon } from "../components/Icons";

export default function Product() {
  const { slug } = useParams();
  const { add } = useCart();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [size, setSize] = useState(null);
  const [color, setColor] = useState(null);
  const [added, setAdded] = useState(false);
  const [wished, setWished] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setAdded(false);
    setWished(false);
    setError("");
    api.product(slug).then((d) => {
      setData(d);
      setSize(d.product.sizes.length === 1 ? d.product.sizes[0] : null);
      setColor(d.product.colors[0]?.name || null);
    });
    window.scrollTo(0, 0);
  }, [slug]);

  if (!data) return <div className="spinner">Loading…</div>;
  const { product, related } = data;

  function addToBag() {
    if (!size) {
      setError("Please choose a size first.");
      return;
    }
    setError("");
    add(product, { size, color });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  async function addToWishlist() {
    if (!user) {
      setError("Sign in to save items to your wishlist.");
      return;
    }
    try {
      await api.addWish(product.id);
      setWished(true);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="container">
      <div className="pdp">
        <div className="pdp-img">
          <ProductImage product={product} ratio={1.1} />
        </div>
        <div className="pdp-info">
          <div className="cat">{product.category}</div>
          <h1>{product.name}</h1>
          <div className="price">
            {fmtPrice(product.price_cents)}
            {product.compare_at_cents && <span className="was">{fmtPrice(product.compare_at_cents)}</span>}
          </div>
          <p className="desc">{product.description}</p>

          <div className="opt-label">Colour — {color}</div>
          <div className="opt-row">
            {product.colors.map((c) => (
              <button
                key={c.name}
                className={`opt color-opt ${color === c.name ? "active" : ""}`}
                onClick={() => setColor(c.name)}
              >
                <span className="swatch-dot" style={{ background: c.hex }} />
                {c.name}
              </button>
            ))}
          </div>

          <div className="opt-label">Size</div>
          <div className="opt-row">
            {product.sizes.map((s) => (
              <button key={s} className={`opt ${size === s ? "active" : ""}`} onClick={() => setSize(s)}>
                {s}
              </button>
            ))}
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-icon" onClick={addToBag}>
              {added ? (
                <>
                  Added <CheckIcon size={16} />
                </>
              ) : (
                "Add to bag"
              )}
            </button>
            <button className="btn btn-ghost btn-icon" onClick={addToWishlist}>
              {wished ? "Saved" : "Wishlist"} <HeartIcon size={16} filled={wished} />
            </button>
          </div>

          {product.fabric && <div className="meta-line">Fabric: {product.fabric}</div>}
          <div className="meta-line">
            {product.stock > 10 ? "In stock" : `Only ${product.stock} left`} · Cash on delivery available ·
            Free delivery over KES 5,000
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>You may also like</h2>
          </div>
          <div className="grid">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
