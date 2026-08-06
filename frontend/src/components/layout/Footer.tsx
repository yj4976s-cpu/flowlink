import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <FlowLinkLogo />
        <nav aria-label="하단 메뉴">
          <a href="#process">서비스 소개</a>
          <a href="#guide">이용 안내</a>
          <a href="#privacy">개인정보처리방침</a>
        </nav>
        <p>© 2026 FlowLink</p>
      </div>
    </footer>
  );
}
