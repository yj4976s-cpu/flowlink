export type IconName =
  | "sunrise"
  | "sun"
  | "moon"
  | "menu"
  | "close"
  | "arrow"
  | "send"
  | "scan"
  | "scanLine"
  | "document"
  | "check"
  | "spark"
  | "cube"
  | "match"
  | "return"
  | "location"
  | "clock"
  | "user"
  | "bell"
  | "logout"
  | "chevron"
  | "chevronLeft"
  | "chevronRight"
  | "eye"
  | "eyeOff"
  | "category"
  | "ball"
  | "bag"
  | "backpack"
  | "umbrella"
  | "footwear"
  | "slipper"
  | "archive"
  | "locate"
  | "userSearch"
  | "packageCheck"
  | "fileSearch"
  | "info"
  | "search"
  | "refresh"
  | "camera"
  | "maximize"
  | "layers"
  | "plus"
  | "more"
  | "edit"
  | "trash";

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    sunrise: (
      <>
        <path d="M4 18h16M6 14h12M12 3v3M4.9 7.9l2.1 2.1M19.1 7.9 17 10" />
        <path d="M8 14a4 4 0 0 1 8 0" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    moon: <path d="M20 15.2A8 8 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    send: <path d="m3.5 11.2 16-7-5.8 15.6-3.1-6.4-7.1-2.2Zm7.1 2.2 8.9-9.2" />,
    scan: (
      <>
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="7" />
        <path d="M3 9V4h5M21 9V4h-5M3 15v5h5M21 15v5h-5" />
      </>
    ),
    scanLine: (
      <>
        <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
        <path d="M5 12h14M8 9h8M8 15h8" />
      </>
    ),
    document: (
      <>
        <rect x="6" y="3" width="12" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16 9" />
      </>
    ),
    spark: (
      <>
        <path d="M12 3v18M7 5.5c-3 2-3 11 0 13M17 5.5c3 2 3 11 0 13M4 12h16" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    cube: (
      <>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
      </>
    ),
    match: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" />
      </>
    ),
    return: (
      <>
        <path d="M7 11V7a3 3 0 0 1 6 0v5M13 10V6a3 3 0 0 1 6 0v8c0 4-3 7-7 7H9c-3 0-5-2-5-5v-4a2 2 0 0 1 3-1Z" />
        <path d="m10 16 2 2 4-5" />
      </>
    ),
    location: (
      <>
        <path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      </>
    ),
    bell: (
      <>
        <path d="M6 10a6 6 0 0 1 12 0v5l2 2H4l2-2v-5" />
        <path d="M10 20h4" />
      </>
    ),
    logout: (
      <>
        <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9" />
      </>
    ),
    chevron: <path d="m7 9 5 5 5-5" />,
    chevronLeft: <path d="m15 18-6-6 6-6" />,
    chevronRight: <path d="m9 6 6 6-6 6" />,
    eye: (
      <>
        <path d="M3 12s3.2-5.5 9-5.5 9 5.5 9 5.5-3.2 5.5-9 5.5S3 12 3 12Z" />
        <circle cx="12" cy="12" r="2.4" />
      </>
    ),
    eyeOff: (
      <>
        <path d="M3 3l18 18" />
        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.8 10.8 0 0 1 21 12a12.7 12.7 0 0 1-2.4 3.4M6.6 6.6A12.8 12.8 0 0 0 3 12s3.2 5.5 9 5.5a8.8 8.8 0 0 0 2.1-.3" />
      </>
    ),
    category: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
      </>
    ),
    ball: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m12 7 4.2 3-1.6 4.9H9.4L7.8 10 12 7ZM12 3v4M20.6 9.2 16.2 10M17.3 19l-2.7-4.1M6.7 19l2.7-4.1M3.4 9.2l4.4.8" />
      </>
    ),
    bag: (
      <>
        <path d="M5 8h14l1 12H4L5 8Z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2M8 12v1M16 12v1" />
      </>
    ),
    backpack: (
      <>
        <path d="M7 9V7a5 5 0 0 1 10 0v2M6 9h12a2 2 0 0 1 2 2v9H4v-9a2 2 0 0 1 2-2Z" />
        <path d="M8 14h8v6M4 13H2v5h2M20 13h2v5h-2" />
      </>
    ),
    umbrella: (
      <>
        <path d="M4 11a8 8 0 0 1 16 0H4Z" />
        <path d="M12 3v14a3 3 0 0 0 6 0M7 11c.4-4.7 2-7.3 5-8M17 11c-.4-4.7-2-7.3-5-8" />
      </>
    ),
    footwear: (
      <>
        <path d="M5 5c2.5 0 3.3 2.2 4.4 4.2 1.2 2.1 3.2 3.2 6 3.4 2.4.2 3.6 1.4 3.6 3.4v2H5c-1.3 0-2-.7-2-2v-2.5c0-1.5.6-2.8 2-3.5V5Z" />
        <path d="M8.3 10.5 11 9M10.3 12.4l2.6-1.5M4 18h15" />
      </>
    ),
    slipper: (
      <>
        <path d="M5 15c2.2-1.9 4.2-4.6 5.4-8.2.4-1.3 1.7-2.1 3-1.7 1.2.4 1.9 1.7 1.5 3l-1.2 3.5c2.5.5 4.6 1.8 5.3 3.8.5 1.4-.5 2.9-2 3.1l-9.4 1.3C4.4 20.2 2.6 17.1 5 15Z" />
        <path d="M9 11.2c1.8.1 3.5.7 4.7 1.7" />
      </>
    ),
    archive: (
      <>
        <path d="M4 8h16v12H4V8Z" />
        <path d="M3 4h18v4H3V4ZM9 12h6" />
      </>
    ),
    locate: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        <path d="M7 7 5 5M17 7l2-2M7 17l-2 2M17 17l2 2" />
      </>
    ),
    userSearch: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 18a5.5 5.5 0 0 1 9.7-3.6" />
        <circle cx="17" cy="16" r="3" />
        <path d="m19.2 18.2 2.3 2.3" />
      </>
    ),
    packageCheck: (
      <>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9M8.5 6l7.5 4" />
        <path d="m14.5 15.5 1.3 1.3 2.7-3" />
      </>
    ),
    fileSearch: (
      <>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
        <path d="M14 3v5h5M14 3l5 5v4" />
        <circle cx="16.5" cy="16.5" r="3.5" />
        <path d="m19 19 2 2M8 12h4M8 8h2" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M4 17v-5h5" />
        <path d="M6.1 9a7 7 0 0 1 11.5-2.6L20 9M4 15l2.4 2.6A7 7 0 0 0 17.9 15" />
      </>
    ),
    camera: (
      <>
        <path d="M4 7h3l1.4-2h7.2L17 7h3v12H4V7Z" />
        <circle cx="12" cy="13" r="3.5" />
        <path d="M17 10h.01" />
      </>
    ),
    maximize: (
      <>
        <path d="M9 4H4v5M15 4h5v5M20 15v5h-5M4 15v5h5" />
        <path d="m4 9 5-5M15 4l5 5M20 15l-5 5M9 20l-5-5" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    edit: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
      </>
    ),
  };

  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
