import type { ObjectKind } from "@/types/home";

export function ObjectIllustration({ kind, title }: { kind: ObjectKind; title?: string }) {
  return (
    <svg className={`object-illustration object-${kind}`} viewBox="0 0 180 135" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={`object-fill-${kind}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".95" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".55" />
        </linearGradient>
      </defs>
      {kind === "backpack" && <g>
        <path d="M68 39c0-17 10-26 22-26s22 9 22 26" fill="none" stroke="currentColor" strokeWidth="8" />
        <path d="M50 49c0-9 7-16 16-16h48c9 0 16 7 16 16l8 66c1 8-5 14-13 14H55c-8 0-14-6-13-14Z" fill={`url(#object-fill-${kind})`} stroke="currentColor" strokeWidth="3" />
        <path d="M64 38c9 9 43 9 52 0M57 53c11-7 56-7 67 0" fill="none" stroke="var(--object-detail)" strokeWidth="2" opacity=".6" />
        <path d="M61 65h58M58 88h64M69 101h42v18H69Z" fill="none" stroke="var(--object-detail)" strokeWidth="3" opacity=".65" />
        <path d="M49 62c-12 9-13 34-7 50M131 62c12 9 13 34 7 50" fill="none" stroke="currentColor" strokeWidth="5" />
      </g>}
      {kind === "umbrella" && <g>
        <path d="M25 64C39 27 71 15 94 18c28 3 50 21 61 50-18-9-28-5-34 3-11-11-21-12-32-1-10-12-21-12-32-1-9-8-19-10-32-5Z" fill={`url(#object-fill-${kind})`} stroke="currentColor" strokeWidth="3" />
        <path d="M31 59c28-19 82-32 117 2" fill="none" stroke="var(--object-detail)" strokeWidth="2" opacity=".65" />
        <path d="M92 20 88 98c-1 19 19 25 25 9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M57 69c8-25 20-41 35-49M121 71c-6-25-15-42-29-51" fill="none" stroke="var(--object-detail)" strokeWidth="2" opacity=".55" />
      </g>}
      {kind === "branch" && <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M25 104c37-14 67-35 129-76" strokeWidth="12" />
        <path d="M28 100c39-17 69-38 124-73" stroke="var(--object-detail)" strokeWidth="3" opacity=".4" />
        <path d="M71 76 57 44M100 59l24-31M122 45l31 10M50 88l-25-9" strokeWidth="7" />
        <path d="M28 102c39-14 67-35 126-73" stroke="var(--object-detail)" strokeWidth="2.5" opacity=".55" />
      </g>}
      {kind === "container" && <g>
        <path d="m38 43 15-20h82l9 20-8 77H47Z" fill={`url(#object-fill-${kind})`} fillOpacity=".42" stroke="currentColor" strokeWidth="4" />
        <path d="M36 43h110M53 23l10 20M133 23l-9 20M61 58h60v46H61Z" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="m64 61 54 40M118 61l-54 40" stroke="var(--object-detail)" strokeWidth="2" opacity=".45" />
      </g>}
    </svg>
  );
}
