const BASE = "/api";

export function getToken() {
  return localStorage.getItem("bayan_token");
}

async function request(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Builds a query string, dropping empty values. */
function qs(params = {}) {
  const s = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))
  ).toString();
  return s ? `?${s}` : "";
}

export const api = {
  // products
  products: (params = {}) => request(`/products${qs(params)}`),
  product: (slug) => request(`/products/${slug}`),
  productsByIds: (ids) => request(`/products?ids=${ids.map(encodeURIComponent).join(",")}`),
  categories: () => request("/products/categories"),

  // storefront constants (currency, delivery pricing)
  config: () => request("/config"),

  // landing-page hero media (public)
  hero: () => request("/hero"),

  // auth
  register: (body) => request("/auth/register", { method: "POST", body }),
  login: (body) => request("/auth/login", { method: "POST", body }),
  me: () => request("/auth/me"),
  forgotPassword: (email) => request("/auth/forgot", { method: "POST", body: { email } }),
  resetPassword: (token, password) => request("/auth/reset", { method: "POST", body: { token, password } }),
  invite: (token) => request(`/auth/invite${qs({ token })}`),
  acceptInvite: (body) => request("/auth/accept-invite", { method: "POST", body }),

  // orders
  createOrder: (body) => request("/orders", { method: "POST", body }),
  myOrders: () => request("/orders"),

  // wishlist
  wishlist: () => request("/wishlist"),
  addWish: (id) => request(`/wishlist/${id}`, { method: "POST" }),
  removeWish: (id) => request(`/wishlist/${id}`, { method: "DELETE" }),

  // admin
  admin: {
    stats: () => request("/admin/stats"),
    // Both listings are paged: { orders|products, total, page, limit, pages }
    orders: (params = {}) => request(`/admin/orders${qs(params)}`),
    products: (params = {}) => request(`/admin/products${qs(params)}`),
    setOrderStatus: (id, status) => request(`/admin/orders/${id}`, { method: "PATCH", body: { status } }),
    createProduct: (body) => request("/admin/products", { method: "POST", body }),
    updateProduct: (id, body) => request(`/admin/products/${id}`, { method: "PUT", body }),
    deleteProduct: (id) => request(`/admin/products/${id}`, { method: "DELETE" }),
    customers: () => request("/admin/customers"),
    settings: () => request("/admin/settings"),
    saveSettings: (body) => request("/admin/settings", { method: "PUT", body }),
    /** Catalogue import. dry=true only validates and reports. Resolves with the report even on 422. */
    importCatalogue: async (file, { dry = false } = {}) => {
      const body = new FormData();
      body.append("file", file);
      const token = getToken();
      const res = await fetch(`${BASE}/admin/import${dry ? "?dry=1" : ""}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 422) throw new Error(data.error || `Import failed (${res.status})`);
      return data; // { created, updated, errors, products, written }
    },
    importTemplate: async () => {
      const token = getToken();
      const res = await fetch(`${BASE}/admin/import/template`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      return res.blob();
    },
    team: () => request("/admin/team"),
    invite: (body) => request("/admin/invites", { method: "POST", body }),
    revokeInvite: (id) => request(`/admin/invites/${id}`, { method: "DELETE" }),
    removeAdmin: (id) => request(`/admin/team/${id}`, { method: "DELETE" }),
    audit: (params = {}) => request(`/admin/audit${qs(params)}`),
    saveHero: (body) => request("/admin/hero", { method: "PUT", body }),
    uploadHeroMedia: async (file) => {
      const body = new FormData();
      body.append("file", file);
      const token = getToken();
      const res = await fetch(`${BASE}/admin/hero/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      return data; // { url, media_type }
    },
    notifications: (params = {}) => request(`/admin/notifications${qs(params)}`),
    markNotificationRead: (id) => request(`/admin/notifications/${id}/read`, { method: "PATCH" }),
    markAllNotificationsRead: () => request("/admin/notifications/read-all", { method: "PATCH" }),
    uploadImage: async (file) => {
      const body = new FormData();
      body.append("file", file);
      const token = getToken();
      const res = await fetch(`${BASE}/admin/uploads`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      return data; // { url }
    },
  },
};

// Price formatting moved to the useMoney() hook in store.jsx: it reads the
// shop's currency and locale from config, which a module function cannot.
