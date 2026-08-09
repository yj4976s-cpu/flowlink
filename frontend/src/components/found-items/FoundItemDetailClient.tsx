"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { FoundItemDetail, FoundItemsApiError, getFoundItem } from "@/lib/foundItemsApi";

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

export function FoundItemDetailClient() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [item, setItem] = useState<FoundItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        </article>
      )}
    </main>
  );
}
