import { useState } from "react";
import { Link } from "react-router-dom";
import { useConfig, useMoney, useWishlist } from "../store";
import ProductImage from "./ProductImage";
import { HeartIcon, WhatsAppIcon } from "./Icons";
import { useWhatsApp } from "../whatsapp";

export default function ProductCard({ product }) {
  const money = useMoney();
  const wa = useWhatsApp();
  const { has, toggle } = useWishlist();
  const { urgency_stock_threshold } = useConfig();
  const [error, setError] = useState("");
  const wished = has(product.id);
  // Scarcity cue, using the server's threshold so both agree.
  const lowStock =
    typeof product.stock === "number" && product.stock > 0 && product.stock <= urgency_stock_threshold;

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
          {lowStock && <span className="stock-banner">Only {product.stock} left</span>}
        </div>
        <div>
          <div className="cat">{product.category}</div>
          <h3>{product.name}</h3>
          <div className="price">
            {money(product.price_cents)}
            {product.compare_at_cents && <span className="was">{money(product.compare_at_cents)}</span>}
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

      {/* WhatsApp enquiry — a real link, also outside the card's Link. Hidden
          when the shop has no WhatsApp number configured. */}
      {wa.enabled && (
      <a
        className="wish-btn wa-btn"
        href={wa.productLink(product)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={`Ask about ${product.name} on WhatsApp`}
        title="Ask about this on WhatsApp"
      >
        <WhatsAppIcon size={16} />
      </a>
      )}

      <div className="swatches">
        {product.colors.map((c) => (
          <span key={c.name} className="swatch-dot" style={{ background: c.hex }} title={c.name} />
        ))}
      </div>

      {error && <div className="card-wish-error">{error}</div>}
    </div>
  );
}
