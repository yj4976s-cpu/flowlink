import styles from "./FlowCopilot.module.css";

export function FlowBeacon({ open, checking = false }: { open: boolean; checking?: boolean }) {
  return <svg className={styles.observerBot} data-checking={checking || undefined} viewBox="0 0 48 48" aria-hidden="true">
    <ellipse className={styles.botReflection} cx="24" cy="39" rx="14" ry="2.4" />
    <path className={styles.botAntenna} d="M24 12V8m-3 0h6" />
    <path className={styles.botBody} d="M14 24c0-7 4.3-11 10-11s10 4 10 11v9c0 4.2-3.6 7-10 7s-10-2.8-10-7Z" />
    <rect className={styles.botVisorFrame} x="17" y="20" width="14" height="6" rx="3" />
    <path className={styles.botVisor} d="M19.5 23h9" />
    <path className={styles.botScan} d="M19.5 23h3" />
    <path className={styles.botWaterline} d="M11 37h26" />
    <title>{open ? "FlowLink AI 열림" : "FlowLink AI 관측 봇"}</title>
  </svg>;
}
