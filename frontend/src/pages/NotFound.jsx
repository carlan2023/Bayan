import { Link } from "react-router-dom";

/**
 * Catch-all for unmatched routes. Without this, App's <Routes> matched nothing
 * and rendered a blank white page — not even the header.
 */
export default function NotFound() {
  return (
    <div className="container empty">
      <h2>We can't find that page</h2>
      <p style={{ marginBottom: 24 }}>
        The link may be out of date, or the address slightly off.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <Link to="/shop" className="btn btn-primary">
          Browse products
        </Link>
        <Link to="/" className="btn btn-ghost">
          Go home
        </Link>
      </div>
    </div>
  );
}
