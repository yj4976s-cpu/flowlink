"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { AuthApiError, getCurrentUser } from "@/lib/authApi";

export function UserRouteGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let active = true;
    getCurrentUser().then((user) => {
      if (!active) return;
      if (user.role === "USER") setAllowed(true);
      else router.replace("/admin");
    }).catch((error: unknown) => {
      if (active) router.replace(error instanceof AuthApiError && error.status === 401 ? "/login" : "/");
    });
    return () => { active = false; };
  }, [router]);
  if (!allowed) return <main className="admin-auth-loading" aria-busy="true"><div /><span>계정 권한을 확인하고 있습니다.</span></main>;
  return children;
}
