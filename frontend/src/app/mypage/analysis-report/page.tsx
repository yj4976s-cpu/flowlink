import { Suspense } from "react";
import { UserRouteGuard } from "@/components/auth/UserRouteGuard";
import { AnalysisReportClient } from "@/components/mypage/analysis-report/AnalysisReportClient";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function MyAnalysisReportPage() {
  return (
    <UserRouteGuard>
      <div className="site-shell">
        <Header />
        <Suspense fallback={null}>
          <AnalysisReportClient />
        </Suspense>
        <Footer />
      </div>
    </UserRouteGuard>
  );
}
