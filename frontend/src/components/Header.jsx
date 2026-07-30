import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth, useCart, useConfig } from "../store";
import { fmtPrice } from "../api";
import { HeartIcon, BagIcon } from "./Icons";

const CATEGORIES = ["Women", "Men", "Kids", "Accessories"];

export default function Header() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const { free_delivery_threshold_cents } = useConfig();
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  function submitSearch(e) {
    e.preventDefault();
    if (q.trim()) {
      navigate(`/shop?search=${encodeURIComponent(q.trim())}`);
      setQ("");
    }
  }

  return (
    <>
      <div className="topbar">
        Free delivery on orders over {fmtPrice(free_delivery_threshold_cents)} · Cash on delivery available
      </div>
      <header className="header">
        <div className="container header-inner">
          <Link to="/" className="logo">
            Ba<em>y</em>an
          </Link>
          <nav className="nav">
            {CATEGORIES.map((c) => (
              <NavLink key={c} to={`/shop?category=${c}`}>
                {c}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <form className="search-form" onSubmit={submitSearch}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search Bayan…"
                aria-label="Search products"
              />
            </form>
            {user?.is_admin && (
              <Link to="/admin" className="icon-btn" style={{ color: "var(--clay-dark)" }}>
                Admin
              </Link>
            )}
            {user ? (
              <>
                <Link to="/account" className="icon-btn">
                  {user.name.split(" ")[0]}
                </Link>
                <button className="icon-btn" onClick={logout}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/login" className="icon-btn">
                Sign in
              </Link>
            )}
            <Link to="/wishlist" className="icon-btn" aria-label="Wishlist">
              <HeartIcon />
            </Link>
            <Link to="/cart" className="icon-btn" aria-label="Cart">
              <BagIcon />
              {count > 0 && <span className="cart-count">{count}</span>}
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
