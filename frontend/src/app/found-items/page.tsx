import { DiscoveryNetworkClient } from "@/components/found-items/DiscoveryNetworkClient";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function FoundItemsPage() {
  return (
    <div className="site-shell">
      <Header />
      <DiscoveryNetworkClient />
      <Footer />
    </div>
  );
}
