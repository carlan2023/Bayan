import { Link, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth, useMoney } from "../store";
import { PAYMENT_LABELS } from "../payment";
import { useAsync } from "../useAsync";
import ErrorState from "../components/ErrorState";

export default function Account() {
  const money = useMoney();
  const { user } = useAuth();
  // Previously a failed fetch was swallowed into an empty array, so a network
  // error was indistinguishable from genuinely having no orders.
  const { data, error, loading, reload } = useAsync(
    () => (user ? api.myOrders() : Promise.resolve({ orders: [] })),
    [user?.id]
  );
  const orders = data?.orders ?? null;

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div className="page-title">
        <h1>Hello, {user.name.split(" ")[0]}</h1>
        <p>{user.email}</p>
      </div>

      <h2 style={{ margin: "16px 0" }}>Order history</h2>
      {error ? (
        <ErrorState title="We couldn't load your orders" message={error} onRetry={reload} />
      ) : loading || !orders ? (
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
              <span>
                <span className="status-chip">{o.status}</span>{" "}
                {o.payment_status === "pending" ? (
                  <Link className="pay-sub" to={`/order/${o.id}/payment`} style={{ display: "inline" }}>
                    {PAYMENT_LABELS.pending}
                  </Link>
                ) : (
                  <span className="pay-sub" style={{ display: "inline" }}>{PAYMENT_LABELS[o.payment_status] || ""}</span>
                )}
              </span>
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
                <span>{money(i.price_cents * i.qty)}</span>
              </div>
            ))}
            <div className="summary-line total">
              <span>Total (cash on delivery)</span>
              <span>{money(o.total_cents)}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
