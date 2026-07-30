import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtPrice } from "../api";
import { useAuth, useCart, useDelivery } from "../store";
import CartNotice from "../components/CartNotice";

export default function Checkout() {
  const { items, subtotal, clear, revalidate } = useCart();
  const { user } = useAuth();
  const delivery = useDelivery(subtotal);

  const [form, setForm] = useState({
    customer_name: user?.name || "",
    phone: "",
    email: user?.email || "",
    address: "",
    city: "",
    note: "",
  });
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [order, setOrder] = useState(null);
  const [changes, setChanges] = useState([]);

  // Last chance to catch a price or stock change before the shopper commits —
  // the server re-prices every line from the DB when the order is created.
  useEffect(() => {
    revalidate().then(setChanges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (order) {
    return (
      <div className="container empty">
        <h2>Thank you, {order.customer_name.split(" ")[0]}!</h2>
        <p style={{ maxWidth: 480, margin: "0 auto 8px" }}>
          Order <strong>#{order.number}</strong> is confirmed for <strong>{fmtPrice(order.total_cents)}</strong>.
        </p>
        <p style={{ maxWidth: 480, margin: "0 auto 24px" }}>
          Please have the cash ready when our courier arrives at {order.address}, {order.city}.
        </p>
        <Link to="/shop" className="btn btn-primary">
          Continue shopping
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="container">
        <div style={{ maxWidth: 520, margin: "24px auto 0" }}>
          <CartNotice changes={changes} />
        </div>
        <div className="empty">
          <h2>Nothing to check out</h2>
          <Link to="/shop" className="btn btn-primary">
            Browse products
          </Link>
        </div>
      </div>
    );
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function placeOrder(e) {
    e.preventDefault();
    setError("");
    setPlacing(true);
    try {
      const { order } = await api.createOrder({
        ...form,
        items: items.map((i) => ({ product_id: i.product_id, qty: i.qty, size: i.size, color: i.color })),
      });
      clear();
      setOrder(order);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(err.message);
      // A rejected order usually means stock or price moved under us — pull the
      // current numbers in so the bag on screen matches what the server will take.
      revalidate().then(setChanges);
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="container">
      <div className="page-title">
        <h1>Checkout</h1>
        <p>Payment method: cash on delivery.</p>
      </div>
      <div className="checkout-layout">
        <form className="panel form-grid" onSubmit={placeOrder}>
          {!user && (
            <div className="alert alert-ok">
              Checking out as a guest. <Link to="/login" style={{ textDecoration: "underline" }}>Sign in</Link>{" "}
              to save this order to your account.
            </div>
          )}
          {error && <div className="alert alert-error">{error}</div>}
          <CartNotice changes={changes} />

          <div className="two-col">
            <div>
              <label htmlFor="co-name">Full name *</label>
              <input
                id="co-name"
                name="name"
                autoComplete="name"
                required
                value={form.customer_name}
                onChange={set("customer_name")}
              />
            </div>
            <div>
              <label htmlFor="co-phone">Phone *</label>
              <input
                id="co-phone"
                name="tel"
                autoComplete="tel"
                inputMode="tel"
                required
                type="tel"
                placeholder="07XX XXX XXX"
                value={form.phone}
                onChange={set("phone")}
              />
            </div>
          </div>
          <div>
            <label htmlFor="co-email">Email</label>
            <input
              id="co-email"
              name="email"
              autoComplete="email"
              inputMode="email"
              type="email"
              value={form.email}
              onChange={set("email")}
            />
          </div>
          <div>
            <label htmlFor="co-address">Delivery address *</label>
            <input
              id="co-address"
              name="street-address"
              autoComplete="street-address"
              required
              placeholder="Street, building, apartment"
              value={form.address}
              onChange={set("address")}
            />
          </div>
          <div className="two-col">
            <div>
              <label htmlFor="co-city">City / town *</label>
              <input
                id="co-city"
                name="address-level2"
                autoComplete="address-level2"
                required
                value={form.city}
                onChange={set("city")}
              />
            </div>
            <div>
              <label htmlFor="co-note">Delivery note</label>
              <input
                id="co-note"
                placeholder="e.g. call on arrival"
                value={form.note}
                onChange={set("note")}
              />
            </div>
          </div>

          <div className="cod-note">
            <strong>Cash on delivery.</strong> You pay {fmtPrice(subtotal + delivery)} in cash when the
            courier hands over your order. Orders are confirmed by phone before dispatch.
          </div>

          <button className="btn btn-accent btn-block" disabled={placing}>
            {placing ? "Placing order…" : `Place order — ${fmtPrice(subtotal + delivery)}`}
          </button>
        </form>

        <div className="panel">
          <h3 style={{ marginBottom: 12 }}>Order summary</h3>
          {items.map((i) => (
            <div className="summary-line" key={`${i.product_id}-${i.size}-${i.color}`}>
              <span>
                {i.name} × {i.qty}
                <span style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
                  {" "}
                  ({i.size}, {i.color})
                </span>
              </span>
              <span>{fmtPrice(i.price_cents * i.qty)}</span>
            </div>
          ))}
          <div className="summary-line">
            <span>Delivery</span>
            <span>{delivery === 0 ? "Free" : fmtPrice(delivery)}</span>
          </div>
          <div className="summary-line total">
            <span>Total due on delivery</span>
            <span>{fmtPrice(subtotal + delivery)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
