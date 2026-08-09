import type { Metadata } from "next";
import { Icon } from "@/components/common/Icon";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "개인정보처리방침 | FlowLink",
  description: "FlowLink 프로젝트의 개인정보 처리 기준 안내",
};

export default function PrivacyPage() {
  return (
    <div className="site-shell">
      <Header />
      <main className="info-page info-document privacy-page">
        <header className="info-hero document-hero">
          <div className="document-hero-icon"><Icon name="check" size={30} /></div>
          <div><p className="info-eyebrow">PRIVACY POLICY</p>
          <h1>개인정보처리방침</h1>
          <p>소중한 정보가 어디에 쓰이고, 무엇을 공개하지 않는지 알기 쉽게 안내합니다.</p></div>
        </header>

        <article className="document-card">
          <section aria-labelledby="privacy-data">
            <h2 id="privacy-data">1. 처리하는 정보</h2>
            <p>회원 가입과 서비스 이용 과정에서 다음 정보를 처리합니다.</p>
            <ul>
              <li><strong>회원 정보:</strong> 이메일, 닉네임, 비밀번호 해시, 약관 및 개인정보 처리 동의 시각</li>
              <li><strong>분실 신고 정보:</strong> 물품 종류, 색상, 특징, 분실 추정 위치와 시간, 사용자가 첨부한 사진</li>
            </ul>
            <p>비밀번호 원문은 저장하지 않으며, 복원할 수 없는 해시 형태로 처리합니다.</p>
          </section>

          <section aria-labelledby="privacy-purpose">
            <h2 id="privacy-purpose">2. 이용 목적</h2>
            <p>수집한 정보는 회원 식별, 분실 신고 처리, 발견물 매칭, 소유권 확인 및 서비스 운영을 위해 이용합니다.</p>
          </section>

          <section aria-labelledby="privacy-disclosure">
            <h2 id="privacy-disclosure">3. 공개 범위</h2>
            <p>발견물 정보가 공개되더라도 다음 정보는 시민에게 공개하지 않습니다.</p>
            <ul>
              <li>신고자의 이메일</li>
              <li>발견물의 정확한 보관 장소</li>
              <li>관리자 메모</li>
              <li>소유권 검증에 사용하는 비공개 특징</li>
            </ul>
          </section>

          <section aria-labelledby="privacy-withdrawal">
            <h2 id="privacy-withdrawal">4. 회원 탈퇴와 정보 처리</h2>
            <p>회원은 탈퇴를 요청할 수 있습니다. 탈퇴가 처리되면 계정 정보는 서비스에서 더 이상 이용하지 않으며 삭제를 원칙으로 합니다. 다만 진행 중인 분실 신고, 소유권 확인 또는 반환 절차가 있다면 해당 처리의 종료와 데이터 정합성 확인이 먼저 필요할 수 있습니다.</p>
          </section>

          <aside className="document-note" aria-label="정책 적용 범위 안내">
            <strong>프로젝트 단계 안내</strong>
            <p>이 방침은 현재 FlowLink 프로젝트·데모 단계의 정책입니다. 실제 상용 서비스 운영 시 서비스 구조와 적용 법령에 맞춘 별도의 개인정보 및 법률 검토가 필요합니다.</p>
          </aside>
        </article>
      </main>
      <Footer />
    </div>
  );
}
