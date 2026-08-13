"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { AuthApiError, getCurrentUser } from "@/lib/authApi";

export function AdminRouteGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let active = true;
    getCurrentUser().then((user) => {
      if (!active) return;
      if (user.role === "ADMIN") setAllowed(true);
      else router.replace("/admin/login");
    }).catch((error: unknown) => {
      if (!active) return;
      router.replace(error instanceof AuthApiError && error.status === 401 ? "/admin/login" : "/");
    });
    return () => { active = false; };
  }, [router]);

  if (!allowed) {
    return <main className="admin-auth-loading" aria-busy="true" aria-live="polite"><div /><span>관리자 권한을 확인하고 있습니다.</span></main>;
  }
  return children;
}
