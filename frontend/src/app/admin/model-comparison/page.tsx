import { AdminModelComparisonClient } from "@/components/admin/model-comparison/AdminModelComparisonClient";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminModelComparisonPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminModelComparisonClient /><Footer /></div></AdminRouteGuard>;
}
