import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCart, useDelivery, useMoney } from "../store";
import ProductImage from "../components/ProductImage";
import CartNotice from "../components/CartNotice";

export default function Cart() {
  const money = useMoney();
  const { items, subtotal, setQty, remove, keyOf, revalidate, maxQty } = useCart();
  const delivery = useDelivery(subtotal);
  const [changes, setChanges] = useState([]);

  // Prices and stock may have moved since these lines were saved to localStorage.
  useEffect(() => {
    revalidate().then(setChanges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) {
    return (
      <div className="container">
        {/* Explain an emptied bag — otherwise a sold-out clear-out looks like a bug. */}
        <div style={{ maxWidth: 520, margin: "24px auto 0" }}>
          <CartNotice changes={changes} />
        </div>
        <div className="empty">
          <h2>Your bag is empty</h2>
          <p style={{ marginBottom: 24 }}>Everything you add will appear here.</p>
          <Link to="/shop" className="btn btn-primary">
            Start shopping
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div className="page-title">
        <h1>Your bag</h1>
      </div>
      <CartNotice changes={changes} />
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
                  <button aria-label={`Decrease quantity of ${i.name}`} onClick={() => setQty(k, i.qty - 1)}>
                    −
                  </button>
                  <span>{i.qty}</span>
                  <button
                    aria-label={`Increase quantity of ${i.name}`}
                    disabled={i.qty >= Math.min(i.stock ?? maxQty, maxQty)}
                    onClick={() => setQty(k, i.qty + 1)}
                  >
                    +
                  </button>
                </div>
                <div className="price">{money(i.price_cents * i.qty)}</div>
              </div>
            );
          })}
        </div>
        <div className="panel">
          <h3 style={{ marginBottom: 12 }}>Summary</h3>
          <div className="summary-line">
            <span>Subtotal</span>
            <span>{money(subtotal)}</span>
          </div>
          <div className="summary-line">
            <span>Delivery</span>
            <span>{delivery === 0 ? "Free" : money(delivery)}</span>
          </div>
          <div className="summary-line total">
            <span>Total</span>
            <span>{money(subtotal + delivery)}</span>
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
