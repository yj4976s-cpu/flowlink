"use client";

import Link from "next/link";
import { Icon } from "@/components/common/Icon";
import { DARU_GUIDE_CONFIG, type DaruGuideRole } from "./daru.guide.config";
import styles from "./DaruMascot.module.css";

export function DaruGuidePanel({ role, userPaused, reducedMotion, onClose, onToggleRoaming }: { role: DaruGuideRole; userPaused: boolean; reducedMotion: boolean; onClose: (options?: { restoreFocus?: boolean }) => void; onToggleRoaming: () => void }) {
  const guide = DARU_GUIDE_CONFIG[role];
  return (
    <section id="daru-guide-panel" className={styles.guidePanel} role="dialog" aria-modal="false" aria-labelledby="daru-guide-title">
      <header className={styles.guideHeader}>
        <div><strong id="daru-guide-title">다루</strong><span>{guide.roleLabel}</span></div>
        <button type="button" aria-label="다루 안내 닫기" onClick={() => onClose({ restoreFocus: true })}><Icon name="close" size={17} /></button>
      </header>
      <div className={styles.guideIntro}><strong>{guide.greeting}</strong><p>{guide.description}</p></div>
      <nav className={styles.guideLinks} aria-label={`${guide.roleLabel} 빠른 메뉴`}>
        {guide.items.map((item) => <Link key={item.href + item.label} href={item.href} onClick={() => onClose()}><span>{item.label}</span><Icon name="arrow" size={15} /></Link>)}
      </nav>
      <Link className={styles.guideAbout} href="/about#daru" onClick={() => onClose()}>다루 알아보기 <Icon name="arrow" size={15} /></Link>
      <div className={styles.guideRoamingSetting}>
        <div><span>자유 이동</span>{reducedMotion && <small>모션 감소 설정 적용 중</small>}</div>
        <button type="button" aria-pressed={userPaused} onClick={onToggleRoaming}>{userPaused ? "다시 돌아다니기" : "다루 쉬게 하기"}</button>
      </div>
    </section>
  );
}
