"use client";

import { useEffect, useState } from "react";
import styles from "./DaruMascot.module.css";
import type { DaruRendererState } from "./daru.animation.adapter";
import type { DaruAction, DaruRhythm } from "./types";
import { loadThemedDaruImageSrc } from "./daru.theme-image";

const IDLE_IMAGES: Record<DaruRhythm, string> = {
  day: "/mascot/daru-idle-day.png",
  dawn: "/mascot/daru-idle-dawn.png",
  night: "/mascot/daru-idle-night.png",
};

export function StaticDaruFallback({ state, theme, action }: { state: DaruRendererState; theme: DaruRhythm; action: DaruAction }) {
  const source = action === "wave" ? "/mascot/daru-wave-day.png" : IDLE_IMAGES[theme];
  const key = `${theme}:${source}`;
  const [themedImage, setThemedImage] = useState<{ key: string; src: string } | null>(null);
  useEffect(() => {
    let active = true;
    loadThemedDaruImageSrc(source, theme).then((src) => {
      if (active) setThemedImage({ key, src });
    });
    return () => { active = false; };
  }, [key, source, theme]);
  const fallbackSrc = action === "wave" && theme !== "day" ? IDLE_IMAGES[theme] : source;
  const imageSrc = themedImage?.key === key ? themedImage.src : fallbackSrc;
  return (
    <span className={styles.renderer} data-renderer="static" data-action={action} data-locomotion={state.locomotion} data-behavior={state.behavior} data-interaction={state.interaction} data-facing={state.facing} aria-hidden="true">
      <span className={styles.contactShadow} />
      <span key={key} className={styles.daruImage} style={{ backgroundImage: `url(${imageSrc})` }} />
    </span>
  );
}
