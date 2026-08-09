import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ServiceFlow } from "@/components/about/ServiceFlow";
import { Icon } from "@/components/common/Icon";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "서비스 소개 | FlowLink",
  description: "AI 수면 부유 객체 탐지부터 분실물 반환까지 연결하는 FlowLink 소개",
};

export default function AboutPage() {
  return (
    <div className="site-shell">
      <Header />
      <main className="info-page about-page">
        <header className="about-hero">
          <Image
            src="/flowlink-about-hero.png"
            alt="도심 하천에서 AI 카메라가 수면 위 가방과 우산을 탐지하고 관리자가 확인하는 모습"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1180px"
          />
          <div className="about-hero-overlay" />
          <div className="about-hero-copy">
            <p className="info-eyebrow">ABOUT FLOWLINK</p>
            <h1>수면 위 발견에서<br />시민의 일상으로</h1>
            <p>AI가 발견한 작은 단서를 시민의 분실 신고와 연결해, 확인부터 회수와 반환까지 이어갑니다.</p>
            <div className="about-hero-actions">
              <Link className="button button-primary" href="/found-items">발견물 살펴보기 <Icon name="arrow" size={18} /></Link>
              <Link className="about-text-link" href="/guide">이용 방법 알아보기 <Icon name="arrow" size={16} /></Link>
            </div>
          </div>
          <div className="about-hero-status" aria-label="FlowLink 지원 영역">
            <span><Icon name="scan" size={17} /> AI 후보 탐지</span>
            <span><Icon name="match" size={17} /> 신고 자동 매칭</span>
            <span><Icon name="return" size={17} /> 안전한 반환</span>
          </div>
        </header>

        <section className="about-intro" aria-labelledby="about-intro-title">
          <p className="info-eyebrow">A BETTER CONNECTION</p>
          <h2 id="about-intro-title">물 위에서 놓친 물건도<br />다시 주인에게 닿을 수 있도록</h2>
          <p>FlowLink는 AI가 수면 위 폐기물과 개인 물품 후보를 탐지하고, 시민의 분실 신고와 연결하여 관리자 확인·회수·반환까지 지원하는 서비스입니다.</p>
        </section>

        <section className="info-feature-grid" aria-label="FlowLink 핵심 기능">
          <article className="info-feature-card">
            <div className="info-feature-icon"><Icon name="scan" size={28} /></div>
            <p>01 · DETECT</p>
            <h2>AI 수면 부유 객체 탐지</h2>
            <p>수면 영상에서 부유 객체를 탐지하고 폐기물과 개인 물품일 가능성이 있는 후보를 구분해 관리자의 검토를 돕습니다.</p>
          </article>
          <article className="info-feature-card">
            <div className="info-feature-icon"><Icon name="match" size={28} /></div>
            <p>02 · CONNECT</p>
            <h2>발견물과 분실 신고 연결</h2>
            <p>발견물의 종류, 색상, 위치와 시간 등의 정보를 시민이 작성한 분실 신고와 비교해 확인할 후보를 제시합니다.</p>
          </article>
        </section>

        <ServiceFlow />

        <aside className="info-notice info-notice-accent" aria-labelledby="ai-boundary">
          <div className="info-notice-icon"><Icon name="spark" size={30} /></div>
          <div><p className="info-eyebrow">HUMAN IN THE LOOP</p><h2 id="ai-boundary">AI는 연결을 돕고, 사람은 최종 확인합니다</h2>
          <p>AI는 물품의 실제 소유자를 확정하지 않습니다. 객체 후보 탐지와 발견물·분실 신고 간 매칭을 보조하며, 최종 소유권 확인과 반환은 관리자의 검토를 거칩니다.</p></div>
        </aside>
      </main>
      <Footer />
    </div>
  );
}
