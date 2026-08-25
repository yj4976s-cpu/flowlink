"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Icon } from "@/components/common/Icon";
import { useDaru } from "@/components/mascot";
import { getCurrentUser, type AuthUser } from "@/lib/authApi";
import {
  deleteAllCopilotConversations,
  deleteCopilotConversation,
  getCopilotBriefing,
  getCopilotConversation,
  loadCopilotConversationHistory,
  renameCopilotConversation,
  sendCopilotMessage,
  CopilotApiError,
  type CopilotAction,
  type CopilotCard,
  type CopilotConversationSummary,
  type CopilotHistoryMessage,
  type CopilotResponse,
  type CopilotSuggestion,
} from "@/lib/copilotApi";
import { listNotifications } from "@/lib/notificationsApi";
import { speechVoiceId, useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import { CopilotSpeechButton } from "./CopilotSpeechButton";
import { FlowBeacon } from "./FlowBeacon";
import {
  guestContextPrompts,
  guestIntents,
  resolveChatPrompts,
  type ChatPageContext,
  type ChatRole,
  type ChatPrompt,
  type GuestIntent,
} from "./copilotPrompts";
import {
  getFoundItem,
  listFoundItems,
  type FoundItemDetail,
  type FoundItemListItem,
} from "@/lib/foundItemsApi";
import { listMyMatches, type MatchCandidate } from "@/lib/matchesApi";
import {
  getAdminDashboard,
  type AdminDashboardData,
} from "@/lib/adminDashboardApi";
import {
  listAdminDetections,
  type DetectionEvent,
} from "@/lib/adminDetectionsApi";
import {
  listAdminOwnershipClaims,
  type AdminOwnershipClaim,
} from "@/lib/adminOwnershipClaimsApi";
import styles from "./FlowCopilot.module.css";

function createClientId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    return Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  speechText?: string;
  cards?: CopilotCard[];
  actions?: CopilotAction[];
  suggestions?: CopilotSuggestion[];
};

function getSpeechText(message: UiMessage) {
  return message.speechText?.trim() || message.text;
}

function historyGroup(value: string) {
  const date = new Date(value);
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const day = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const difference = Math.floor((start - day) / 86400000);
  return difference <= 0
    ? "오늘"
    : difference === 1
      ? "어제"
      : difference < 7
        ? "최근 7일"
        : "이전";
}

function conversationContext(item: CopilotConversationSummary) {
  const labels: Record<string, string> = {
    MATCH: "Match",
    ANALYSIS: "Detection",
    LOST_REPORT: "Lost Report",
    FOUND_ITEM: "Found Item",
    OWNERSHIP_CLAIM: "Claim",
  };
  return item.context_entity_id && labels[item.context_type]
    ? `${labels[item.context_type]} #${item.context_entity_id}`
    : null;
}

function pageContext(path: string): ChatPageContext {
  if (path === "/") return "HOME";
  if (path === "/found-items") return "FOUND_ITEMS";
  if (path.startsWith("/community")) return "COMMUNITY";
  if (path.startsWith("/found-items/")) return "FOUND_ITEM_DETAIL";
  if (path === "/lost-reports/new") return "LOST_REPORT_NEW";
  if (path === "/matches") return "MATCH_LIST";
  if (path === "/notifications") return "NOTIFICATIONS";
  if (path === "/mypage") return "MY_PAGE";
  if (path === "/detect") return "DETECTION";
  if (path === "/admin") return "ADMIN_DASHBOARD";
  if (path.startsWith("/admin/detections")) return "ADMIN_DETECTIONS";
  if (path.startsWith("/admin/ownership-claims"))
    return "ADMIN_OWNERSHIP_CLAIMS";
  if (path.startsWith("/admin/found-items")) return "ADMIN_FOUND_ITEMS";
  if (path.startsWith("/admin")) return "ADMIN_OPERATIONS";
  return "GUIDE";
}

