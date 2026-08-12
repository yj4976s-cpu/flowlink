"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { FoundItemDetail, FoundItemsApiError, getFoundItem, resolveFoundItemImageUrl } from "@/lib/foundItemsApi";
import { getItemTypeMeta } from "@/lib/itemTypeMeta";
import { listMyMatches, type MatchCandidate } from "@/lib/matchesApi";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusLabel: Record<string, string> = {
  AVAILABLE: "공개 중",
  RECOVERED: "회수됨",
};

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateFormatter.format(date);
}

function getStatusLabel(status: string) {
  return statusLabel[status] ?? status;
}

function fallbackFoundItemImage(item: Pick<FoundItemDetail, "item_category" | "item_category_name">) {
  const family = getItemTypeMeta(item.item_category, item.item_category_name).family;
  if (family === "bag") return "/found-backpack-day.png";
  if (family === "umbrella") return "/found-umbrella-day.png";
  if (family === "neutral") return "/found-branch-day.png";
  return "/found-container-day.png";
}

export function FoundItemDetailClient() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [item, setItem] = useState<FoundItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relatedMatch, setRelatedMatch] = useState<MatchCandidate | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const loadItem = async () => {
      if (!/^\d+$/.test(id)) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setNotFound(false);
      try {
        const data = await getFoundItem(id, controller.signal);
        setItem(data);
        setImageFailed(false);
        try {
          const matches = await listMyMatches(controller.signal);
          setRelatedMatch(matches.find((match) => match.found_item.id === data.id) ?? null);
        } catch {
          setRelatedMatch(null);
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof FoundItemsApiError && caught.status === 404) {
          setNotFound(true);
          setItem(null);
          return;
        }
        const message = caught instanceof FoundItemsApiError ? caught.message : "발견물 상세 정보를 불러오지 못했습니다.";
        setError(message);
        setItem(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadItem();
    return () => controller.abort();
  }, [id]);

  return (
    <main className="found-items-page found-detail-page">
      <Link className="found-back-link" href="/found-items"><Icon name="arrow" size={17} /> 목록으로 돌아가기</Link>

      {loading && <section className="found-state-card" role="status">발견물 상세 정보를 불러오고 있습니다.</section>}
      {!loading && notFound && (
        <section className="found-state-card found-state-error" aria-labelledby="not-found-title">
          <strong id="not-found-title">발견물을 찾을 수 없습니다.</strong>
          <p>공개가 종료되었거나 존재하지 않는 발견물일 수 있습니다.</p>
        </section>
      )}
      {!loading && error && <section className="found-state-card found-state-error" role="alert">{error}</section>}
      {!loading && item && (
        <article className="found-detail-card" aria-labelledby="found-detail-title">
          <div className="found-detail-image">{(() => {
            const imageUrl = resolveFoundItemImageUrl(item.image_url);
            const fallbackUrl = fallbackFoundItemImage(item);
            const visibleUrl = imageUrl && !imageFailed ? imageUrl : fallbackUrl;
            return visibleUrl ? (
              <img
                src={visibleUrl}
                alt={`${item.item_category_name} 발견물 이미지`}
                onError={visibleUrl === imageUrl ? () => setImageFailed(true) : undefined}
              />
            ) : (
              <Icon name="fileSearch" size={42} />
            );
          })()}</div>
          <div className="found-detail-summary">
            <p className="placeholder-eyebrow">FOUND ITEM DETAIL</p>
            <div className="found-detail-title-row">
              <h1 id="found-detail-title">{item.public_description || `${item.item_category_name} 발견물`}</h1>
              <span className="found-status-chip">{getStatusLabel(item.status)}</span>
            </div>
            <p>공개 API가 제공하는 범위의 발견물 정보만 표시합니다. 정확한 보관 장소와 관리자 메모는 공개하지 않습니다.</p>
          </div>

          <dl className="found-detail-list">
            <div>
              <dt>물품 종류</dt>
              <dd>{item.item_category_name}<span>{item.item_category}</span></dd>
            </div>
            <div>
              <dt>색상</dt>
              <dd>{item.color || "미상"}</dd>
            </div>
            <div>
              <dt>대략적인 발견 구역</dt>
              <dd>{item.area_name}</dd>
            </div>
            <div>
              <dt>발견 시각</dt>
              <dd><time dateTime={item.found_at}>{formatDateTime(item.found_at)}</time></dd>
            </div>
            <div>
              <dt>상태</dt>
              <dd>{getStatusLabel(item.status)}</dd>
            </div>
            <div>
              <dt>공개 등록 시각</dt>
              <dd><time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time></dd>
            </div>
          </dl>
          {item.source_type === "AI" && <section className="found-ai-summary" aria-labelledby="found-ai-title"><Icon name="scanLine" size={22} /><div><span>AI 분석</span><h2 id="found-ai-title">{item.item_category_name}</h2><p>관리자 확인 완료</p><small>AI 분석 결과는 관리자 확인 과정에서 변경될 수 있습니다. 공개 API에 신뢰도 값이 없어 점수는 표시하지 않습니다.</small></div></section>}
          {relatedMatch && (
            <section className="found-detail-compare" aria-labelledby="found-compare-title">
              <div className="found-detail-compare-heading">
                <div><p className="placeholder-eyebrow">MY REPORT COMPARE</p><h2 id="found-compare-title">내 분실 신고와 비교</h2></div>
                <strong>{relatedMatch.total_score}% 유사</strong>
              </div>
              <div className="found-detail-compare-grid">
                <article><span>내 신고</span><h3>{relatedMatch.lost_report.item_category_name}</h3><p>{relatedMatch.lost_report.area_name} · {formatDateTime(relatedMatch.lost_report.lost_from)}</p></article>
                <Icon name="match" size={24} />
                <article><span>발견물</span><h3>{relatedMatch.found_item.item_category_name}</h3><p>{relatedMatch.found_item.area_name} · {formatDateTime(relatedMatch.found_item.found_at)}</p></article>
              </div>
              <p>신고 내용과 조건이 유사한 발견물입니다. 상세 점수와 공개되지 않은 특징 입력은 기존 확인 절차에서 진행합니다.</p>
              <Link className="button button-primary" href="/matches">비교 결과 확인 및 내 물건으로 확인 요청</Link>
            </section>
          )}
        </article>
      )}
    </main>
  );
}
