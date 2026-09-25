import { useEffect, useState } from "react";
import { usePageTitle } from "../usePageTitle";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth, useCart, useConfig, useDelivery, useMoney } from "../store";
import { NETWORK_LABELS, rememberOrderToken } from "../payment";
import CartNotice from "../components/CartNotice";

export default function Checkout() {
  usePageTitle("Checkout");
  const money = useMoney();
  const { items, subtotal, clear, revalidate } = useCart();
  const { user } = useAuth();
  const delivery = useDelivery(subtotal);
  const { payment_methods = ["cod"], mobile_money_networks = [] } = useConfig();
  const momoOffered = payment_methods.includes("mobile_money") && mobile_money_networks.length > 0;
  const navigate = useNavigate();

  const [form, setForm] = useState({
    customer_name: user?.name || "",
    phone: "",
    email: user?.email || "",
    address: "",
    city: "",
    note: "",
    payment_method: "cod",
    momo_network: "",
    momo_phone: "",
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
        <h1 className="empty-title">Thank you, {order.customer_name.split(" ")[0]}!</h1>
        <p style={{ maxWidth: 480, margin: "0 auto 8px" }}>
          Order <strong>#{order.number}</strong> is confirmed for <strong>{money(order.total_cents)}</strong>.
        </p>
        <p style={{ maxWidth: 480, margin: "0 auto 24px" }}>
          Please have the cash ready when our courier arrives at {order.address}, {order.city}.
        </p>
        <p style={{ maxWidth: 480, margin: "0 auto 24px" }}>
          You can check on it any time at <Link to={`/track?number=${order.number}`}>Track an order</Link> with your
          order number and phone.
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
          <h1 className="empty-title">Nothing to check out</h1>
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
      const momo = form.payment_method === "mobile_money";
      if (momo && !form.momo_network) {
        setError("Choose MTN MoMo or Airtel Money.");
        setPlacing(false);
        return;
      }
      const { order, payment, access_token } = await api.createOrder({
        ...form,
        momo_phone: form.momo_phone || form.phone,
        items: items.map((i) => ({ product_id: i.product_id, qty: i.qty, size: i.size, color: i.color })),
      });
      clear();
      if (momo) {
        // The payment page follows the order with this token; Flutterwave may
        // first send the shopper to its own page to confirm, then back to ours.
        rememberOrderToken(order.id, access_token);
        if (payment?.redirect_url) window.location.assign(payment.redirect_url);
        else navigate(`/order/${order.id}/payment`);
        return;
      }
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
        <p>{momoOffered ? "Pay with mobile money, or in cash on delivery." : "Payment method: cash on delivery."}</p>
      </div>
      <div className="checkout-layout">
        <form className="panel form-grid" onSubmit={placeOrder}>
          {!user && (
            <div className="alert alert-ok">
              Checking out as a guest. <Link to="/login" style={{ textDecoration: "underline" }}>Sign in</Link>{" "}
              to save this order to your account.
            </div>
          )}
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
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

          {momoOffered ? (
            <fieldset className="pay-methods">
              <legend>Payment</legend>
              <label className={`pay-option ${form.payment_method === "mobile_money" ? "active" : ""}`}>
                <input
                  type="radio"
                  name="payment_method"
                  value="mobile_money"
                  checked={form.payment_method === "mobile_money"}
                  onChange={set("payment_method")}
                />
                <span>
                  <strong>Mobile money</strong>
                  <span className="pay-sub">Approve the payment on your phone now.</span>
                </span>
              </label>
              <label className={`pay-option ${form.payment_method === "cod" ? "active" : ""}`}>
                <input type="radio" name="payment_method" value="cod" checked={form.payment_method === "cod"} onChange={set("payment_method")} />
                <span>
                  <strong>Cash on delivery</strong>
                  <span className="pay-sub">Pay {money(subtotal + delivery)} in cash when the courier arrives.</span>
                </span>
              </label>
              {form.payment_method === "mobile_money" && (
                <div className="pay-momo">
                  <div role="radiogroup" aria-label="Mobile money network" className="opt-row">
                    {mobile_money_networks.map((n) => (
                      <label key={n} className={`opt ${form.momo_network === n ? "active" : ""}`}>
                        <input
                          type="radio"
                          name="momo_network"
                          value={n}
                          className="sr-only"
                          checked={form.momo_network === n}
                          onChange={set("momo_network")}
                        />
                        {NETWORK_LABELS[n] || n}
                      </label>
                    ))}
                  </div>
                  <label htmlFor="co-momo-phone">Mobile money number</label>
                  <input
                    id="co-momo-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder={form.phone || "07XX XXX XXX"}
                    value={form.momo_phone}
                    onChange={set("momo_phone")}
                    aria-describedby="co-momo-hint"
                  />
                  <span id="co-momo-hint" className="field-hint">
                    Leave empty to use the phone number above. Your items are held for 30 minutes while you approve.
                  </span>
                </div>
              )}
            </fieldset>
          ) : (
            <div className="cod-note">
              <strong>Cash on delivery.</strong> You pay {money(subtotal + delivery)} in cash when the
              courier hands over your order. Orders are confirmed by phone before dispatch.
            </div>
          )}

          <button className="btn btn-accent btn-block" disabled={placing}>
            {placing
              ? "Placing order…"
              : form.payment_method === "mobile_money"
                ? `Pay ${money(subtotal + delivery)} with mobile money`
                : `Place order — ${money(subtotal + delivery)}`}
          </button>
        </form>

        <div className="panel">
          <h2 className="panel-title">Order summary</h2>
          {items.map((i) => (
            <div className="summary-line" key={`${i.product_id}-${i.size}-${i.color}`}>
              <span>
                {i.name} × {i.qty}
                <span style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
                  {" "}
                  ({i.size}, {i.color})
                </span>
              </span>
              <span>{money(i.price_cents * i.qty)}</span>
            </div>
          ))}
          <div className="summary-line">
            <span>Delivery</span>
            <span>{delivery === 0 ? "Free" : money(delivery)}</span>
          </div>
          <div className="summary-line total">
            <span>{form.payment_method === "mobile_money" ? "Total to pay now" : "Total due on delivery"}</span>
            <span>{money(subtotal + delivery)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
