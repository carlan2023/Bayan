import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import { AuthProvider, CartProvider, ConfigProvider, WishlistProvider } from "./store";
import Header from "./components/Header";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import Catalog from "./pages/Catalog";
import Product from "./pages/Product";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Auth from "./pages/Auth";
import Account from "./pages/Account";
import Wishlist from "./pages/Wishlist";
import AdminLayout from "./admin/AdminLayout";
import AdminDashboard from "./admin/Dashboard";
import AdminProducts from "./admin/Products";
import AdminOrders from "./admin/Orders";
import AdminCustomers from "./admin/Customers";
import AdminStorefront from "./admin/Storefront";
import AdminSettings from "./admin/Settings";
import NotFound from "./pages/NotFound";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import OrderPayment from "./pages/OrderPayment";
import TrackOrder from "./pages/TrackOrder";
import AdminTeam from "./admin/Team";
import AdminAudit from "./admin/Audit";

/**
 * Move focus to the page on client-side navigation. Without it, a keyboard or
 * screen-reader user who follows a link stays on that link in the old page's
 * DOM position and hears nothing about the new page. The first render is left
 * alone so a fresh load starts at the top as usual.
 */
function useRouteFocus(ref) {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.focus({ preventScroll: true });
  }, [pathname, ref]);
}

function ShopLayout() {
  const main = useRef(null);
  useRouteFocus(main);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header />
      <main id="main" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

// ConfigProvider sits outside CartProvider: the cart reads the server's
// per-line quantity cap from it to clamp quantities.
export default function App() {
  return (
    <ConfigProvider>
      <AuthProvider>
        <WishlistProvider>
          <CartProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<ShopLayout />}>
                  <Route path="/" element={<Home />} />
                  <Route path="/shop" element={<Catalog />} />
                  <Route path="/product/:slug" element={<Product />} />
                  <Route path="/cart" element={<Cart />} />
                  <Route path="/checkout" element={<Checkout />} />
                  <Route path="/login" element={<Auth />} />
                  <Route path="/account" element={<Account />} />
                  <Route path="/wishlist" element={<Wishlist />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/accept-invite" element={<AcceptInvite />} />
                  <Route path="/order/:id/payment" element={<OrderPayment />} />
                  <Route path="/track" element={<TrackOrder />} />
                  {/* Catch-all inside the shop layout, so a bad URL still gets
                      a header, footer and a way back. */}
                  <Route path="*" element={<NotFound />} />
                </Route>
                <Route path="/admin" element={<AdminLayout />}>
                  <Route index element={<AdminDashboard />} />
                  <Route path="products" element={<AdminProducts />} />
                  <Route path="orders" element={<AdminOrders />} />
                  <Route path="customers" element={<AdminCustomers />} />
                  <Route path="storefront" element={<AdminStorefront />} />
                  <Route path="settings" element={<AdminSettings />} />
                  <Route path="team" element={<AdminTeam />} />
                  <Route path="audit" element={<AdminAudit />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </CartProvider>
        </WishlistProvider>
      </AuthProvider>
    </ConfigProvider>
  );
}
