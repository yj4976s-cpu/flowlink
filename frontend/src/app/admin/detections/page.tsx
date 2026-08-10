import { AdminDetectionsClient } from "@/components/admin/detections/AdminDetectionsClient";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminDetectionsPage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminDetectionsClient /><Footer /></div></AdminRouteGuard>;
}
