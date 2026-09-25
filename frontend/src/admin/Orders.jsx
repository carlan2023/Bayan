import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../api";
import Pager from "./Pager";
import { useMoney } from "../store";
import { PAYMENT_LABELS, NETWORK_LABELS } from "../payment";

const STATUSES = ["pending", "confirmed", "dispatched", "delivered", "cancelled"];
const PAGE_SIZE = 25;

export default function Orders() {
  const money = useMoney();
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      api.admin
        .orders({ status: filter, search: query, page, limit: PAGE_SIZE })
        .then(setResult)
        .catch((e) => setError(e.message)),
    [filter, query, page]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Debounce typing so each keystroke isn't a request.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const orders = result?.orders ?? null;

  useEffect(() => {
    if (result && result.page > result.pages) setPage(result.pages);
  }, [result]);

  async function setStatus(order, status) {
    setError("");
    try {
      await api.admin.setOrderStatus(order.id, status);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function setPayment(order, payment_status, confirmText) {
    if (!window.confirm(confirmText)) return;
    setError("");
    try {
      await api.admin.setPaymentStatus(order.id, payment_status);
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
          <p>{result ? `${result.total} matching` : "Loading…"}</p>
        </div>
        <div className="tools">
          <input
            className="input-sm"
            aria-label="Search orders"
            placeholder="Order #, name, phone, town…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="pill-row" style={{ marginBottom: 18 }}>
        <button
          className={`pill ${!filter ? "active" : ""}`}
          onClick={() => {
            setFilter("");
            setPage(1);
          }}
        >
          All
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`pill ${filter === s ? "active" : ""}`}
            onClick={() => {
              setFilter(s);
              setPage(1);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="admin-panel">
        {!orders ? (
          <div className="spinner">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="empty-mini">
            No orders{filter ? ` with status "${filter}"` : ""}
            {query ? ` matching “${query}”` : ""}
            {!filter && !query ? " yet" : ""}.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Customer</th>
                <th>Contact</th>
                <th>Delivery</th>
                <th>Placed</th>
                <th className="num">Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                // Shorthand <> cannot carry a key, so the key on the inner <tr>
                // was not the list child's key — React warned and mis-matched
                // rows whenever the filter changed. Fragment takes one.
                <Fragment key={o.id}>
                  <tr>
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
                    <td className="num">{money(o.total_cents)}</td>
                    <td>
                      <span className={`pay-badge pay-${o.payment_status}`}>{PAYMENT_LABELS[o.payment_status] || o.payment_status}</span>
                      {o.payment_method === "mobile_money" && (
                        <div className="muted-sku">{NETWORK_LABELS[o.payment?.network] || "Mobile money"}</div>
                      )}
                      {o.payment_status === "review" && (
                        <div className="tools">
                          <button className="link-btn" onClick={() => setPayment(o, "paid", `Accept the payment for #${o.number} as paid in full?`)}>
                            Accept
                          </button>
                          <button className="link-btn" onClick={() => setPayment(o, "refund_due", `Mark #${o.number} as needing a refund?`)}>
                            Refund
                          </button>
                        </div>
                      )}
                      {o.payment_status === "refund_due" && (
                        <button
                          className="link-btn"
                          onClick={() => setPayment(o, "refunded", `Have you refunded #${o.number} in Flutterwave?`)}
                        >
                          Mark refunded
                        </button>
                      )}
                    </td>
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
                    <tr>
                      <td colSpan="9" style={{ background: "var(--bg)" }}>
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
                                <td className="num">{money(i.price_cents)}</td>
                                <td className="num">{money(i.price_cents * i.qty)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td colSpan="4" className="num">Delivery</td>
                              <td className="num">{o.delivery_cents === 0 ? "Free" : money(o.delivery_cents)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
            </table>
          </div>
        )}

        {result && (
          <Pager
            page={result.page}
            pages={result.pages}
            total={result.total}
            limit={result.limit}
            label="orders"
            onPage={setPage}
          />
        )}
      </div>
    </>
  );
}
