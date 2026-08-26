import type { Metadata } from "next";
import { DaruGame } from "@/components/daru-game/DaruGame";
import { Header } from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "다루 놀이터 | FlowLink",
  description: "다루와 FlowLink 탐지 물품의 같은 그림을 찾아 맞추는 기억력 게임",
};

export default function DaruGamePage() {
  return (
    <div className="site-shell">
      <Header />
      <main>
        <DaruGame />
      </main>
    </div>
  );
}
