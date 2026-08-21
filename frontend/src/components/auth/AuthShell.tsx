"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { FlowLinkLogo } from "@/components/common/FlowLinkLogo";
import { Icon } from "@/components/common/Icon";
import { DaruSettings } from "@/components/mascot";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useTheme } from "@/components/theme/ThemeProvider";
import { AuthApiError, completeSocialRegistration, getCurrentUser, getOAuthStartUrl, login, register, SocialAuthProvider } from "@/lib/authApi";

type AuthMode = "login" | "register";
type AuthPortal = "default" | "admin";
type FieldErrors = Record<string, string>;
type SocialProvider = SocialAuthProvider;

const socialProviders: { id: SocialProvider; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "naver", label: "네이버" },
  { id: "kakao", label: "카카오" },
];

function isSocialProvider(value: string | null): value is SocialProvider {
  return value === "google" || value === "naver" || value === "kakao";
}

function getOAuthErrorMessage(providerValue: string | null, reason: string | null) {
  const provider = isSocialProvider(providerValue)
    ? socialProviders.find((item) => item.id === providerValue)?.label ?? "소셜"
    : "소셜";

  if (reason === "provider") return `${provider} 로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.`;
  if (reason === "state") return "소셜 로그인 인증 시간이 만료되었거나 인증 정보가 올바르지 않습니다. 다시 시도해주세요.";
  if (reason === "conflict") return "이미 같은 이메일로 가입된 FlowLink 계정이 있습니다. 기존 계정으로 로그인해주세요.";
  if (reason === "account") return "현재 이 계정으로 로그인할 수 없습니다. 계정 상태를 확인해주세요.";
  if (reason === "denied") return "소셜 로그인이 취소되었습니다.";
  return "소셜 로그인 중 문제가 발생했습니다. 다시 시도해주세요.";
}

function SocialProviderMark({ provider }: { provider: SocialProvider }) {
  if (provider === "google") {
    return (
      <svg className="auth-social-mark auth-social-mark-google" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z" />
        <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.3l-3.3-2.6c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.6A10.1 10.1 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.4H3.1a10.1 10.1 0 0 0 0 9.2L6.5 14Z" />
        <path fill="#EA4335" d="M12 6a5.4 5.4 0 0 1 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 12 2a10.1 10.1 0 0 0-8.9 5.4l3.4 2.7A5.9 5.9 0 0 1 12 6Z" />
      </svg>
    );
  }
  if (provider === "naver") {
    return <span className="auth-social-mark auth-social-mark-naver" aria-hidden="true">N</span>;
  }
  return (
    <svg className="auth-social-mark auth-social-mark-kakao" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4C6.9 4 3 7 3 10.8c0 2.4 1.6 4.5 4 5.7l-1 3.7 4.3-2.8c.6.1 1.1.2 1.7.2 5.1 0 9-3 9-6.8S17.1 4 12 4Z" />
    </svg>
  );
}

