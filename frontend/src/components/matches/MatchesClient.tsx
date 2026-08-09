"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@/components/common/Icon";
import { OwnershipClaimForm } from "@/components/ownership-claims/OwnershipClaimForm";
import { MatchesApiError, listMyMatches } from "@/lib/matchesApi";
import type { MatchCandidate } from "@/lib/matchesApi";
import styles from "./MatchesClient.module.css";

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const matchStatusLabels: Record<string, string> = {
  SUGGESTED: "후보 생성",
  NOTIFIED: "매칭 알림",
  VIEWED: "확인함",
  DISMISSED: "제외됨",
  CLAIMED: "확인 요청됨",
};

const lostReportStatusLabels: Record<string, string> = {
  OPEN: "신고 접수",
  MATCHED: "후보 확인 중",
  CLAIM_PENDING: "소유권 확인 중",
  RESOLVED: "처리 완료",
  CANCELLED: "취소됨",
};

const foundItemStatusLabels: Record<string, string> = {
  AVAILABLE: "공개 중",
  RECOVERED: "회수됨",
  CLAIM_PENDING: "소유권 확인 중",
  RETURNED: "반환 완료",
  DISPOSED: "처분됨",
};

const publicFoundItemDetailStatuses = new Set(["AVAILABLE", "RECOVERED"]);
const claimableLostReportStatuses = new Set(["OPEN", "MATCHED"]);

const scoreParts = [
  { key: "type_score", label: "물품 종류", max: 40 },
  { key: "area_score", label: "발견 구역", max: 25 },
  { key: "time_score", label: "시간 범위", max: 20 },
  { key: "keyword_score", label: "색상·특징", max: 15 },
] as const;

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateTimeFormatter.format(date);
}

function getLabel(labels: Record<string, string>, status: string) {
  return labels[status] ?? status;
}

function canOpenFoundItemDetail(status: string) {
  return publicFoundItemDetailStatuses.has(status);
}

function canCreateOwnershipClaim(match: MatchCandidate) {
  return match.found_item.status === "AVAILABLE" && claimableLostReportStatuses.has(match.lost_report.status);
}

function getOwnershipClaimUnavailableMessage(match: MatchCandidate) {
  if (match.found_item.status === "CLAIM_PENDING" || match.lost_report.status === "CLAIM_PENDING") {
    return "소유권 확인 진행 중";
  }
  if (match.found_item.status === "RETURNED" || match.lost_report.status === "RESOLVED") {
    return "반환 절차가 완료된 후보입니다.";
  }
  if (match.found_item.status === "DISPOSED" || match.lost_report.status === "CANCELLED") {
    return "현재 확인 요청을 보낼 수 없는 후보입니다.";
  }
  if (match.found_item.status !== "AVAILABLE") {
    return "현재 발견물 상태에서는 확인 요청을 보낼 수 없습니다.";
  }
  if (!claimableLostReportStatuses.has(match.lost_report.status)) {
    return "현재 분실 신고 상태에서는 확인 요청을 보낼 수 없습니다.";
  }
  return null;
}

function scoreBarStyle(score: number, max: number): CSSProperties {
  const ratio = max > 0 ? Math.min(Math.max(score / max, 0), 1) : 0;
  return { width: `${ratio * 100}%` };
}

function MatchStateCard({
  icon,
  title,
  description,
  action,
  tone = "default",
}: {
  icon: "scan" | "document" | "spark";
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <div className={`${styles.stateCard} ${tone === "error" ? styles.stateError : ""}`} role={tone === "error" ? "alert" : "status"}>
      <Icon name={icon} size={26} />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
        {action}
      </div>
    </div>
  );
}

