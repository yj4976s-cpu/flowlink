import type { Metadata } from "next";
import { Icon } from "@/components/common/Icon";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "이용약관 | FlowLink",
  description: "FlowLink 프로젝트 서비스 이용 기준 안내",
};

export default function TermsPage() {
  return (
    <div className="site-shell">
      <Header />
      <main className="info-page info-document terms-page">
        <header className="info-hero document-hero">
          <div className="document-hero-icon"><Icon name="document" size={30} /></div>
          <div><p className="info-eyebrow">TERMS OF USE</p>
          <h1>이용약관</h1>
          <p>서로의 물건과 정보를 존중하며 FlowLink를 이용하기 위한 약속입니다.</p></div>
        </header>

        <article className="document-card">
          <section>
            <h2>1. 서비스 목적</h2>
            <p>FlowLink는 수면 위 객체 탐지와 분실 신고의 연결을 통해 발견물의 확인, 회수와 반환 절차를 지원하는 프로젝트 서비스입니다.</p>
          </section>
          <section>
            <h2>2. 회원 계정 관리</h2>
            <p>회원은 정확한 정보로 계정을 이용하고 자신의 로그인 정보를 안전하게 관리해야 합니다. 계정을 타인에게 양도하거나 타인의 계정을 사용해서는 안 됩니다.</p>
          </section>
          <section>
            <h2>3. 올바른 신고와 소유권 요청</h2>
            <p>허위로 분실 신고를 작성하거나 타인의 물품에 대해 부정한 소유권 확인을 요청해서는 안 됩니다. 서비스 운영과 다른 이용자의 권리를 해치는 요청은 제한될 수 있습니다.</p>
          </section>
          <section>
            <h2>4. AI와 자동 매칭의 범위</h2>
            <p>AI 탐지와 자동 매칭 결과는 확인을 돕는 참고 정보이며, 동일 물품 또는 실제 소유자를 확정하지 않습니다. 최종 소유권 확인은 제출 정보와 비공개 특징 등을 바탕으로 한 관리자의 검토를 거칩니다.</p>
          </section>
          <section>
            <h2>5. 서비스 변경과 제한</h2>
            <p>프로젝트 진행 상황, 기술적 점검 또는 운영상 필요에 따라 일부 기능이 변경되거나 제한될 수 있습니다. 중요한 변경은 서비스 화면 등 적절한 방법으로 안내합니다.</p>
          </section>
          <aside className="document-note">
            <strong>프로젝트 단계 안내</strong>
            <p>이 약관은 현재 FlowLink 프로젝트·데모 단계의 이용 기준입니다. 실제 상용 운영 시 서비스 내용과 적용 환경에 맞게 별도로 검토하고 갱신해야 합니다.</p>
          </aside>
        </article>
      </main>
      <Footer />
    </div>
  );
}
