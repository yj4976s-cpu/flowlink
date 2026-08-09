import type { Metadata } from "next";
import { Icon } from "@/components/common/Icon";
import { GuideFlow, type GuideStep } from "@/components/guide/GuideFlow";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export const metadata: Metadata = {
  title: "이용 안내 | FlowLink",
  description: "시민과 관리자를 위한 FlowLink 발견물 매칭 및 반환 이용 절차",
};

const citizenSteps: GuideStep[] = [
  { label: "발견물 검색", description: "공개된 발견물 목록에서 종류, 색상, 위치 구역을 확인합니다.", icon: "scan" },
  { label: "분실 신고", description: "잃어버린 물품의 특징과 사진, 분실 추정 위치와 시간을 등록합니다.", icon: "document" },
  { label: "자동 매칭 결과 확인", description: "신고 내용과 발견물 후보의 유사도를 참고해 다음 행동을 정합니다.", icon: "match" },
  { label: "소유권 확인 요청", description: "본인 물품일 가능성이 있으면 비공개 특징으로 확인을 요청합니다.", icon: "spark" },
  { label: "관리자 확인", description: "관리자가 요청 정보와 보관 상태를 함께 검토합니다.", icon: "check" },
  { label: "반환", description: "승인 후 안내된 절차에 따라 안전하게 물품을 돌려받습니다.", icon: "return" },
];

const managerSteps: GuideStep[] = [
  { label: "AI 탐지", description: "AI가 수면 위 부유 객체를 감지하고 발견물 후보를 생성합니다.", icon: "scan" },
  { label: "객체 검토·분류", description: "관리자가 탐지 결과를 확인하고 폐기물과 개인 물품 후보를 분류합니다.", icon: "cube" },
  { label: "회수", description: "현장 상황과 안전을 고려해 발견물 후보를 회수합니다.", icon: "return" },
  { label: "발견물 공개", description: "민감한 정보와 정확한 보관 장소를 제외한 발견물 정보를 공개합니다.", icon: "spark" },
  { label: "소유권 요청 검토", description: "시민의 신고 내용과 비공개 특징을 비교해 요청을 검토합니다.", icon: "document" },
  { label: "승인·거절", description: "동일 물품 가능성과 검증 정보를 바탕으로 반환 여부를 결정합니다.", icon: "check" },
  { label: "반환 완료", description: "반환이 끝난 물품은 처리 상태를 완료로 기록합니다.", icon: "return" },
];

export default function GuidePage() {
  return (
    <div className="site-shell">
      <Header />
      <main className="info-page guide-page">
        <header className="info-hero guide-hero">
          <div className="guide-hero-copy">
            <p className="info-eyebrow">USER GUIDE</p>
            <h1>이용 안내</h1>
            <p>분실 신고부터<br />안전한 반환까지</p>
            <span>분실 신고와 발견물 처리가 서로 어긋나지 않도록, 시민과 관리자의 다음 행동을 한눈에 정리했습니다.</span>
          </div>

          <div className="guide-hero-visual" aria-label="발견물 검색, 자동 매칭, 안전한 반환으로 이어지는 FlowLink 이용 과정">
            <div className="guide-visual-water" aria-hidden="true" />
            <div className="guide-visual-step">
              <span><Icon name="scan" size={24} /></span>
              <small>01</small>
              <strong>발견물 검색</strong>
            </div>
            <Icon name="arrow" size={18} />
            <div className="guide-visual-step is-center">
              <span><Icon name="match" size={24} /></span>
              <small>02</small>
              <strong>자동 매칭</strong>
            </div>
            <Icon name="arrow" size={18} />
            <div className="guide-visual-step">
              <span><Icon name="return" size={24} /></span>
              <small>03</small>
              <strong>안전한 반환</strong>
            </div>
          </div>
        </header>

        <GuideFlow eyebrow="FOR CITIZENS" title="시민 이용 절차" titleId="citizen-guide" steps={citizenSteps} />
        <GuideFlow eyebrow="FOR MANAGERS" title="관리자 처리 절차" titleId="manager-guide" steps={managerSteps} />

        <aside className="info-notice guide-notice" aria-labelledby="guide-notice">
          <div className="info-notice-icon"><span aria-hidden="true">!</span></div>
          <div>
            <h2 id="guide-notice">이용 전 확인해 주세요</h2>
            <ul>
              <li>자동 매칭 점수는 동일 물품을 확정하는 결과가 아니라 판단을 돕는 참고 정보입니다.</li>
              <li>발견 위치는 개인정보와 보관 안전을 위해 대략적인 구역만 공개될 수 있습니다.</li>
              <li>정확한 보관 장소와 소유권 검증에 사용하는 정보는 공개하지 않습니다.</li>
            </ul>
          </div>
        </aside>
      </main>
      <Footer />
    </div>
  );
}
