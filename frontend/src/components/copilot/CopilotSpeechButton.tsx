import styles from "./FlowCopilot.module.css";

type CopilotSpeechButtonProps = {
  speaking: boolean;
  disabled?: boolean;
  unsupported?: boolean;
  onClick: () => void;
};

export function CopilotSpeechButton({ speaking, disabled = false, unsupported = false, onClick }: CopilotSpeechButtonProps) {
  return (
    <button
      className={styles.speechButton}
      type="button"
      aria-label={speaking ? "음성 안내 중지" : "이 답변 음성으로 듣기"}
      aria-pressed={speaking}
      disabled={disabled || unsupported}
      title={unsupported ? "이 브라우저에서는 음성 안내를 지원하지 않아요." : undefined}
      onClick={onClick}
    >
      <span aria-hidden="true">{speaking ? "■" : "🔊"}</span>
      {speaking ? "정지" : "듣기"}
    </button>
  );
}
