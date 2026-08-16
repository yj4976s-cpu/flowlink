import { notFound } from "next/navigation";
import { DaruWalkPreview } from "@/components/mascot/DaruWalkPreview";

export default function DaruWalkPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DaruWalkPreview />;
}
