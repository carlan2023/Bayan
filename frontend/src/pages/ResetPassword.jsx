import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../store";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { token: session, user } = await api.resetPassword(token, password);
      signIn(session, user);
      navigate(user.is_admin ? "/admin" : "/account", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="container auth-wrap">
        <div className="panel form-grid">
          <h1 style={{ fontSize: "1.7rem" }}>This link is incomplete</h1>
          <p className="auth-lead">Open the link from your email again, or ask for a new one.</p>
          <Link to="/forgot-password" className="btn btn-primary btn-block">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container auth-wrap">
      <form className="panel form-grid" onSubmit={submit}>
        <h1 style={{ fontSize: "1.7rem" }}>Choose a new password</h1>
        {error && (
          <div className="alert alert-error" role="alert">
            {error} {/expired|invalid|used/i.test(error) && <Link to="/forgot-password">Request a new link</Link>}
          </div>
        )}
        <div>
          <label htmlFor="reset-password">New password</label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="reset-hint"
          />
          <span id="reset-hint" className="field-hint">
            At least 6 characters.
          </span>
        </div>
        <div>
          <label htmlFor="reset-confirm">Confirm new password</label>
          <input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            minLength={6}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Saving…" : "Save password and sign in"}
        </button>
      </form>
    </div>
  );
}
