"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DaruSpriteRenderer } from "./DaruSpriteRenderer";
import { LayeredDaruRenderer } from "./LayeredDaruRenderer";
import type { DaruRendererState } from "./daru.animation.adapter";
import type { DaruFacing } from "./daru.renderer.config";
import { DARU_SPRITE_CONFIG } from "./daru.sprite.config";
import type { DaruRhythm } from "./types";
import styles from "./DaruWalkPreview.module.css";

type PreviewRenderer = "layered" | "sprite";

const CADENCE_CANDIDATES = [
  { id: "A", cycleDurationMs: 538 },
  { id: "B", cycleDurationMs: 620 },
  { id: "C", cycleDurationMs: 650 },
] as const;
const NORMAL_CADENCE = CADENCE_CANDIDATES[1];

type CadenceCandidate = (typeof CADENCE_CANDIDATES)[number]["id"];

function speedForCycle(cycleDurationMs: number) {
  return DARU_SPRITE_CONFIG.stridePx / (cycleDurationMs / 1000);
}

export function DaruWalkPreview() {
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(speedForCycle(CADENCE_CANDIDATES[0].cycleDurationMs));
  const [cadence, setCadence] = useState<CadenceCandidate>("A");
  const [x, setX] = useState(0);
  const [facing, setFacing] = useState<DaruFacing>("right");
  const [locomotion, setLocomotion] = useState<DaruRendererState["locomotion"]>("idle");
  const [renderer, setRenderer] = useState<PreviewRenderer>("sprite");
  const [theme, setTheme] = useState<DaruRhythm>("day");
  const directionRef = useRef<DaruFacing>("right");

  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    const timers: number[] = [];
    const legDistance = 420;
    const duration = (legDistance / speed) * 1000;
    const runLeg = () => {
      if (cancelled) return;
      const direction = directionRef.current;
      setFacing(direction);
      setLocomotion("start_walk");
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        setLocomotion("walk");
        setX(direction === "right" ? legDistance : 0);
      }, 120));
      timers.push(window.setTimeout(() => {
        if (cancelled) return;
        setLocomotion("stop_walk");
        timers.push(window.setTimeout(() => {
          if (cancelled) return;
          setLocomotion("idle");
          directionRef.current = direction === "right" ? "left" : "right";
          timers.push(window.setTimeout(runLeg, 680));
        }, 220));
      }, duration + 120));
    };
    runLeg();
    return () => { cancelled = true; timers.forEach(window.clearTimeout); };
  }, [playing, speed]);

  const state = useMemo<DaruRendererState>(() => ({
    locomotion, behavior: "normal", interaction: "none", facing,
    movementSpeed: speed / speedForCycle(NORMAL_CADENCE.cycleDurationMs), dragging: false, reducedMotion: false,
    lookX: 0, lookY: 0, tailEnergy: 0.5,
  }), [facing, locomotion, speed]);

  const restartFacing = (nextFacing: DaruFacing) => {
    setPlaying(false);
    setLocomotion("idle");
    directionRef.current = nextFacing;
    setFacing(nextFacing);
    setX(nextFacing === "right" ? 0 : 420);
    window.setTimeout(() => setPlaying(true), 50);
  };
  const selectCadence = (candidate: (typeof CADENCE_CANDIDATES)[number]) => {
    setCadence(candidate.id);
    setSpeed(speedForCycle(candidate.cycleDurationMs));
  };
  const duration = (420 / speed) * 1000;
  const cycleDuration = (DARU_SPRITE_CONFIG.stridePx / speed) * 1000;
  const moving = locomotion === "walk" || locomotion === "start_walk";
  const idleSrc = `/mascot/daru-idle-${theme}.png`;

  return (
    <main className={styles.page}>
      <header><p>Development preview</p><h1>다루 WALK A/B Preview</h1><span>{speed}px/s · {cycleDuration.toFixed(0)}ms/cycle · {(8000 / cycleDuration).toFixed(1)}fps · stride {DARU_SPRITE_CONFIG.stridePx}px</span></header>
      <section className={styles.modeBar} aria-label="렌더러와 테마 선택">
        <div><button type="button" data-active={renderer === "layered" || undefined} onClick={() => setRenderer("layered")}>Layered</button><button type="button" data-active={renderer === "sprite" || undefined} onClick={() => setRenderer("sprite")}>Sprite</button></div>
        <select value={theme} onChange={(event) => setTheme(event.target.value as DaruRhythm)} aria-label="테마"><option value="dawn">DAWN</option><option value="day">DAY</option><option value="night">NIGHT</option></select>
      </section>
      <section className={styles.track} aria-label="다루 걷기 미리보기">
        <div className={styles.stage} data-daru-stage="true" data-walking={moving || undefined} style={{ "--preview-x": `${x}px`, "--preview-duration": `${duration}ms` } as React.CSSProperties}>
          {locomotion === "idle" ? <span className={styles.idle} style={{ backgroundImage: `url(${idleSrc})` }} /> : renderer === "layered" ? <LayeredDaruRenderer state={state} theme={theme} /> : <DaruSpriteRenderer state={state} theme={theme} />}
        </div>
        <span className={styles.ground} />
      </section>
      <section className={styles.controls} aria-label="걷기 조절">
        <div className={styles.cadenceControls} aria-label="Sprite WALK cadence A/B/C">
          {CADENCE_CANDIDATES.map((candidate) => (
            <button type="button" key={candidate.id} data-active={cadence === candidate.id || undefined} onClick={() => selectCadence(candidate)}>
              {candidate.id} · {candidate.cycleDurationMs}ms
            </button>
          ))}
        </div>
        <div className={styles.quickControls}><button type="button" onClick={() => setSpeed(50)}>Slow</button><button type="button" onClick={() => selectCadence(NORMAL_CADENCE)}>Normal</button><button type="button" onClick={() => setSpeed(112)}>Fast</button><button type="button" onClick={() => { if (playing) setLocomotion("idle"); setPlaying((value) => !value); }}>{playing ? "Stop" : "Play"}</button><button type="button" onClick={() => restartFacing("left")}>Left</button><button type="button" onClick={() => restartFacing("right")}>Right</button></div>
        <label>이동 속도 <strong>{speed}px/s</strong><input type="range" min="42" max="120" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
        <p>방향: {facing === "right" ? "오른쪽" : "왼쪽"} · 상태: {locomotion} · renderer: {renderer} · theme: {theme}</p>
      </section>
      <section className={styles.checklist} aria-label="Layered rig 확인 항목"><strong>Layered 확인 항목</strong><ul><li>팔 움직임: YES</li><li>앞다리 움직임: YES</li><li>뒷다리 움직임: YES</li><li>Body secondary motion: YES</li><li>Head follow: YES</li><li>꼬리 움직임: YES</li><li>Scarf follow: YES</li><li>눈에 띄는 foot sliding: 브라우저 판정 필요</li></ul></section>
    </main>
  );
}
