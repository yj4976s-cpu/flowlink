import styles from "./DaruMascot.module.css";
import type { DaruRendererState } from "./daru.animation.adapter";
import type { DaruRhythm } from "./types";

const IDLE_IMAGES: Record<DaruRhythm, string> = {
  day: "/mascot/daru-idle-day.png",
  dawn: "/mascot/daru-idle-dawn.png",
  night: "/mascot/daru-idle-night.png",
};

export function StaticDaruFallback({ state, theme }: { state: DaruRendererState; theme: DaruRhythm }) {
  return (
    <span className={styles.renderer} data-renderer="static" data-locomotion={state.locomotion} data-behavior={state.behavior} data-interaction={state.interaction} data-facing={state.facing} aria-hidden="true">
      <span className={styles.contactShadow} />
      <span key={theme} className={styles.daruImage} style={{ backgroundImage: `url(${IDLE_IMAGES[theme]})` }} />
    </span>
  );
}
