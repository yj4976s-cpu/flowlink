"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { Icon, type IconName } from "@/components/common/Icon";

export type GuideStep = {
  label: string;
  description: string;
  icon: IconName;
};

type GuideFlowProps = {
  eyebrow: string;
  title: string;
  titleId: string;
  steps: readonly GuideStep[];
};

export function GuideFlow({ eyebrow, title, titleId, steps }: GuideFlowProps) {
  const [activeStep, setActiveStep] = useState(0);
  const active = steps[activeStep];
  const stepCountStyle = { "--guide-step-count": steps.length } as CSSProperties;

  const showNextStep = () => {
    setActiveStep((current) => (current + 1) % steps.length);
  };

  return (
    <section className="info-section guide-flow" aria-labelledby={titleId}>
      <div className="service-flow-heading">
        <div className="info-section-heading">
          <p>{eyebrow}</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button type="button" className="flow-next" onClick={showNextStep} aria-label={`${title} 다음 단계 보기`}>
          <span>{activeStep + 1} / {steps.length}</span>
          <Icon name="arrow" size={20} />
        </button>
      </div>

      <div className="guide-flow-panel">
        <ol className="guide-flow-list" style={stepCountStyle}>
          {steps.map((step, index) => (
            <li key={step.label} className={index === activeStep ? "is-active" : undefined} aria-current={index === activeStep ? "step" : undefined}>
              <span className="flow-step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className="guide-step-icon"><Icon name={step.icon} size={22} /></span>
              <strong>{step.label}</strong>
              {index < steps.length - 1 && <span className="guide-flow-arrow" aria-hidden="true"><Icon name="arrow" size={16} /></span>}
            </li>
          ))}
        </ol>

        <div className="guide-flow-detail" aria-live="polite">
          <span>{String(activeStep + 1).padStart(2, "0")}</span>
          <div>
            <strong>{active.label}</strong>
            <p>{active.description}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
