import type { Metadata } from "next";
import { Noto_Sans_KR, Noto_Serif_KR } from "next/font/google";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { FlowCopilot } from "@/components/copilot/FlowCopilot";
import "./globals.css";

const notoSans = Noto_Sans_KR({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  fallback: ["Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "sans-serif"],
});

const notoSerif = Noto_Serif_KR({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  fallback: ["Noto Serif", "Batang", "serif"],
});

export const metadata: Metadata = {
  title: "FlowLink | AI 수변 부유 객체 탐지 및 분실물 연결",
  description:
    "AI가 수변 공간의 부유 객체를 탐지하고 분실 신고, 매칭, 반환을 연결하는 FlowLink 서비스",
};

const themeScript = `
  (() => {
    try {
      const stored = localStorage.getItem("flowlink-theme");
      const theme = stored === "dawn" || stored === "night" || stored === "day" ? stored : "day";
      if (stored !== theme) localStorage.setItem("flowlink-theme", theme);
      document.documentElement.dataset.theme = theme;
    } catch (_) {
      document.documentElement.dataset.theme = "day";
    }
  })();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      data-theme="day"
      suppressHydrationWarning
      className={`${notoSans.variable} ${notoSerif.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>{children}<FlowCopilot /></ThemeProvider>
      </body>
    </html>
  );
}
