import { FoundItemMapClient } from "@/components/map/FoundItemMapClient";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function FoundItemMapPage() {
  return (
    <div className="site-shell">
      <Header />
      <FoundItemMapClient />
      <Footer />
    </div>
  );
}
