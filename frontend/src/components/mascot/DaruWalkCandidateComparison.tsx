"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import styles from "./DaruWalkCandidateComparison.module.css";

const WALK_01 = "/mascot/sprites/day/walk/walk-01.png";
const WALK_05 = "/mascot/sprites/day/walk/walk-05.png";
const WALK_05_V2 = "/mascot/sprites/day/walk-candidate/walk-05-v2.png";

type Pair = "ab" | "half-cycle";
type View = "side" | "overlay" | "blink";

export function DaruWalkCandidateComparison() {
  const [pair, setPair] = useState<Pair>("ab");
  const [view, setView] = useState<View>("side");
  const [showCandidate, setShowCandidate] = useState(true);
  const [candidateReady, setCandidateReady] = useState(false);
  const left = pair === "ab" ? WALK_05 : WALK_01;
  const leftLabel = pair === "ab" ? "Production walk-05" : "Production walk-01";

  useEffect(() => {
    let active = true;
    const image = new Image();
    image.src = WALK_05_V2;
    const ready = typeof image.decode === "function" ? image.decode() : new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(); });
    ready.then(() => { if (active) setCandidateReady(true); }).catch(() => { if (active) setCandidateReady(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (view !== "blink") return;
    const timer = window.setInterval(() => setShowCandidate((value) => !value), 500);
    return () => window.clearInterval(timer);
  }, [view]);

  return (
    <section className={styles.panel} aria-labelledby="candidate-compare-title">
      <header>
        <div><p>DAY · DEV only</p><h2 id="candidate-compare-title">WALK 05 CANDIDATE COMPARE</h2></div>
        <span data-ready={candidateReady || undefined}>{candidateReady ? "candidate decoded" : "candidate decoding…"}</span>
      </header>

      <div className={styles.toolbar}>
        <div><strong>PAIR</strong><button type="button" data-active={pair === "ab" || undefined} onClick={() => setPair("ab")}>walk-05 ↔ 05-v2</button><button type="button" data-active={pair === "half-cycle" || undefined} onClick={() => setPair("half-cycle")}>walk-01 ↔ 05-v2</button></div>
        <div><strong>VIEW</strong>{(["side", "overlay", "blink"] as const).map((item) => <button type="button" key={item} data-active={view === item || undefined} onClick={() => setView(item)}>{item === "side" ? "Side by side" : item === "overlay" ? "Overlay 50%" : "Blink 500ms"}</button>)}</div>
      </div>

      {view === "side" ? (
        <div className={styles.side}>
          <figure><figcaption>{leftLabel}</figcaption><div><img src={left} alt={leftLabel} /></div></figure>
          <figure><figcaption>Candidate walk-05-v2</figcaption><div><img src={WALK_05_V2} alt="Candidate walk-05-v2" onLoad={() => setCandidateReady(true)} /></div></figure>
        </div>
      ) : (
        <figure className={styles.composite}>
          <figcaption>{leftLabel} ↔ Candidate walk-05-v2 · {view === "overlay" ? "50% overlay" : "500ms blink"}</figcaption>
          <div><img src={left} alt={leftLabel} /><img src={WALK_05_V2} alt="Candidate walk-05-v2" onLoad={() => setCandidateReady(true)} style={{ opacity: view === "overlay" ? 0.5 : showCandidate ? 1 : 0 }} /></div>
        </figure>
      )}

      <div className={styles.checks}>
        <strong>CHECK</strong>
        <span>Opposite leg leads versus walk-01</span><span>Arms counter-swing</span><span>Face / torso / scarf continuity</span><span>Foot baseline remains aligned</span>
      </div>
      <p className={styles.note}>This panel reads DAY candidate assets only. It does not replace or feed the production WALK renderer.</p>
    </section>
  );
}
