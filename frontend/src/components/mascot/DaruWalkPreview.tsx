"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DaruSpriteRenderer } from "./DaruSpriteRenderer";
import type { DaruRendererState } from "./daru.animation.adapter";
import { DARU_GROUNDED_ROAMING_CONFIG, type DaruFacing } from "./daru.renderer.config";
import { DARU_SPRITE_CONFIG } from "./daru.sprite.config";
import type { DaruRhythm } from "./types";
import styles from "./DaruWalkPreview.module.css";

type IdleSource = "original" | "walk-type" | "front";

const FRONT_IDLE_IMAGES: Record<DaruRhythm, string> = {
  day: "/mascot/daru-idle-day.png",
  dawn: "/mascot/daru-idle-dawn.png",
  night: "/mascot/daru-idle-night.png",
};

const WALK_CYCLE_MS = DARU_GROUNDED_ROAMING_CONFIG.normalCycleMs;
const WALK_SPEED_PX_PER_SECOND = DARU_SPRITE_CONFIG.stridePx / (WALK_CYCLE_MS / 1000);
const TRAVEL_DISTANCE_PX = DARU_SPRITE_CONFIG.stridePx * 10;
const TRAVEL_DURATION_MS = (TRAVEL_DISTANCE_PX / WALK_SPEED_PX_PER_SECOND) * 1000;
const IDLE_HOLD_MS = 350;
const ACCELERATION_RATIO = 0.04;

function waitForImage(image: HTMLImageElement) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error(`Failed to load ${image.src}`)), { once: true });
  });
}

async function loadDecodedFrame(src: string) {
  const image = new Image();
  image.src = src;
  try {
    if (typeof image.decode === "function") await image.decode();
    else await waitForImage(image);
  } catch {
    await waitForImage(image);
  }
  return image;
}

function movementProgress(elapsedMs: number) {
  const time = Math.min(1, Math.max(0, elapsedMs / TRAVEL_DURATION_MS));
  const ramp = ACCELERATION_RATIO;
  const normalization = 1 - ramp;
  if (time < ramp) return (time * time) / (2 * ramp * normalization);
  if (time > 1 - ramp) {
    const remaining = 1 - time;
    return 1 - (remaining * remaining) / (2 * ramp * normalization);
  }
  return (time - ramp / 2) / normalization;
}

