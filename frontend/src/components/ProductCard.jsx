import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtPrice } from "../api";
import { useWishlist } from "../store";
import ProductImage from "./ProductImage";
import { HeartIcon } from "./Icons";

export default function ProductCard({ product }) {
  const { has, toggle } = useWishlist();
  const [error, setError] = useState("");
  const wished = has(product.id);

  async function onWish(e) {
    // The card is a link; don't navigate when the heart is tapped.
    e.preventDefault();
    e.stopPropagation();
    setError("");
    try {
      await toggle(product.id);
    } catch (err) {
      setError(err.message);
      setTimeout(() => setError(""), 3000);
    }
  }

  return (
    <div className="card">
      <Link to={`/product/${product.slug}`} className="card-body">
        <div className="card-img">
          {product.compare_at_cents && <span className="badge">Sale</span>}
          <ProductImage product={product} />
        </div>
        <div>
          <div className="cat">{product.category}</div>
          <h3>{product.name}</h3>
          <div className="price">
            {fmtPrice(product.price_cents)}
            {product.compare_at_cents && <span className="was">{fmtPrice(product.compare_at_cents)}</span>}
          </div>
        </div>
      </Link>

      {/* Sits outside the Link — a <button> inside an <a> is invalid markup. */}
      <button
        type="button"
        className={`wish-btn ${wished ? "on" : ""}`}
        onClick={onWish}
        aria-pressed={wished}
        aria-label={wished ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
        title={error || (wished ? "Saved to wishlist" : "Save to wishlist")}
      >
        <HeartIcon size={16} filled={wished} />
      </button>

      <div className="swatches">
        {product.colors.map((c) => (
          <span key={c.name} className="swatch-dot" style={{ background: c.hex }} title={c.name} />
        ))}
      </div>

      {error && <div className="card-wish-error">{error}</div>}
    </div>
  );
}
