import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";
import { UserRouteGuard } from "@/components/auth/UserRouteGuard";

export default function NotificationsPage() {
  return (
    <UserRouteGuard><div className="site-shell">
      <Header />
      <NotificationsClient />
      <Footer />
    </div></UserRouteGuard>
  );
}
