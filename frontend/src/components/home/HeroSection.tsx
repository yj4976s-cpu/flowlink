import { Icon } from "@/components/common/Icon";
import { DetectionScene } from "./DetectionScene";

function RiversideLineArt() {
  return <svg className="riverside-line-art" viewBox="0 0 480 165" aria-hidden="true">
    <g className="line-trees">
      <path d="M5 72c-2-9 3-17 10-17 2-10 14-11 18-2 8-5 17 1 16 10 8-3 16 3 14 11M18 73V57m-7 16 7-7 8 7m20 1V61m-6 7 6-5 7 7M64 74c-2-8 3-15 9-15 3-9 14-9 17-1 8-3 15 3 13 12" />
      <path d="M351 72c-2-9 3-17 10-17 2-10 14-11 18-2 8-5 17 1 16 10 8-3 16 3 14 11m-47-1V57m-7 16 7-7 8 7m22 1V60m-7 9 7-6 8 8m8 3c-1-8 4-14 10-14 3-9 14-9 17 0 8-3 15 3 13 12m-21 2V61m25 13V65" />
    </g>
    <g className="line-city">
      <path d="M102 72V59h10v13m5 0V48h12v24m5 0V55h9v17m5 0V39h14v33m5 0V22h15v50m6 0V44h13v28m6 0V31h13v41m6 0V10h17v62m7 0V36h13v36m6 0V48h11v24m6 0V27h14v45m6 0V53h12v19m6 0V43h15v29m6 0V57h11v15m6 0V49h12v23" />
      <path d="M171 22h7m35-12h8m-106 49h8m132-31h8m26 16h8" />
    </g>
    <g className="line-bridge">
      <path d="M43 69c35-2 70-2 105 0 42 3 84 3 126 0M43 75c38-1 73 0 108 2 42 2 83 2 124-2" />
      <path d="M52 74c20-29 49-29 70 0m3 0c21-28 53-28 75 0m3 0c19-23 45-23 64 0" />
      <path d="M52 69v15m71-15v16m78-16v16m67-16v14M43 82h233" />
    </g>
    <g className="line-banks">
      <path d="M0 82c43-5 84-3 122 3 45 7 82 9 116 5 44-6 90-10 139-8 34 1 68 4 103 8" />
      <path d="M0 91c50 2 91 7 127 15 31 7 60 10 86 10M480 96c-47 2-88 8-123 17-27 7-53 11-78 12" />
    </g>
    <g className="line-currents">
      <path d="M15 101c52 2 94 9 128 20 34 11 63 15 88 13 29-2 58-11 91-22 39-13 83-16 143-12" />
      <path d="M7 111c48 3 87 10 120 21 37 13 70 19 100 18 34-1 68-12 106-24 39-12 82-15 134-11" />
      <path d="M23 124c43 2 78 8 110 18 38 12 74 18 107 17 37-2 73-13 112-24 32-9 67-12 105-10" />
      <path d="M54 140c37 0 70 5 101 13m170-5c37-10 73-13 108-11" />
      <path d="M169 94c-26 15-54 27-86 37m109-34c-19 17-40 31-65 43m89-39c-12 17-26 33-44 49m72-48c-3 18-8 36-17 55m44-54c7 18 12 36 15 54m11-59c15 17 28 34 38 50m-16-57c24 15 45 30 62 45" />
    </g>
    <g className="line-ripples">
      <path d="M49 98c28 1 54 5 78 12m-55 3c25 2 48 7 69 14m192-19c27-7 55-10 85-8m-67 20c25-7 50-9 75-7" />
      <path d="M181 105c22 5 43 7 63 7 24 0 48-3 73-9m-151 17c29 7 57 10 84 9 29-1 58-5 88-14m-185 21c36 9 70 13 102 12 34-1 68-7 103-18" />
    </g>
  </svg>;
}

export function HeroSection() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-inner">
        <div className="hero-copy">
          <p className="eyebrow"><Icon name="scan" size={18} /> AI 기반 수변 부유 객체 탐지</p>
          <h1 id="hero-title">
            <span className="theme-copy theme-copy-day">흐름을 따라,<br />다시 <em>연결</em>되는 순간</span>
            <span className="theme-copy theme-copy-night">밤의 흐름 속에서도,<br />놓치지 않는 <em>연결</em></span>
          </h1>
          <div className="title-rule" aria-hidden="true"><i /></div>
          <p className="hero-description">
            <span className="theme-copy theme-copy-day">강과 호수, 바다의 흐름을 읽어 소중한 물건이 다시 제자리로 돌아가도록 FlowLink가 연결합니다.</span>
            <span className="theme-copy theme-copy-night">AI가 수면의 흐름을 분석하고, 발견부터 매칭까지 안전하게 이어갑니다.</span>
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#recent-items">발견물 찾기 <Icon name="arrow" size={18} /></a>
            <a className="button button-secondary" href="#process">서비스 소개 보기</a>
          </div>
          <RiversideLineArt />
        </div>
        <DetectionScene />
      </div>
    </section>
  );
}
