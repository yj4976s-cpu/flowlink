"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DaruSpriteRenderer } from "./DaruSpriteRenderer";
import { LayeredDaruRenderer } from "./LayeredDaruRenderer";
import type { DaruRendererState } from "./daru.animation.adapter";
import {
  DARU_LAYERED_LAYOUT,
  DARU_LAYERED_MOTION,
  DARU_RIG_CANVAS_SIZE,
  DARU_RIG_SOURCE_IMAGE,
  type DaruLayerName,
} from "./daru.layered.config";
import { DARU_GROUNDED_ROAMING_CONFIG, type DaruFacing } from "./daru.renderer.config";
import { DARU_SPRITE_CONFIG } from "./daru.sprite.config";
import type { DaruRhythm } from "./types";
import { DaruPoseAudit } from "./DaruPoseAudit";
import { DaruWalkCandidateComparison } from "./DaruWalkCandidateComparison";
import { useTheme } from "../theme/ThemeProvider";
import styles from "./DaruWalkPreview.module.css";

const CYCLE_CANDIDATES = [620, 720, 780, 840] as const;
const PHASE_CANDIDATES = [0, 0.25, 0.5, 0.75] as const;
const PREVIEW_SIZES = [148, 112, 88] as const;
const TRAVEL_DISTANCE_PX = DARU_SPRITE_CONFIG.stridePx * 10;
const IDLE_HOLD_MS = 350;
const ACCELERATION_RATIO = 0.04;
const RIG_NATURAL_SIZE = "1254 x 1254";
const NATURAL_WALK_PLAYBACK_RATE = 0.86;
const NATURAL_START_PLAYBACK_RATE = 0.72;
const NATURAL_STOP_PLAYBACK_RATE = 0.54;
const NATURAL_PREBLEND_START = 0.58;
const NATURAL_PREBLEND_MAX_OPACITY = 0.24;
const NATURAL_WALK_FRAMES = Array.from(
  { length: 8 },
  (_, index) => `/mascot/sprites/day/walk-natural-v4/walk-natural-v4-${String(index + 1).padStart(2, "0")}.png`,
);

const FRONT_IDLE_IMAGES: Record<DaruRhythm, string> = {
  day: "/mascot/daru-idle-day.png",
  dawn: "/mascot/daru-idle-dawn.png",
  night: "/mascot/daru-idle-night.png",
};

type NeutralCompareView = "side" | "overlay" | "blink";

function movementProgress(elapsedMs: number, durationMs: number) {
  const time = Math.min(1, Math.max(0, elapsedMs / durationMs));
  const ramp = ACCELERATION_RATIO;
  const normalization = 1 - ramp;
  if (time < ramp) return (time * time) / (2 * ramp * normalization);
  if (time > 1 - ramp) {
    const remaining = 1 - time;
    return 1 - (remaining * remaining) / (2 * ramp * normalization);
  }
  return (time - ramp / 2) / normalization;
}

function SpritePreview({ state, theme, phaseOverride }: { state: DaruRendererState; theme: DaruRhythm; phaseOverride: number | null }) {
  const walkFrames = DARU_SPRITE_CONFIG[theme].walkFrames;
  if (phaseOverride !== null) {
    const frameIndex = Math.floor(phaseOverride * walkFrames.length) % walkFrames.length;
    return <span className={styles.spritePhaseFrame} style={{ backgroundImage: `url(${walkFrames[frameIndex]})` }} />;
  }
  if (state.locomotion === "idle" || state.locomotion === "stop_walk") {
    return <span className={styles.spritePhaseFrame} style={{ backgroundImage: `url(${FRONT_IDLE_IMAGES[theme]})` }} />;
  }
  return <DaruSpriteRenderer state={state} theme={theme} />;
}

function NaturalFullBodyPreview({ facing, phase }: { facing: DaruFacing; phase: number }) {
  const normalizedPhase = (phase + 1) % 1;
  const frameProgress = normalizedPhase * NATURAL_WALK_FRAMES.length;
  const frameBase = Math.floor(frameProgress);
  const frameIndex = frameBase % NATURAL_WALK_FRAMES.length;
  const nextFrameIndex = (frameIndex + 1) % NATURAL_WALK_FRAMES.length;
  const frameLocalProgress = frameProgress - frameBase;
  const preblendProgress = Math.max(0, (frameLocalProgress - NATURAL_PREBLEND_START) / (1 - NATURAL_PREBLEND_START));
  const nextFrameOpacity = preblendProgress * NATURAL_PREBLEND_MAX_OPACITY;
  return (
    <span className={styles.naturalFrame} data-facing={facing}>
      {NATURAL_WALK_FRAMES.map((src, index) => {
        const opacity = index === frameIndex ? 1 : index === nextFrameIndex ? nextFrameOpacity : 0;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt="" draggable={false} style={{ opacity }} />
        );
      })}
    </span>
  );
}

