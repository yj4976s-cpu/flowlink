import { LostReportForm } from "@/components/lost-reports/LostReportForm";
import { LostReportAuthGate } from "@/components/lost-reports/LostReportAuthGate";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function LostReportNewPage() {
  return (
    <div className="site-shell">
      <Header />
      <LostReportAuthGate>
        <LostReportForm />
      </LostReportAuthGate>
      <Footer />
    </div>
  );
}
