import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { api } from "./api";
import { applyTheme, DEFAULT_SETTINGS } from "./theme";
import { findVariant, priceOf } from "./variants";

/* ---------------- Config ---------------- */
/**
 * The shop's settings — brand, palette, fonts, copy, departments, currency and
 * delivery pricing — served at GET /api/config from the Settings document.
 *
 * First paint never waits on that fetch: in production the server embeds the
 * same payload in index.html (<script id="shop-config">, see
 * backend/src/shell.js), so it is read synchronously here. Only the Vite dev
 * server, which serves index.html untouched, falls back to the shared defaults
 * (/shared/default-settings.json — the backend's own file) until the fetch
 * lands. The server re-prices every order anyway, so a stale default can never
 * be charged.
 */
const FALLBACK_CONFIG = {
  ...DEFAULT_SETTINGS,
  urgency_stock_threshold: 3,
  // Hides "Forgot password?" until the server says it can actually send the email.
  email_enabled: false,
};

function embeddedConfig() {
  try {
    const el = typeof document !== "undefined" && document.getElementById("shop-config");
    return el ? { ...FALLBACK_CONFIG, ...JSON.parse(el.textContent) } : null;
  } catch {
    return null;
  }
}

const ConfigContext = createContext(FALLBACK_CONFIG);
const ConfigActionsContext = createContext({ reload: async () => {}, replace: () => {} });

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(() => embeddedConfig() || FALLBACK_CONFIG);

  const reload = useCallback(
    () =>
      api
        .config()
        .then((c) => setConfig({ ...FALLBACK_CONFIG, ...c }))
        .catch(() => {
          /* keep what we have — the server re-prices every order anyway */
        }),
    []
  );

  // Refresh even when embedded: a long-open tab should pick up edits.
  useEffect(() => {
    reload();
  }, [reload]);

  // Before paint, so a retheme never shows a frame of the old palette.
  useLayoutEffect(() => {
    applyTheme(config);
    if (config.page_title) document.title = config.page_title;
  }, [config]);

  const actions = useMemo(
    () => ({ reload, replace: (c) => setConfig({ ...FALLBACK_CONFIG, ...c }) }),
    [reload]
  );

  return (
    <ConfigActionsContext.Provider value={actions}>
      <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
    </ConfigActionsContext.Provider>
  );
}
export const useConfig = () => useContext(ConfigContext);
/** { reload(), replace(config) } — used by Admin → Settings after a save. */
export const useConfigActions = () => useContext(ConfigActionsContext);

/** Delivery charge for a subtotal, using the server's thresholds. */
export function useDelivery(subtotalCents) {
  const { free_delivery_threshold_cents, delivery_fee_cents } = useConfig();
  return subtotalCents >= free_delivery_threshold_cents ? 0 : delivery_fee_cents;
}

/** A money formatter for a currency + locale (prices are stored as cents). */
export function moneyFormatter(currency, locale) {
  let nf;
  try {
    nf = new Intl.NumberFormat(locale, { style: "currency", currency });
  } catch {
    nf = new Intl.NumberFormat(undefined, { style: "currency", currency: "UGX" });
  }
  return (cents) => nf.format((cents || 0) / 100);
}

/**
 * useMoney() → format(cents). Replaces the old module-level fmtPrice, which
 * hard-coded en-UG / UGX and so could never follow a shop's settings.
 */
export function useMoney() {
  const { currency, locale } = useConfig();
  return useMemo(() => moneyFormatter(currency, locale), [currency, locale]);
}

/**
 * useCopy() → t(text). Fills the placeholders the settings copy may use:
 * {shop_name}, {free_delivery_threshold} and {delivery_fee} — so marketing copy
 * quoting a fee stays true when the owner changes the fee.
 */
export function useCopy() {
  const config = useConfig();
  const money = useMoney();
  return useCallback(
    (text) =>
      String(text ?? "").replace(/\{(shop_name|free_delivery_threshold|delivery_fee)\}/g, (_, key) =>
        key === "shop_name"
          ? config.shop_name
          : money(key === "delivery_fee" ? config.delivery_fee_cents : config.free_delivery_threshold_cents)
      ),
    [config, money]
  );
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
    /** Store a session the server already issued (password reset, invite acceptance). */
    signIn: persist,
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

      // Stock and price are per size/colour: a line for a pair the product no
      // longer makes counts as sold out, whatever the other sizes hold.
      const variant = findVariant(p, item.size, item.color);
      const price = priceOf(p, item.size, item.color);
      const stock = variant ? variant.stock : 0;
      const line = { ...item, name: p.name, slug: p.slug, price_cents: price, stock };
      if (price !== item.price_cents) {
        changes.push({ kind: "price", name: p.name, from: item.price_cents, to: price });
      }

      const cap = Math.min(stock, max_qty_per_line);
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
        const variant = findVariant(product, size, color);
        const entry = {
          product_id: product.id,
          slug: product.slug,
          name: product.name,
          price_cents: priceOf(product, size, color),
          swatch: product.swatch,
          category: product.category,
          image: colorImage || product.image || null,
          // The chosen pair's stock, not the product total: "3 left in L" must
          // stop the + button at 3 even when XS has forty.
          stock: variant ? variant.stock : 0,
          size,
          color,
          qty,
        };
        const k = keyOf(entry);
        // Never let a line exceed stock or the server's per-line cap — the
        // order endpoint silently clamps, which would surprise the shopper.
        const cap = Math.min(entry.stock, max_qty_per_line);
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
