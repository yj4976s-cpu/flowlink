import { MyPageClient } from "@/components/mypage/MyPageClient";
import { Suspense } from "react";
import { UserRouteGuard } from "@/components/auth/UserRouteGuard";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function MyPage() {
  return <UserRouteGuard><div className="site-shell"><Header /><Suspense fallback={null}><MyPageClient /></Suspense><Footer /></div></UserRouteGuard>;
}
