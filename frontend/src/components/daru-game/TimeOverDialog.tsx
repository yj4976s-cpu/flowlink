import { useEffect, useRef } from "react";
import styles from "./DaruGame.module.css";

export function TimeOverDialog({ onContinue, onFinish }: { onContinue: () => void; onFinish: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <section ref={ref} className={styles.timeOverDialog} role="dialog" aria-modal="true" aria-labelledby="time-over-title" tabIndex={-1}>
    <p>TIME OVER</p><h2 id="time-over-title">시간은 끝났지만,<br />끝까지 찾아볼까요?</h2>
    <div><button className="button button-primary" type="button" onClick={onContinue}>계속 찾기</button><button className="button button-secondary" type="button" onClick={onFinish}>여기서 끝내기</button></div>
  </section>;
}
