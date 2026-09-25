import { useState } from "react";
import { usePageTitle } from "../usePageTitle";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useMoney } from "../store";
import { PAYMENT_LABELS } from "../payment";

const STEPS = ["pending", "confirmed", "dispatched", "delivered"];
const STEP_LABELS = { pending: "Received", confirmed: "Confirmed", dispatched: "On its way", delivered: "Delivered" };

/** Guest order lookup: order number + the phone number it was placed with. */
export default function TrackOrder() {
  usePageTitle("Track an order");
  const money = useMoney();
  const [params] = useSearchParams();
  const [number, setNumber] = useState(params.get("number") || "");
  const [phone, setPhone] = useState("");
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.lookupOrder(number.trim(), phone.trim());
      setOrder(r.order);
    } catch (err) {
      setOrder(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const cancelled = order?.status === "cancelled";
  const reached = order ? STEPS.indexOf(order.status) : -1;

  return (
    <div className="container track-wrap">
      <div className="page-title">
        <h1>Track an order</h1>
        <p>Use the order number from your confirmation and the phone number you ordered with.</p>
      </div>
      <form className="panel form-grid track-form" onSubmit={submit}>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="two-col">
          <div>
            <label htmlFor="track-number">Order number</label>
            <input
              id="track-number"
              inputMode="numeric"
              required
              placeholder="e.g. 1024"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="track-phone">Phone</label>
            <input
              id="track-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Looking…" : "Find my order"}
        </button>
      </form>

      {order && (
        <section className="panel track-result" aria-labelledby="track-title">
          <h2 id="track-title">Order #{order.number}</h2>
          <p className="pay-sub">
            Placed {new Date(order.created_at).toLocaleDateString()} · {PAYMENT_LABELS[order.payment_status] || order.payment_status}
          </p>
          {cancelled ? (
            <div className="alert alert-error">This order was cancelled.</div>
          ) : (
            <ol className="track-steps">
              {STEPS.map((s, i) => (
                <li key={s} className={i <= reached ? "done" : ""} aria-current={i === reached ? "step" : undefined}>
                  {STEP_LABELS[s]}
                </li>
              ))}
            </ol>
          )}
          {order.payment_status === "pending" && (
            <p>
              <Link to={`/order/${order.id}/payment`}>Waiting for your mobile money payment</Link>
            </p>
          )}
          <table className="track-items">
            <tbody>
              {order.items.map((i, k) => (
                <tr key={k}>
                  <td>
                    {i.qty} × {i.name}
                    {i.size && <span className="pay-sub"> ({[i.size, i.color].filter(Boolean).join(" / ")})</span>}
                  </td>
                  <td className="num">{money(i.price_cents * i.qty)}</td>
                </tr>
              ))}
              <tr>
                <td>Delivery to {order.city}</td>
                <td className="num">{order.delivery_cents === 0 ? "Free" : money(order.delivery_cents)}</td>
              </tr>
              <tr className="total">
                <td>Total</td>
                <td className="num">{money(order.total_cents)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
