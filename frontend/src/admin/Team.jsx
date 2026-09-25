import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../store";

/**
 * Admins and pending invites. Before this, `is_admin` could only be set by the
 * boot-time bootstrap or by hand in the database, so a shop with two staff
 * shared one login.
 */
export default function Team() {
  const { user } = useAuth();
  const [team, setTeam] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null); // { email, accept_url, emailed }

  const load = useCallback(
    () =>
      api.admin
        .team()
        .then(setTeam)
        .catch((e) => setError(e.message)),
    []
  );
  useEffect(() => {
    load();
  }, [load]);

  async function invite(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const r = await api.admin.invite(form);
      setSent({ email: r.invite.email, accept_url: r.accept_url, emailed: r.emailed });
      setForm({ email: "", name: "" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn, confirmText) {
    if (!window.confirm(confirmText)) return;
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
    load();
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* the link is selectable on screen anyway */
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Team</h1>
          <p>{team ? `${team.admins.length} admin${team.admins.length === 1 ? "" : "s"}` : "Loading…"}</p>
        </div>
      </div>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <form className="admin-panel form-grid" onSubmit={invite}>
        <h3>Invite an admin</h3>
        <p className="hint">
          They get full access to products, orders, customers and settings. The link works once and expires in 7 days.
        </p>
        <div className="form-3col">
          <div>
            <label htmlFor="inv-email">Email *</label>
            <input
              id="inv-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="inv-name">Name</label>
            <input id="inv-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div style={{ alignSelf: "end" }}>
            <button className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? "Sending…" : "Send invite"}
            </button>
          </div>
        </div>
        {sent && (
          <div className="alert alert-ok" role="status">
            {sent.emailed ? `Invite emailed to ${sent.email}. ` : `Email isn't set up, so send ${sent.email} this link yourself: `}
            <code className="invite-link">{sent.accept_url}</code>{" "}
            <button type="button" className="link-btn" onClick={() => copy(sent.accept_url)}>
              Copy link
            </button>
          </div>
        )}
      </form>

      <div className="admin-panel">
        <h3>Admins</h3>
        {!team ? (
          <div className="spinner">Loading…</div>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Admin since</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {team.admins.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {a.name}
                      {a.id === user?.id && <span className="muted-sku"> (you)</span>}
                    </td>
                    <td>{a.email}</td>
                    <td>{new Date(a.created_at).toLocaleDateString()}</td>
                    <td className="num">
                      {a.id !== user?.id && team.admins.length > 1 && (
                        <button
                          className="link-btn"
                          style={{ color: "var(--danger)" }}
                          onClick={() =>
                            act(
                              () => api.admin.removeAdmin(a.id),
                              `Remove admin access from ${a.email}? Their customer account stays.`
                            )
                          }
                        >
                          Remove access
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {team?.invites.length > 0 && (
        <div className="admin-panel">
          <h3>Pending invites</h3>
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Invited by</th>
                  <th>Expires</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {team.invites.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>{i.invited_by || "—"}</td>
                    <td>{new Date(i.expires_at).toLocaleDateString()}</td>
                    <td className="num">
                      <button
                        className="link-btn"
                        style={{ color: "var(--danger)" }}
                        onClick={() => act(() => api.admin.revokeInvite(i.id), `Revoke the invite for ${i.email}?`)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
