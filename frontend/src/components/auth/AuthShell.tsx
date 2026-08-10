"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useTheme } from "@/components/theme/ThemeProvider";
import { AuthApiError, getCurrentUser, login, register } from "@/lib/authApi";

type AuthMode = "login" | "register";
type FieldErrors = Record<string, string>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const loginScene = {
  dawn: {
    title: <>발견된 순간부터<br />다시 이어질 때까지</>,
    detections: [
      { id: "umbrella", object: "우산", confidence: 94, role: "main" },
      { id: "bag", object: "백팩", confidence: 88, role: "secondary" },
    ],
  },
  day: {
    title: <>흐름을 따라<br />다시 만나는 순간</>,
    detections: [
      { id: "bag", object: "백팩", confidence: 92, role: "main" },
      { id: "footwear", object: "신발", confidence: 87, role: "secondary" },
    ],
  },
  night: {
    title: <>밤의 흐름 속에서도<br />놓치지 않는 연결</>,
    detections: [
      { id: "footwear", object: "신발", confidence: 91, role: "main" },
      { id: "umbrella", object: "우산", confidence: 86, role: "secondary" },
    ],
  },
} as const;

const registerScene = {
  dawn: {
    description: "분실 신고부터 매칭 결과 확인까지, 놓친 순간을 다시 연결합니다.",
    detections: [
      { id: "footwear", object: "신발", confidence: 94, role: "main" },
      { id: "plastic", object: "플라스틱", confidence: 87, role: "secondary" },
    ],
  },
  day: {
    description: "분실 신고부터 매칭 결과 확인까지, 가장 선명한 흐름으로 이어집니다.",
    detections: [
      { id: "ball", object: "공", confidence: 93, role: "main" },
      { id: "can", object: "캔", confidence: 89, role: "secondary" },
    ],
  },
  night: {
    description: "분실 신고부터 매칭 결과 확인까지, 잃어버린 가능성을 끝까지 추적합니다.",
    detections: [
      { id: "umbrella", object: "우산", confidence: 94, role: "main" },
      { id: "bag", object: "백팩", confidence: 91, role: "secondary" },
    ],
  },
} as const;

function ConfidenceCount({ target, delay = 470, duration = 950 }: { target: number; delay?: number; duration?: number }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    if (reducedMotion) {
      frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }

    let startedAt: number | null = null;
    const startDelay = delay;
    const tick = (time: number) => {
      if (startedAt === null) startedAt = time;
      const elapsed = time - startedAt;
      if (elapsed < startDelay) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min((elapsed - startDelay) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [delay, duration, target]);

  return <>{value}%</>;
}

function PasswordField({
  id,
  label,
  placeholder,
  error,
  autoComplete,
}: {
  id: string;
  label: string;
  placeholder: string;
  error?: string;
  autoComplete: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className={`auth-input-wrap${error ? " has-error" : ""}`}>
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? `${label} 숨기기` : `${label} 표시`}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {visible ? (
              <><path d="M3 3l18 18" /><path d="M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.8 10.8 0 0 1 21 12a12.7 12.7 0 0 1-2.4 3.4M6.6 6.6A12.8 12.8 0 0 0 3 12s3.2 5.5 9 5.5a8.8 8.8 0 0 0 2.1-.3" /></>
            ) : (
              <><path d="M3 12s3.2-5.5 9-5.5 9 5.5 9 5.5-3.2 5.5-9 5.5S3 12 3 12Z" /><circle cx="12" cy="12" r="2.4" /></>
            )}
          </svg>
        </button>
      </div>
      {error && <p className="auth-error" id={errorId}>{error}</p>}
    </div>
  );
}

