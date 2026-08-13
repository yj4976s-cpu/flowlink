import { DetectionAuthGate } from "@/components/detection/DetectionAuthGate";
import { DetectionWorkbench } from "@/components/detection/DetectionWorkbench";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function DetectPage() {
  return (
    <div className="site-shell">
      <Header />
      <DetectionAuthGate>
        <DetectionWorkbench />
      </DetectionAuthGate>
      <Footer />
    </div>
  );
}
