import styles from "./DaruMascot.module.css";
import type { DaruRendererState } from "./daru.animation.adapter";

export function StaticDaruFallback({ state }: { state: DaruRendererState }) {
  return (
    <span className={styles.renderer} data-renderer="static" data-locomotion={state.locomotion} data-behavior={state.behavior} data-interaction={state.interaction} data-facing={state.facing} aria-hidden="true">
      <span className={styles.contactShadow} />
      <span className={styles.daruImage} />
    </span>
  );
}
