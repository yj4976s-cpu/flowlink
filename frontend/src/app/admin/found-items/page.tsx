import { AdminFoundItemsClient } from "@/components/admin/found-items/AdminFoundItemsClient";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminFoundItemsPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminFoundItemsClient /><Footer /></div></AdminRouteGuard>;
}
