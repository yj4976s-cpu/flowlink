"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";
import { Icon } from "@/components/common/Icon";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

const navigation = [
  { label: "발견물 찾기", href: "/found-items" },
  { label: "분실 신고", href: "/lost-reports/new" },
  { label: "서비스 소개", href: "/about" },
  { label: "이용 안내", href: "/guide" },
] as const;

export function Header() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  const closeMenu = () => setOpen(false);

  return (
    <header className="site-header" id="top">
      <div className="header-inner">
        <FlowLinkLogo />
        <nav className="desktop-nav" aria-label="주요 메뉴">
          {navigation.map((item) => <Link key={item.label} href={item.href}>{item.label}</Link>)}
        </nav>
        <div className="header-actions">
          <Link className="login-link" href="/login">로그인</Link>
          <ThemeToggle />
          <Link className="button button-primary header-cta" href="/lost-reports/new">분실 신고하기</Link>
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
            {navigation.map((item) => (
              <Link key={item.label} href={item.href} onClick={closeMenu}>{item.label}</Link>
            ))}
            <Link href="/login" onClick={closeMenu}>로그인</Link>
            <Link className="button button-primary" href="/lost-reports/new" onClick={closeMenu}>분실 신고하기</Link>
          </nav>
        </div>
      )}
    </header>
  );
}
