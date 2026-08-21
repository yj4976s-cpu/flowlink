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
      <path d="M5.7 8.1C4.3 7.9 3.5 6.8 3.8 5.7c.3-1.2 1.7-1.7 2.8-.9.5.4.8 1 .8 1.7" fill="#855438" />
      <path d="M18.3 8.1c1.4-.2 2.2-1.3 1.9-2.4-.3-1.2-1.7-1.7-2.8-.9-.5.4-.8 1-.8 1.7" fill="#855438" />
      <path d="M12 3.7c-4.5 0-7.7 3.2-7.7 7.5 0 4.6 3.1 7.4 7.7 7.4s7.7-2.8 7.7-7.4c0-4.3-3.2-7.5-7.7-7.5Z" fill="#9B6847" />
      <path d="M12 9.2c-2.7 0-4.7 1.5-4.7 3.6 0 2.2 1.9 3.7 4.7 3.7s4.7-1.5 4.7-3.7c0-2.1-2-3.6-4.7-3.6Z" fill="#EBC9A6" />
      <circle cx="8.9" cy="9.1" r=".85" fill="#211A18" />
      <circle cx="15.1" cy="9.1" r=".85" fill="#211A18" />
      <path d="M10.7 11.4c.7-.5 1.9-.5 2.6 0 .2.2.2.5 0 .7l-.9.7a.7.7 0 0 1-.8 0l-.9-.7c-.2-.2-.2-.5 0-.7Z" fill="#33231E" />
      <path d="M12 12.7v1.1m0 0c-.5.5-1.1.6-1.6.3m1.6-.3c.5.5 1.1.6 1.6.3M7.2 11.9l-2.4-.5m2.4 1.7-2.5.2m12.1-1.4 2.4-.5m-2.4 1.7 2.5.2" stroke="#5F3D2D" strokeWidth=".65" strokeLinecap="round" />
      <path d="M6.3 16.2c3.5 1.4 7.9 1.4 11.4 0l-.6 2c-3.2 1.1-7 1.1-10.2 0l-.6-2Z" fill="currentColor" />
      <path d="M15.6 17.3 18 19.1l-.8-2.7-1.6.9Z" fill="currentColor" />
      <path d="M5 20.8c1.7-1 3.4-1 5.1 0s3.4 1 5.1 0 3.1-1 4.6-.2" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}