export function DaruWalkPreview() {
  const stageRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<DaruFacing>("right");
  const transitionRunRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [facing, setFacing] = useState<DaruFacing>("right");
  const [locomotion, setLocomotion] = useState<DaruRendererState["locomotion"]>("idle");
  const [idleSource, setIdleSource] = useState<IdleSource>("front");
  const [walkPoseIdleFrame, setWalkPoseIdleFrame] = useState(0);
  const [candidateScale, setCandidateScale] = useState(1.06);
  const [candidateOffsetX, setCandidateOffsetX] = useState(0);
  const [candidateOffsetY, setCandidateOffsetY] = useState(5);
  const [transitionCheck, setTransitionCheck] = useState(false);
  const [transitionPass, setTransitionPass] = useState(0);
  const [theme, setTheme] = useState<DaruRhythm>("day");
  const [decodeResult, setDecodeResult] = useState<{ theme: DaruRhythm; frames: readonly HTMLImageElement[] } | null>(null);
  const [failedTheme, setFailedTheme] = useState<DaruRhythm | null>(null);
  const decodedFrames = decodeResult?.theme === theme ? decodeResult.frames : null;
  const decodeFailed = failedTheme === theme;

  useEffect(() => {
    let active = true;
    Promise.all(DARU_SPRITE_CONFIG[theme].walkFrames.map(loadDecodedFrame))
      .then((frames) => {
        if (!active) return;
        setFailedTheme(null);
        setDecodeResult({ theme, frames });
      })
      .catch(() => { if (active) setFailedTheme(theme); });
    return () => { active = false; };
  }, [theme]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!playing || !decodedFrames || !stage) return;

    let cancelled = false;
    let animationFrame = 0;
    const timers: number[] = [];
    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => { if (!cancelled) callback(); }, delay);
      timers.push(timer);
    };
    const setPosition = (position: number) => {
      stage.style.setProperty("--preview-x", `${position}px`);
    };

    const runLeg = () => {
      if (cancelled) return;
      const direction = directionRef.current;
      const from = direction === "right" ? 0 : TRAVEL_DISTANCE_PX;
      const to = direction === "right" ? TRAVEL_DISTANCE_PX : 0;
      setPosition(from);
      setFacing(direction);
      setLocomotion("start_walk");

      schedule(() => {
        const startedAt = performance.now();
        setLocomotion("walk");
        const move = (now: number) => {
          if (cancelled) return;
          const progress = movementProgress(now - startedAt);
          setPosition(from + (to - from) * progress);
          if (progress < 1) {
            animationFrame = requestAnimationFrame(move);
            return;
          }

          setPosition(to);
          setLocomotion("stop_walk");
          schedule(() => {
            setLocomotion("idle");
            schedule(() => {
              if (transitionCheck) {
                transitionRunRef.current += 1;
                setTransitionPass(transitionRunRef.current);
                if (transitionRunRef.current >= 3) {
                  setTransitionCheck(false);
                  setPlaying(false);
                  return;
                }
              }
              const nextDirection = direction === "right" ? "left" : "right";
              directionRef.current = nextDirection;
              setFacing(nextDirection);
              runLeg();
            }, IDLE_HOLD_MS);
          }, DARU_GROUNDED_ROAMING_CONFIG.stopWalkMs);
        };
        animationFrame = requestAnimationFrame(move);
      }, DARU_GROUNDED_ROAMING_CONFIG.startWalkMs);
    };

    runLeg();
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      timers.forEach(window.clearTimeout);
    };
  }, [decodedFrames, playing, transitionCheck]);

  const state = useMemo<DaruRendererState>(() => ({
    locomotion,
    behavior: "normal",
    interaction: "none",
    facing,
    movementSpeed: 1,
    dragging: false,
    reducedMotion: false,
    lookX: 0,
    lookY: 0,
    tailEnergy: 0.5,
  }), [facing, locomotion]);

  const restartFacing = (nextFacing: DaruFacing) => {
    setTransitionCheck(false);
    setPlaying(false);
    setLocomotion("idle");
    directionRef.current = nextFacing;
    setFacing(nextFacing);
    stageRef.current?.style.setProperty("--preview-x", `${nextFacing === "right" ? 0 : TRAVEL_DISTANCE_PX}px`);
    window.setTimeout(() => setPlaying(true), 50);
  };
  const applyCandidatePreset = (aligned: boolean) => {
    setIdleSource("front");
    setCandidateScale(aligned ? 1.06 : 1);
    setCandidateOffsetX(0);
    setCandidateOffsetY(aligned ? 5 : 0);
  };
  const startTransitionCheck = () => {
    setPlaying(false);
    setLocomotion("idle");
    setIdleSource("front");
    transitionRunRef.current = 0;
    setTransitionPass(0);
    window.setTimeout(() => {
      setTransitionCheck(true);
      setPlaying(true);
    }, 50);
  };
  const walking = locomotion === "walk" || locomotion === "start_walk";
  const idleSrc = idleSource === "front"
    ? FRONT_IDLE_IMAGES[theme]
    : idleSource === "walk-type"
      ? DARU_SPRITE_CONFIG[theme].walkFrames[walkPoseIdleFrame]
      : "/mascot/daru-idle-transparent.png";
  const idleStyle = idleSource === "front"
    ? { backgroundImage: `url(${idleSrc})`, transform: `translate(${candidateOffsetX}px, ${candidateOffsetY}px) scale(${candidateScale})` }
    : { backgroundImage: `url(${idleSrc})` };

  return (
    <main className={styles.page}>
      <header>
        <p>개발 전용 프리뷰</p>
        <h1>다루 WALK 프레임 비교</h1>
        <span>{WALK_SPEED_PX_PER_SECOND.toFixed(3)}px/s · {WALK_CYCLE_MS}ms/cycle · {TRAVEL_DURATION_MS.toFixed(0)}ms / {TRAVEL_DISTANCE_PX}px · stride {DARU_SPRITE_CONFIG.stridePx}px</span>
      </header>

      <section className={styles.modeBar} aria-label="프레임 모드와 테마 선택">
        <strong>Original 8</strong>
        <select value={theme} onChange={(event) => setTheme(event.target.value as DaruRhythm)} aria-label="테마">
          <option value="dawn">DAWN</option>
          <option value="day">DAY</option>
          <option value="night">NIGHT</option>
        </select>
      </section>

      <section className={styles.track} aria-label="다루 걷기 미리보기">
        <div ref={stageRef} className={styles.stage} data-daru-stage="true" data-walking={walking || undefined} data-locomotion={locomotion}>
          {!decodedFrames || locomotion === "idle" ? (
            <span className={styles.idle} style={idleStyle} />
          ) : (
            <DaruSpriteRenderer state={state} theme={theme} />
          )}
        </div>
        <span className={styles.ground} />
        {!decodedFrames && <span className={styles.decodeStatus}>{decodeFailed ? "프레임 decode 실패 — idle fallback" : "WALK 8프레임 decode 중…"}</span>}
      </section>

      <section className={styles.controls} aria-label="걷기 조절">
        <div className={styles.idleControls}>
          <strong>IDLE SOURCE</strong>
          <div>
            <button type="button" data-active={idleSource === "original" || undefined} onClick={() => { setIdleSource("original"); setTheme("day"); }}>A · Original Idle</button>
            <button type="button" data-active={idleSource === "walk-type" || undefined} onClick={() => setIdleSource("walk-type")}>B · 3/4 Walk-type Idle</button>
            <button type="button" data-active={idleSource === "front" || undefined} onClick={() => setIdleSource("front")}>C · Front Idle</button>
          </div>
          <span>{idleSource === "original" ? "기존 원래 정면 IDLE" : idleSource === "walk-type" ? "현재 3/4 WALK형 IDLE" : `정면 IDLE · ${theme.toUpperCase()}`}</span>
        </div>
        <div className={styles.thumbnailGrid} aria-label="Walk Pose Idle 프레임 선택">
          {DARU_SPRITE_CONFIG[theme].walkFrames.map((src, index) => (
            <button
              type="button"
              key={src}
              data-active={idleSource === "walk-type" && walkPoseIdleFrame === index || undefined}
              aria-label={`walk frame ${String(index + 1).padStart(2, "0")}를 idle로 선택`}
              onClick={() => {
                setWalkPoseIdleFrame(index);
                setIdleSource("walk-type");
              }}
            >
              <span style={{ backgroundImage: `url(${src})` }} />
              <small>{String(index + 1).padStart(2, "0")}</small>
            </button>
          ))}
        </div>
        <div className={styles.candidateTuning} aria-label="New Candidate DEV 정렬 조절">
          <strong>Candidate DEV alignment</strong>
          <div className={styles.candidatePresets}>
            <button type="button" data-active={candidateScale === 1 && candidateOffsetX === 0 && candidateOffsetY === 0 || undefined} onClick={() => applyCandidatePreset(false)}>A · Original</button>
            <button type="button" data-active={candidateScale === 1.06 && candidateOffsetX === 0 && candidateOffsetY === 5 || undefined} onClick={() => applyCandidatePreset(true)}>권장 · 1.06 / 0 / +5</button>
          </div>
          <label>Scale <span>{candidateScale.toFixed(2)}</span><input type="range" min="0.9" max="1.12" step="0.01" value={candidateScale} onChange={(event) => setCandidateScale(Number(event.target.value))} /></label>
          <label>X <span>{candidateOffsetX}px</span><input type="range" min="-20" max="20" step="1" value={candidateOffsetX} onChange={(event) => setCandidateOffsetX(Number(event.target.value))} /></label>
          <label>Y <span>{candidateOffsetY}px</span><input type="range" min="-16" max="16" step="1" value={candidateOffsetY} onChange={(event) => setCandidateOffsetY(Number(event.target.value))} /></label>
          <button type="button" onClick={() => { setCandidateScale(1); setCandidateOffsetX(0); setCandidateOffsetY(0); }}>Reset</button>
          <button type="button" onClick={startTransitionCheck}>Transition Check · 3회</button>
        </div>
        <div className={styles.quickControls}>
          <button type="button" onClick={() => { setTransitionCheck(false); if (playing) setLocomotion("idle"); setPlaying((value) => !value); }}>{playing ? "정지" : "재생"}</button>
          <button type="button" onClick={() => restartFacing("left")}>왼쪽</button>
          <button type="button" onClick={() => restartFacing("right")}>오른쪽</button>
        </div>
        <p>방향: {facing === "right" ? "오른쪽" : "왼쪽"} · mode: Original 8 · 상태: {locomotion} · theme: {theme}{transitionCheck ? ` · transition check ${transitionPass + 1}/3` : ""}</p>
        <p className={styles.notice}>production과 동일한 Original 8 진단 모드입니다. 왼쪽 이동은 방향 전용 에셋 전까지 임시 mirror 상태입니다.</p>
      </section>

      <section className={styles.checklist} aria-label="프리뷰 확인 항목">
        <strong>Original 8 진단 조건</strong>
        <ul>
          <li>Original 8: 약 12.9 pose fps</li>
          <li>cycle: 모두 620ms</li>
          <li>stride: 모두 42px</li>
          <li>travel: 모두 420px / 6200ms</li>
          <li>위치 갱신: requestAnimationFrame</li>
          <li>프레임 진행: 실제 이동거리 기반</li>
          <li>재생 전: 8장 decode 완료 대기</li>
          <li>IDLE 비교: Current / Walk Pose</li>
          <li>Candidate: 테마별 원본 + DEV 정렬만</li>
        </ul>
      </section>
    </main>
  );
}
