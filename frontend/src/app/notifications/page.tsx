import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { NotificationsClient } from "@/components/notifications/NotificationsClient";

export default function NotificationsPage() {
  return (
    <div className="site-shell">
      <Header />
      <NotificationsClient />
      <Footer />
    </div>
  );
}
