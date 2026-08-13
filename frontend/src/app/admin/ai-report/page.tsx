import { AdminAiReportClient } from "@/components/admin/ai-report/AdminAiReportClient";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminAiReportPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminAiReportClient /><Footer /></div></AdminRouteGuard>;
}
