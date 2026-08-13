import { AdminCitizenReportsClient } from "@/components/admin/citizen-reports/AdminCitizenReportsClient";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminCitizenReportsPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminCitizenReportsClient /><Footer /></div></AdminRouteGuard>;
}
