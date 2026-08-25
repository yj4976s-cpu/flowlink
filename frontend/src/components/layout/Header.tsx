"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";
import { Icon } from "@/components/common/Icon";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { NotificationToastHost } from "@/components/notifications/NotificationToastHost";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { DaruSettings } from "@/components/mascot";
import { AuthUser, getCurrentUser, logout as logoutRequest } from "@/lib/authApi";
import { AUTH_CHANGED_EVENT } from "@/lib/authEvents";

type NavigationItem = {
  label: string;
  href: string;
  children?: readonly { label: string; href: string }[];
  activePaths?: readonly string[];
};

const userNavigation: readonly NavigationItem[] = [
  { label: "분실 신고", href: "/lost-reports/new" },
  {
    label: "발견물 센터",
    href: "/found-items",
    children: [
      { label: "발견물 목록", href: "/found-items" },
      { label: "발견물 지도", href: "/map" },
    ],
  },
  { label: "물건 확인", href: "/detect" },
  { label: "커뮤니티", href: "/community" },
  { label: "내 진행 상황", href: "/mypage" },
  { label: "다루 놀이터", href: "/daru-game" },
];

const adminNavigation: readonly NavigationItem[] = [
  {
    label: "업무 처리",
    href: "/admin",
    activePaths: ["/admin", "/admin/detections", "/admin/citizen-reports", "/admin/ownership-claims"],
    children: [
      { label: "관리자 대시보드", href: "/admin" },
      { label: "AI 탐지 검토", href: "/admin/detections" },
      { label: "시민 제보 관리", href: "/admin/citizen-reports" },
      { label: "소유권 요청", href: "/admin/ownership-claims" },
    ],
  },
  {
    label: "발견물 관리",
    href: "/admin/found-items",
    activePaths: ["/admin/found-items", "/admin/map"],
    children: [
      { label: "발견물 목록", href: "/admin/found-items" },
      { label: "관리자 지도", href: "/admin/map" },
    ],
  },
  {
    label: "운영 분석",
    href: "/admin/ai-report",
    activePaths: ["/admin/ai-report", "/admin/users", "/admin/community-posts"],
    children: [
      { label: "AI 리포트", href: "/admin/ai-report" },
      { label: "사용자 관리", href: "/admin/users" },
      { label: "게시글 관리", href: "/admin/community-posts" },
    ],
  },
];

