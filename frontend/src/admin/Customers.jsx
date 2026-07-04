import { useEffect, useState } from "react";
import { api, fmtPrice } from "../api";

export default function Customers() {
  const [customers, setCustomers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.admin.customers().then((d) => setCustomers(d.customers)).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Customers</h1>
          <p>{customers ? `${customers.length} registered` : "Loading…"}</p>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="admin-panel">
        {!customers ? (
          <div className="spinner">Loading…</div>
        ) : customers.length === 0 ? (
          <div className="empty-mini">No registered customers yet. Guest orders appear under Orders.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Joined</th>
                <th className="num">Orders</th>
                <th className="num">Lifetime spend</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.email}</td>
                  <td>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="num">{c.orders}</td>
                  <td className="num">{fmtPrice(c.spent_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
