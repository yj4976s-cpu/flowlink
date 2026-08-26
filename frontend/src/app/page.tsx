import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { HeroSection } from "@/components/home/HeroSection";
import { ProcessFlow } from "@/components/home/ProcessFlow";
import { RecentItems } from "@/components/home/RecentItems";
import { StatsStrip } from "@/components/home/StatsStrip";
import { emptyHomeSummary, getHomeSummary } from "@/lib/homeApi";

export default async function Home() {
  const summary = await getHomeSummary() ?? emptyHomeSummary;
  return (
    <div className="site-shell">
      <Header />
      <main>
        <HeroSection />
        <StatsStrip stats={summary.stats} />
        <ProcessFlow />
        <RecentItems items={summary.recentItems} />
      </main>
      <Footer />
    </div>
  );
}
