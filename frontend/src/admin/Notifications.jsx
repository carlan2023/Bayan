import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

const POLL_MS = 30000;

/** Type → glyph + accent class for the medallion. */
const TYPE_META = {
  order: { label: "Order", glyph: "🛍", cls: "n-order" },
  wishlist: { label: "Wishlist", glyph: "♥", cls: "n-wish" },
  stock_low: { label: "Low stock", glyph: "▲", cls: "n-low" },
  stock_out: { label: "Sold out", glyph: "!", cls: "n-out" },
  customer: { label: "Customer", glyph: "＋", cls: "n-customer" },
};

function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Bell + slide-over activity feed. Polls every 30s so the badge stays live
 * while the admin works; the panel itself refreshes on open.
 *
 * `variant` picks the chrome: "sidebar" (labelled, dark admin rail) or
 * "header" (icon-only, sits with the storefront header actions so alerts are
 * visible while the admin is browsing the shop, not just inside /admin).
 */
export default function Notifications({ variant = "sidebar" }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { notifications, unread } = await api.admin.notifications({ limit: 30 });
      setItems(notifications);
      setUnread(unread);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // Live badge: poll in the background for as long as the admin shell is mounted.
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Escape closes; refresh on open so the list is current the moment it shows.
  useEffect(() => {
    if (!open) return;
    load();
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, load]);

  async function onItemClick(n) {
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      api.admin.markNotificationRead(n.id).catch(() => {});
    }
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  }

  async function markAll() {
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    setUnread(0);
    api.admin.markAllNotificationsRead().catch(() => {});
  }

  return (
    <>
      <button
        type="button"
        className={`notif-bell in-${variant} ${unread > 0 ? "has-unread" : ""}`}
        aria-label={`Activity — ${unread} unread`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span>Activity</span>
        {unread > 0 && <span className="notif-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <>
          <div className="notif-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="notif-panel" ref={panelRef} aria-label="Admin activity feed">
            <div className="notif-head">
              <h3>Activity</h3>
              {unread > 0 && (
                <button type="button" className="link-btn" onClick={markAll}>
                  Mark all read
                </button>
              )}
              <button type="button" className="notif-close" aria-label="Close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            {error ? (
              <div className="empty-mini">Couldn't load activity: {error}</div>
            ) : !items ? (
              <div className="empty-mini">Loading…</div>
            ) : items.length === 0 ? (
              <div className="notif-empty">
                <div className="notif-empty-mark">✓</div>
                All quiet. Orders, wishlist saves and stock alerts will appear here.
              </div>
            ) : (
              <ul className="notif-list">
                {items.map((n) => {
                  const meta = TYPE_META[n.type] || TYPE_META.order;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        className={`notif-item ${n.read ? "" : "unread"}`}
                        onClick={() => onItemClick(n)}
                      >
                        <span className={`notif-medallion ${meta.cls}`} aria-hidden="true">
                          {meta.glyph}
                        </span>
                        <span className="notif-content">
                          <span className="notif-title">{n.title}</span>
                          {n.body && <span className="notif-body">{n.body}</span>}
                          <span className="notif-time">
                            {meta.label} · {timeAgo(n.created_at)}
                          </span>
                        </span>
                        {!n.read && <span className="notif-dot" aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </>
      )}
    </>
  );
}
