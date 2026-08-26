import { notFound } from "next/navigation";
import { DaruMemoryDevLab } from "@/components/daru-game/dev/DaruMemoryDevLab";

export default function DaruMemoryDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DaruMemoryDevLab />;
}
