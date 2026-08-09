import { FoundItemDetailClient } from "@/components/found-items/FoundItemDetailClient";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function FoundItemDetailPage() {
  return (
    <div className="site-shell">
      <Header />
      <FoundItemDetailClient />
      <Footer />
    </div>
  );
}
