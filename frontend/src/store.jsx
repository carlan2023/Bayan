import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";

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

/* ---------------- Cart ---------------- */
const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    const raw = localStorage.getItem("bayan_cart");
    return raw ? JSON.parse(raw) : [];
  });

  useEffect(() => {
    localStorage.setItem("bayan_cart", JSON.stringify(items));
  }, [items]);

  const keyOf = (i) => `${i.product_id}|${i.size || ""}|${i.color || ""}`;

  const value = {
    items,
    count: items.reduce((n, i) => n + i.qty, 0),
    subtotal: items.reduce((s, i) => s + i.price_cents * i.qty, 0),
    add(product, { size, color, qty = 1 }) {
      setItems((prev) => {
        const entry = {
          product_id: product.id,
          slug: product.slug,
          name: product.name,
          price_cents: product.price_cents,
          swatch: product.swatch,
          category: product.category,
          size,
          color,
          qty,
        };
        const k = keyOf(entry);
        const existing = prev.find((i) => keyOf(i) === k);
        if (existing) {
          return prev.map((i) => (keyOf(i) === k ? { ...i, qty: i.qty + qty } : i));
        }
        return [...prev, entry];
      });
    },
    setQty(key, qty) {
      setItems((prev) =>
        qty <= 0 ? prev.filter((i) => keyOf(i) !== key) : prev.map((i) => (keyOf(i) === key ? { ...i, qty } : i))
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
