import Link from "next/link";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function LoginPage() {
  return (
    <div className="site-shell">
      <Header />
      <main className="placeholder-page">
        <section className="placeholder-card" aria-labelledby="page-title">
          <p className="placeholder-eyebrow">FLOWLINK</p>
          <h1 id="page-title">로그인</h1>
          <p className="placeholder-description">FlowLink 계정으로 서비스를 이용하기 위한 로그인 화면입니다.</p>
          <p className="placeholder-status">현재 기능을 준비하고 있습니다.</p>
          <Link className="button button-primary" href="/">메인으로 돌아가기</Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
