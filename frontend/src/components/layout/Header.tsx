"use client";

import { useEffect, useRef, useState } from "react";
import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";
import { Icon } from "@/components/common/Icon";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

const navigation = [
  { label: "발견물 찾기", href: "#recent-items", enabled: true },
  { label: "분실 신고", enabled: false },
  { label: "서비스 소개", href: "#process", enabled: true },
  { label: "이용 안내", enabled: false },
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
          {navigation.map((item) => (
            item.enabled ? (
              <a key={item.label} href={item.href}>{item.label}</a>
            ) : (
              <span key={item.label} className="nav-link is-disabled" aria-disabled="true" title="준비 중인 기능입니다">{item.label}</span>
            )
          ))}
        </nav>
        <div className="header-actions">
          <span className="login-link is-disabled" aria-disabled="true" title="준비 중인 기능입니다">로그인</span>
          <ThemeToggle />
          <button type="button" className="button button-primary header-cta is-disabled" disabled title="준비 중인 기능입니다">분실 신고하기</button>
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
              item.enabled ? (
                <a key={item.label} href={item.href} onClick={closeMenu}>{item.label}</a>
              ) : (
                <span key={item.label} className="nav-link is-disabled" aria-disabled="true" title="준비 중인 기능입니다">{item.label}</span>
              )
            ))}
            <span className="nav-link is-disabled" aria-disabled="true" title="준비 중인 기능입니다">로그인</span>
            <button type="button" className="button button-primary is-disabled" disabled title="준비 중인 기능입니다">분실 신고하기</button>
          </nav>
        </div>
      )}
    </header>
  );
}