function formatLayout(part: DaruLayerName) {
  const layer = DARU_LAYERED_LAYOUT[part];
  return `left ${layer.left}% / top ${layer.top}% / width ${layer.width}% / height ${layer.height}%`;
}

function formatPivot(part: DaruLayerName) {
  const layer = DARU_LAYERED_LAYOUT[part];
  return `${layer.pivot.x}, ${layer.pivot.y}`;
}

export function DaruWalkPreview() {
  const directionRef = useRef<DaruFacing>("right");
  const runCountRef = useRef(0);
  const { theme, setTheme } = useTheme();
  const [playing, setPlaying] = useState(true);
  const [facing, setFacing] = useState<DaruFacing>("right");
  const [locomotion, setLocomotion] = useState<DaruRendererState["locomotion"]>("idle");
  const [position, setPosition] = useState(0);
  const [cycleMs, setCycleMs] = useState<number>(DARU_LAYERED_MOTION.cycleMs);
  const [previewSize, setPreviewSize] = useState<148 | 112 | 88>(148);
  const [phaseOverride, setPhaseOverride] = useState<number | null>(null);
  const [repeatTarget, setRepeatTarget] = useState<number | null>(null);
  const [neutralView, setNeutralView] = useState<NeutralCompareView>("side");
  const [showNeutralRig, setShowNeutralRig] = useState(true);
  const [naturalPlaybackPhase, setNaturalPlaybackPhase] = useState(0);
  const walkSpeedPxPerSecond = DARU_SPRITE_CONFIG.stridePx / (cycleMs / 1000);
  const travelDurationMs = (TRAVEL_DISTANCE_PX / walkSpeedPxPerSecond) * 1000;
  const walkFrames = DARU_SPRITE_CONFIG[theme].walkFrames;
  const naturalPhase = phaseOverride ?? naturalPlaybackPhase;

  useEffect(() => {
    if (!playing || phaseOverride !== null) return;
    let cancelled = false;
    let animationFrame = 0;
    const timers: number[] = [];
    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => { if (!cancelled) callback(); }, delay);
      timers.push(timer);
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
          const progress = movementProgress(now - startedAt, travelDurationMs);
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
              runCountRef.current += 1;
              if (repeatTarget !== null && runCountRef.current >= repeatTarget) {
                setRepeatTarget(null);
                setPlaying(false);
                return;
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

    runCountRef.current = 0;
    runLeg();
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      timers.forEach(window.clearTimeout);
    };
  }, [cycleMs, phaseOverride, playing, repeatTarget, travelDurationMs]);

  useEffect(() => {
    if (neutralView !== "blink") return;
    const timer = window.setInterval(() => setShowNeutralRig((value) => !value), 500);
    return () => window.clearInterval(timer);
  }, [neutralView]);

  useEffect(() => {
    NATURAL_WALK_FRAMES.forEach((src) => {
      const image = new Image();
      image.src = src;
    });
  }, []);

  useEffect(() => {
    if (phaseOverride !== null || !playing || locomotion === "idle") return;
    let frame = 0;
    let previousTime = performance.now();
    const tick = (now: number) => {
      const delta = now - previousTime;
      previousTime = now;
      const speedScale = locomotion === "walk"
        ? NATURAL_WALK_PLAYBACK_RATE
        : locomotion === "start_walk"
          ? NATURAL_START_PLAYBACK_RATE
          : NATURAL_STOP_PLAYBACK_RATE;
      setNaturalPlaybackPhase((value) => (value + (delta / cycleMs) * speedScale) % 1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cycleMs, locomotion, phaseOverride, playing]);

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
    setPhaseOverride(null);
    setRepeatTarget(null);
    setPlaying(false);
    setLocomotion("idle");
    directionRef.current = nextFacing;
    setFacing(nextFacing);
    setPosition(nextFacing === "right" ? 0 : TRAVEL_DISTANCE_PX);
    window.setTimeout(() => setPlaying(true), 50);
  };

  const inspectPhase = (phase: number) => {
    setPlaying(false);
    setRepeatTarget(null);
    setPhaseOverride(phase);
    setLocomotion("walk");
    setPosition(facing === "right" ? TRAVEL_DISTANCE_PX * phase : TRAVEL_DISTANCE_PX * (1 - phase));
  };

  const resumeLive = () => {
    setPhaseOverride(null);
    setPlaying(true);
  };

  const runThreePasses = () => {
    runCountRef.current = 0;
    setPhaseOverride(null);
    setRepeatTarget(3);
    setPlaying(false);
    window.setTimeout(() => setPlaying(true), 50);
  };

  const stageStyle = { "--preview-x": `${position}px`, "--preview-size": `${previewSize}px` } as React.CSSProperties;
  const assetRows = (["tail", "armFar", "legFar", "base", "legNear", "armNear"] as const).map((part) => {
    const layer = DARU_LAYERED_LAYOUT[part];
    return { part, layer };
  });

  return (
    <main className={styles.page}>
      <header>
        <p>DEV ONLY</p>
        <h1>Daru WALK A/B Preview</h1>
        <span>{walkSpeedPxPerSecond.toFixed(3)}px/s · {cycleMs}ms/cycle · {travelDurationMs.toFixed(0)}ms / {TRAVEL_DISTANCE_PX}px · stride {DARU_SPRITE_CONFIG.stridePx}px</span>
      </header>

      <section className={styles.modeBar} aria-label="WALK preview controls">
        <strong>{theme.toUpperCase()} · {facing.toUpperCase()} · {previewSize}px · {phaseOverride === null ? "LIVE" : `${Math.round(phaseOverride * 100)}% phase`}</strong>
        <div>
          <select value={theme} onChange={(event) => setTheme(event.target.value as DaruRhythm)} aria-label="Theme">
            <option value="day">DAY</option>
            <option value="dawn">DAWN</option>
            <option value="night">NIGHT</option>
          </select>
          <button type="button" data-active={facing === "left" || undefined} onClick={() => restartFacing("left")}>LEFT</button>
          <button type="button" data-active={facing === "right" || undefined} onClick={() => restartFacing("right")}>RIGHT</button>
        </div>
      </section>

      <section className={styles.previewGrid} aria-label="Current Sprite 8 and Natural Full-body 8 comparison">
        <article className={styles.previewPane}>
          <div><strong>Current Sprite 8</strong><span>production fallback reference</span></div>
          <section className={styles.track} aria-label="Current Sprite 8">
            <div className={styles.stage} data-daru-stage="true" data-walking={locomotion !== "idle" || undefined} data-locomotion={locomotion} style={stageStyle}>
              <SpritePreview state={state} theme={theme} phaseOverride={phaseOverride} />
            </div>
            <span className={styles.ground} />
          </section>
        </article>

        <article className={styles.previewPane}>
          <div><strong>Natural Full-body 8</strong><span>new complete-frame candidate; production not connected</span></div>
          <section className={styles.track} aria-label="Natural Full-body 8">
            <div className={styles.stage} data-daru-stage="true" data-walking={locomotion !== "idle" || undefined} data-locomotion={locomotion} style={stageStyle}>
              <NaturalFullBodyPreview facing={facing} phase={naturalPhase} />
            </div>
            <span className={styles.ground} />
          </section>
        </article>
      </section>

      <section className={styles.neutralCompare} aria-label="Registered rig neutral composite comparison">
        <header>
          <div>
            <p>NEUTRAL ACCEPTANCE GATE</p>
            <h2>walk-01 source vs Registered Rig Neutral Composite</h2>
          </div>
          <div className={styles.cadenceControls}>
            {(["side", "overlay", "blink"] as const).map((item) => (
              <button type="button" key={item} data-active={neutralView === item || undefined} onClick={() => setNeutralView(item)}>
                {item === "side" ? "Original / Composite" : item === "overlay" ? "50% Overlay" : "Blink 500ms"}
              </button>
            ))}
          </div>
        </header>
        {neutralView === "side" ? (
          <div className={styles.neutralSide}>
            <figure>
              <figcaption>Original walk-01</figcaption>
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={DARU_RIG_SOURCE_IMAGE} alt="Original walk-01" />
              </div>
            </figure>
            <figure>
              <figcaption>Registered Rig Neutral Composite</figcaption>
              <div data-daru-stage="true">
                <LayeredDaruRenderer state={{ ...state, locomotion: "idle" }} theme="day" cycleMs={cycleMs} />
              </div>
            </figure>
          </div>
        ) : (
          <figure className={styles.neutralOverlay}>
            <figcaption>{neutralView === "overlay" ? "50% overlay" : "500ms blink"} · source and registered composite</figcaption>
            <div data-daru-stage="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={DARU_RIG_SOURCE_IMAGE} alt="Original walk-01" />
              <span style={{ opacity: neutralView === "overlay" ? 0.5 : neutralView === "blink" && !showNeutralRig ? 0 : 1 }}>
                <LayeredDaruRenderer state={{ ...state, locomotion: "idle" }} theme="day" cycleMs={cycleMs} />
              </span>
            </div>
          </figure>
        )}
        <p>Pixel diff for the generated neutral composite is 0. All six rig-v2 layers are 1254x1254 and share the original walk-01 coordinate system.</p>
      </section>

      <section className={styles.controls} aria-label="Walk controls">
        <div className={styles.cadenceControls} aria-label="WALK cycle candidates">
          {CYCLE_CANDIDATES.map((candidate) => <button type="button" key={candidate} data-active={cycleMs === candidate || undefined} onClick={() => setCycleMs(candidate)}>{candidate}ms</button>)}
        </div>
        <div className={styles.cadenceControls} aria-label="Renderer size candidates">
          {PREVIEW_SIZES.map((size) => <button type="button" key={size} data-active={previewSize === size || undefined} onClick={() => setPreviewSize(size)}>{size}px</button>)}
        </div>
        <div className={styles.phaseInspector}>
          <strong>GAIT PHASE INSPECTOR</strong>
          <div>
            {PHASE_CANDIDATES.map((phase) => <button type="button" key={phase} data-active={phaseOverride === phase || undefined} onClick={() => inspectPhase(phase)}>{Math.round(phase * 100)}%</button>)}
            <button type="button" data-active={phaseOverride === null || undefined} onClick={resumeLive}>LIVE</button>
          </div>
          <span>natural frame {Math.floor(naturalPhase * NATURAL_WALK_FRAMES.length) + 1} / {NATURAL_WALK_FRAMES.length} · phase {Math.round(naturalPhase * 100)}% · playback {Math.round(NATURAL_WALK_PLAYBACK_RATE * 100)}%</span>
          <span>complete-frame playback only; no separated limb transforms in the primary candidate</span>
        </div>
        <div className={styles.quickControls}>
          <button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? "Pause" : "Play"}</button>
          <button type="button" onClick={runThreePasses}>start → walk → stop → idle x3</button>
        </div>
        <p className={styles.notice}>Registered Rig v2 uses DAY walk-01-derived 1254px assets below. Production DaruCharacter still uses the existing Sprite renderer.</p>
      </section>

      <section className={styles.assetNotice} aria-label="Registered Rig v2 asset values">
        <strong>Registered Rig v2 asset values in use</strong>
        <div className={styles.assetGrid}>
          {assetRows.map(({ part, layer }) => (
            <dl key={part}>
              <dt>{part}</dt>
              <dd>src: <code>{layer.src}</code></dd>
              <dd>natural: {RIG_NATURAL_SIZE}</dd>
              <dd>layout: {formatLayout(part)}</dd>
              <dd>pivot px: {formatPivot(part)}</dd>
              <dd>origin: {layer.origin}</dd>
            </dl>
          ))}
        </div>
        <p>source: <code>{DARU_RIG_SOURCE_IMAGE}</code> · canvas: <code>{DARU_RIG_CANVAS_SIZE}px</code> · cycle: <code>{DARU_LAYERED_MOTION.cycleMs}ms</code> · stride: <code>{DARU_LAYERED_MOTION.stridePx}px</code></p>
        <p>legRotation: <code>±{DARU_LAYERED_MOTION.legRotationDeg}deg</code> · footLift: <code>{DARU_LAYERED_MOTION.footLiftPx}px canvas</code> · armSwing: <code>±{DARU_LAYERED_MOTION.armSwingDeg}deg</code> · bodyBob: <code>{DARU_LAYERED_MOTION.bodyBobPx}px canvas</code> · tailSwing: <code>±{DARU_LAYERED_MOTION.tailSwingDeg}deg</code></p>
      </section>

      <section className={styles.checklist} aria-label="Registered Rig v2 checklist">
        <strong>Registered Rig v2 checklist</strong>
        <ul>
          <li>0% / 50%: opposite leg pose check</li>
          <li>25% / 75%: passing pose check</li>
          <li>All moving parts share the original 1254px registered canvas</li>
          <li>stop_walk settles within 170-220ms</li>
          <li>DAY rig only; DAWN/NIGHT production handling is untouched</li>
          <li>Current Sprite 8 remains the production fallback reference</li>
        </ul>
      </section>

      <DaruWalkCandidateComparison />
      <DaruPoseAudit theme={theme} frames={walkFrames} />
    </main>
  );
}