function ScoreBreakdown({ match }: { match: MatchCandidate }) {
  return (
    <dl className={styles.scoreList} aria-label="규칙 기반 점수 세부 항목">
      {scoreParts.map((part) => {
        const score = match[part.key];
        return (
          <div key={part.key}>
            <dt>
              <span>{part.label}</span>
              <b>{score} / {part.max}점</b>
            </dt>
            <dd>
              <span style={scoreBarStyle(score, part.max)} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function MatchCard({
  match,
  isClaimFormOpen,
  onOpenClaimForm,
  onCloseClaimForm,
  onMatchesRefresh,
}: {
  match: MatchCandidate;
  isClaimFormOpen: boolean;
  onOpenClaimForm: () => void;
  onCloseClaimForm: () => void;
  onMatchesRefresh: () => void;
}) {
  const titleId = `match-${match.id}-title`;
  const canViewFoundItemDetail = canOpenFoundItemDetail(match.found_item.status);
  const canRequestOwnershipClaim = canCreateOwnershipClaim(match);
  const claimUnavailableMessage = getOwnershipClaimUnavailableMessage(match);

  return (
    <article className={styles.matchCard} aria-labelledby={titleId}>
      <div className={styles.cardHeader}>
        <div>
          <p>매칭 후보</p>
          <h2 id={titleId}>{match.lost_report.item_category_name} 후보</h2>
        </div>
        <span className={styles.statusChip}>{getLabel(matchStatusLabels, match.status)}</span>
      </div>

      <div className={styles.scoreHero}>
        <div>
          <span>매칭 점수</span>
          <strong>{match.total_score}점</strong>
        </div>
        <div className={styles.totalBar} aria-hidden="true">
          <span style={scoreBarStyle(match.total_score, 100)} />
        </div>
      </div>

      <div className={styles.compareGrid}>
        <section className={styles.infoPanel} aria-label="내 분실 신고 정보">
          <span className={styles.panelBadge}>내 분실 신고</span>
          <h3>{match.lost_report.description}</h3>
          <dl>
            <div>
              <dt>종류</dt>
              <dd>{match.lost_report.item_category_name}</dd>
            </div>
            <div>
              <dt>색상</dt>
              <dd>{match.lost_report.color || "미상"}</dd>
            </div>
            <div>
              <dt>분실 추정 구역</dt>
              <dd>{match.lost_report.area_name}</dd>
            </div>
            <div>
              <dt>분실 시각</dt>
              <dd><time dateTime={match.lost_report.lost_from}>{formatDateTime(match.lost_report.lost_from)}</time></dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>{getLabel(lostReportStatusLabels, match.lost_report.status)}</dd>
            </div>
          </dl>
        </section>

        <div className={styles.bridge} aria-hidden="true">
          <Icon name="match" size={24} />
        </div>

        <section className={styles.infoPanel} aria-label="공개 발견물 정보">
          <span className={styles.panelBadge}>공개 발견물</span>
          <h3>{match.found_item.public_description || `${match.found_item.item_category_name} 발견물`}</h3>
          <dl>
            <div>
              <dt>종류</dt>
              <dd>{match.found_item.item_category_name}</dd>
            </div>
            <div>
              <dt>색상</dt>
              <dd>{match.found_item.color || "미상"}</dd>
            </div>
            <div>
              <dt>발견 구역</dt>
              <dd>{match.found_item.area_name}</dd>
            </div>
            <div>
              <dt>발견 시각</dt>
              <dd><time dateTime={match.found_item.found_at}>{formatDateTime(match.found_item.found_at)}</time></dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>{getLabel(foundItemStatusLabels, match.found_item.status)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className={styles.cardFooter}>
        <ScoreBreakdown match={match} />
        <div className={styles.cardActions}>
          {canViewFoundItemDetail ? (
            <Link className="button button-secondary" href={`/found-items/${match.found_item.id}`}>
              발견물 상세 보기 <Icon name="arrow" size={17} />
            </Link>
          ) : (
            <span className={styles.detailUnavailable}>현재 공개 상세 조회가 종료된 발견물입니다.</span>
          )}
          {canRequestOwnershipClaim ? (
            <button className="button button-primary" type="button" onClick={onOpenClaimForm} aria-expanded={isClaimFormOpen}>
              내 물건 같아요
            </button>
          ) : claimUnavailableMessage ? (
            <span className={styles.claimUnavailable}>{claimUnavailableMessage}</span>
          ) : null}
        </div>
      </div>
      {isClaimFormOpen && (
        <OwnershipClaimForm
          foundItemId={match.found_item.id}
          lostReportId={match.lost_report.id}
          foundItemLabel={match.found_item.public_description || match.found_item.item_category_name}
          onCancel={onCloseClaimForm}
          onSubmitted={onMatchesRefresh}
          onRequestRefresh={onMatchesRefresh}
        />
      )}
    </article>
  );
}

export function MatchesClient() {
  const [matches, setMatches] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [activeClaimMatchId, setActiveClaimMatchId] = useState<number | null>(null);

  const loadMatches = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setErrorStatus(null);

    try {
      const data = await listMyMatches(signal);
      setMatches(data);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (caught instanceof MatchesApiError) {
        setError(caught.message);
        setErrorStatus(caught.status ?? null);
        return;
      }
      setError("매칭 후보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      setErrorStatus(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const refreshMatches = useCallback(async () => {
    try {
      const data = await listMyMatches();
      setMatches(data);
      setError(null);
      setErrorStatus(null);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadInitialMatches = async () => {
      try {
        const data = await listMyMatches(controller.signal);
        setMatches(data);
        setError(null);
        setErrorStatus(null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof MatchesApiError) {
          setError(caught.message);
          setErrorStatus(caught.status ?? null);
          return;
        }
        setError("매칭 후보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        setErrorStatus(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadInitialMatches();
    return () => controller.abort();
  }, []);

  const summaryText = useMemo(() => {
    if (loading) return "내 분실 신고와 공개 발견물을 비교하고 있습니다.";
    if (error) return error;
    return `현재 표시된 후보 ${matches.length}개`;
  }, [error, loading, matches.length]);

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="matches-title">
        <div>
          <p className={styles.eyebrow}>MATCH CANDIDATES</p>
          <h1 id="matches-title">내 물건과 닮은<br />발견물을 확인해요</h1>
          <p>
            내가 작성한 분실 신고와 공개 발견물 정보를 규칙 기반으로 비교해 후보를 보여줍니다.
            점수는 참고용이며, 동일 물품이나 소유자를 확정하는 결과가 아닙니다.
          </p>
        </div>
        <div className={styles.heroCard} aria-label="매칭 후보 조회 요약">
          <Icon name="match" size={34} />
          <strong>{summaryText}</strong>
          <span>최종 확인과 반환 절차는 관리자 검토를 거쳐 진행됩니다.</span>
        </div>
      </section>

      <section className={styles.notice} aria-label="매칭 점수 안내">
        <Icon name="spark" size={22} />
        <p>
          매칭 점수는 물품 종류, 구역, 시간 범위, 색상·특징을 더한 참고 정보입니다.
          비공개 검증 정보나 정확한 보관 장소는 이 화면에 표시하지 않습니다.
        </p>
      </section>

      <section className={styles.results} aria-labelledby="matches-list-title" aria-busy={loading}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>MY MATCHES</p>
            <h2 id="matches-list-title">매칭 후보 목록</h2>
          </div>
          {!loading && !error && <span>표시 중 {matches.length}개</span>}
        </div>

        {loading && (
          <MatchStateCard
            icon="scan"
            title="매칭 후보를 불러오고 있습니다."
            description="분실 신고와 공개 발견물의 후보 정보를 확인하는 중입니다."
          />
        )}

        {!loading && error && (
          <MatchStateCard
            icon="spark"
            title={errorStatus === 401 ? "로그인이 필요합니다." : "매칭 후보를 불러오지 못했습니다."}
            description={error}
            tone="error"
            action={
              <div className={styles.stateActions}>
                {errorStatus === 401 ? (
                  <Link className="button button-primary" href="/login">로그인하러 가기</Link>
                ) : (
                  <button className="button button-secondary" type="button" onClick={() => void loadMatches()}>
                    다시 시도
                  </button>
                )}
              </div>
            }
          />
        )}

        {!loading && !error && matches.length === 0 && (
          <MatchStateCard
            icon="document"
            title="아직 매칭 후보가 없습니다."
            description="현재 확인된 매칭 후보가 없습니다. 발견물 목록을 확인하거나 분실 신고 내용을 다시 확인해주세요."
            action={
              <div className={styles.stateActions}>
                <Link className="button button-primary" href="/lost-reports/new">분실 신고하기</Link>
                <Link className="button button-secondary" href="/found-items">발견물 둘러보기</Link>
              </div>
            }
          />
        )}

        {!loading && !error && matches.length > 0 && (
          <div className={styles.matchList} role="list">
            {matches.map((match) => (
              <div key={match.id} role="listitem">
                <MatchCard
                  match={match}
                  isClaimFormOpen={activeClaimMatchId === match.id}
                  onOpenClaimForm={() => setActiveClaimMatchId(match.id)}
                  onCloseClaimForm={() => setActiveClaimMatchId(null)}
                  onMatchesRefresh={() => void refreshMatches()}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
