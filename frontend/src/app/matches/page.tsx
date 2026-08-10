import { MatchesClient } from "@/components/matches/MatchesClient";
import { UserRouteGuard } from "@/components/auth/UserRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function MatchesPage() {
  return (
    <UserRouteGuard><div className="site-shell">
      <Header />
      <MatchesClient />
      <Footer />
    </div></UserRouteGuard>
  );
}
