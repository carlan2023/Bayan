import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, fmtPrice } from "../api";
import { useAuth } from "../store";

export default function Account() {
  const { user } = useAuth();
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    if (user) api.myOrders().then((d) => setOrders(d.orders)).catch(() => setOrders([]));
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div className="page-title">
        <h1>Hello, {user.name.split(" ")[0]}</h1>
        <p>{user.email}</p>
      </div>

      <h2 style={{ margin: "16px 0" }}>Order history</h2>
      {!orders ? (
        <div className="spinner">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="empty">
          <h2>No orders yet</h2>
          <p style={{ marginBottom: 24 }}>Orders you place while signed in will appear here.</p>
          <Link to="/shop" className="btn btn-primary">
            Start shopping
          </Link>
        </div>
      ) : (
        orders.map((o) => (
          <div className="order-card" key={o.id}>
            <div className="order-head">
              <div>
                <strong>Order #{o.number}</strong>
                <span style={{ color: "var(--ink-soft)", marginLeft: 12, fontSize: "0.88rem" }}>
                  {new Date(o.created_at).toLocaleDateString()}
                </span>
              </div>
              <span className="status-chip">{o.status}</span>
            </div>
            {o.items.map((i) => (
              <div className="summary-line" key={i.id}>
                <span>
                  {i.name} × {i.qty}
                  {i.size && (
                    <span style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
                      {" "}
                      ({i.size}
                      {i.color ? `, ${i.color}` : ""})
                    </span>
                  )}
                </span>
                <span>{fmtPrice(i.price_cents * i.qty)}</span>
              </div>
            ))}
            <div className="summary-line total">
              <span>Total (cash on delivery)</span>
              <span>{fmtPrice(o.total_cents)}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
