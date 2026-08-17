import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

/* ---------------- Config ---------------- */
/**
 * Delivery pricing lives on the server (backend/src/config.js) and is served at
 * GET /api/config. These defaults only cover the first paint and an offline
 * fetch; they must stay in step with the backend module.
 */
const DEFAULT_CONFIG = {
  currency: "UGX",
  free_delivery_threshold_cents: 20000000,
  delivery_fee_cents: 1000000,
  max_qty_per_line: 20,
  urgency_stock_threshold: 3,
};

const ConfigContext = createContext(DEFAULT_CONFIG);

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  useEffect(() => {
    api
      .config()
      .then((c) => setConfig({ ...DEFAULT_CONFIG, ...c }))
      .catch(() => {
        /* keep defaults — the server re-prices every order anyway */
      });
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}
export const useConfig = () => useContext(ConfigContext);

/** Delivery charge for a subtotal, using the server's thresholds. */
export function useDelivery(subtotalCents) {
  const { free_delivery_threshold_cents, delivery_fee_cents } = useConfig();
  return subtotalCents >= free_delivery_threshold_cents ? 0 : delivery_fee_cents;
}

/* ---------------- Auth ---------------- */
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("bayan_user");
    return raw ? JSON.parse(raw) : null;
  });

  // Revalidate token on load
  useEffect(() => {
    if (localStorage.getItem("bayan_token")) {
      api.me()
        .then(({ user }) => setUser(user))
        .catch(() => logoutInternal());
    }
  }, []);

  function persist(token, user) {
    localStorage.setItem("bayan_token", token);
    localStorage.setItem("bayan_user", JSON.stringify(user));
    setUser(user);
  }
  function logoutInternal() {
    localStorage.removeItem("bayan_token");
    localStorage.removeItem("bayan_user");
    setUser(null);
  }

  const value = {
    user,
    async login(email, password) {
      const { token, user } = await api.login({ email, password });
      persist(token, user);
    },
    async register(name, email, password) {
      const { token, user } = await api.register({ name, email, password });
      persist(token, user);
    },
    logout: logoutInternal,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);

/* ---------------- Wishlist ---------------- */
const WishlistContext = createContext(null);

/**
 * Which products the signed-in user has saved. Previously each Product page
 * tracked a local `wished` boolean, so returning to a saved item showed
 * "Wishlist" rather than "Saved" and cards had no way to show the state at all.
 * Must sit inside AuthProvider — it reloads whenever the account changes.
 */
export function WishlistProvider({ children }) {
  const { user } = useAuth();
  const [ids, setIds] = useState([]);

  useEffect(() => {
    if (!user) {
      setIds([]);
      return;
    }
    let cancelled = false;
    api
      .wishlist()
      .then(({ products }) => {
        if (!cancelled) setIds(products.map((p) => p.id));
      })
      .catch(() => {
        if (!cancelled) setIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const value = {
    ids,
    has: (id) => ids.includes(id),
    /** Optimistic add/remove; rolls back and rethrows if the server rejects. */
    async toggle(id) {
      if (!user) throw new Error("Sign in to save items to your wishlist.");
      const wasSaved = ids.includes(id);
      setIds((prev) => (wasSaved ? prev.filter((x) => x !== id) : [...prev, id]));
      try {
        if (wasSaved) await api.removeWish(id);
        else await api.addWish(id);
      } catch (err) {
        setIds((prev) => (wasSaved ? [...prev, id] : prev.filter((x) => x !== id)));
        throw err;
      }
      return !wasSaved;
    },
  };
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}
export const useWishlist = () => useContext(WishlistContext);

/* ---------------- Cart ---------------- */
const CartContext = createContext(null);

export function CartProvider({ children }) {
  const { max_qty_per_line } = useConfig();
  const [items, setItems] = useState(() => {
    const raw = localStorage.getItem("bayan_cart");
    return raw ? JSON.parse(raw) : [];
  });

  useEffect(() => {
    localStorage.setItem("bayan_cart", JSON.stringify(items));
  }, [items]);

  const keyOf = (i) => `${i.product_id}|${i.size || ""}|${i.color || ""}`;

  /**
   * Re-price the cart against the catalogue.
   *
   * Cart lines are persisted in localStorage indefinitely, so a price change,
   * a stock drop or a deleted product leaves the shopper looking at a total the
   * server will not honour — it re-reads every price from the DB at checkout.
   * Returns the list of changes so the caller can tell the shopper what moved.
   */
  async function revalidate() {
    const ids = [...new Set(items.map((i) => i.product_id))];
    if (ids.length === 0) return [];

    let products;
    try {
      ({ products } = await api.productsByIds(ids));
    } catch {
      return []; // offline — leave the cart alone rather than emptying it
    }

    const byId = new Map(products.map((p) => [p.id, p]));
    const changes = [];
    const next = [];

    for (const item of items) {
      const p = byId.get(item.product_id);
      if (!p) {
        changes.push({ kind: "removed", name: item.name });
        continue;
      }

      const line = { ...item, name: p.name, slug: p.slug, price_cents: p.price_cents, stock: p.stock };
      if (p.price_cents !== item.price_cents) {
        changes.push({ kind: "price", name: p.name, from: item.price_cents, to: p.price_cents });
      }

      const cap = Math.min(p.stock, max_qty_per_line);
      if (cap <= 0) {
        changes.push({ kind: "soldout", name: p.name });
        continue;
      }
      if (line.qty > cap) {
        changes.push({ kind: "qty", name: p.name, to: cap });
        line.qty = cap;
      }
      next.push(line);
    }

    if (changes.length) setItems(next);
    return changes;
  }

  const value = {
    items,
    revalidate,
    maxQty: max_qty_per_line,
    count: items.reduce((n, i) => n + i.qty, 0),
    subtotal: items.reduce((s, i) => s + i.price_cents * i.qty, 0),
    add(product, { size, color, qty = 1 }) {
      setItems((prev) => {
        const colorImage = product.colors?.find((c) => c.name === color)?.image;
        const entry = {
          product_id: product.id,
          slug: product.slug,
          name: product.name,
          price_cents: product.price_cents,
          swatch: product.swatch,
          category: product.category,
          image: colorImage || product.image || null,
          stock: product.stock,
          size,
          color,
          qty,
        };
        const k = keyOf(entry);
        // Never let a line exceed stock or the server's per-line cap — the
        // order endpoint silently clamps, which would surprise the shopper.
        const cap = Math.min(product.stock ?? max_qty_per_line, max_qty_per_line);
        if (cap <= 0) return prev; // sold out — adding it would only fail at checkout
        const existing = prev.find((i) => keyOf(i) === k);
        if (existing) {
          // Refresh the line's product data while we have it fresh from the API.
          return prev.map((i) =>
            keyOf(i) === k ? { ...i, ...entry, qty: Math.min(i.qty + qty, cap) } : i
          );
        }
        return [...prev, { ...entry, qty: Math.min(qty, cap) }];
      });
    },
    setQty(key, qty) {
      setItems((prev) =>
        qty <= 0
          ? prev.filter((i) => keyOf(i) !== key)
          : prev.map((i) =>
              keyOf(i) === key
                ? { ...i, qty: Math.min(qty, Math.min(i.stock ?? max_qty_per_line, max_qty_per_line)) }
                : i
            )
      );
    },
    remove(key) {
      setItems((prev) => prev.filter((i) => keyOf(i) !== key));
    },
    clear() {
      setItems([]);
    },
    keyOf,
  };
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export const useCart = () => useContext(CartContext);