function AuthVisual({ mode }: { mode: AuthMode }) {
  const isLogin = mode === "login";
  const { theme } = useTheme();

  if (isLogin) {
    const scene = loginScene[theme];
    return (
      <section className={`auth-visual auth-login-visual auth-theme-${theme}`} aria-label={`${scene.detections.map((item) => item.object).join(", ")}을 탐지한 FlowLink 수변 장면`}>
        <div key={theme} className="auth-login-sequence">
          <div className="auth-login-scene" aria-hidden="true" />
          <div className="auth-visual-content">
            <p className="auth-visual-eyebrow">AI DETECTION</p>
            <h2>{scene.title}</h2>
            <p>발견과 반환 사이의 흐름을<br />FlowLink가 연결합니다.</p>
            <div className="auth-micro-flow auth-login-flow" aria-label="발견, 연결, 반환 흐름">
              {["발견", "연결", "반환"].map((step) => <span key={step}><i />{step}</span>)}
            </div>
          </div>
          {scene.detections.map((detection, index) => (
            <div key={detection.id} className={`auth-login-detection auth-login-detection-${detection.id} is-${detection.role} sequence-${index + 1}`} aria-label={`${detection.object}, 탐지 신뢰도 ${detection.confidence}%`}>
              <i className="auth-detection-anchor" aria-hidden="true" />
              <i className="auth-detection-leader" aria-hidden="true" />
              <div className="auth-detection-card">
                <span className="auth-detection-name">{detection.object}</span>
                <strong><span>신뢰도</span> <em><ConfidenceCount target={detection.confidence} delay={index === 0 ? 450 : 590} duration={600} /></em></strong>
                <i aria-hidden="true" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const scene = registerScene[theme];
  return (
    <section key={theme} className={`auth-visual auth-register-visual auth-theme-${theme}`} aria-label={`${scene.detections.map((item) => item.object).join(", ")}을 탐지한 FlowLink 회원가입 수변 장면`}>
      <div className="auth-visual-content">
        <p className="auth-visual-eyebrow">AI DETECTION</p>
        <h2>잃어버린 물건과<br />다시 만날 가능성을 연결합니다</h2>
        <p>분실 신고와 수면 위 발견을 연결해<br />소중한 물건의 귀환을 시작합니다.</p>
        <div className="auth-micro-flow" aria-hidden="true">
          {["신고", "발견", "연결"].map((step) => <span key={step}><i />{step}</span>)}
        </div>
      </div>
      {scene.detections.map((detection, index) => (
        <div
          key={detection.id}
          className={`auth-detection auth-register-detection auth-register-detection-${detection.id} is-${detection.role} sequence-${index + 1}`}
          aria-label={`${detection.object}, 탐지 신뢰도 ${detection.confidence}%`}
        >
          <span>{detection.object}</span>
          <strong>신뢰도 <ConfidenceCount target={detection.confidence} delay={index === 0 ? 420 : 850} /></strong>
          <i aria-hidden="true" />
        </div>
      ))}
    </section>
  );
}

export function AuthShell({ mode }: { mode: AuthMode }) {
  const isLogin = mode === "login";
  const router = useRouter();
  const { theme } = useTheme();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");

  const validate = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const nextErrors: FieldErrors = {};
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    if (!email) nextErrors.email = "이메일을 입력해주세요.";
    else if (!emailPattern.test(email)) nextErrors.email = "올바른 이메일 형식을 입력해주세요.";
    if (!password) nextErrors.password = "비밀번호를 입력해주세요.";
    else if (password.length < 8) nextErrors.password = "비밀번호는 8자 이상 입력해주세요.";

    if (!isLogin) {
      const nickname = String(data.get("nickname") ?? "").trim();
      const confirm = String(data.get("password-confirm") ?? "");
      if (!nickname) nextErrors.nickname = "닉네임을 입력해주세요.";
      else if (nickname.length < 2) nextErrors.nickname = "닉네임은 2자 이상 입력해주세요.";
      if (!confirm) nextErrors["password-confirm"] = "비밀번호를 한 번 더 입력해주세요.";
      else if (password !== confirm) nextErrors["password-confirm"] = "비밀번호가 일치하지 않습니다.";
      if (data.get("terms") !== "on" || data.get("privacy") !== "on") nextErrors.agreements = "필수 항목에 동의해주세요.";
    }
    return nextErrors;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitMessage("");
    const nextErrors = validate(event.currentTarget);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    setIsSubmitting(true);
    try {
      if (isLogin) {
        await login({ email, password });
      } else {
        await register({
          email,
          password,
          nickname: String(data.get("nickname") ?? "").trim(),
          terms_agreed: data.get("terms") === "on",
          privacy_agreed: data.get("privacy") === "on",
        });
      }

      const currentUser = await getCurrentUser();
      setSubmitMessage(`${currentUser.nickname}님, 환영합니다.`);
      router.replace("/");
      router.refresh();
    } catch (error) {
      const message = error instanceof AuthApiError
        ? error.message
        : "인증 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
      setSubmitMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`auth-page auth-page-${mode}`}>
      <header className="auth-header">
        <FlowLinkLogo />
        <div className="auth-header-actions">
          <ThemeToggle />
          <Link className="auth-home-link" href="/">홈으로</Link>
        </div>
      </header>
      <main className="auth-main">
        <AuthVisual mode={mode} />
        <section className="auth-form-panel" aria-labelledby="auth-title">
          <form className="auth-form" noValidate onSubmit={handleSubmit}>
            <p className="auth-form-eyebrow">{isLogin ? "WELCOME BACK" : "GET STARTED"}</p>
            <h1 id="auth-title">{isLogin ? "다시 만나서 반가워요" : <>FlowLink를 <span>시작해볼까요?</span></>}</h1>
            <p className="auth-form-description">{isLogin ? "FlowLink에 로그인해 매칭과 신고 내역을 확인하세요." : registerScene[theme].description}</p>

            <div className="auth-fields">
              <div className="auth-field">
                <label htmlFor="email">이메일</label>
                <input id="email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} />
                {errors.email && <p className="auth-error" id="email-error">{errors.email}</p>}
              </div>
              {!isLogin && (
                <div className="auth-field">
                  <label htmlFor="nickname">닉네임</label>
                  <input id="nickname" name="nickname" type="text" autoComplete="nickname" placeholder="사용할 닉네임을 입력해주세요" aria-invalid={Boolean(errors.nickname)} aria-describedby={errors.nickname ? "nickname-error" : undefined} />
                  {errors.nickname && <p className="auth-error" id="nickname-error">{errors.nickname}</p>}
                </div>
              )}
              <PasswordField id="password" label="비밀번호" placeholder="비밀번호를 입력해주세요" error={errors.password} autoComplete={isLogin ? "current-password" : "new-password"} />
              {!isLogin && <PasswordField id="password-confirm" label="비밀번호 확인" placeholder="비밀번호를 한 번 더 입력해주세요" error={errors["password-confirm"]} autoComplete="new-password" />}
            </div>

            {!isLogin && (
              <fieldset className="auth-agreements" aria-describedby={errors.agreements ? "agreements-error" : undefined}>
                <legend className="sr-only">필수 동의</legend>
                <div className="auth-agreement-row"><label><input type="checkbox" name="terms" /><span className="auth-checkbox" aria-hidden="true" /><b>이용약관에 동의합니다.</b></label><Link href="/terms">보기</Link></div>
                <div className="auth-agreement-row"><label><input type="checkbox" name="privacy" /><span className="auth-checkbox" aria-hidden="true" /><b>개인정보 처리방침에 동의합니다.</b></label><Link href="/privacy">보기</Link></div>
                {errors.agreements && <p className="auth-error" id="agreements-error">{errors.agreements}</p>}
              </fieldset>
            )}

            <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (isLogin ? "로그인 중..." : "가입 중...") : (isLogin ? "로그인" : "FlowLink 시작하기")}
            </button>
            {submitMessage && <p className="auth-submit-message" role="status">{submitMessage}</p>}
            <p className="auth-switch">{isLogin ? "계정이 없으신가요?" : "이미 계정이 있으신가요?"} <Link href={isLogin ? "/register" : "/login"}>{isLogin ? "회원가입" : "로그인"}</Link></p>
          </form>
        </section>
      </main>
    </div>
  );
}
