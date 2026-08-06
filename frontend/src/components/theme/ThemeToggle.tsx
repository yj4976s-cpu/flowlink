"use client";

import { Icon } from "@/components/common/Icon";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="화면 테마 선택">
      <button
        type="button"
        className="theme-option"
        aria-label="DAY 테마로 전환"
        aria-pressed={theme === "day"}
        onClick={() => setTheme("day")}
      >
        <Icon name="sun" size={17} />
        <span>DAY</span>
      </button>
      <button
        type="button"
        className="theme-option"
        aria-label="NIGHT 테마로 전환"
        aria-pressed={theme === "night"}
        onClick={() => setTheme("night")}
      >
        <Icon name="moon" size={17} />
        <span>NIGHT</span>
      </button>
    </div>
  );
}
