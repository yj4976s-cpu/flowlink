"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/common/Icon";

const flowSteps: { label: string; icon: IconName }[] = [
  { label: "개인 물품 후보 탐지", icon: "scan" },
  { label: "관리자 확인", icon: "check" },
  { label: "발견물 공개", icon: "cube" },
  { label: "시민 분실 신고", icon: "document" },
  { label: "자동 매칭", icon: "match" },
  { label: "소유권 확인", icon: "spark" },
  { label: "반환", icon: "return" },
];

export function ServiceFlow() {
  const [activeStep, setActiveStep] = useState(0);

  const showNextStep = () => {
    setActiveStep((current) => (current + 1) % flowSteps.length);
  };

  return (
    <section className="info-section service-flow" aria-labelledby="service-flow-title">
      <div className="service-flow-heading">
        <div className="info-section-heading">
          <p>HOW IT WORKS</p>
          <h2 id="service-flow-title">전체 서비스 흐름</h2>
        </div>
        <button type="button" className="flow-next" onClick={showNextStep} aria-label="다음 서비스 단계 보기">
          <span>{activeStep + 1} / {flowSteps.length}</span>
          <Icon name="arrow" size={20} />
        </button>
      </div>

      <ol className="info-steps info-steps-flow">
        {flowSteps.map((step, index) => (
          <li key={step.label} className={index === activeStep ? "is-active" : undefined} aria-current={index === activeStep ? "step" : undefined}>
            <span className="flow-step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="info-step-icon"><Icon name={step.icon} size={22} /></span>
            <strong>{step.label}</strong>
            {index < flowSteps.length - 1 && <span className="flow-connector" aria-hidden="true"><Icon name="arrow" size={16} /></span>}
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="polite">현재 단계: {flowSteps[activeStep].label}</p>
    </section>
  );
}
