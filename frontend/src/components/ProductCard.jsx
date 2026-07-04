import { Link } from "react-router-dom";
import { fmtPrice } from "../api";
import ProductImage from "./ProductImage";

export default function ProductCard({ product }) {
  return (
    <Link to={`/product/${product.slug}`} className="card">
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
      <div className="swatches">
        {product.colors.map((c) => (
          <span key={c.name} className="swatch-dot" style={{ background: c.hex }} title={c.name} />
        ))}
      </div>
    </Link>
  );
}