function isNavigationItemCurrent(item: NavigationItem, pathname: string) {
  if (item.activePaths) {
    return item.activePaths.some((path) => pathname === path || (path !== "/admin" && pathname.startsWith(`${path}/`)));
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function LogoutConfirmDialog({ user, pending, error, onCancel, onConfirm }: { user: AuthUser; pending: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) { event.preventDefault(); onCancel(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", keyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", keyDown); };
  }, [onCancel, pending]);
  return <div className="logout-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !pending && onCancel()}>
    <section ref={dialogRef} className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title" aria-describedby="logout-dialog-description">
      <span className="logout-dialog-icon"><Icon name="logout" size={20} /></span>
      <h2 id="logout-dialog-title">로그아웃하시겠어요?</h2>
      <p id="logout-dialog-description">현재 계정에서 로그아웃합니다.</p>
      <div className="logout-account-summary">
        <span aria-hidden="true"><Icon name="user" size={19} /></span>
        <div><strong>{user.nickname}</strong><small>{user.email}</small></div>
        <b>{user.role === "ADMIN" ? "관리자" : "일반 사용자"}</b>
      </div>
      {error && <p className="logout-dialog-error" role="alert">{error}</p>}
      <div className="logout-dialog-actions"><button ref={cancelRef} type="button" className="button button-secondary" disabled={pending} onClick={onCancel}>취소</button><button type="button" className="button button-primary" disabled={pending} onClick={onConfirm}>{pending ? "로그아웃 중..." : "로그아웃"}</button></div>
    </section>
  </div>;
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [openNavGroup, setOpenNavGroup] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const logoutTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((user) => {
        if (active) setCurrentUser(user);
      })
      .catch(() => {
        if (active) setCurrentUser(null);
      })
      .finally(() => { if (active) setAuthResolved(true); });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const syncAuth = (event: Event) => {
      const user = (event as CustomEvent<AuthUser | null>).detail;
      setCurrentUser(user);
      setAuthResolved(true);
      if (!user) {
        setProfileOpen(false);
        setNotificationOpen(false);
        setLogoutConfirm(false);
      }
    };
    window.addEventListener(AUTH_CHANGED_EVENT, syncAuth);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, syncAuth);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!logoutConfirm) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, logoutConfirm]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeProfile = (event: MouseEvent) => {
      if (logoutConfirm) return;
      if (!profileRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
        setLogoutConfirm(false);
        setLogoutError("");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!logoutConfirm) setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", closeProfile);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeProfile);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen, logoutConfirm]);

  const closeMenu = () => { setOpen(false); setLogoutConfirm(false); setLogoutError(""); setOpenNavGroup(null); };
  const changeNotificationOpen = useCallback((nextOpen: boolean) => {
    setNotificationOpen(nextOpen);
    if (nextOpen) {
      setProfileOpen(false);
      setLogoutConfirm(false);
      setLogoutError("");
    }
  }, []);
  const isAdmin = currentUser?.role === "ADMIN";
  const navigation = isAdmin ? adminNavigation : userNavigation;
  const handleLogout = async () => {
    if (logoutPending) return;
    setLogoutPending(true);
    setLogoutError("");
    try {
      await logoutRequest();
      setCurrentUser(null);
      setProfileOpen(false);
      setNotificationOpen(false);
      closeMenu();
      if (pathname === "/detect") {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      } else {
        router.replace("/");
      }
      router.refresh();
    } catch {
      setLogoutError("로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLogoutPending(false);
    }
  };
  const requestLogout = () => { setLogoutError(""); setLogoutConfirm(true); };
  const continueSession = () => { if (!logoutPending) { setLogoutConfirm(false); setLogoutError(""); window.setTimeout(() => logoutTriggerRef.current?.focus()); } };
  const renderDesktopNavItem = (item: (typeof navigation)[number]) => {
    const isCurrent = isNavigationItemCurrent(item, pathname);
    const isGroupCurrent = item.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`)) ?? false;
    if (item.children?.length) {
      const expanded = openNavGroup === item.label;
      return (
        <div
          className="nav-group"
          data-active={isGroupCurrent || isCurrent}
          key={item.label}
          onMouseEnter={() => setOpenNavGroup(item.label)}
          onMouseLeave={() => setOpenNavGroup(null)}
          onFocus={() => setOpenNavGroup(item.label)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpenNavGroup(null);
          }}
        >
          <Link className="nav-group-trigger" href={item.href} aria-current={isCurrent ? "page" : undefined} aria-haspopup="true" aria-expanded={expanded}>
            {item.label}
            <Icon name="chevron" size={14} />
          </Link>
          <div className="nav-submenu" aria-label={`${item.label} 하위 메뉴`}>
            {item.children.map((child) => {
              const childCurrent = pathname === child.href || pathname.startsWith(`${child.href}/`);
              return <Link key={child.href} href={child.href} aria-current={childCurrent ? "page" : undefined}>{child.label}</Link>;
            })}
          </div>
        </div>
      );
    }
    return <Link key={item.label} href={item.href} aria-current={isCurrent ? "page" : undefined}>{item.label}</Link>;
  };

  return (
    <header className="site-header" id="top">
      <div className="header-inner">
        <FlowLinkLogo />
        <nav className="desktop-nav" aria-label={isAdmin ? "관리자 메뉴" : "주요 메뉴"} aria-busy={!authResolved}>
          {authResolved && navigation.map(renderDesktopNavItem)}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <DaruSettings />
          {authResolved && (currentUser ? (
            <>
              {!isAdmin && <NotificationCenter key={currentUser.id} userId={currentUser.id} open={notificationOpen} onOpenChange={changeNotificationOpen} />}
              <div className="profile-menu-wrap" ref={profileRef}>
                <button className="profile-trigger" type="button" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => { setProfileOpen((value) => !value); setNotificationOpen(false); setLogoutConfirm(false); setLogoutError(""); }}>
                  <span className="profile-avatar" aria-hidden="true"><Icon name="user" size={17} /></span>
                  <span>{currentUser.nickname}님</span>
                  <span className={`profile-chevron${profileOpen ? " is-open" : ""}`}><Icon name="chevron" size={16} /></span>
                </button>
                <div className={`profile-dropdown${profileOpen ? " is-open" : ""}`} role="menu" aria-hidden={!profileOpen}>
                  <div className="profile-dropdown-user">
                    <strong>{currentUser.nickname}님</strong>
                    <span>{currentUser.email}</span>
                  </div>
                  <div className="profile-dropdown-links">
                    <Link href={isAdmin ? "/admin" : "/mypage"} role="menuitem" onClick={() => setProfileOpen(false)}><Icon name="user" size={18} />{isAdmin ? "관리자 정보" : "마이페이지"}</Link>
                  </div>
                  <button ref={logoutTriggerRef} type="button" role="menuitem" onClick={requestLogout}><Icon name="logout" size={18} />로그아웃</button>
                </div>
              </div>
            </>
          ) : (
            <Link className="login-link" href="/login">로그인</Link>
          ))}
          {authResolved && !isAdmin && <Link className="button button-primary header-cta" href="/lost-reports/new">분실 신고하기</Link>}
          <button
            ref={buttonRef}
            type="button"
            className="menu-button"
            aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => { setOpen((value) => !value); setNotificationOpen(false); setProfileOpen(false); }}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </div>
      {open && <button className="menu-backdrop" aria-label="메뉴 닫기" onClick={closeMenu} />}
      {open && (
        <div ref={menuRef} id="mobile-menu" className="mobile-menu is-open">
          <nav aria-label="모바일 메뉴">
            {authResolved && navigation.map((item) => {
              const isCurrent = isNavigationItemCurrent(item, pathname);
              const groupCurrent = item.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`)) ?? false;
              return (
                <Fragment key={item.label}>
                  <Link href={item.href} onClick={closeMenu} aria-current={isCurrent ? "page" : undefined} data-active={groupCurrent || isCurrent}>
                    {item.label}
                  </Link>
                  {item.children?.map((child) => {
                    const childCurrent = pathname === child.href || pathname.startsWith(`${child.href}/`);
                    return <Link className="mobile-sub-link" key={child.href} href={child.href} onClick={closeMenu} aria-current={childCurrent ? "page" : undefined}>{child.label}</Link>;
                  })}
                </Fragment>
              );
            })}
            {currentUser ? (
              <>
                {isAdmin && <Link href="/admin" onClick={closeMenu}>관리자 정보</Link>}
                {!isAdmin && <Link href="/notifications" onClick={closeMenu}>알림</Link>}
                <button className="mobile-auth-button" type="button" onClick={requestLogout}>로그아웃</button>
              </>
            ) : (
              <Link href="/login" onClick={closeMenu}>로그인</Link>
            )}
            {!isAdmin && <Link className="button button-primary" href="/lost-reports/new" onClick={closeMenu}>분실 신고하기</Link>}
          </nav>
        </div>
      )}
      {logoutConfirm && currentUser && <LogoutConfirmDialog user={currentUser} pending={logoutPending} error={logoutError} onCancel={continueSession} onConfirm={() => void handleLogout()} />}
      <NotificationToastHost key={currentUser?.id ?? "guest"} user={currentUser} />
    </header>
  );
}
