import { MatchesClient } from "@/components/matches/MatchesClient";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function MatchesPage() {
  return (
    <div className="site-shell">
      <Header />
      <MatchesClient />
      <Footer />
    </div>
  );
}
