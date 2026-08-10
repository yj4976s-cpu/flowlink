"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/components/common/Icon";
import { AuthApiError, getCurrentUser } from "@/lib/authApi";
import styles from "./DetectionWorkbench.module.css";

const detectPath = "/detect";
const loginPath = `/login?next=${encodeURIComponent(detectPath)}`;

export function DetectionAuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "ready" | "error">("checking");
  const [message, setMessage] = useState("");

  const checkAuth = async () => {
    setStatus("checking");
    setMessage("");
    try {
      await getCurrentUser();
      setStatus("ready");
    } catch (caught) {
      if (caught instanceof AuthApiError && caught.status === 401) {
        router.replace(loginPath);
        return;
      }
      setMessage("로그인 상태를 확인하지 못했습니다.");
      setStatus("error");
    }
  };

  useEffect(() => {
    let active = true;

    const checkInitialAuth = async () => {
      try {
        await getCurrentUser();
        if (active) setStatus("ready");
      } catch (caught) {
        if (!active) return;
        if (caught instanceof AuthApiError && caught.status === 401) {
          router.replace(loginPath);
          return;
        }
        setMessage("로그인 상태를 확인하지 못했습니다.");
        setStatus("error");
      }
    };

    void checkInitialAuth();
    return () => {
      active = false;
    };
  }, [router]);

  if (status === "ready") return <>{children}</>;

  return (
    <main className={styles.page}>
      <section className={styles.stateCard} role={status === "error" ? "alert" : "status"} aria-live="polite">
        <Icon name={status === "error" ? "spark" : "scan"} size={24} />
        <div>
          <strong>{status === "error" ? message : "로그인 상태를 확인하고 있습니다."}</strong>
          {status === "error" && (
            <button className="button button-secondary" type="button" onClick={() => void checkAuth()}>
              다시 시도
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
