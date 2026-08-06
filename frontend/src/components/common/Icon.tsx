export type IconName =
  | "sun" | "moon" | "menu" | "close" | "arrow" | "scan"
  | "document" | "check" | "spark" | "cube" | "match" | "return"
  | "location" | "clock";

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    sun: <><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon: <path d="M20 15.2A8 8 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"/>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    scan: <><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/><path d="M3 9V4h5M21 9V4h-5M3 15v5h5M21 15v5h-5"/></>,
    document: <><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
    spark: <><path d="M12 3v18M7 5.5c-3 2-3 11 0 13M17 5.5c3 2 3 11 0 13M4 12h16"/><circle cx="12" cy="12" r="3"/></>,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
    match: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3"/></>,
    return: <><path d="M7 11V7a3 3 0 0 1 6 0v5M13 10V6a3 3 0 0 1 6 0v8c0 4-3 7-7 7H9c-3 0-5-2-5-5v-4a2 2 0 0 1 3-1Z"/><path d="m10 16 2 2 4-5"/></>,
    location: <><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  };

  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
