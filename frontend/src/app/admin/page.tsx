import { AdminDashboardClient } from "@/components/admin/dashboard/AdminDashboardClient";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminDashboardClient /><Footer /></div></AdminRouteGuard>;
}
