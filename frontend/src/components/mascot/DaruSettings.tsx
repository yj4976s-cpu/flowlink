"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { useDaru } from "./DaruProvider";
import { DaruIcon } from "./DaruIcon";
import type { DaruMode } from "./types";
import styles from "./DaruSettings.module.css";

const options: Array<{ value: DaruMode; label: string; description: string }> = [
  { value: "active", label: "출근하기", description: "다루가 곁에서 함께 움직이며 도와줘요" },
  { value: "quiet", label: "잠깐 쉬기", description: "다루가 자리를 지키며 조용히 쉬어요" },
  { value: "hidden", label: "퇴근하기", description: "다루가 오늘은 화면에서 퇴근해요" },
];

export function DaruSettings() {
  const { mode, setMode } = useDaru();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button ref={triggerRef} className={styles.trigger} type="button" aria-label="다루 표시 설정" aria-haspopup="menu" aria-expanded={open} aria-controls="daru-settings-menu" onClick={() => setOpen((current) => !current)}>
        <DaruIcon className={styles.daruIcon} /><span>다루</span>
      </button>
      {open && <div className={styles.menu} id="daru-settings-menu" role="menu" aria-label="다루 표시 모드">
        <strong>다루 표시 모드</strong>
        {options.map((option) => <button key={option.value} type="button" role="menuitemradio" aria-checked={mode === option.value} onClick={() => { setMode(option.value); setOpen(false); }}>
          <span><b>{option.label}</b><small>{option.description}</small></span>
          {mode === option.value && <Icon name="check" size={17} />}
        </button>)}
      </div>}
    </div>
  );
}
