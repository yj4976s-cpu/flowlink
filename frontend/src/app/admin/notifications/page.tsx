import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { AdminNotificationsClient } from "@/components/notifications/AdminNotificationsClient";

export default function AdminNotificationsPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminNotificationsClient /><Footer /></div></AdminRouteGuard>;
}
