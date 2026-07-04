import { Link } from "react-router-dom";
import { fmtPrice } from "../api";
import { useCart } from "../store";
import ProductImage from "../components/ProductImage";

export default function Cart() {
  const { items, subtotal, setQty, remove, keyOf } = useCart();

  if (items.length === 0) {
    return (
      <div className="container empty">
        <h2>Your bag is empty</h2>
        <p style={{ marginBottom: 24 }}>Everything you add will appear here.</p>
        <Link to="/shop" className="btn btn-primary">
          Start shopping
        </Link>
      </div>
    );
  }

  const delivery = subtotal >= 500000 ? 0 : 25000;

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div className="page-title">
        <h1>Your bag</h1>
      </div>
      <div className="checkout-layout">
        <div className="panel">
          {items.map((i) => {
            const k = keyOf(i);
            return (
              <div className="cart-row" key={k}>
                <Link to={`/product/${i.slug}`} className="thumb">
                  <ProductImage product={i} ratio={1} />
                </Link>
                <div>
                  <Link to={`/product/${i.slug}`}>
                    <strong>{i.name}</strong>
                  </Link>
                  <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
                    {i.color} · Size {i.size}
                  </div>
                  <button className="link-btn" onClick={() => remove(k)}>
                    Remove
                  </button>
                </div>
                <div className="qty-ctrl">
                  <button onClick={() => setQty(k, i.qty - 1)}>−</button>
                  <span>{i.qty}</span>
                  <button onClick={() => setQty(k, i.qty + 1)}>+</button>
                </div>
                <div className="price">{fmtPrice(i.price_cents * i.qty)}</div>
              </div>
            );
          })}
        </div>
        <div className="panel">
          <h3 style={{ marginBottom: 12 }}>Summary</h3>
          <div className="summary-line">
            <span>Subtotal</span>
            <span>{fmtPrice(subtotal)}</span>
          </div>
          <div className="summary-line">
            <span>Delivery</span>
            <span>{delivery === 0 ? "Free" : fmtPrice(delivery)}</span>
          </div>
          <div className="summary-line total">
            <span>Total</span>
            <span>{fmtPrice(subtotal + delivery)}</span>
          </div>
          <div className="cod-note">Pay in cash when your order arrives — no card needed.</div>
          <Link to="/checkout" className="btn btn-accent btn-block" style={{ textAlign: "center" }}>
            Checkout
          </Link>
        </div>
      </div>
    </div>
  );
}