function Card({ card }: { card: CopilotCard }) {
  const label =
    card.type === "MATCH"
      ? "신고 매칭"
      : card.type === "ANALYSIS"
        ? "AI 객체 탐지"
        : card.type === "EVIDENCE"
          ? "답변 근거"
          : card.type === "TIMELINE"
            ? "진행 상태"
            : card.type === "COMMUNITY"
              ? "커뮤니티 참고 정보"
              : "FlowLink 상태";
  return (
    <article className={styles.dataCard} data-type={card.type}>
      <div>
        <span>{label}</span>
        {card.score != null && <strong>{card.score}점</strong>}
        {card.confidence != null && (
          <strong>{Math.round(card.confidence * 100)}%</strong>
        )}
      </div>
      <h4>{card.title}</h4>
      {card.subtitle && <p>{card.subtitle}</p>}
      {card.status && <b>{card.status}</b>}
      {card.details.length > 0 && (
        <ul>
          {card.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
      {card.type === "MATCH" && card.score != null && (
        <small>신고 조건 유사도 · 소유 확률이 아닙니다</small>
      )}
      {card.type === "ANALYSIS" && card.confidence != null && (
        <small>이미지 속 객체 분류 신뢰도</small>
      )}
    </article>
  );
}

function StructuredActionButton({
  item,
  disabled = false,
  onAction,
}: {
  item: CopilotAction;
  disabled?: boolean;
  onAction: (item: CopilotAction) => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={() => onAction(item)}>
      <span className={styles.actionLabel}>{item.label}</span>
      {item.type === "NAVIGATE" && (
        <span className={styles.actionChevron}>
          <Icon name="chevronRight" size={15} />
        </span>
      )}
    </button>
  );
}

function QuestionButton({
  text,
  disabled,
  onAsk,
}: {
  text: string;
  disabled: boolean;
  onAsk: (text: string) => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={() => onAsk(text)}>
      {text}
    </button>
  );
}

export function FlowCopilot() {
  const { cue: cueDaru } = useDaru();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [autoSpeechEnabled, setAutoSpeechEnabled] = useState(false);
  const [ratePanelMessageId, setRatePanelMessageId] = useState<string | null>(null);
  const speechPreferenceUserId = user?.role === "USER" ? user.id : null;
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const {
    supported: speechSupported,
    speakingMessageId,
    paused: speechPaused,
    voices: speechVoices,
    selectedVoiceId,
    speechRate,
    setSelectedVoice,
    setSpeechRate,
    speak: speakSpeech,
    pause: pauseSpeech,
    resume: resumeSpeech,
    stop: stopSpeech,
  } = useSpeechSynthesis({
    voiceSelectionEnabled: speechPreferenceUserId !== null,
    voiceStorageUserId: speechPreferenceUserId,
    speechRateStorageUserId: speechPreferenceUserId,
  });
  const previousOpenRef = useRef(open);
  const wasLoadingRef = useRef(false);
  const autoSpeechEnabledRef = useRef(false);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("flowlink:daru-occlusion", { detail: { open } }));
    return () => {
      window.dispatchEvent(new CustomEvent("flowlink:daru-occlusion", { detail: { open: false } }));
    };
  }, [open]);

  useEffect(() => {
    const previousOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (previousOpen === open) return;
    cueDaru(open ? "alert" : "rest", { source: "service", duration: open ? 1800 : 2400 });
  }, [cueDaru, open]);

  useEffect(() => {
    if (!open) {
      stopSpeech();
      setRatePanelMessageId(null);
    }
  }, [open, stopSpeech]);

  useEffect(() => {
    stopSpeech();
    setRatePanelMessageId(null);
  }, [pathname, stopSpeech]);

  useEffect(() => {
    if (loading) cueDaru("listen", { source: "service" });
    else if (wasLoadingRef.current) cueDaru("happy", { source: "service" });
    wasLoadingRef.current = loading;
  }, [cueDaru, loading]);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [unread, setUnread] = useState(0);
  const [briefing, setBriefing] = useState<CopilotResponse | null>(null);
  const [authVersion, setAuthVersion] = useState(0);
  const [showExamples, setShowExamples] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [guestIntent, setGuestIntent] = useState<GuestIntent | null>(null);
  const [publicItems, setPublicItems] = useState<FoundItemListItem[] | null>(
    null,
  );
  const [publicItem, setPublicItem] = useState<FoundItemDetail | null>(null);
  const [myMatches, setMyMatches] = useState<MatchCandidate[] | null>(null);
  const [adminDashboard, setAdminDashboard] =
    useState<AdminDashboardData | null>(null);
  const [adminDetections, setAdminDetections] = useState<
    DetectionEvent[] | null
  >(null);
  const [adminClaims, setAdminClaims] = useState<AdminOwnershipClaim[] | null>(
    null,
  );
  const [adminDataError, setAdminDataError] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    CopilotConversationSummary[]
  >([]);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryError, setMemoryError] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [conversationCount, setConversationCount] = useState(0);
  const [manageHistory, setManageHistory] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [bulkDeleteMode, setBulkDeleteMode] = useState<"selected" | "all" | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [conversationMenu, setConversationMenu] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<CopilotConversationSummary | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const historyBackRef = useRef<HTMLButtonElement>(null);
  const manageHistoryButtonRef = useRef<HTMLButtonElement>(null);
  const conversationMenuTriggers = useRef(new Map<string, HTMLButtonElement>());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const cooldownUntilRef = useRef<number | null>(null);
  const sessionRef = useRef<string | null | undefined>(undefined);
  const sessionGenerationRef = useRef(0);
  const context = pageContext(pathname);

  useEffect(() => {
    if (!authReady) return;
    if (speechPreferenceUserId === null) {
      autoSpeechEnabledRef.current = false;
      setAutoSpeechEnabled(false);
      return;
    }
    let enabled = false;
    try {
      enabled = window.localStorage.getItem(
        `flowlink:copilot:auto-speech:${speechPreferenceUserId}`,
      ) === "true";
    } catch {
      // Keep the safe default when storage is unavailable.
    }
    autoSpeechEnabledRef.current = enabled;
    setAutoSpeechEnabled(enabled);
  }, [authReady, speechPreferenceUserId]);

  const changeAutoSpeech = useCallback((enabled: boolean) => {
    autoSpeechEnabledRef.current = enabled;
    setAutoSpeechEnabled(enabled);
    if (!enabled) stopSpeech();
    try {
      if (speechPreferenceUserId !== null) {
        window.localStorage.setItem(
          `flowlink:copilot:auto-speech:${speechPreferenceUserId}`,
          String(enabled),
        );
      }
    } catch {
      // The in-memory preference still works for the current session.
    }
  }, [speechPreferenceUserId, stopSpeech]);

  const clearCooldown = useCallback(() => {
    cooldownUntilRef.current = null;
    setCooldownRemaining(0);
  }, []);

  const startCooldown = useCallback((seconds: number) => {
    const safeSeconds = Math.max(1, Math.ceil(seconds));
    cooldownUntilRef.current = Date.now() + safeSeconds * 1000;
    setCooldownRemaining(safeSeconds);
  }, []);

  const currentCooldownRemaining = useCallback(() => {
    const until = cooldownUntilRef.current;
    if (!until) return 0;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }, []);

  const resetSessionUi = useCallback(() => {
    stopSpeech();
    setRatePanelMessageId(null);
    setMessages([]);
    setValue("");
    setUnread(0);
    setBriefing(null);
    setConversationId(null);
    setConversations([]);
    setConversationCount(0);
    setMemoryOpen(false);
    setMemoryLoading(false);
    setMemoryError(false);
    setHistoryQuery("");
    setHistoryPage(1);
    setManageHistory(false);
    setSelectedConversationIds(new Set());
    setEditingId(null);
    setEditingTitle("");
    setConversationMenu(null);
    setDeleteTarget(null);
    setBulkDeleteMode(null);
    setDeleteError("");
    setDeleteBusy(false);
    clearCooldown();
  }, [clearCooldown, stopSpeech]);

  const closeConversationMenu = useCallback(
    (conversationPublicId: string | null) => {
      setConversationMenu(null);
      if (conversationPublicId) {
        window.setTimeout(() =>
          conversationMenuTriggers.current.get(conversationPublicId)?.focus(),
        );
      }
    },
    [],
  );

  const resolveSession = useCallback(() => {
    let active = true;
    getCurrentUser()
      .then((current) => {
        if (!active) return;
        const key = `${current.role}:${current.id}`;
        if (sessionRef.current !== undefined && sessionRef.current !== key) {
          sessionGenerationRef.current += 1;
          abortRef.current?.abort();
          abortRef.current = null;
          sendingRef.current = false;
          setLoading(false);
          resetSessionUi();
        }
        sessionRef.current = key;
        setUser(current);
        if (current.role === "USER") {
          void Promise.all([listNotifications("unread"), getCopilotBriefing()])
            .then(([items, nextBriefing]) => {
              if (!active) return;
              setUnread(
                items.filter((item) => item.notification_type === "MATCH_FOUND")
                  .length,
              );
              setBriefing(nextBriefing);
            })
            .catch(() => {
              if (active) {
                setUnread(0);
                setBriefing(null);
              }
            });
        } else {
          setUnread(0);
          void getCopilotBriefing()
            .then((next) => active && setBriefing(next))
            .catch(() => active && setBriefing(null));
        }
      })
      .catch(() => {
        if (active) {
          if (sessionRef.current !== undefined && sessionRef.current !== null) {
            sessionGenerationRef.current += 1;
            abortRef.current?.abort();
            abortRef.current = null;
            sendingRef.current = false;
            setLoading(false);
            setMessages([]);
            setValue("");
          }
          sessionRef.current = null;
          setUser(null);
          resetSessionUi();
        }
      })
      .finally(() => active && setAuthReady(true));
    return () => {
      active = false;
    };
  }, [resetSessionUi]);
  useEffect(resolveSession, [resolveSession, pathname, authVersion]);
  useEffect(() => {
    if (!user) {
      setConversations([]);
      setConversationCount(0);
      return;
    }
    let active = true;
    const requestGeneration = sessionGenerationRef.current;
    const requestSession = sessionRef.current;
    const isCurrentSession = () =>
      active &&
      requestGeneration === sessionGenerationRef.current &&
      requestSession === sessionRef.current;
    setMemoryError(false);
    void loadCopilotConversationHistory()
      .then(({ items, count }) => {
        if (isCurrentSession()) {
          setConversations(items);
          setConversationCount(count);
        }
      })
      .catch(() => {
        if (isCurrentSession()) {
          setConversations([]);
          setConversationCount(0);
          setMemoryError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [user]);
  useEffect(() => {
    const changed = () => {
      sessionGenerationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      sendingRef.current = false;
      setLoading(false);
      resetSessionUi();
      setUser(null);
      setAuthReady(false);
      setAuthVersion((value) => value + 1);
    };
    window.addEventListener("flowlink:auth-changed", changed);
    return () => window.removeEventListener("flowlink:auth-changed", changed);
  }, [resetSessionUi]);
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = window.setInterval(() => {
      const remaining = currentCooldownRemaining();
      setCooldownRemaining(remaining);
      if (remaining <= 0) cooldownUntilRef.current = null;
    }, 500);
    return () => window.clearInterval(timer);
  }, [cooldownRemaining, currentCooldownRemaining]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (deleteTarget && !deleteBusy) {
          setDeleteTarget(null);
          setDeleteError("");
          return;
        }
        if (bulkDeleteMode && !deleteBusy) {
          setBulkDeleteMode(null);
          setDeleteError("");
          window.setTimeout(() => manageHistoryButtonRef.current?.focus());
          return;
        }
        if (conversationMenu) {
          closeConversationMenu(conversationMenu);
          return;
        }
        if (memoryOpen) {
          setMemoryOpen(false);
          setManageHistory(false);
          setSelectedConversationIds(new Set());
          window.setTimeout(() => historyButtonRef.current?.focus());
          return;
        }
        setOpen(false);
        launcherRef.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    window.setTimeout(
      () =>
        memoryOpen
          ? historyBackRef.current?.focus()
          : inputRef.current?.focus(),
      180,
    );
    return () => window.removeEventListener("keydown", close);
  }, [bulkDeleteMode, closeConversationMenu, conversationMenu, deleteBusy, deleteTarget, memoryOpen, open]);
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, loading]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const modeTitle =
    user?.role === "ADMIN"
      ? "Operations Copilot"
      : user
        ? "Personal Copilot"
        : "Guide Mode";
  const role: ChatRole =
    user?.role === "ADMIN" ? "ADMIN" : user ? "USER" : "GUEST";
  const prompts = useMemo(
    () => resolveChatPrompts({ role, pageContext: context }),
    [context, role],
  );
  const entityId = useMemo(() => {
    const match = pathname.match(/\/(\d+)(?:\/|$)/);
    return match ? Number(match[1]) : undefined;
  }, [pathname]);
  useEffect(() => {
    const controller = new AbortController();
    setGuestIntent(null);
    setShowExamples(false);
    setShowRecommendations(false);
    setPublicItems(null);
    setPublicItem(null);
    setMyMatches(null);
    setAdminDataError(false);
    if (context === "FOUND_ITEMS")
      void listFoundItems({}, controller.signal)
        .then(setPublicItems)
        .catch(() => undefined);
    if (context === "FOUND_ITEM_DETAIL" && entityId)
      void getFoundItem(String(entityId), controller.signal)
        .then(setPublicItem)
        .catch(() => undefined);
    if (user?.role === "USER" && context === "MATCH_LIST")
      void listMyMatches(controller.signal)
        .then(setMyMatches)
        .catch(() => undefined);
    if (user?.role === "ADMIN") {
      void Promise.all([
        getAdminDashboard("today", controller.signal),
        listAdminDetections(controller.signal),
        listAdminOwnershipClaims(controller.signal),
      ])
        .then(([dashboard, detections, claims]) => {
          setAdminDashboard(dashboard);
          setAdminDetections(detections);
          setAdminClaims(claims);
        })
        .catch(() => setAdminDataError(true));
    }
    return () => controller.abort();
  }, [context, entityId, user?.role]);
  const latestAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  const history = (nextText: string): CopilotHistoryMessage[] =>
    [
      ...messages
        .filter((item) => item.role !== "system")
        .map((item): CopilotHistoryMessage => ({
          role: item.role as "user" | "assistant",
          content: item.text,
        })),
      { role: "user" as const, content: nextText },
    ].slice(-12);
  const refreshMemory = async () => {
    setMemoryError(false);
    const requestGeneration = sessionGenerationRef.current;
    const requestSession = sessionRef.current;
    try {
      const { items, count } = await loadCopilotConversationHistory();
      if (requestGeneration !== sessionGenerationRef.current || requestSession !== sessionRef.current) return;
      setConversations(items);
      setConversationCount(count);
    } catch (error) {
      if (requestGeneration !== sessionGenerationRef.current || requestSession !== sessionRef.current) return;
      setMemoryError(true);
      throw error;
    }
  };
  const newConversation = () => {
    stopSpeech();
    setRatePanelMessageId(null);
    abortRef.current?.abort();
    setLoading(false);
    setMessages([]);
    setConversationId(null);
    setMemoryOpen(false);
    setManageHistory(false);
    setSelectedConversationIds(new Set());
    setShowExamples(false);
    setShowRecommendations(false);
    clearCooldown();
  };
  const resumeConversation = async (id: string) => {
    stopSpeech();
    setRatePanelMessageId(null);
    abortRef.current?.abort();
    setLoading(false);
    setMemoryLoading(true);
    setMemoryError(false);
    const requestGeneration = sessionGenerationRef.current;
    const requestSession = sessionRef.current;
    try {
      const item = await getCopilotConversation(id);
      if (
        requestGeneration !== sessionGenerationRef.current ||
        requestSession !== sessionRef.current
      )
        return;
      setConversationId(item.public_id);
      setMessages(
        item.messages.map((message) => ({
          id: `stored-${message.id}`,
          role: message.role === "USER" ? "user" : "assistant",
          text: message.content,
          speechText: message.speech_text ?? undefined,
          cards: message.cards,
          actions: message.actions,
          suggestions: message.suggestions,
        })),
      );
      setMemoryOpen(false);
    } catch {
      if (
        requestGeneration === sessionGenerationRef.current &&
        requestSession === sessionRef.current
      )
        setMemoryError(true);
    } finally {
      if (requestGeneration === sessionGenerationRef.current)
        setMemoryLoading(false);
    }
  };

  const ask = async (text: string) => {
    const trimmed = text.trim();
    const remaining = currentCooldownRemaining();
    if (!trimmed || loading || sendingRef.current || remaining > 0) {
      if (remaining > 0) setCooldownRemaining(remaining);
      return;
    }
    sendingRef.current = true;
    const userMessage: UiMessage = {
      id: createClientId(),
      role: "user",
      text: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setValue("");
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const requestGeneration = sessionGenerationRef.current;
    const requestSession = sessionRef.current;
    try {
      const activeConversation = conversationId;
      const response = await sendCopilotMessage(
        history(trimmed),
        { page: context, path: pathname, entity_id: entityId },
        {
          signal: controller.signal,
          conversationId: activeConversation,
          clientMessageId: userMessage.id,
        },
      );
      if (
        controller.signal.aborted ||
        requestGeneration !== sessionGenerationRef.current ||
        requestSession !== sessionRef.current
      )
        return;
      if (activeConversation !== conversationId) return;
      if (response.conversation_public_id)
        setConversationId(response.conversation_public_id);
      const assistantMessage: UiMessage = {
        id: createClientId(),
        role: "assistant",
        text: response.message,
        speechText: response.speech_text ?? undefined,
        cards: response.cards,
        actions: response.actions,
        suggestions: response.suggestions.slice(0, 5),
      };
      setMessages((current) => [...current, assistantMessage]);
      if (user?.role === "USER" && autoSpeechEnabledRef.current) {
        speakSpeech(assistantMessage.id, getSpeechText(assistantMessage));
      }
      void refreshMemory().catch(() => undefined);
      setShowExamples(false);
      setUnread(0);
    } catch (error) {
      if (
        controller.signal.aborted ||
        requestGeneration !== sessionGenerationRef.current ||
        requestSession !== sessionRef.current
      )
        return;
      if (error instanceof CopilotApiError && error.status === 429) {
        const seconds = error.retryAfterSeconds ?? 30;
        startCooldown(seconds);
        setMessages((current) => [
          ...current,
          {
            id: createClientId(),
            role: "system",
            text: `${error.message} 약 ${Math.ceil(seconds)}초 후 다시 시도해주세요.`,
          },
        ]);
      } else {
        setMessages((current) => [
          ...current,
          {
            id: createClientId(),
            role: "system",
            text:
              error instanceof Error
                ? error.message
                : "FlowLink AI 응답을 받지 못했어요.",
          },
        ]);
      }
    } finally {
      if (requestGeneration === sessionGenerationRef.current) {
        sendingRef.current = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(value);
  };
  const action = (item: CopilotAction) => {
    if (item.type === "NAVIGATE") {
      router.push(item.target);
      setOpen(false);
      launcherRef.current?.focus();
    } else void ask(item.target);
  };
  const promptButton = (prompt: ChatPrompt, className?: string) => (
    <button
      className={className}
      type="button"
      key={prompt.id}
      disabled={loading || cooldownRemaining > 0}
      onClick={() => void ask(prompt.message)}
    >
      {className === styles.primaryPrompt ? (
        <>
          <strong>{prompt.title}</strong>
          {prompt.description && <span>{prompt.description}</span>}
        </>
      ) : (
        prompt.title
      )}
    </button>
  );
  const toggleRecommendations = () => {
    setShowRecommendations((current) => !current);
    setShowExamples(false);
  };
  const toggleExamples = () => {
    setShowExamples((current) => !current);
    setShowRecommendations(false);
  };
  const guestPageQuestions = guestContextPrompts(context);
  const briefTitle =
    context === "MATCH_LIST"
      ? "현재 매칭 브리핑"
      : context === "FOUND_ITEMS"
        ? "발견물 브리핑"
        : context === "FOUND_ITEM_DETAIL"
          ? "이 발견물 살펴보기"
          : context === "DETECTION"
            ? "AI 분석 안내"
            : "현재 Flow 브리핑";
  const matchTop = myMatches?.length
    ? [...myMatches].sort((a, b) => b.total_score - a.total_score)[0]
    : null;
  const briefQuestion =
    context === "MATCH_LIST"
      ? "현재 매칭 결과를 분석해서 설명해줘."
      : context === "FOUND_ITEM_DETAIL"
        ? "이 발견물의 AI 분석 결과를 설명해줘."
        : context === "FOUND_ITEMS"
          ? "최근 발견물 흐름을 설명해줘."
          : "현재 상태를 설명해줘.";
  const pendingDetectionObjects =
    adminDetections
      ?.flatMap((event) =>
        event.detected_objects.map((object) => ({ event, object })),
      )
      .filter(({ object }) => object.processing_status === "PENDING") ?? [];
  const pendingClaims =
    adminClaims?.filter((claim) => claim.status === "PENDING") ?? [];
  const lowConfidence = [...pendingDetectionObjects].sort(
    (a, b) => a.object.confidence - b.object.confidence,
  )[0];
  const adminPriorityCount =
    pendingDetectionObjects.length +
    pendingClaims.length +
    (adminDashboard?.metrics.citizen_pending ?? 0);
  const adminFocusTitle =
    context === "ADMIN_DETECTIONS"
      ? "탐지 운영 포커스"
      : context === "ADMIN_OWNERSHIP_CLAIMS"
        ? "소유권 확인 포커스"
        : context === "ADMIN_FOUND_ITEMS"
          ? "발견물 운영 포커스"
          : "오늘의 운영 포커스";

  const guestHome = (
    <div className={styles.welcome}>
      <span>FLOWLINK GUIDE</span>
      {guestIntent ? (
        <section
          className={styles.intentQuestions}
          aria-labelledby="guest-intent-heading"
        >
          <button
            type="button"
            className={styles.backButton}
            onClick={() => setGuestIntent(null)}
          >
            처음으로
          </button>
          <h3 id="guest-intent-heading">{guestIntent.heading}</h3>
          <p>무엇이 궁금한가요?</p>
          <div>
            {guestIntent.questions.map((question) => (
              <QuestionButton
                key={question}
                text={question}
                disabled={loading}
                onAsk={(text) => void ask(text)}
              />
            ))}
          </div>
        </section>
      ) : (
        <>
          <h3>무엇을 도와드릴까요?</h3>
          <p>원하는 도움을 고르면 관련 질문을 간단히 보여드릴게요.</p>
          {context === "FOUND_ITEM_DETAIL" && publicItem && (
            <section className={styles.contextBrief}>
              <small>공개 발견물 정보</small>
              <h4>{publicItem.item_category_name}</h4>
              <dl>
                <div>
                  <dt>발견 구역</dt>
                  <dd>{publicItem.area_name}</dd>
                </div>
                <div>
                  <dt>발견 시각</dt>
                  <dd>
                    {new Date(publicItem.found_at).toLocaleDateString("ko-KR")}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => void ask("이 발견물의 AI 분석 결과를 설명해줘.")}
              >
                이 분석 결과 설명해줘
              </button>
            </section>
          )}
          {context === "HOME" || context === "GUIDE" ? (
            <section className={styles.intentSection}>
              <h4>원하는 도움을 선택하세요</h4>
              <div>
                {guestIntents.map((intent) => (
                  <button
                    type="button"
                    key={intent.id}
                    onClick={() => setGuestIntent(intent)}
                  >
                    <strong>{intent.title}</strong>
                    <span>{intent.description}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className={styles.intentSection}>
              <h4>현재 페이지에 대해 물어보기</h4>
              <div>
                {guestPageQuestions.map((prompt) => (
                  <QuestionButton
                    key={prompt.id}
                    text={prompt.message}
                    disabled={loading}
                    onAsk={(text) => void ask(text)}
                  />
                ))}
              </div>
            </section>
          )}
          <button
            type="button"
            className={styles.singleQuestion}
            onClick={() => void ask("FlowLink는 어떤 서비스야?")}
          >
            FlowLink는 어떤 서비스야?
          </button>
        </>
      )}
    </div>
  );

  const userHome = (
    <div className={styles.welcome}>
      <span>FLOWLINK PERSONAL</span>
      <h3>{briefTitle}</h3>
      <section className={styles.contextBrief} aria-label={briefTitle}>
        {context === "MATCH_LIST" && myMatches === null ? (
          <p className={styles.briefLoading}>매칭 정보를 불러오는 중이에요.</p>
        ) : context === "MATCH_LIST" ? (
          <>
            <p>
              {myMatches!.length
                ? `비슷한 발견물이 ${myMatches!.length}건 있어요.`
                : "아직 새로 확인할 매칭 결과가 없어요."}
            </p>
            <dl>
              <div>
                <dt>관련 발견물</dt>
                <dd>{myMatches!.length}건</dd>
              </div>
              {matchTop && (
                <div>
                  <dt>최고 매칭 점수</dt>
                  <dd>{matchTop.total_score}점</dd>
                </div>
              )}
            </dl>
          </>
        ) : context === "FOUND_ITEMS" && publicItems !== null ? (
          <>
            <p>현재 공개된 발견물 {publicItems.length}건을 확인할 수 있어요.</p>
            <dl>
              {Object.entries(
                publicItems.reduce<Record<string, number>>(
                  (counts, item) => ({
                    ...counts,
                    [item.item_category_name]:
                      (counts[item.item_category_name] ?? 0) + 1,
                  }),
                  {},
                ),
              )
                .slice(0, 4)
                .map(([name, count]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{count}건</dd>
                  </div>
                ))}
            </dl>
          </>
        ) : context === "FOUND_ITEM_DETAIL" && publicItem ? (
          <>
            <p>{publicItem.item_category_name} 발견물의 공개 정보예요.</p>
            <dl>
              <div>
                <dt>발견 구역</dt>
                <dd>{publicItem.area_name}</dd>
              </div>
              <div>
                <dt>물품 상태</dt>
                <dd>{publicItem.status}</dd>
              </div>
            </dl>
          </>
        ) : (
          <p>
            {briefing?.message ?? "현재 FlowLink 데이터를 확인하고 있어요."}
          </p>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => void ask(briefQuestion)}
        >
          {briefQuestion.replace(".", "")}
        </button>
      </section>
      {briefing?.cards.map((card, index) => (
        <Card card={card} key={`briefing-${index}`} />
      ))}
      {briefing?.actions.length ? (
        <nav
          className={`${styles.actions} ${styles.contextActions}`}
          aria-label="내 Flow 바로가기"
        >
          {briefing.actions.map((item) => (
            <StructuredActionButton
              item={item}
              key={`brief-${item.label}`}
              onAction={action}
            />
          ))}
        </nav>
      ) : null}
      <section className={styles.promptSection}>
        <h4>지금 추천</h4>
        {prompts.primaryRecommendation &&
          promptButton(prompts.primaryRecommendation, styles.primaryPrompt)}
        {prompts.contextualPrompts.length > 0 && (
          <>
            <button
              type="button"
              className={styles.disclosure}
              aria-expanded={showRecommendations}
              aria-controls="copilot-recommendations"
              onClick={toggleRecommendations}
            >
              추천 질문 {prompts.contextualPrompts.length}개 더 보기{" "}
              <Icon name="chevron" size={16} />
            </button>
            {showRecommendations && (
              <div
                id="copilot-recommendations"
                className={styles.disclosurePanel}
              >
                {prompts.contextualPrompts.map((prompt) =>
                  promptButton(prompt),
                )}
              </div>
            )}
          </>
        )}
      </section>
      <section className={styles.compactExamples}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={showExamples}
          aria-controls="copilot-home-examples"
          onClick={toggleExamples}
        >
          추천 질문 5개 보기 <Icon name="chevron" size={16} />
        </button>
        {showExamples && (
          <div id="copilot-home-examples" className={styles.disclosurePanel}>
            {prompts.examplePrompts.map((prompt) => promptButton(prompt))}
          </div>
        )}
      </section>
    </div>
  );

  const adminNav = (
    [
      { type: "NAVIGATE", label: "대시보드", target: "/admin" },
      { type: "NAVIGATE", label: "탐지", target: "/admin/detections" },
      { type: "NAVIGATE", label: "요청", target: "/admin/ownership-claims" },
    ] satisfies CopilotAction[]
  ).filter((item) => item.target !== pathname);
  const adminHome = (
    <div className={`${styles.welcome} ${styles.operationsHome}`}>
      <span>FLOWLINK OPERATIONS</span>
      <h3>{adminFocusTitle}</h3>
      {adminDataError ? (
        <section className={styles.operationsError} role="status">
          <strong>운영 데이터 일부를 불러오지 못했어요.</strong>
          <p>대화 기능은 계속 사용할 수 있습니다.</p>
        </section>
      ) : adminDashboard === null ? (
        <section
          className={styles.operationsLoading}
          aria-label="운영 현황을 불러오는 중"
        >
          <i />
          <i />
          <i />
        </section>
      ) : (
        <>
          <p className={styles.operationsSummary}>
            {adminPriorityCount > 0
              ? `지금 우선 확인할 항목이 ${adminPriorityCount}건 있어요. 처리가 필요한 항목부터 확인해보세요.`
              : "현재 우선 확인이 필요한 운영 항목은 없어요."}
          </p>
          <dl className={styles.metricStrip} aria-label="핵심 운영 지표">
            <div>
              <dt>검토 대기</dt>
              <dd>{pendingDetectionObjects.length}</dd>
            </div>
            <div>
              <dt>소유권 확인</dt>
              <dd>{pendingClaims.length}</dd>
            </div>
            <div>
              <dt>제보 대기</dt>
              <dd>{adminDashboard.metrics.citizen_pending}</dd>
            </div>
          </dl>
          <section className={styles.prioritySection}>
            <h4>우선 확인</h4>
            {adminPriorityCount === 0 ? (
              <div className={styles.priorityEmpty}>
                <p>현재 바로 확인해야 할 운영 항목은 없어요.</p>
                <button
                  type="button"
                  onClick={() =>
                    void ask(
                      "현재 운영 상태를 실제 데이터를 기준으로 정리해줘.",
                    )
                  }
                >
                  운영 현황 확인하기
                </button>
              </div>
            ) : (
              <ol>
                {lowConfidence && (
                  <li>
                    <span>01</span>
                    <div>
                      <strong>검토 대기 탐지</strong>
                      <p>
                        {lowConfidence.object.object_class_name} · 탐지 신뢰도{" "}
                        {Math.round(lowConfidence.object.confidence * 100)}%
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        void ask(
                          `탐지 객체 ${lowConfidence.object.id}번에서 관리자가 확인해야 할 점을 실제 데이터 기준으로 설명해줘.`,
                        )
                      }
                    >
                      분석하기
                    </button>
                  </li>
                )}
                {pendingClaims.length > 0 && (
                  <li>
                    <span>{lowConfidence ? "02" : "01"}</span>
                    <div>
                      <strong>소유권 확인 대기</strong>
                      <p>처리 대기 요청 {pendingClaims.length}건</p>
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        void ask(
                          "소유권 확인 대기 요청에서 우선 확인할 내용을 정리해줘.",
                        )
                      }
                    >
                      정리하기
                    </button>
                  </li>
                )}
                {adminDashboard.metrics.citizen_pending > 0 && (
                  <li>
                    <span>
                      {lowConfidence && pendingClaims.length
                        ? "03"
                        : lowConfidence || pendingClaims.length
                          ? "02"
                          : "01"}
                    </span>
                    <div>
                      <strong>발견 제보 대기</strong>
                      <p>
                        검토할 시민 제보{" "}
                        {adminDashboard.metrics.citizen_pending}건
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push("/admin/citizen-reports")}
                    >
                      살펴보기
                    </button>
                  </li>
                )}
              </ol>
            )}
          </section>
          {adminPriorityCount > 0 && (
            <button
              type="button"
              className={styles.operationsAnalyze}
              disabled={loading}
              onClick={() =>
                void ask(
                  "현재 운영 상태에서 우선 확인할 내용을 실제 데이터를 기준으로 정리해줘.",
                )
              }
            >
              현재 운영 상태 분석하기
            </button>
          )}
        </>
      )}
      <nav
        className={`${styles.actions} ${styles.contextActions}`}
        aria-label="관리 화면 바로가기"
      >
        {adminNav.slice(0, 3).map((item) => (
          <StructuredActionButton
            item={item}
            key={item.target}
            onAction={action}
          />
        ))}
      </nav>
      <section className={styles.compactExamples}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={showExamples}
          aria-controls="copilot-admin-examples"
          onClick={toggleExamples}
        >
          추천 질문 5개 보기 <Icon name="chevron" size={16} />
        </button>
        {showExamples && (
          <div id="copilot-admin-examples" className={styles.disclosurePanel}>
            {prompts.examplePrompts.map((prompt) => promptButton(prompt))}
          </div>
        )}
      </section>
    </div>
  );
  const filteredConversations = conversations.filter(
    (item) =>
      item.title.toLowerCase().includes(historyQuery.trim().toLowerCase()) ||
      (conversationContext(item) ?? "")
        .toLowerCase()
        .includes(historyQuery.trim().toLowerCase()),
  );
  const totalHistoryPages = Math.max(1, Math.ceil(filteredConversations.length / 5));
  const safeHistoryPage = Math.min(historyPage, totalHistoryPages);
  const visibleConversations = filteredConversations.slice((safeHistoryPage - 1) * 5, safeHistoryPage * 5);
  const groupedConversations = visibleConversations.reduce<
    Record<string, CopilotConversationSummary[]>
  >((groups, item) => {
    const group = historyGroup(item.last_message_at);
    (groups[group] ??= []).push(item);
    return groups;
  }, {});
  useEffect(() => setHistoryPage(1), [historyQuery]);
  useEffect(() => { if (historyPage > totalHistoryPages) setHistoryPage(totalHistoryPages); }, [historyPage, totalHistoryPages]);
  const contextLabel = `${context.replaceAll("_", " ")}${entityId ? ` · #${entityId}` : ""}`;

  return (
    <div className={styles.copilotRoot} data-open={open || undefined}>
      {open && (
        <section
          id="flowlink-copilot-panel"
          className={styles.panel}
          aria-label="FlowLink AI Copilot"
        >
          <header>
            <div className={styles.headerMark}>
              <FlowBeacon open={false} />
            </div>
            <div>
              <strong>FlowLink AI</strong>
              <span>
                {role === "ADMIN" ? "Operations Copilot · ADMIN" : modeTitle}
              </span>
            </div>
            {role === "USER" && (
              <div className={styles.speechSettings}>
                <label className={styles.autoSpeechToggle} title={!speechSupported ? "이 브라우저에서는 음성 안내를 지원하지 않아요." : undefined}>
                  <span aria-hidden="true">🔊</span>
                  <span>음성 안내</span>
                  <input
                    type="checkbox"
                    checked={autoSpeechEnabled}
                    disabled={!speechSupported}
                    aria-label="새 답변 자동 음성 안내"
                    onChange={(event) => changeAutoSpeech(event.target.checked)}
                  />
                  <i aria-hidden="true" />
                  <b aria-hidden="true">{autoSpeechEnabled ? "ON" : "OFF"}</b>
                </label>
                <label className={styles.voiceSelectLabel}>
                  <span>목소리</span>
                  <select
                    value={selectedVoiceId ?? ""}
                    disabled={!speechSupported || speechVoices.length === 0}
                    aria-label="한국어 음성 선택"
                    onChange={(event) => setSelectedVoice(event.target.value || null)}
                  >
                    <option value="">기본 한국어</option>
                    {speechVoices.map((voice) => (
                      <option key={speechVoiceId(voice)} value={speechVoiceId(voice)}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <button
              type="button"
              aria-label="FlowLink AI 닫기"
              onClick={() => {
                setOpen(false);
                launcherRef.current?.focus();
              }}
            >
              <Icon name="close" size={19} />
            </button>
          </header>
          <div className={styles.contextLine}>
            <span>현재</span>
            <strong>{contextLabel}</strong>
          </div>
          <nav className={styles.conversationUtility} aria-label="대화 관리">
            <button
              type="button"
              className={styles.newConversationButton}
              onClick={newConversation}
            >
              <Icon name="plus" size={18} />새 대화
            </button>
            <button
              ref={historyButtonRef}
              type="button"
              className={styles.historyButton}
              aria-pressed={memoryOpen}
              onClick={() => {
                setMemoryOpen(true);
                setManageHistory(false);
                setSelectedConversationIds(new Set());
                setHistoryPage(1);
                setConversationMenu(null);
              }}
            >
              <Icon name="clock" size={18} />
              대화 기록
              {conversationCount > 0 && (
                <small>{conversationCount}</small>
              )}
            </button>
          </nav>
          <div
            className={`${styles.messages} ${memoryOpen ? styles.historyViewActive : ""}`}
            role={memoryOpen ? undefined : "log"}
            aria-live={memoryOpen ? undefined : "polite"}
            aria-relevant="additions"
          >
            {memoryOpen ? (
              <section className={styles.memoryPanel} aria-label="대화 기록">
                <div className={styles.historyHeading}>
                  <button
                    ref={historyBackRef}
                    type="button"
                    onClick={() => {
                      setMemoryOpen(false);
                      setManageHistory(false);
                      setSelectedConversationIds(new Set());
                      window.setTimeout(() =>
                        historyButtonRef.current?.focus(),
                      );
                    }}
                    aria-label="대화로 돌아가기"
                  >
                    <Icon name="chevronLeft" size={18} />
                  </button>
                  <div>
                    <h3>대화 기록</h3>
                    <p>
                      {user
                        ? "이전 대화를 다시 확인해요."
                        : "비로그인 대화는 영구 저장되지 않아요."}
                    </p>
                    {user && <small className={styles.historyCount}>총 {conversationCount}개의 대화</small>}
                  </div>
                  {user && conversations.length > 0 && <button ref={manageHistoryButtonRef} type="button" className={styles.manageHistoryButton} onClick={() => { setManageHistory((current) => { if (current) setSelectedConversationIds(new Set()); return !current; }); setConversationMenu(null); }}>{manageHistory ? "완료" : "기록 관리"}</button>}
                </div>
                {user && conversations.length >= 5 && (
                  <label className={styles.historySearch}>
                    <Icon name="search" size={17} />
                    <input
                      value={historyQuery}
                      onChange={(event) => setHistoryQuery(event.target.value)}
                      placeholder="대화 제목 또는 연결 항목 검색"
                      aria-label="대화 기록 검색"
                    />
                  </label>
                )}
                {memoryLoading ? (
                  <div className={styles.historySkeleton} role="status">
                    <i />
                    <i />
                    <i />
                  </div>
                ) : memoryError ? (
                  <div className={styles.historyState} role="alert">
                    <strong>대화 기록을 불러오지 못했어요.</strong>
                    <button
                      type="button"
                      onClick={() =>
                        void refreshMemory().catch(() => undefined)
                      }
                    >
                      다시 시도
                    </button>
                  </div>
                ) : !user || conversations.length === 0 ? (
                  <div className={styles.historyState}>
                    <strong>대화 기록이 비어 있어요.</strong>
                    <p>새로운 대화를 시작하면 여기에 기록됩니다.</p>
                    <button type="button" onClick={newConversation}>
                      새 대화 시작
                    </button>
                  </div>
                ) : filteredConversations.length === 0 ? (
                  <div className={styles.historyState}>
                    <strong>검색 결과가 없어요.</strong>
                    <p>다른 제목이나 연결 항목으로 찾아보세요.</p>
                  </div>
                ) : (
                  <div className={styles.historyGroups}>
                    {Object.entries(groupedConversations).map(
                      ([group, items]) => (
                        <section key={group}>
                          {conversations.length >= 4 && <h4>{group}</h4>}
                          <ul>
                            {items.map((item) => (
                              <li
                                key={item.public_id}
                                data-current={
                                  conversationId === item.public_id || undefined
                                }
                              >
                                {manageHistory && <button type="button" className={styles.historySelect} aria-label={`${item.title || "새 대화"} 선택`} aria-pressed={selectedConversationIds.has(item.public_id)} onClick={() => setSelectedConversationIds((current) => { const next = new Set(current); if (next.has(item.public_id)) next.delete(item.public_id); else next.add(item.public_id); return next; })}><Icon name="check" size={15} /></button>}
                                {editingId === item.public_id ? (
                                  <form
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      void renameCopilotConversation(
                                        item.public_id,
                                        editingTitle,
                                      ).then(() => {
                                        setEditingId(null);
                                        return refreshMemory();
                                      });
                                    }}
                                  >
                                    <input
                                      autoFocus
                                      value={editingTitle}
                                      maxLength={120}
                                      onChange={(event) =>
                                        setEditingTitle(event.target.value)
                                      }
                                      aria-label="대화 제목"
                                    />
                                    <button disabled={!editingTitle.trim()}>
                                      저장
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingId(null)}
                                    >
                                      취소
                                    </button>
                                  </form>
                                ) : (
                                  <button
                                    className={styles.resumeButton}
                                    type="button"
                                    disabled={manageHistory}
                                    onClick={() =>
                                      void resumeConversation(item.public_id)
                                    }
                                  >
                                    <strong>{item.title || "새 대화"}</strong>
                                    <span>
                                      {[
                                        conversationContext(item),
                                        new Date(
                                          item.last_message_at,
                                        ).toLocaleString("ko-KR", {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        }),
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </span>
                                  </button>
                                )}
                                {!manageHistory && editingId !== item.public_id && (
                                  <div className={styles.conversationMenu}>
                                    <button
                                      ref={(node) => {
                                        if (node)
                                          conversationMenuTriggers.current.set(
                                            item.public_id,
                                            node,
                                          );
                                        else
                                          conversationMenuTriggers.current.delete(
                                            item.public_id,
                                          );
                                      }}
                                      type="button"
                                      aria-label={`${item.title || "새 대화"} 대화 관리`}
                                      aria-expanded={
                                        conversationMenu === item.public_id
                                      }
                                      aria-haspopup="menu"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (conversationMenu === item.public_id)
                                          closeConversationMenu(item.public_id);
                                        else
                                          setConversationMenu(item.public_id);
                                      }}
                                    >
                                      <Icon name="more" size={18} />
                                    </button>
                                    {conversationMenu === item.public_id && (
                                      <div
                                        role="menu"
                                        aria-label={`${item.title || "새 대화"} 관리 메뉴`}
                                      >
                                        <button
                                          type="button"
                                          role="menuitem"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setEditingId(item.public_id);
                                            setEditingTitle(item.title);
                                            setConversationMenu(null);
                                          }}
                                        >
                                          <Icon name="edit" size={18} />
                                          <span>이름 변경</span>
                                        </button>
                                        <button
                                          type="button"
                                          role="menuitem"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setDeleteError("");
                                            setDeleteTarget(item);
                                            setConversationMenu(null);
                                          }}
                                        >
                                          <Icon name="trash" size={18} />
                                          <span>대화 삭제</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        </section>
                      ),
                    )}
                  </div>
                )}
                {!memoryLoading && !memoryError && filteredConversations.length > 0 && <footer className={styles.historyFooter}>
                  {manageHistory && <div className={styles.historyBulkActions}><span>선택 {selectedConversationIds.size}개</span><button type="button" disabled={selectedConversationIds.size === 0} onClick={() => { setDeleteError(""); setBulkDeleteMode("selected"); }}>선택 삭제</button><button type="button" onClick={() => { setDeleteError(""); setBulkDeleteMode("all"); }}>전체 삭제</button></div>}
                  {filteredConversations.length > 5 && <nav className={styles.historyPagination} aria-label="대화 기록 페이지"><button type="button" disabled={safeHistoryPage === 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>‹ 이전</button><span aria-live="polite">{safeHistoryPage} / {totalHistoryPages}</span><button type="button" disabled={safeHistoryPage === totalHistoryPages} onClick={() => setHistoryPage((page) => Math.min(totalHistoryPages, page + 1))}>다음 ›</button></nav>}
                </footer>}
              </section>
            ) : (
              <>
                {messages.length === 0 &&
                  (role === "GUEST"
                    ? guestHome
                    : role === "USER"
                      ? userHome
                      : adminHome)}
                {messages.length > 0 && (
                  <div className={styles.exampleToggle}>
                    <button
                      type="button"
                      aria-expanded={showExamples}
                      aria-controls="copilot-example-prompts"
                      disabled={loading}
                      onClick={() => setShowExamples((current) => !current)}
                    >
                      질문 예시
                    </button>
                    {showExamples && (
                      <div
                        id="copilot-example-prompts"
                        className={styles.exampleTray}
                      >
                        {prompts.examplePrompts.map((prompt) =>
                          promptButton(prompt),
                        )}
                      </div>
                    )}
                  </div>
                )}
                {messages.map((message) => (
                  <div
                    className={styles.message}
                    data-role={message.role}
                    key={message.id}
                  >
                    <div className={styles.messageMeta}>
                      <span>
                        {message.role === "user"
                          ? "나"
                          : message.role === "assistant"
                            ? "FlowLink AI"
                            : "연결 안내"}
                      </span>
                      {message.role === "assistant" && (
                        <CopilotSpeechButton
                          speaking={speakingMessageId === message.id}
                          paused={speakingMessageId === message.id && speechPaused}
                          speechRate={speechRate}
                          unsupported={!speechSupported}
                          onSpeak={() => speakSpeech(message.id, getSpeechText(message))}
                          onPause={pauseSpeech}
                          onResume={resumeSpeech}
                          onStop={stopSpeech}
                          onRateChange={setSpeechRate}
                          ratePanelOpen={ratePanelMessageId === message.id}
                          onRatePanelOpenChange={(nextOpen) => setRatePanelMessageId(nextOpen ? message.id : null)}
                        />
                      )}
                    </div>
                    <p>{message.text}</p>
                    {message.cards?.map((card, index) => (
                      <Card card={card} key={`${message.id}-${index}`} />
                    ))}
                    {message.actions && message.actions.length > 0 && (
                      <div className={styles.actions}>
                        {message.actions.map((item) => (
                          <StructuredActionButton
                            item={item}
                            disabled={loading}
                            key={`${item.type}-${item.label}`}
                            onAction={action}
                          />
                        ))}
                      </div>
                    )}
                    {message.id === latestAssistantId &&
                      message.suggestions &&
                      message.suggestions.length > 0 && (
                        <section className={styles.followUps}>
                          <h4>이어서 물어보기</h4>
                          {message.suggestions.slice(0, 5).map((suggestion) => (
                            <button
                              type="button"
                              disabled={loading}
                              key={suggestion.id}
                              onClick={() => void ask(suggestion.message)}
                            >
                              {suggestion.message}
                            </button>
                          ))}
                        </section>
                      )}
                  </div>
                ))}
                {loading && (
                  <div className={styles.typing} role="status">
                    <span className="sr-only">
                      FlowLink AI가 확인하고 있어요
                    </span>
                    <FlowBeacon open={false} checking />
                    <small>데이터를 확인하고 있어요</small>
                  </div>
                )}
                <div ref={messageEndRef} />
              </>
            )}
          </div>
          {!memoryOpen && (
            <form className={styles.input} onSubmit={submit}>
              <textarea
                ref={inputRef}
                value={value}
                onChange={(event) =>
                  setValue(event.target.value.slice(0, 2000))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (value.trim() && cooldownRemaining <= 0) void ask(value);
                  }
                }}
                rows={1}
                placeholder={
                  role === "ADMIN"
                    ? "운영 데이터에 대해 물어보세요"
                    : "FlowLink에 궁금한 내용을 물어보세요"
                }
                aria-label="FlowLink AI에게 질문"
                disabled={loading}
              />
              {cooldownRemaining > 0 && (
                <p className={styles.cooldownNotice} role="status">
                  약 {cooldownRemaining}초 후 다시 보낼 수 있어요.
                </p>
              )}
              <button
                type="submit"
                disabled={loading || cooldownRemaining > 0 || !value.trim()}
                aria-label="질문 보내기"
              >
                <Icon name="send" size={18} />
              </button>
            </form>
          )}
        </section>
      )}
      {deleteTarget && (
        <div className={styles.confirmBackdrop} role="presentation">
          <div
            className={styles.confirmDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-delete-title"
          >
            <h3 id="memory-delete-title">이 대화를 삭제할까요?</h3>
            <p>“{deleteTarget.title}” 대화가 Flow Memory에서 사라집니다.</p>
            {deleteError && <p className={styles.deleteError} role="alert">{deleteError}</p>}
            <div>
              <button type="button" disabled={deleteBusy} onClick={() => { setDeleteTarget(null); setDeleteError(""); }}>
                취소
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => { if (deleteBusy) return; const target = deleteTarget; const requestGeneration = sessionGenerationRef.current; const requestSession = sessionRef.current; const isCurrentSession = () => requestGeneration === sessionGenerationRef.current && requestSession === sessionRef.current; setDeleteBusy(true); setDeleteError(""); void deleteCopilotConversation(target.public_id).then(async () => { if (!isCurrentSession()) return; if (conversationId === target.public_id) newConversation(); setDeleteTarget(null); await refreshMemory(); }).catch(() => { if (isCurrentSession()) setDeleteError("대화를 삭제하지 못했어요. 잠시 후 다시 시도해 주세요."); }).finally(() => { if (isCurrentSession()) setDeleteBusy(false); }); }}
              >
                {deleteBusy ? "삭제 중" : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkDeleteMode && (
        <div className={styles.confirmBackdrop} role="presentation">
          <div className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="memory-bulk-delete-title" aria-describedby="memory-bulk-delete-description">
            <h3 id="memory-bulk-delete-title">{bulkDeleteMode === "all" ? "대화 기록을 모두 삭제할까요?" : "선택한 대화를 삭제할까요?"}</h3>
            <p id="memory-bulk-delete-description">{bulkDeleteMode === "all" ? `저장된 대화 ${conversationCount}개가 모두 삭제됩니다.` : `선택한 ${selectedConversationIds.size}개의 대화가 삭제됩니다.`}<br />삭제한 기록은 다시 복구할 수 없습니다.</p>
            {deleteError && <p className={styles.deleteError} role="alert">{deleteError}</p>}
            <div>
              <button type="button" autoFocus disabled={deleteBusy} onClick={() => { setBulkDeleteMode(null); setDeleteError(""); window.setTimeout(() => manageHistoryButtonRef.current?.focus()); }}>취소</button>
              <button type="button" disabled={deleteBusy || (bulkDeleteMode === "selected" && selectedConversationIds.size === 0)} onClick={() => {
                if (deleteBusy) return;
                const mode = bulkDeleteMode;
                const selectedIds = [...selectedConversationIds];
                const requestGeneration = sessionGenerationRef.current;
                const requestSession = sessionRef.current;
                const isCurrentSession = () => requestGeneration === sessionGenerationRef.current && requestSession === sessionRef.current;
                setDeleteBusy(true); setDeleteError("");
                void (mode === "all" ? deleteAllCopilotConversations().then(() => ({ failed: [] as string[], deleted: selectedIds })) : Promise.allSettled(selectedIds.map(deleteCopilotConversation)).then((results) => ({ failed: selectedIds.filter((_, index) => results[index].status === "rejected"), deleted: selectedIds.filter((_, index) => results[index].status === "fulfilled") }))).then(async ({ failed, deleted }) => {
                  if (!isCurrentSession()) return;
                  if (failed.length) { if (conversationId && deleted.includes(conversationId)) newConversation(); setSelectedConversationIds(new Set(failed)); setDeleteError("일부 대화를 삭제하지 못했어요. 실패한 항목만 다시 선택했어요."); await refreshMemory(); return; }
                  if (mode === "all" || (conversationId && selectedIds.includes(conversationId))) newConversation();
                  setBulkDeleteMode(null); setManageHistory(false); setSelectedConversationIds(new Set()); setHistoryPage(1);
                  await refreshMemory();
                }).catch(async () => { if (!isCurrentSession()) return; setDeleteError("대화를 삭제하지 못했어요. 목록을 새로 확인해 주세요."); await refreshMemory().catch(() => undefined); }).finally(() => { if (isCurrentSession()) setDeleteBusy(false); });
              }}>{deleteBusy ? "삭제 중" : bulkDeleteMode === "all" ? "전체 삭제" : `${selectedConversationIds.size}개 삭제`}</button>
            </div>
          </div>
        </div>
      )}
      <div className={styles.tooltip} role="tooltip">
        <strong>FlowLink AI</strong>
        <span>
          {user?.role === "ADMIN"
            ? "운영 현황을 함께 확인해요"
            : user
              ? "내 신고·분석·매칭을 함께 확인해요"
              : "서비스 이용을 도와드려요"}
        </span>
      </div>
      <button
        ref={launcherRef}
        className={styles.launcher}
        type="button"
        aria-label={open ? "FlowLink AI 닫기" : "FlowLink AI 열기"}
        aria-expanded={open}
        aria-controls="flowlink-copilot-panel"
        aria-busy={!authReady || loading}
        onClick={() => setOpen((current) => !current)}
      >
        <FlowBeacon open={open} checking={loading} />
        {unread > 0 && (
          <span className={styles.badge}>
            <b>{Math.min(unread, 9)}</b>
            <span className="sr-only">새로운 매칭 알림 {unread}건</span>
          </span>
        )}
      </button>
    </div>
  );
}
