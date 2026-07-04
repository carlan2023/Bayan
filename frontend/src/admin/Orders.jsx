import { useEffect, useState } from "react";
import { api, fmtPrice } from "../api";

const STATUSES = ["pending", "confirmed", "dispatched", "delivered", "cancelled"];

export default function Orders() {
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(null);
  const [error, setError] = useState("");

  const load = (status = filter) =>
    api.admin.orders(status).then((d) => setOrders(d.orders)).catch((e) => setError(e.message));

  useEffect(() => {
    setOrders(null);
    load(filter);
  }, [filter]);

  async function setStatus(order, status) {
    setError("");
    try {
      await api.admin.setOrderStatus(order.id, status);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Orders</h1>
          <p>{orders ? `${orders.length} shown` : "Loading…"}</p>
        </div>
        <div className="pill-row">
          <button className={`pill ${!filter ? "active" : ""}`} onClick={() => setFilter("")}>All</button>
          {STATUSES.map((s) => (
            <button key={s} className={`pill ${filter === s ? "active" : ""}`} onClick={() => setFilter(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="admin-panel">
        {!orders ? (
          <div className="spinner">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="empty-mini">No orders{filter ? ` with status "${filter}"` : " yet"}.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Customer</th>
                <th>Contact</th>
                <th>Delivery</th>
                <th>Placed</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <>
                  <tr key={o.id}>
                    <td>{o.number}</td>
                    <td>{o.customer_name}{o.user_id ? "" : " (guest)"}</td>
                    <td>
                      {o.phone}
                      {o.email && <div style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>{o.email}</div>}
                    </td>
                    <td>
                      {o.address}, {o.city}
                      {o.note && <div style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>“{o.note}”</div>}
                    </td>
                    <td>{new Date(o.created_at).toLocaleString()}</td>
                    <td className="num">{fmtPrice(o.total_cents)}</td>
                    <td>
                      <select
                        className="select-sm"
                        value={o.status}
                        onChange={(e) => setStatus(o, e.target.value)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button className="link-btn" onClick={() => setOpen(open === o.id ? null : o.id)}>
                        {open === o.id ? "Hide" : "Items"}
                      </button>
                    </td>
                  </tr>
                  {open === o.id && (
                    <tr key={`${o.id}-items`}>
                      <td colSpan="8" style={{ background: "var(--bg)" }}>
                        <table className="admin-table" style={{ margin: "4px 0" }}>
                          <thead>
                            <tr><th>Item</th><th>Options</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Line total</th></tr>
                          </thead>
                          <tbody>
                            {o.items.map((i) => (
                              <tr key={i.id}>
                                <td>{i.name}</td>
                                <td>{[i.size, i.color].filter(Boolean).join(" · ") || "—"}</td>
                                <td className="num">{i.qty}</td>
                                <td className="num">{fmtPrice(i.price_cents)}</td>
                                <td className="num">{fmtPrice(i.price_cents * i.qty)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td colSpan="4" className="num">Delivery</td>
                              <td className="num">{o.delivery_cents === 0 ? "Free" : fmtPrice(o.delivery_cents)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
