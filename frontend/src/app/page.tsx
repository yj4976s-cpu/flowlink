import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { HeroSection } from "@/components/home/HeroSection";
import { ProcessFlow } from "@/components/home/ProcessFlow";
import { RecentItems } from "@/components/home/RecentItems";
import { StatsStrip } from "@/components/home/StatsStrip";

export default function Home() {
  return (
    <div className="site-shell">
      <Header />
      <main>
        <HeroSection />
        <StatsStrip />
        <ProcessFlow />
        <RecentItems />
      </main>
      <Footer />
    </div>
  );
}
