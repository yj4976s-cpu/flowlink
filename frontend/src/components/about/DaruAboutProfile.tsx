"use client";

import Image from "next/image";
import { useTheme } from "@/components/theme/ThemeProvider";
import type { DaruRhythm } from "@/components/mascot/types";

const DARU_PROFILE_IMAGES: Record<DaruRhythm, string> = {
  dawn: "/mascot/daru-idle-dawn.png",
  day: "/mascot/daru-idle-day.png",
  night: "/mascot/daru-idle-night.png",
};

export function DaruAboutProfile() {
  const { theme } = useTheme();

  return (
    <Image
      key={theme}
      src={DARU_PROFILE_IMAGES[theme]}
      alt=""
      fill
      sizes="58px"
      aria-hidden="true"
    />
  );
}
