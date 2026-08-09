import { AdminOwnershipClaimsClient } from "@/components/admin/ownership-claims/AdminOwnershipClaimsClient";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function AdminOwnershipClaimsPage() {
  return (
    <div className="site-shell">
      <Header />
      <AdminOwnershipClaimsClient />
      <Footer />
    </div>
  );
}
