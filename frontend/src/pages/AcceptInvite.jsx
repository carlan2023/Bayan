import { useState } from "react";
import { usePageTitle } from "../usePageTitle";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../store";
import { useAsync } from "../useAsync";
import ErrorState from "../components/ErrorState";

/**
 * Landing page for an admin invite link. A new address creates its account
 * here; an address that already has an account proves it with its password.
 */
export default function AcceptInvite() {
  usePageTitle("Join the shop team");
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const { data: invite, error: loadError, loading } = useAsync(
    () => (token ? api.invite(token) : Promise.reject(new Error("This invite link is incomplete."))),
    [token]
  );
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { token: session, user } = await api.acceptInvite({ token, name: name || invite.name, password });
      signIn(session, user);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (loading) return <div className="spinner">Loading…</div>;
  if (loadError) {
    return (
      <div className="container">
        <ErrorState title="This invite can't be used" message={`${loadError} Ask the admin who invited you to send a new one.`}>
          <Link to="/" className="btn btn-ghost">
            Go to the shop
          </Link>
        </ErrorState>
      </div>
    );
  }

  const existing = invite.existing_account;
  return (
    <div className="container auth-wrap">
      <form className="panel form-grid" onSubmit={submit}>
        <h1 style={{ fontSize: "1.7rem" }}>Join the shop team</h1>
        <p className="auth-lead">
          You've been invited to help run this shop as <strong>{invite.email}</strong>.{" "}
          {existing
            ? "You already have an account. Enter its password to accept."
            : "Choose a name and password to create your admin account."}
        </p>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {!existing && (
          <div>
            <label htmlFor="invite-name">Your name</label>
            <input
              id="invite-name"
              autoComplete="name"
              required={!invite.name}
              placeholder={invite.name || ""}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        <div>
          <label htmlFor="invite-password">{existing ? "Your password" : "Choose a password"}</label>
          <input
            id="invite-password"
            type="password"
            autoComplete={existing ? "current-password" : "new-password"}
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Please wait…" : "Accept invite"}
        </button>
      </form>
    </div>
  );
}
