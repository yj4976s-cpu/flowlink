import Link from "next/link";
import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <FlowLinkLogo />
        <nav aria-label="하단 메뉴">
          <Link href="/#process">서비스 소개</Link>
          <Link href="/guide">이용 안내</Link>
          <Link href="/privacy">개인정보처리방침</Link>
        </nav>
        <p>© 2026 FlowLink</p>
      </div>
    </footer>
  );
}
