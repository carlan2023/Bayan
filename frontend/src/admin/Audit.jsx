import { useEffect, useState } from "react";
import { api } from "../api";
import Pager from "./Pager";

const ACTIONS = {
  "order.status": "Order status",
  "order.payment": "Payment",
  "product.create": "Product created",
  "product.price": "Price change",
  "admin.invite": "Admin invited",
  "admin.invite_revoke": "Invite revoked",
  "admin.join": "Admin joined",
  "admin.demote": "Admin removed",
  "auth.password_reset": "Password reset",
  "settings.update": "Settings changed",
  "catalogue.import": "Catalogue import",
};

/** Read-only trail of who changed what: order statuses, prices, the team. */
export default function Audit() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    api.admin
      .audit({ action, page })
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [action, page]);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Audit log</h1>
          <p>{result ? `${result.total} entr${result.total === 1 ? "y" : "ies"}` : "Loading…"}</p>
        </div>
        <div className="tools">
          <label htmlFor="audit-action" className="sr-only">
            Filter by action
          </label>
          <select
            id="audit-action"
            className="input-sm"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All actions</option>
            {Object.entries(ACTIONS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      <div className="admin-panel">
        {!result ? (
          <div className="spinner">Loading…</div>
        ) : result.entries.length === 0 ? (
          <div className="empty-mini">Nothing recorded yet.</div>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>What happened</th>
                </tr>
              </thead>
              <tbody>
                {result.entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <time dateTime={e.created_at}>{new Date(e.created_at).toLocaleString()}</time>
                    </td>
                    <td>{e.actor_email || "system"}</td>
                    <td>{ACTIONS[e.action] || e.action}</td>
                    <td>{e.summary}</td>
                  </tr>
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
            label="entries"
            onPage={setPage}
          />
        )}
      </div>
    </>
  );
}
