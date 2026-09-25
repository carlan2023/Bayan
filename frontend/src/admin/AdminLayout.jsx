import { NavLink, Link, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../store";
import Notifications from "./Notifications";
import "./admin.css";

export default function AdminLayout() {
  const { user, logout } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_admin) {
    return (
      <div className="container empty">
        <h2>Admin access required</h2>
        <p style={{ marginBottom: 24 }}>You're signed in as {user.email}, which is not an admin account.</p>
        <Link to="/" className="btn btn-primary">Back to the store</Link>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <Link to="/" className="logo">
          Ba<em>y</em>an
        </Link>
        <nav>
          <NavLink to="/admin" end>Overview</NavLink>
          <NavLink to="/admin/products">Products</NavLink>
          <NavLink to="/admin/orders">Orders</NavLink>
          <NavLink to="/admin/customers">Customers</NavLink>
          <NavLink to="/admin/storefront">Storefront</NavLink>
          <NavLink to="/admin/team">Team</NavLink>
          <NavLink to="/admin/audit">Audit log</NavLink>
          <NavLink to="/">← View store</NavLink>
        </nav>
        <Notifications variant="sidebar" />
        <div className="side-foot">
          <div className="who">{user.name}</div>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
