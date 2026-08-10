"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";
import { Icon } from "@/components/common/Icon";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { AuthUser, getCurrentUser, logout as logoutRequest } from "@/lib/authApi";

const userNavigation = [
  { label: "AI 탐지", href: "/detect" },
  { label: "발견물 센터", href: "/found-items" },
  { label: "분실 신고", href: "/lost-reports/new" },
  { label: "서비스 소개", href: "/about" },
  { label: "이용 안내", href: "/guide" },
] as const;

const adminNavigation = [
  { label: "대시보드", href: "/admin" },
  { label: "시민 제보", href: "/admin/citizen-reports" },
  { label: "소유권 요청", href: "/admin/ownership-claims" },
] as const;

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

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
    if (!open) return;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeProfile = (event: MouseEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", closeProfile);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeProfile);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

  const closeMenu = () => setOpen(false);
  const isAdmin = currentUser?.role === "ADMIN";
  const navigation = isAdmin ? adminNavigation : userNavigation;
  const handleLogout = async () => {
    try {
      await logoutRequest();
      setCurrentUser(null);
      setProfileOpen(false);
      closeMenu();
      if (pathname === "/detect") {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      } else {
        router.replace("/");
      }
      router.refresh();
    } catch {
      // Keep the authenticated UI when the server could not clear the cookie.
    }
  };

  return (
    <header className="site-header" id="top">
      <div className="header-inner">
        <FlowLinkLogo />
        <nav className="desktop-nav" aria-label={isAdmin ? "관리자 메뉴" : "주요 메뉴"} aria-busy={!authResolved}>
          {authResolved && navigation.map((item) => <Link key={item.label} href={item.href}>{item.label}</Link>)}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          {authResolved && (currentUser ? (
            <div className="profile-menu-wrap" ref={profileRef}>
              <button className="profile-trigger" type="button" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>
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
                  {!isAdmin && <Link href="/notifications" role="menuitem" onClick={() => setProfileOpen(false)}><Icon name="bell" size={18} />알림</Link>}
                </div>
                <button type="button" role="menuitem" onClick={handleLogout}><Icon name="logout" size={18} />로그아웃</button>
              </div>
            </div>
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
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </div>
      {open && <button className="menu-backdrop" aria-label="메뉴 닫기" onClick={closeMenu} />}
      {open && (
        <div ref={menuRef} id="mobile-menu" className="mobile-menu is-open">
          <nav aria-label="모바일 메뉴">
            {authResolved && navigation.map((item) => (
              <Link key={item.label} href={item.href} onClick={closeMenu}>{item.label}</Link>
            ))}
            {currentUser ? (
              <>
                <Link href={isAdmin ? "/admin" : "/mypage"} onClick={closeMenu}>{isAdmin ? "관리자 정보" : "마이페이지"}</Link>
                {!isAdmin && <Link href="/notifications" onClick={closeMenu}>알림</Link>}
                <button className="mobile-auth-button" type="button" onClick={handleLogout}>로그아웃</button>
              </>
            ) : (
              <Link href="/login" onClick={closeMenu}>로그인</Link>
            )}
            {!isAdmin && <Link className="button button-primary" href="/lost-reports/new" onClick={closeMenu}>분실 신고하기</Link>}
          </nav>
        </div>
      )}
    </header>
  );
}
