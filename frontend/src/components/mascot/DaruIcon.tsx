type DaruIconProps = {
  className?: string;
  size?: number;
};

export function DaruIcon({ className, size = 18 }: DaruIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <image href="/mascot/daru-header-otter.png" x="2.5" y="1" width="19" height="19" preserveAspectRatio="xMidYMid meet" />
      <path d="M4.8 21c1.75-1 3.5-1 5.25 0s3.5 1 5.25 0 3.25-1 4.75-.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}
