import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useCart, useConfig } from "../store";
import { fmtPrice } from "../api";
import { HeartIcon, BagIcon, MenuIcon, CloseIcon, SearchIcon } from "./Icons";
import Notifications from "../admin/Notifications";

const CATEGORIES = ["Women", "Men", "Kids", "Accessories"];

export default function Header() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const { free_delivery_threshold_cents } = useConfig();
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const mobileSearchRef = useRef(null);

  function submitSearch(e) {
    e.preventDefault();
    if (q.trim()) {
      navigate(`/shop?search=${encodeURIComponent(q.trim())}`);
      setQ("");
      setSearchOpen(false);
      setMenuOpen(false);
    }
  }

  // Close both panels whenever the route changes — otherwise tapping a link in
  // the drawer navigates but leaves the drawer covering the new page.
  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);

  // Escape closes whichever panel is open.
  useEffect(() => {
    if (!menuOpen && !searchOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, searchOpen]);

  // Stop the page scrolling behind the open drawer.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  // Focus the field when the mobile search opens, so the keyboard appears.
  useEffect(() => {
    if (searchOpen) mobileSearchRef.current?.focus();
  }, [searchOpen]);

  return (
    <>
      <div className="topbar">
        Free delivery on orders over {fmtPrice(free_delivery_threshold_cents)} · Cash on delivery available
      </div>
      <header className="header">
        <div className="container header-inner">
          <button
            type="button"
            className="icon-btn hamburger"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => {
              setMenuOpen((v) => !v);
              setSearchOpen(false);
            }}
          >
            {menuOpen ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
          </button>

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

            <button
              type="button"
              className="icon-btn search-toggle"
              aria-label="Search"
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen((v) => !v);
                setMenuOpen(false);
              }}
            >
              <SearchIcon size={20} />
            </button>

            {/* Admins see the activity bell everywhere on the storefront, so a
                new order or stock-out can't go unnoticed while they browse. */}
            {user?.is_admin && <Notifications variant="header" />}
            {user?.is_admin && (
              <Link to="/admin" className="icon-btn desktop-only" style={{ color: "var(--clay-dark)" }}>
                Admin
              </Link>
            )}
            {user ? (
              <>
                <Link to="/account" className="icon-btn desktop-only">
                  {user.name.split(" ")[0]}
                </Link>
                <button className="icon-btn desktop-only" onClick={logout}>
                  Sign out
                </button>
              </>
            ) : (
              <Link to="/login" className="icon-btn desktop-only">
                Sign in
              </Link>
            )}
            <Link to="/wishlist" className="icon-btn" aria-label="Wishlist">
              <HeartIcon />
            </Link>
            <Link to="/cart" className="icon-btn" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>
              <BagIcon />
              {count > 0 && <span className="cart-count">{count}</span>}
            </Link>
          </div>
        </div>

        {/* Mobile-only search row, revealed by the magnifier button. */}
        {searchOpen && (
          <div className="mobile-search">
            <form className="container" onSubmit={submitSearch}>
              <input
                ref={mobileSearchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search Bayan…"
                aria-label="Search products"
              />
            </form>
          </div>
        )}

        {/* Mobile-only drawer: departments plus the account actions that are
            hidden from the top bar at this width. */}
        {menuOpen && (
          <div className="mobile-nav" id="mobile-nav">
            <nav className="container">
              {CATEGORIES.map((c) => (
                <NavLink key={c} to={`/shop?category=${c}`}>
                  {c}
                </NavLink>
              ))}
              <NavLink to="/shop">All products</NavLink>

              <div className="mobile-nav-foot">
                {user?.is_admin && <Link to="/admin">Admin dashboard</Link>}
                {user ? (
                  <>
                    <Link to="/account">My account</Link>
                    <button type="button" onClick={logout}>
                      Sign out
                    </button>
                  </>
                ) : (
                  <Link to="/login">Sign in / Register</Link>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
    </>
  );
}
