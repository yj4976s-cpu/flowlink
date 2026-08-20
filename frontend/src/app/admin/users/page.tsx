import { AdminUsersClient } from "@/components/admin/users/AdminUsersClient";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminUsersPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminUsersClient /><Footer /></div></AdminRouteGuard>;
}
