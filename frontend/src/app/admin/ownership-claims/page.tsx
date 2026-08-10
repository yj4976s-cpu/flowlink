import { AdminOwnershipClaimsClient } from "@/components/admin/ownership-claims/AdminOwnershipClaimsClient";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminOwnershipClaimsPage() {
  return (
    <AdminRouteGuard><div className="site-shell">
      <Header />
      <AdminOwnershipClaimsClient />
      <Footer />
    </div></AdminRouteGuard>
  );
}
