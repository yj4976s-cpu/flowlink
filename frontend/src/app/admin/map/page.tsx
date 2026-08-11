import { AdminOperationsMap } from "@/components/admin/operations-map/AdminOperationsMap";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminMapPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminOperationsMap /><Footer /></div></AdminRouteGuard>;
}
