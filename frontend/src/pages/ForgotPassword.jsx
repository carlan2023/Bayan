import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // The server answers the same way whether or not the account exists.
      const r = await api.forgotPassword(email);
      setMessage(r.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container auth-wrap">
      <form className="panel form-grid" onSubmit={submit}>
        <h1 style={{ fontSize: "1.7rem" }}>Reset your password</h1>
        {message ? (
          <div className="alert alert-ok" role="status">
            {message}
          </div>
        ) : (
          <>
            <p className="auth-lead">Enter the email you signed up with and we'll send you a link to choose a new password.</p>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}
        <div className="auth-switch">
          <Link to="/login" className="link-btn">
            Back to sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
