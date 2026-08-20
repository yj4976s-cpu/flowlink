import { Icon } from "@/components/common/Icon";
import type { ObjectKind } from "@/types/home";
import { ObjectIllustration } from "./ObjectIllustration";

const detections: { kind: ObjectKind; label: string; confidence: number; className: string }[] = [
  { kind: "backpack", label: "가방", confidence: 92, className: "detection-backpack" },
  { kind: "umbrella", label: "우산", confidence: 88, className: "detection-umbrella" },
  { kind: "branch", label: "나뭇가지", confidence: 81, className: "detection-branch" },
];

function DetectionCard({ kind, label, confidence, className }: (typeof detections)[number]) {
  return (
    <article className={`detection-card ${className}`} aria-label={`${label}, 탐지 신뢰도 ${confidence}%`}>
      <div className="detection-copy">
        <span>{label}</span><strong>신뢰도 {confidence}%</strong><i aria-hidden="true" />
      </div>
      <ObjectIllustration kind={kind} />
      <div className="ripple" aria-hidden="true"><i /><i /><i /></div>
    </article>
  );
}

export function DetectionScene() {
  return (
    <div className="detection-scene" aria-label="AI가 수변의 가방, 우산, 나뭇가지를 탐지하는 일러스트">
      <div className="scene-sky" aria-hidden="true"><i className="moon" /><i className="cloud cloud-one" /><i className="cloud cloud-two" /></div>
      <svg className="scene-city" viewBox="0 0 1000 250" preserveAspectRatio="none" aria-hidden="true">
        <path className="city-back" d="M0 205h28v-31h24v31h35v-55h29v55h38v-30h45v30h35v-72h25v72h36v-41h32v41h39v-26h31v26h48v-59h30v59h36v-35h29v35h44v-62h25v62h53v-28h38v28h48v-48h28v48h42v-30h37v30h65v45H0Z" />
        <path className="city-shape" d="M0 205h45v-38h27v38h32v-85h35v85h28v-52h44v52h34V90h21v-35h21v150h42v-74h31v74h35v-41h27v41h53v-96h25v96h36v-59h30v59h40v-30h49v30h47v-80h28v80h42v-48h36v48h41v-23h55v23h70v45H0Z" />
        <path className="bridge-line" d="M160 202c140-80 270-80 405 0m-405 0h405M235 166v36m92-62v62m91-58v58m87-34v34" />
        <g className="city-windows"><path d="M118 141h8m-8 14h8m38 17h9m92-87h9m-9 17h9m88 50h8m92-26h8m108 16h8m110-31h8m72 42h8" /></g>
        <g className="city-lights"><path d="M254 79v10m17-14v12m188 63v10m112-37v12m173 60v8m63-50v10" /></g>
      </svg>
      <svg className="scene-reflections" viewBox="0 0 1000 360" preserveAspectRatio="none" aria-hidden="true">
        <path d="M92 5 54 330M132 5l-8 288M258 0l-38 344M285 0l27 320M475 8l-24 300M583 0l42 337M735 0l-19 292M855 0l38 318" />
        <path className="reflection-warm" d="M250 0l-8 296M282 0l26 315M579 0l44 306M850 0l40 270" />
      </svg>
      <div className="promenade" aria-hidden="true"><i /><i /><i /><span /><span /></div>
      <div className="water-lines" aria-hidden="true" />
      <div className="water-sparkles" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      <svg className="detection-path" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M1 1 9 5 1 9Z" className="flow-arrow-head" />
          </marker>
        </defs>
        <g className="scan-rings">
          <ellipse cx="490" cy="441" rx="86" ry="27" />
          <ellipse cx="490" cy="441" rx="62" ry="19" />
          <ellipse cx="490" cy="441" rx="40" ry="12" />
          <g className="umbrella-scan">
            <ellipse cx="665" cy="317" rx="76" ry="24" />
            <ellipse cx="665" cy="317" rx="54" ry="17" />
            <ellipse cx="665" cy="317" rx="31" ry="10" />
          </g>
          <ellipse cx="785" cy="427" rx="88" ry="27" />
          <ellipse cx="785" cy="427" rx="62" ry="19" />
          <ellipse cx="785" cy="427" rx="38" ry="11" />
        </g>
        <g className="flow-lines flow-lines-day">
          <path className="flow-halo" d="M490 407C548 342 610 350 665 317S724 365 785 399" />
          <path className="flow-main" d="M490 407C548 342 610 350 665 317S724 365 785 399" markerEnd="url(#flow-arrow)" />
          <path className="flow-secondary" d="M490 420C565 475 685 472 785 409" markerEnd="url(#flow-arrow)" />
          <path className="flow-thread flow-thread-one" d="M487 392C543 322 608 330 665 303S735 345 789 388" markerEnd="url(#flow-arrow)" />
          <path className="flow-thread flow-thread-two" d="M493 435C578 493 699 479 793 417" markerEnd="url(#flow-arrow)" />
          <g className="flow-arrows">
            <path d="m548 351 9 3-7 6" /><path d="m603 338 9 2-7 7" /><path d="m704 337 8 5-9 4" /><path d="m741 374 9 4-8 5" />
            <path d="m564 457 9 4-8 5" /><path d="m632 472 9 2-8 6" /><path d="m704 459 9-1-6 8" />
          </g>
          <g className="flow-particles">
            <circle r="3"><animateMotion dur="5.8s" repeatCount="indefinite" path="M490 407C548 342 610 350 665 317S724 365 785 399" /></circle>
            <circle r="2.5"><animateMotion dur="7.2s" begin="-2.4s" repeatCount="indefinite" path="M490 420C565 475 685 472 785 409" /></circle>
            <circle r="2"><animateMotion dur="6.4s" begin="-4s" repeatCount="indefinite" path="M487 392C543 322 608 330 665 303S735 345 789 388" /></circle>
            <circle className="flow-spark" r="1.7"><animateMotion dur="8.6s" begin="-1.2s" repeatCount="indefinite" path="M490 407C548 342 610 350 665 317S724 365 785 399" /></circle>
            <circle className="flow-spark" r="1.5"><animateMotion dur="9.4s" begin="-5s" repeatCount="indefinite" path="M493 435C578 493 699 479 793 417" /></circle>
            <circle className="flow-spark" r="1.4"><animateMotion dur="7.8s" begin="-3.3s" repeatCount="indefinite" path="M487 392C543 322 608 330 665 303S735 345 789 388" /></circle>
          </g>
        </g>
        <g className="flow-lines flow-lines-night">
          <path className="flow-halo" d="M490 407C568 350 650 363 735 329S755 365 785 399" />
          <path className="flow-main" d="M490 407C568 350 650 363 735 329S755 365 785 399" markerEnd="url(#flow-arrow)" />
          <path className="flow-secondary" d="M490 420C585 474 705 468 785 409" markerEnd="url(#flow-arrow)" />
          <path className="flow-thread flow-thread-one" d="M487 392C555 330 650 342 735 314S764 352 789 388" markerEnd="url(#flow-arrow)" />
          <path className="flow-thread flow-thread-two" d="M493 435C592 492 718 474 793 417" markerEnd="url(#flow-arrow)" />
          <g className="flow-arrows">
            <path d="m565 357 9 3-7 6" /><path d="m642 354 9 2-7 7" /><path d="m716 332 8 5-9 4" /><path d="m760 374 9 4-8 5" />
            <path d="m575 456 9 4-8 5" /><path d="m650 470 9 2-8 6" /><path d="m724 458 9-1-6 8" />
          </g>
          <g className="flow-particles">
            <circle r="2.7"><animateMotion dur="6.2s" repeatCount="indefinite" path="M490 407C568 350 650 363 735 329S755 365 785 399" /></circle>
            <circle r="2.3"><animateMotion dur="7.6s" begin="-2.4s" repeatCount="indefinite" path="M490 420C585 474 705 468 785 409" /></circle>
            <circle r="1.9"><animateMotion dur="6.8s" begin="-4s" repeatCount="indefinite" path="M487 392C555 330 650 342 735 314S764 352 789 388" /></circle>
            <circle className="flow-spark" r="1.5"><animateMotion dur="8.8s" begin="-1.2s" repeatCount="indefinite" path="M490 407C568 350 650 363 735 329S755 365 785 399" /></circle>
            <circle className="flow-spark" r="1.4"><animateMotion dur="9.6s" begin="-5s" repeatCount="indefinite" path="M493 435C592 492 718 474 793 417" /></circle>
            <circle className="flow-spark" r="1.3"><animateMotion dur="8s" begin="-3.3s" repeatCount="indefinite" path="M487 392C555 330 650 342 735 314S764 352 789 388" /></circle>
          </g>
        </g>
        <circle className="flow-node node-large" cx="490" cy="425" r="4" />
        <circle className="flow-node" cx="574" cy="352" r="3" />
        <circle className="flow-node node-large umbrella-node" cx="665" cy="317" r="4" />
        <circle className="flow-node" cx="724" cy="365" r="3" />
        <circle className="flow-node node-large" cx="785" cy="411" r="4" />
      </svg>
      {detections.map((detection) => <DetectionCard key={detection.label} {...detection} />)}
      <div className="live-card">
        <span className="live-icon"><Icon name="scan" size={27} /></span>
        <span><strong>AI 탐지 흐름</strong><small>한강 잠실 지역</small></span>
        <b><i /> LIVE</b>
      </div>
    </div>
  );
}
