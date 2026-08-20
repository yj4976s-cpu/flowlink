import { headers } from "next/headers";

import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { HeroSection } from "@/components/home/HeroSection";
import { ProcessFlow } from "@/components/home/ProcessFlow";
import { RecentItems } from "@/components/home/RecentItems";
import { StatsStrip } from "@/components/home/StatsStrip";
import { emptyHomeSummary, getHomeSummary } from "@/lib/homeApi";

export default async function Home() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  const requestOrigin = host ? `${proto.split(",", 1)[0]}://${host}` : null;
  const summary = await getHomeSummary(requestOrigin) ?? emptyHomeSummary;
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
