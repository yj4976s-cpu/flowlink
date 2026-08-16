"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";
import { Icon } from "@/components/common/Icon";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useTheme } from "@/components/theme/ThemeProvider";
import { AuthApiError, getCurrentUser, login, register } from "@/lib/authApi";

type AuthMode = "login" | "register";
type AuthPortal = "default" | "admin";
type FieldErrors = Record<string, string>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordPattern = /^(?=.*[A-Za-z])(?=.*[0-9]).{8,}$/;
const passwordPolicyMessage = "비밀번호는 영문과 숫자를 조합해 8자 이상 입력해주세요.";
const passwordMismatchMessage = "비밀번호가 일치하지 않습니다.";

function getPasswordConditions(password: string) {
  return [
    { label: "8자 이상", met: password.length >= 8 },
    { label: "영문 포함", met: /[A-Za-z]/.test(password) },
    { label: "숫자 포함", met: /[0-9]/.test(password) },
  ];
}

const loginScene = {
  dawn: {
    moment: "FLOW 01 · DISCOVER",
    title: <>새로운 발견이<br />흐름을 시작합니다</>,
    description: <>수면 위 발견을 놓치지 않고<br />다시 연결될 가능성을 찾습니다.</>,
    activeStep: 0,
    detections: [
      { id: "umbrella", object: "우산", confidence: 94, role: "main" },
      { id: "bag", object: "백팩", confidence: 88, role: "secondary" },
    ],
  },
  day: {
    moment: "FLOW 02 · CONNECT",
    title: <>발견된 순간이<br />다시 연결되는 과정</>,
    description: <>신고와 발견물 후보를 비교해<br />이어질 가능성을 확인합니다.</>,
    activeStep: 1,
    detections: [
      { id: "bag", object: "백팩", confidence: 92, role: "main" },
      { id: "footwear", object: "신발", confidence: 87, role: "secondary" },
    ],
  },
  night: {
    moment: "FLOW 03 · RETURN",
    title: <>하루가 지나도<br />연결은 계속됩니다</>,
    description: <>확인 중인 발견과 신고의 흐름을<br />반환까지 이어갑니다.</>,
    activeStep: 2,
    detections: [
      { id: "bag", object: "백팩", confidence: 92, role: "secondary" },
      { id: "footwear", object: "신발", confidence: 91, role: "main" },
      { id: "umbrella", object: "우산", confidence: 86, role: "secondary" },
    ],
  },
} as const;

const registerScene = {
  dawn: {
    description: "분실 신고부터 매칭 결과 확인까지, 놓친 순간을 다시 연결합니다.",
  },
  day: {
    description: "분실 신고부터 매칭 결과 확인까지, 가장 선명한 흐름으로 이어집니다.",
  },
  night: {
    description: "분실 신고부터 매칭 결과 확인까지, 잃어버린 가능성을 끝까지 추적합니다.",
  },
} as const;

function getSafeNextPath() {
  const fallbackPath = "/";
  const nextPath = new URLSearchParams(window.location.search).get("next")?.trim();
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) return fallbackPath;

  const url = new URL(nextPath, window.location.origin);
  if (url.origin !== window.location.origin) return fallbackPath;
  return `${url.pathname}${url.search}${url.hash}`;
}

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
  minLength,
  maxLength,
  pattern,
  onChange,
  onBlur,
  value,
  valid = false,
  shakeKey = 0,
  describedBy,
  children,
}: {
  id: string;
  label: string;
  placeholder: string;
  error?: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void;
  value?: string;
  valid?: boolean;
  shakeKey?: number;
  describedBy?: string;
  children?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const errorId = `${id}-error`;

  useEffect(() => {
    if (shakeKey === 0) return;
    const field = fieldRef.current;
    if (!field) return;
    field.classList.remove("is-shaking");
    void field.offsetWidth;
    field.classList.add("is-shaking");
    const timeout = window.setTimeout(() => field.classList.remove("is-shaking"), 300);
    return () => window.clearTimeout(timeout);
  }, [shakeKey]);

  return (
    <div className={`auth-field auth-password-field${valid ? " is-valid" : ""}`} ref={fieldRef}>
      <label htmlFor={id}>{label}</label>
      <div className={`auth-input-wrap${error ? " has-error" : ""}${valid ? " is-valid" : ""}`}>
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
          minLength={minLength}
          maxLength={maxLength}
          pattern={pattern}
          onChange={onChange}
          onBlur={onBlur}
          value={value}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? `${label} 숨기기` : `${label} 보기`}
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
      {children}
      {error && <p className="auth-error" id={errorId}>{error}</p>}
    </div>
  );
}

