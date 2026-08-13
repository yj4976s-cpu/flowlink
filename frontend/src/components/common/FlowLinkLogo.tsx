import Link from "next/link";

export function FlowLinkLogo() {
  return (
    <Link className="brand" href="/" aria-label="FlowLink 홈">
      <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M8 18c5-5 9-5 14 0s9 5 12 0M8 24c5-5 9-5 14 0s9 5 12 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M20 7v7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span>FlowLink</span>
    </Link>
  );
}
