import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
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
import NotFound from "./pages/NotFound";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import AdminTeam from "./admin/Team";
import AdminAudit from "./admin/Audit";

function ShopLayout() {
  return (
    <>
      <Header />
      <main>
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