function PasswordConditions({ password }: { password: string }) {
  const conditions = getPasswordConditions(password);
  const metCount = conditions.filter((condition) => condition.met).length;
  const hasInput = password.length > 0;
  return (
    <div className={`auth-password-guide${metCount === conditions.length ? " is-complete" : ""}`} id="password-conditions">
      <div><span>비밀번호 조건</span><b>{metCount} / {conditions.length}</b></div>
      <ul aria-label="비밀번호 조건 충족 상태">
        {conditions.map((condition) => (
          <li key={condition.label} className={hasInput && condition.met ? "is-met" : "is-neutral"}>
            <span className="auth-condition-icon" aria-hidden="true">
              {hasInput && condition.met ? <Icon name="check" size={15} /> : <i />}
            </span>
            <span>{condition.label}</span>
            <span className="sr-only">{hasInput && condition.met ? "완료" : "미완료"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuthVisual({ mode, portal }: { mode: AuthMode; portal: AuthPortal }) {
  const isLogin = mode === "login";
  const { theme } = useTheme();

  if (isLogin) {
    const scene = loginScene[theme];
    return (
      <section className={`auth-visual auth-login-visual auth-theme-${theme}`} aria-label={`${scene.detections.map((item) => item.object).join(", ")}을 탐지한 FlowLink 수변 장면`}>
        <div key={theme} className="auth-login-sequence">
          <div className="auth-login-scene" aria-hidden="true" />
          <div className="auth-visual-content">
            <p className="auth-visual-eyebrow">{portal === "admin" ? "OPERATIONS FLOW" : "AI DETECTION"}</p>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
            <div className="auth-micro-flow auth-login-flow" aria-label={`발견, 연결, 반환 흐름. 현재 단계: ${["발견", "연결", "반환"][scene.activeStep]}`}>
              {["발견", "연결", "반환"].map((step, index) => (
                <span key={step} className={index < scene.activeStep ? "is-complete" : index === scene.activeStep ? "is-current" : "is-pending"} aria-current={index === scene.activeStep ? "step" : undefined}>
                  <i aria-hidden="true" />{step}
                </span>
              ))}
            </div>
          </div>
          {scene.detections.map((detection, index) => (
            <div key={detection.id} className={`auth-login-detection auth-login-detection-${detection.id} is-${detection.role} sequence-${index + 1}`} aria-label={`${detection.object}, 탐지 신뢰도 ${detection.confidence}%`}>
              <i className="auth-detection-anchor" aria-hidden="true" />
              <i className="auth-detection-leader" aria-hidden="true" />
              <div className="auth-detection-card">
                <span className="auth-detection-name">{detection.object}</span>
                <strong><span>신뢰도</span> <em>{detection.confidence}%</em></strong>
                <i aria-hidden="true" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section key={theme} className={`auth-visual auth-register-visual auth-theme-${theme}`} aria-label="FlowLink 회원가입 수변 소개 장면">
      <div className="auth-register-copy-card">
        <p className="auth-visual-eyebrow">AI DETECTION</p>
        <h2>잃어버린 순간을<br />다시 이어질 흐름으로</h2>
        <p>분실 신고와 수면 위 발견을 연결해 소중한 물건의 귀환을 시작합니다.</p>
        <div className="auth-micro-flow" aria-hidden="true">
          {["신고", "발견", "연결"].map((step) => <span key={step}><i />{step}</span>)}
        </div>
      </div>
    </section>
  );
}

export function AuthShell({ mode, portal = "default" }: { mode: AuthMode; portal?: AuthPortal }) {
  const isLogin = mode === "login";
  const isAdminPortal = isLogin && portal === "admin";
  const router = useRouter();
  const { theme } = useTheme();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(isLogin);
  const [submitMessage, setSubmitMessage] = useState("");
  const [roleMismatch, setRoleMismatch] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordShakeKey, setPasswordShakeKey] = useState(0);
  const [confirmShakeKey, setConfirmShakeKey] = useState(0);

  useEffect(() => {
    if (!isLogin) return;
    let active = true;
    getCurrentUser().then((currentUser) => {
      if (!active) return;
      if (currentUser.role === "ADMIN") router.replace("/admin");
      else if (isAdminPortal) {
        setRoleMismatch(true);
        setSubmitMessage("일반 사용자 계정입니다. FlowLink 사용자 서비스에서 이용해주세요.");
      } else router.replace("/");
    }).catch(() => {
      // A missing or expired cookie simply means the login form should be shown.
    }).finally(() => {
      if (active) setIsCheckingSession(false);
    });
    return () => { active = false; };
  }, [isAdminPortal, isLogin, router]);

  const validate = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const nextErrors: FieldErrors = {};
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");

    if (!email) nextErrors.email = "이메일을 입력해주세요.";
    else if (!emailPattern.test(email)) nextErrors.email = "올바른 이메일 형식을 입력해주세요.";
    if (!password) nextErrors.password = isLogin ? "비밀번호를 입력해주세요." : passwordPolicyMessage;

    if (!isLogin) {
      const nickname = String(data.get("nickname") ?? "").trim();
      const confirm = String(data.get("password-confirm") ?? "");
      if (!nickname) nextErrors.nickname = "닉네임을 입력해주세요.";
      else if (nickname.length < 2) nextErrors.nickname = "닉네임은 2자 이상 입력해주세요.";
      if (!passwordPattern.test(password)) nextErrors.password = passwordPolicyMessage;
      if (!confirm) nextErrors["password-confirm"] = "비밀번호를 한 번 더 입력해주세요.";
      else if (password !== confirm) nextErrors["password-confirm"] = passwordMismatchMessage;
      if (data.get("terms") !== "on" || data.get("privacy") !== "on") nextErrors.agreements = "필수 항목에 동의해주세요.";
    }
    return nextErrors;
  };

  const clearFieldError = (field: string) => {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handlePasswordChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextPassword = event.currentTarget.value;
    setPassword(nextPassword);
    if (passwordPattern.test(nextPassword)) clearFieldError("password");
    if (passwordConfirm === nextPassword) clearFieldError("password-confirm");
  };

  const handleConfirmChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextConfirm = event.currentTarget.value;
    setPasswordConfirm(nextConfirm);
    if (nextConfirm === password) clearFieldError("password-confirm");
  };

  const handlePasswordBlur = () => {
    if (password && !passwordPattern.test(password)) {
      setErrors((current) => ({ ...current, password: passwordPolicyMessage }));
    }
  };

  const handleConfirmBlur = () => {
    if (passwordConfirm && passwordConfirm !== password) {
      setErrors((current) => ({ ...current, "password-confirm": passwordMismatchMessage }));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitMessage("");
    setRoleMismatch(false);
    const nextErrors = validate(event.currentTarget);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.password) setPasswordShakeKey((current) => current + 1);
      if (nextErrors["password-confirm"]) setConfirmShakeKey((current) => current + 1);
      requestAnimationFrame(() => {
        event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

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
      if (isAdminPortal && currentUser.role !== "ADMIN") {
        setRoleMismatch(true);
        setSubmitMessage("일반 사용자 계정입니다. FlowLink 사용자 서비스에서 이용해주세요.");
        return;
      }
      setSubmitMessage(currentUser.role === "ADMIN" ? "운영자 계정을 확인했습니다. 운영 허브로 이동합니다." : "로그인되었습니다.");
      router.replace(currentUser.role === "ADMIN" ? "/admin" : isLogin ? getSafeNextPath() : "/");
      router.refresh();
    } catch (error) {
      const message = error instanceof AuthApiError && error.status === 401
        ? "이메일 또는 비밀번호를 확인해주세요."
        : error instanceof AuthApiError
        ? error.message
        : "인증 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
      setSubmitMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`auth-page auth-page-${mode}${isAdminPortal ? " auth-page-admin" : ""}`}>
      <header className="auth-header">
        <FlowLinkLogo />
        <div className="auth-header-actions">
          <ThemeToggle />
          <Link className="auth-home-link" href="/">홈으로</Link>
        </div>
      </header>
      <main className="auth-main">
        <AuthVisual mode={mode} portal={portal} />
        <section className="auth-form-panel" aria-labelledby="auth-title">
          <form className="auth-form" noValidate onSubmit={handleSubmit}>
            <p className="auth-form-eyebrow">{isLogin ? <span key={theme} className="auth-moment-label">{loginScene[theme].moment}</span> : "GET STARTED"}</p>
            <h1 id="auth-title">{isLogin ? "다시, 연결을 이어가세요" : <>FlowLink를 <span>시작해볼까요?</span></>}</h1>
            <p className="auth-form-description">{isLogin ? "로그인하고 신고와 발견의 진행 상황을 확인하세요." : registerScene[theme].description}</p>

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
              <PasswordField
                id="password"
                label="비밀번호"
                placeholder={isLogin ? "비밀번호를 입력해주세요" : "영문·숫자 조합 8자 이상"}
                error={errors.password}
                autoComplete={isLogin ? "current-password" : "new-password"}
                minLength={isLogin ? undefined : 8}
                pattern={isLogin ? undefined : "^(?=.*[A-Za-z])(?=.*[0-9]).{8,}$"}
                onChange={isLogin ? undefined : handlePasswordChange}
                onBlur={isLogin ? undefined : handlePasswordBlur}
                value={isLogin ? undefined : password}
                valid={!isLogin && password.length > 0 && passwordPattern.test(password)}
                shakeKey={passwordShakeKey}
                describedBy={!isLogin ? "password-conditions" : undefined}
              >
                {!isLogin && <PasswordConditions password={password} />}
              </PasswordField>
              {!isLogin && <PasswordField id="password-confirm" label="비밀번호 확인" placeholder="비밀번호를 한 번 더 입력해주세요" error={errors["password-confirm"]} autoComplete="new-password" onChange={handleConfirmChange} onBlur={handleConfirmBlur} value={passwordConfirm} valid={passwordConfirm.length > 0 && passwordPattern.test(password) && passwordConfirm === password} shakeKey={confirmShakeKey} describedBy={passwordConfirm.length > 0 && passwordPattern.test(password) && passwordConfirm === password ? "password-confirm-success" : undefined}>{passwordConfirm.length > 0 && passwordPattern.test(password) && passwordConfirm === password && <p className="auth-password-success" id="password-confirm-success"><Icon name="check" size={15} />비밀번호와 일치해요</p>}</PasswordField>}
            </div>

            {!isLogin && (
              <fieldset className="auth-agreements" aria-describedby={errors.agreements ? "agreements-error" : undefined}>
                <legend className="sr-only">필수 동의</legend>
                <div className="auth-agreement-row"><label><input type="checkbox" name="terms" /><span className="auth-checkbox" aria-hidden="true" /><b>이용약관에 동의합니다.</b></label><Link href="/terms">보기</Link></div>
                <div className="auth-agreement-row"><label><input type="checkbox" name="privacy" /><span className="auth-checkbox" aria-hidden="true" /><b>개인정보 처리방침에 동의합니다.</b></label><Link href="/privacy">보기</Link></div>
                {errors.agreements && <p className="auth-error" id="agreements-error">{errors.agreements}</p>}
              </fieldset>
            )}

            <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting || isCheckingSession}>
              {isCheckingSession ? "로그인 확인 중..." : isSubmitting ? (isLogin ? "로그인 확인 중..." : "가입 중...") : (isAdminPortal ? "운영 허브 로그인" : isLogin ? "로그인" : "FlowLink 시작하기")}
            </button>
            {submitMessage && <p className={`auth-submit-message${roleMismatch ? " is-error" : ""}`} role={roleMismatch ? "alert" : "status"}>{submitMessage}</p>}
            {isAdminPortal ? <p className="auth-switch"><Link href="/login">일반 로그인으로 돌아가기</Link></p> : <p className="auth-switch">{isLogin ? "계정이 없으신가요?" : "이미 계정이 있으신가요?"} <Link href={isLogin ? "/register" : "/login"}>{isLogin ? "회원가입" : "로그인"}</Link></p>}
            {roleMismatch && <Link className="auth-role-action" href="/">사용자 서비스로 이동</Link>}
            {isLogin && !isAdminPortal && <p className="auth-portal-link">운영자이신가요? <Link href="/admin/login">운영 허브 로그인</Link></p>}
          </form>
        </section>
      </main>
    </div>
  );
}
