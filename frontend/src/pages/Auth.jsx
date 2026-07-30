import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../store";

export default function Auth() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register(form.name, form.email, form.password);
      navigate(location.state?.from || "/account");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container auth-wrap">
      <form className="panel form-grid" onSubmit={submit}>
        <h1 style={{ fontSize: "1.7rem" }}>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        {error && <div className="alert alert-error">{error}</div>}
        {mode === "register" && (
          <div>
            <label htmlFor="auth-name">Full name</label>
            <input id="auth-name" name="name" autoComplete="name" required value={form.name} onChange={set("name")} />
          </div>
        )}
        <div>
          <label htmlFor="auth-email">Email</label>
          <input
            id="auth-email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            type="email"
            value={form.email}
            onChange={set("email")}
          />
        </div>
        <div>
          <label htmlFor="auth-password">Password</label>
          <input
            id="auth-password"
            name="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            type="password"
            minLength={6}
            value={form.password}
            onChange={set("password")}
          />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <div className="auth-switch">
          {mode === "login" ? (
            <>
              New to Bayan?{" "}
              <button type="button" className="link-btn" onClick={() => setMode("register")}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button type="button" className="link-btn" onClick={() => setMode("login")}>
                Sign in
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
