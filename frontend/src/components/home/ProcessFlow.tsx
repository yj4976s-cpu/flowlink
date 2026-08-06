import { Icon, type IconName } from "@/components/common/Icon";

const steps: { title: string; description: string; icon: IconName }[] = [
  { title: "탐지", icon: "scan", description: "업로드된 이미지와 영상에서 수변 부유 객체를 탐지합니다." },
  { title: "분류", icon: "cube", description: "물체 유형과 주요 특징을 분석해 데이터로 분류합니다." },
  { title: "매칭", icon: "match", description: "분실 신고 정보와 AI 분석을 기반으로 매칭합니다." },
  { title: "반환", icon: "return", description: "소유자 확인 후 안전하게 물건을 반환합니다." },
];

export function ProcessFlow() {
  return (
    <section className="section process-section" id="process" aria-labelledby="process-title">
      <div className="section-heading process-heading">
        <p>OUR PROCESS</p>
        <h2 id="process-title">발견에서 반환까지,<br />4단계 흐름</h2>
      </div>
      <div className="process-list">
        {steps.map((step, index) => (
          <div className="process-unit" key={step.title}>
            <article className={`process-card step-${index + 1}`}>
              <span className="process-icon"><Icon name={step.icon} size={32} /></span>
              <div><h3><b>{String(index + 1).padStart(2, "0")}</b> {step.title}</h3><p>{step.description}</p></div>
            </article>
            {index < steps.length - 1 && <span className="process-arrow" aria-hidden="true">›</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
