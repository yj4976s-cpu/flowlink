import styles from "./FlowCopilot.module.css";
import { SPEECH_RATES, type SpeechRate } from "@/hooks/useSpeechSynthesis";

type CopilotSpeechButtonProps = {
  speaking: boolean;
  paused: boolean;
  speechRate: SpeechRate;
  disabled?: boolean;
  unsupported?: boolean;
  onSpeak: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRateChange: (rate: number) => void;
};

export function CopilotSpeechButton({
  speaking,
  paused,
  speechRate,
  disabled = false,
  unsupported = false,
  onSpeak,
  onPause,
  onResume,
  onStop,
  onRateChange,
}: CopilotSpeechButtonProps) {
  const controlsDisabled = disabled || unsupported;
  return (
    <span
      className={styles.speechControls}
      title={unsupported ? "이 브라우저에서는 음성 안내를 지원하지 않아요." : undefined}
    >
      {speaking ? (
        <>
          <button
            className={styles.speechButton}
            type="button"
            aria-label={paused ? "음성 안내 계속 재생" : "음성 안내 일시정지"}
            disabled={controlsDisabled}
            onClick={paused ? onResume : onPause}
          >
            <span aria-hidden="true">{paused ? "▶" : "⏸"}</span>
            {paused ? "계속 듣기" : "일시정지"}
          </button>
          <button
            className={styles.speechButton}
            type="button"
            aria-label="음성 안내 중지"
            disabled={controlsDisabled}
            onClick={onStop}
          >
            <span aria-hidden="true">■</span>
            정지
          </button>
        </>
      ) : (
        <button
          className={styles.speechButton}
          type="button"
          aria-label="이 답변 음성으로 듣기"
          disabled={controlsDisabled}
          onClick={onSpeak}
        >
          <span aria-hidden="true">🔊</span>
          듣기
        </button>
      )}
      <select
        className={styles.speechRateSelect}
        value={speechRate}
        aria-label="음성 재생 속도"
        disabled={controlsDisabled}
        onChange={(event) => onRateChange(Number(event.target.value))}
      >
        {SPEECH_RATES.map((rate) => (
          <option key={rate} value={rate}>{rate.toFixed(1)}×</option>
        ))}
      </select>
    </span>
  );
}
