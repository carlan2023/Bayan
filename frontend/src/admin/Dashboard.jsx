import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtPrice } from "../api";
import { BarChart, Donut } from "./Charts";

const STATUS_COLORS = {
  pending: "#c9a24b",
  confirmed: "#7b8fa3",
  dispatched: "#8a6fa8",
  delivered: "#2e4b3f",
  cancelled: "#a4483a",
};

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.admin.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!stats) return <div className="spinner">Loading analytics…</div>;

  const { totals, revenue_by_day, orders_by_status, top_products, revenue_by_category, low_stock, recent_orders } = stats;

  const bars = revenue_by_day.map((d) => ({
    label: d.day,
    shortLabel: d.day.slice(5),
    value: d.revenue_cents,
  }));

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Overview</h1>
          <p>Last 14 days of trading at a glance.</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="kpi-label">Revenue</div>
          <div className="kpi-value">{fmtPrice(totals.revenue_cents)}</div>
          <div className="kpi-sub">excl. cancelled orders</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Orders</div>
          <div className="kpi-value">{totals.orders}</div>
          <div className="kpi-sub">{totals.pending_orders} awaiting confirmation</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg. order value</div>
          <div className="kpi-value">{fmtPrice(totals.aov_cents)}</div>
          <div className="kpi-sub">{totals.units_sold} units sold</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Customers</div>
          <div className="kpi-value">{totals.customers}</div>
          <div className="kpi-sub">{totals.products} products live</div>
        </div>
      </div>

      <div className="admin-grid">
        <div className="admin-panel">
          <h3>Revenue <span>— last 14 days</span></h3>
          <BarChart data={bars} formatValue={fmtPrice} />
        </div>
        <div className="admin-panel">
          <h3>Orders by status</h3>
          <Donut
            segments={orders_by_status.map((s) => ({
              label: s.status,
              value: s.count,
              color: STATUS_COLORS[s.status],
            }))}
          />
        </div>
      </div>

      <div className="admin-grid">
        <div className="admin-panel">
          <h3>Top products <span>— by revenue</span></h3>
          {top_products.length === 0 ? (
            <div className="empty-mini">No sales yet — top sellers will appear here.</div>
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr><th>Product</th><th className="num">Units</th><th className="num">Revenue</th></tr>
                </thead>
                <tbody>
                  {top_products.map((p) => (
                    <tr key={p.product_id}>
                      <td>{p.name}</td>
                      <td className="num">{p.units}</td>
                      <td className="num">{fmtPrice(p.revenue_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="admin-panel">
          <h3>Revenue by category</h3>
          {revenue_by_category.length === 0 ? (
            <div className="empty-mini">No sales yet.</div>
          ) : (
            <Donut
              segments={revenue_by_category.map((c) => ({ label: c.category, value: c.revenue_cents }))}
              formatValue={fmtPrice}
            />
          )}
        </div>
      </div>

      <div className="admin-grid">
        <div className="admin-panel">
          <h3>Recent orders</h3>
          {recent_orders.length === 0 ? (
            <div className="empty-mini">No orders yet.</div>
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr><th>#</th><th>Customer</th><th>City</th><th>Status</th><th className="num">Total</th></tr>
                </thead>
                <tbody>
                  {recent_orders.map((o) => (
                    <tr key={o.id}>
                      <td>{o.number}</td>
                      <td>{o.customer_name}</td>
                      <td>{o.city}</td>
                      <td><span className={`chip ${o.status}`}>{o.status}</span></td>
                      <td className="num">{fmtPrice(o.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <Link to="/admin/orders" className="link-btn">Manage all orders →</Link>
          </div>
        </div>
        <div className="admin-panel">
          <h3>Low stock <span>— 10 or fewer left</span></h3>
          {low_stock.length === 0 ? (
            <div className="empty-mini">All products are well stocked.</div>
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr><th>Product</th><th>Category</th><th className="num">Stock</th></tr>
                </thead>
                <tbody>
                  {low_stock.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.category}</td>
                      <td className="num" style={{ color: p.stock === 0 ? "var(--danger)" : "inherit" }}>{p.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
