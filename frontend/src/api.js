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

export const api = {
  // products
  products: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))
    ).toString();
    return request(`/products${qs ? "?" + qs : ""}`);
  },
  product: (slug) => request(`/products/${slug}`),
  categories: () => request("/products/categories"),

  // auth
  register: (body) => request("/auth/register", { method: "POST", body }),
  login: (body) => request("/auth/login", { method: "POST", body }),
  me: () => request("/auth/me"),

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
    orders: (status) => request(`/admin/orders${status ? `?status=${status}` : ""}`),
    setOrderStatus: (id, status) => request(`/admin/orders/${id}`, { method: "PATCH", body: { status } }),
    createProduct: (body) => request("/admin/products", { method: "POST", body }),
    updateProduct: (id, body) => request(`/admin/products/${id}`, { method: "PUT", body }),
    deleteProduct: (id) => request(`/admin/products/${id}`, { method: "DELETE" }),
    customers: () => request("/admin/customers"),
  },
};

export const fmtPrice = (cents) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(
    cents / 100
  );
