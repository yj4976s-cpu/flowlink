import { AdminMobileWasteCamera } from "@/components/admin/detections/AdminMobileWasteCamera";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminMobileWastePage() {
  return <AdminRouteGuard><div className="site-shell"><Header /><AdminMobileWasteCamera /><Footer /></div></AdminRouteGuard>;
}
