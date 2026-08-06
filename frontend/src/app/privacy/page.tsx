import Link from "next/link";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function PrivacyPage() {
  return (
    <div className="site-shell">
      <Header />
      <main className="placeholder-page">
        <section className="placeholder-card" aria-labelledby="page-title">
          <p className="placeholder-eyebrow">FLOWLINK</p>
          <h1 id="page-title">개인정보처리방침</h1>
          <p className="placeholder-description">서비스 개인정보 처리 기준을 안내하는 화면입니다.</p>
          <p className="placeholder-status">현재 기능을 준비하고 있습니다.</p>
          <Link className="button button-primary" href="/">메인으로 돌아가기</Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
