"use client";

import { useEffect, useRef, useState } from "react";
import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";
import { Icon } from "@/components/common/Icon";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

const navigation = [
  ["발견물 찾기", "#recent-items"],
  ["분실 신고", "#report"],
  ["서비스 소개", "#process"],
  ["이용 안내", "#guide"],
  ["공지사항", "#notice"],
];

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
          {navigation.map(([label, href]) => <a key={label} href={href}>{label}</a>)}
        </nav>
        <div className="header-actions">
          <a className="login-link" href="#login">로그인</a>
          <ThemeToggle />
          <a className="button button-primary header-cta" href="#report">분실 신고하기</a>
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
            {navigation.map(([label, href]) => <a key={label} href={href} onClick={closeMenu}>{label}</a>)}
            <a href="#login" onClick={closeMenu}>로그인</a>
            <a className="button button-primary" href="#report" onClick={closeMenu}>분실 신고하기</a>
          </nav>
        </div>
      )}
    </header>
  );
}
