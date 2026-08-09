import { LostReportForm } from "@/components/lost-reports/LostReportForm";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function LostReportNewPage() {
  return (
    <div className="site-shell">
      <Header />
      <LostReportForm />
      <Footer />
    </div>
  );
}
