import { DetectionAuthGate } from "@/components/detection/DetectionAuthGate";
import { DetectionWorkbench } from "@/components/detection/DetectionWorkbench";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

type DetectPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DetectPage({ searchParams }: DetectPageProps) {
  const params = await searchParams;
  const mode = Array.isArray(params?.mode) ? params?.mode[0] : params?.mode;

  return (
    <div className="site-shell">
      <Header />
      <DetectionAuthGate>
        <DetectionWorkbench initialTab={mode === "camera" ? "webcam" : "image"} />
      </DetectionAuthGate>
      <Footer />
    </div>
  );
}
