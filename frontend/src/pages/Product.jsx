import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtPrice } from "../api";
import { useCart, useConfig, useWishlist } from "../store";
import { useAsync } from "../useAsync";
import ProductImage from "../components/ProductImage";
import ProductCard from "../components/ProductCard";
import ErrorState from "../components/ErrorState";
import { HeartIcon, CheckIcon, WhatsAppIcon } from "../components/Icons";
import { waProductLink } from "../whatsapp";

export default function Product() {
  const { slug } = useParams();
  const { add } = useCart();
  const { has, toggle } = useWishlist();
  const { free_delivery_threshold_cents, urgency_stock_threshold } = useConfig();

  const { data, error: loadError, loading, reload } = useAsync(() => api.product(slug), [slug]);

  const [size, setSize] = useState(null);
  const [color, setColor] = useState(null);
  const [added, setAdded] = useState(false);
  // Kept separate from loadError: this one is for validation and wishlist
  // failures, which must not replace the whole page with an error screen.
  const [formError, setFormError] = useState("");

  useEffect(() => {
    window.scrollTo(0, 0);
    setAdded(false);
    setFormError("");
  }, [slug]);

  // Default the options once the product arrives.
  useEffect(() => {
    if (!data?.product) return;
    setSize(data.product.sizes.length === 1 ? data.product.sizes[0] : null);
    setColor(data.product.colors[0]?.name || null);
  }, [data]);

  if (loading) return <div className="spinner">Loading…</div>;

  if (loadError) {
    return (
      <div className="container">
        <ErrorState title="We couldn't load this product" message={loadError} onRetry={reload}>
          <Link to="/shop" className="btn btn-ghost">
            Browse products
          </Link>
        </ErrorState>
      </div>
    );
  }

  const { product, related } = data;
  const wished = has(product.id);
  // Adding a sold-out item used to succeed and only fail at checkout.
  const soldOut = product.stock <= 0;
  const lowStock = !soldOut && product.stock <= urgency_stock_threshold;

  // Show the photo for the chosen colour, falling back to the product's main image.
  const activeColor = product.colors.find((c) => c.name === color);
  const heroProduct = { ...product, image: activeColor?.image || product.image };

  function addToBag() {
    if (!size) {
      setFormError("Please choose a size first.");
      return;
    }
    setFormError("");
    add(product, { size, color });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  async function toggleWishlist() {
    setFormError("");
    try {
      await toggle(product.id);
    } catch (e) {
      setFormError(e.message);
    }
  }

  return (
    <div className="container">
      <div className="pdp">
        <div className="pdp-img">
          <ProductImage product={heroProduct} ratio={1.1} />
        </div>
        <div className="pdp-info">
          <div className="cat">{product.category}</div>
          <h1>{product.name}</h1>
          <div className="price">
            {fmtPrice(product.price_cents)}
            {product.compare_at_cents && <span className="was">{fmtPrice(product.compare_at_cents)}</span>}
          </div>
          {lowStock && (
            <div className="stock-alert" role="status">
              <span className="stock-alert-dot" aria-hidden="true" />
              Only {product.stock} left in stock — once it's gone, it's gone.
            </div>
          )}

          <p className="desc">{product.description}</p>

          <div className="opt-label">Colour — {color}</div>
          <div className="opt-row">
            {product.colors.map((c) => (
              <button
                key={c.name}
                className={`opt color-opt ${color === c.name ? "active" : ""}`}
                aria-pressed={color === c.name}
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
              <button
                key={s}
                className={`opt ${size === s ? "active" : ""}`}
                aria-pressed={size === s}
                onClick={() => setSize(s)}
              >
                {s}
              </button>
            ))}
          </div>

          {formError && <div className="alert alert-error">{formError}</div>}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn btn-primary btn-icon" onClick={addToBag} disabled={soldOut}>
              {soldOut ? (
                "Out of stock"
              ) : added ? (
                <>
                  Added <CheckIcon size={16} />
                </>
              ) : (
                "Add to bag"
              )}
            </button>
            <button
              className="btn btn-ghost btn-icon"
              onClick={toggleWishlist}
              aria-pressed={wished}
            >
              {wished ? "Saved" : "Wishlist"} <HeartIcon size={16} filled={wished} />
            </button>
            <a
              className="btn btn-wa btn-icon"
              href={waProductLink(product)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ask on WhatsApp <WhatsAppIcon size={16} />
            </a>
          </div>

          {product.fabric && <div className="meta-line">Fabric: {product.fabric}</div>}
          <div className="meta-line">
            {soldOut ? "Out of stock" : product.stock > 10 ? "In stock" : `Only ${product.stock} left`} ·
            Cash on delivery available · Free delivery over {fmtPrice(free_delivery_threshold_cents)}
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