function SocialAuthSection({
  mode,
  onSelect,
  pendingProvider,
}: {
  mode: AuthMode;
  onSelect: (provider: SocialProvider) => void;
  pendingProvider: SocialProvider | null;
}) {
  const actionLabel = mode === "login" ? "간편 로그인" : "간편 가입";
  return (
    <section className="auth-social" aria-labelledby="auth-social-title">
      <h2 id="auth-social-title">{actionLabel}</h2>
      <div className="auth-social-buttons">
        {socialProviders.map((provider) => (
          <button
            key={provider.id}
            className="auth-social-button"
            type="button"
            aria-label={`${provider.label} ${actionLabel}`}
            disabled={pendingProvider !== null}
            aria-busy={pendingProvider === provider.id}
            onClick={() => onSelect(provider.id)}
          >
            <SocialProviderMark provider={provider.id} />
            <span>{provider.label}</span>
          </button>
        ))}
      </div>
      <div className="auth-email-divider" role="separator" aria-label="이메일 인증">
        <span>또는 이메일</span>
      </div>
    </section>
  );
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordPattern = /^(?=.*[A-Za-z])(?=.*[0-9]).{8,128}$/;
const passwordPolicyMessage = "비밀번호는 영문과 숫자를 조합해 8~128자로 입력해주세요.";
const passwordMismatchMessage = "비밀번호가 일치하지 않습니다.";

function getPasswordConditions(password: string) {
  return [
    { label: "8자 이상", met: password.length >= 8 && password.length <= 128 },
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
              {hasInput && condition.met ? <Icon name="check" size={17} /> : <i />}
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
  const [submitError, setSubmitError] = useState(false);
  const [roleMismatch, setRoleMismatch] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordShakeKey, setPasswordShakeKey] = useState(0);
  const [confirmShakeKey, setConfirmShakeKey] = useState(0);
  const [pendingSocialProvider, setPendingSocialProvider] = useState<SocialProvider | null>(null);
  const [socialRegistrationProvider, setSocialRegistrationProvider] = useState<SocialProvider | null>(null);

  useEffect(() => {
    if (isLogin) return;
    const provider = new URLSearchParams(window.location.search).get("social");
    if (isSocialProvider(provider)) {
      const frame = requestAnimationFrame(() => setSocialRegistrationProvider(provider));
      return () => cancelAnimationFrame(frame);
    }
  }, [isLogin]);

  useEffect(() => {
    if (!isLogin || isAdminPortal) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("oauth_error")) return;
    const frame = requestAnimationFrame(() => {
      setSubmitError(true);
      setSubmitMessage(getOAuthErrorMessage(params.get("oauth_error"), params.get("reason")));
    });
    return () => cancelAnimationFrame(frame);
  }, [isAdminPortal, isLogin]);

  const isSocialRegistration = !isLogin && socialRegistrationProvider !== null;

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

    if (!isSocialRegistration) {
      if (!email) nextErrors.email = "이메일을 입력해주세요.";
      else if (!emailPattern.test(email)) nextErrors.email = "올바른 이메일 형식을 입력해주세요.";
      if (!password) nextErrors.password = isLogin ? "비밀번호를 입력해주세요." : passwordPolicyMessage;
    }

    if (!isLogin) {
      const nickname = String(data.get("nickname") ?? "").trim();
      const confirm = String(data.get("password-confirm") ?? "");
      if (!nickname) nextErrors.nickname = "닉네임을 입력해주세요.";
      else if (nickname.length < 2) nextErrors.nickname = "닉네임은 2자 이상 입력해주세요.";
      if (!isSocialRegistration) {
        if (!passwordPattern.test(password)) nextErrors.password = passwordPolicyMessage;
        if (!confirm) nextErrors["password-confirm"] = "비밀번호를 한 번 더 입력해주세요.";
        else if (password !== confirm) nextErrors["password-confirm"] = passwordMismatchMessage;
      }
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

  const handleSocialAuth = (provider: SocialProvider) => {
    const providerLabel = socialProviders.find((item) => item.id === provider)?.label ?? provider;
    setRoleMismatch(false);
    setSubmitError(false);
    setPendingSocialProvider(provider);
    setSubmitMessage(`${providerLabel} 인증 페이지로 이동하고 있습니다.`);
    try {
      window.location.assign(getOAuthStartUrl(provider));
    } catch (error) {
      setPendingSocialProvider(null);
      setSubmitError(true);
      setSubmitMessage(error instanceof AuthApiError ? error.message : "소셜 인증을 시작하지 못했습니다.");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitMessage("");
    setSubmitError(false);
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
      } else if (isSocialRegistration) {
        await completeSocialRegistration({
          nickname: String(data.get("nickname") ?? "").trim(),
          terms_agreed: data.get("terms") === "on",
          privacy_agreed: data.get("privacy") === "on",
        });
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
        setSubmitError(true);
        setSubmitMessage("일반 사용자 계정입니다. FlowLink 사용자 서비스에서 이용해주세요.");
        return;
      }
      setSubmitMessage(currentUser.role === "ADMIN" ? "운영자 계정을 확인했습니다. 운영 허브로 이동합니다." : "로그인되었습니다.");
      router.replace(currentUser.role === "ADMIN" ? "/admin" : isLogin ? getSafeNextPath() : "/");
      router.refresh();
    } catch (error) {
      const socialRegistrationExpired = isSocialRegistration && error instanceof AuthApiError && error.status === 401;
      const message = socialRegistrationExpired
        ? "소셜 인증 시간이 만료되었습니다. 아래 간편 가입에서 다시 인증해주세요."
        : error instanceof AuthApiError && error.status === 401
        ? "이메일 또는 비밀번호를 확인해주세요."
        : error instanceof AuthApiError
        ? error.message
        : "인증 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
      if (socialRegistrationExpired) setSocialRegistrationProvider(null);
      setSubmitError(true);
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
          {!isAdminPortal && <DaruSettings />}
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

            {!isAdminPortal && !isSocialRegistration && <SocialAuthSection mode={mode} onSelect={handleSocialAuth} pendingProvider={pendingSocialProvider} />}
            {isSocialRegistration && (
              <p className="auth-social-pending" role="status">
                {socialProviders.find((provider) => provider.id === socialRegistrationProvider)?.label} 인증이 완료됐습니다. 닉네임과 필수 약관을 확인해주세요.
              </p>
            )}

            <div className="auth-fields">
              {!isSocialRegistration && <div className="auth-field">
                <label htmlFor="email">이메일</label>
                <input id="email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} />
                {errors.email && <p className="auth-error" id="email-error">{errors.email}</p>}
              </div>}
              {!isLogin && (
                <div className="auth-field">
                  <label htmlFor="nickname">닉네임</label>
                  <input id="nickname" name="nickname" type="text" autoComplete="nickname" placeholder="사용할 닉네임을 입력해주세요" aria-invalid={Boolean(errors.nickname)} aria-describedby={errors.nickname ? "nickname-error" : undefined} />
                  {errors.nickname && <p className="auth-error" id="nickname-error">{errors.nickname}</p>}
                </div>
              )}
              {!isSocialRegistration && <PasswordField
                id="password"
                label="비밀번호"
                placeholder={isLogin ? "비밀번호를 입력해주세요" : "영문·숫자 조합 8자 이상"}
                error={errors.password}
                autoComplete={isLogin ? "current-password" : "new-password"}
                minLength={isLogin ? undefined : 8}
                maxLength={isLogin ? undefined : 128}
                pattern={isLogin ? undefined : "^(?=.*[A-Za-z])(?=.*[0-9]).{8,128}$"}
                onChange={isLogin ? undefined : handlePasswordChange}
                onBlur={isLogin ? undefined : handlePasswordBlur}
                value={isLogin ? undefined : password}
                valid={!isLogin && password.length > 0 && passwordPattern.test(password)}
                shakeKey={passwordShakeKey}
                describedBy={!isLogin ? "password-conditions" : undefined}
              >
                {!isLogin && <PasswordConditions password={password} />}
              </PasswordField>}
              {!isLogin && !isSocialRegistration && <PasswordField id="password-confirm" label="비밀번호 확인" placeholder="비밀번호를 한 번 더 입력해주세요" error={errors["password-confirm"]} autoComplete="new-password" maxLength={128} onChange={handleConfirmChange} onBlur={handleConfirmBlur} value={passwordConfirm} valid={passwordConfirm.length > 0 && passwordPattern.test(password) && passwordConfirm === password} shakeKey={confirmShakeKey} describedBy={passwordConfirm.length > 0 && passwordPattern.test(password) && passwordConfirm === password ? "password-confirm-success" : undefined}>{passwordConfirm.length > 0 && passwordPattern.test(password) && passwordConfirm === password && <p className="auth-password-success" id="password-confirm-success"><Icon name="check" size={15} />비밀번호와 일치해요</p>}</PasswordField>}
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
              {isCheckingSession ? "로그인 확인 중..." : isSubmitting ? (isLogin ? "로그인 확인 중..." : "가입 중...") : (isAdminPortal ? "운영 허브 로그인" : isLogin ? "로그인" : isSocialRegistration ? "소셜 가입 완료" : "FlowLink 시작하기")}
            </button>
            {submitMessage && <p className={`auth-submit-message${roleMismatch || submitError ? " is-error" : ""}`} role={roleMismatch || submitError ? "alert" : "status"}>{submitMessage}</p>}
            {isAdminPortal ? <p className="auth-switch"><Link href="/login">일반 로그인으로 돌아가기</Link></p> : <p className="auth-switch">{isLogin ? "계정이 없으신가요?" : "이미 계정이 있으신가요?"} <Link href={isLogin ? "/register" : "/login"}>{isLogin ? "회원가입" : "로그인"}</Link></p>}
            {roleMismatch && <Link className="auth-role-action" href="/">사용자 서비스로 이동</Link>}
            {isLogin && !isAdminPortal && <p className="auth-portal-link">운영자이신가요? <Link href="/admin/login">운영 허브 로그인</Link></p>}
          </form>
        </section>
      </main>
    </div>
  );
}
