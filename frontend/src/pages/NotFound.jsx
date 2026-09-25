import { Link } from "react-router-dom";
import { usePageTitle } from "../usePageTitle";

/**
 * Catch-all for unmatched routes. Without this, App's <Routes> matched nothing
 * and rendered a blank white page — not even the header.
 */
export default function NotFound() {
  usePageTitle("Page not found");
  return (
    <div className="container empty">
      <h1 className="empty-title">We can't find that page</h1>
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
