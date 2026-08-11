"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { resolveCommunityImageUrl, type CommunityPost, type CommunitySystemUpdate } from "@/lib/communityApi";
import { createFlowLinkMap, type KakaoCustomOverlayInstance, type KakaoMapInstance } from "@/lib/kakaoPlaces";
import styles from "./Community.module.css";

type Point = {
  key: string;
  title: string;
  body: string | null;
  image: string | null;
  place: string;
  time: string;
  latitude: number;
  longitude: number;
  href: string | null;
  type: string;
  markerType: "story" | "question" | "experience" | "notice" | "found" | "return";
};

type CommunityMapProps = {
  posts: CommunityPost[];
  updates: CommunitySystemUpdate[];
  center?: { latitude: number; longitude: number };
  filtered?: boolean;
  onShowAll?: () => void;
};

export function CommunityMap({ posts, updates, center, filtered = false, onShowAll }: CommunityMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const overlays = useRef<Array<{ overlay: KakaoCustomOverlayInstance; node: HTMLButtonElement }>>([]);
  const previewRef = useRef<HTMLElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no_key">("loading");
  const [selected, setSelected] = useState<Point | null>(null);
  const [retry, setRetry] = useState(0);
  const centerLatitude = center?.latitude;
  const centerLongitude = center?.longitude;

  const points = useMemo<Point[]>(() => [
    ...posts.filter((item) => item.latitude != null && item.longitude != null).map((item): Point => ({
      key: `post-${item.id}`,
      title: item.title,
      body: item.content,
      image: resolveCommunityImageUrl(item.image_url),
      place: item.place_name || item.address || "선택한 위치",
      time: item.created_at,
      latitude: item.latitude!,
      longitude: item.longitude!,
      href: `/community/${item.id}`,
      type: item.is_notice ? "공지" : item.category === "FIELD_STORY" ? "현장 이야기" : item.category === "QUESTION" ? "궁금해요" : "이용 경험",
      markerType: item.is_notice ? "notice" : item.category === "FIELD_STORY" ? "story" : item.category === "QUESTION" ? "question" : "experience",
    })),
    ...updates.filter((item) => item.latitude != null && item.longitude != null).map((item): Point => ({
      key: `update-${item.type}-${item.id}`,
      title: item.title,
      body: null,
      image: null,
      place: item.place_name,
      time: item.timestamp,
      latitude: item.latitude!,
      longitude: item.longitude!,
      href: item.href,
      type: item.type === "RETURN_UPDATE" ? "반환 완료" : "FlowLink 발견 소식",
      markerType: item.type === "RETURN_UPDATE" ? "return" : "found",
    })),
  ], [posts, updates]);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let removeMapClick: (() => void) | undefined;
    let destroyMap: (() => void) | undefined;
    setStatus("loading");
    setSelected(null);
    const initial = centerLatitude != null && centerLongitude != null ? { latitude: centerLatitude, longitude: centerLongitude } : points[0];
    void createFlowLinkMap(container.current, { latitude: initial?.latitude, longitude: initial?.longitude, level: centerLatitude != null ? 6 : 7 }).then(({ kakao, map, destroy }) => {
      destroyMap = destroy;
      if (disposed || !container.current) { destroy(); return; }
      mapRef.current = map;
      if (centerLatitude == null && points.length > 1) {
        const bounds = new kakao.maps.LatLngBounds();
        points.forEach((point) => bounds.extend(new kakao.maps.LatLng(point.latitude, point.longitude)));
        map.setBounds(bounds, 56);
      }
      overlays.current = points.map((point) => {
        const node = document.createElement("button");
        node.type = "button";
        node.className = styles.communityMarker;
        node.dataset.kind = point.markerType;
        node.dataset.pointKey = point.key;
        node.setAttribute("aria-label", `${point.type}: ${point.title}, ${point.place}`);
        node.innerHTML = `<span aria-hidden="true"></span>`;
        node.addEventListener("click", (event) => {
          event.stopPropagation();
          setSelected(point);
        });
        const overlay = new kakao.maps.CustomOverlay({ map, position: new kakao.maps.LatLng(point.latitude, point.longitude), content: node, xAnchor: .5, yAnchor: 1, zIndex: 3 });
        return { overlay, node };
      });
      const clearSelection = () => setSelected(null);
      kakao.maps.event.addListener(map, "click", clearSelection);
      removeMapClick = () => kakao.maps.event.removeListener(map, "click", clearSelection);
      setStatus("ready");
    }).catch((reason: unknown) => {
      if (disposed) return;
      const message = reason instanceof Error ? reason.message : "";
      setStatus(message.includes("키가 설정되지") ? "no_key" : "error");
    });
    return () => {
      disposed = true;
      removeMapClick?.();
      destroyMap?.();
      overlays.current.forEach(({ overlay }) => overlay.setMap(null));
      overlays.current = [];
      mapRef.current = null;
    };
  }, [centerLatitude, centerLongitude, points, retry]);

  useEffect(() => {
    overlays.current.forEach(({ node }) => node.toggleAttribute("data-selected", node.dataset.pointKey === selected?.key));
    if (selected) window.setTimeout(() => previewRef.current?.focus());
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [selected]);

  return (
    <div className={styles.mapWrap}>
      <div ref={container} className={styles.communityMap} role="application" aria-label="지역 커뮤니티 Kakao 지도" />
      {status === "loading" && <div className={styles.mapLoading}><Icon name="refresh" size={22} /><span>실제 Kakao 지도를 불러오고 있어요.</span></div>}
      {status === "ready" && points.length === 0 && <div className={styles.mapZeroNotice} role="status"><Icon name="location" size={18} /><span><strong>이 지역에 지도에서 확인할 수 있는 이야기가 아직 없어요.</strong><small>좌표가 등록된 이야기만 마커로 표시됩니다.</small></span>{filtered && onShowAll && <button type="button" onClick={onShowAll}>전체 지역 보기</button>}</div>}
      {(status === "error" || status === "no_key") && <div className={styles.mapError} role="alert"><Icon name="info" size={28} /><strong>{status === "no_key" ? "Kakao 지도 연결 설정이 필요해요." : "지도를 불러오지 못했어요."}</strong><span>{status === "no_key" ? "개발 환경의 JavaScript 키 설정을 확인해 주세요." : "잠시 후 다시 확인해 주세요."}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button></div>}
      {selected && (
        <article ref={previewRef} className={styles.mapPreview} tabIndex={-1} aria-label={`${selected.title} 미리보기`}>
          <button type="button" aria-label="지도 미리보기 닫기" onClick={() => setSelected(null)}><Icon name="close" size={16} /></button>
          {selected.image && <img src={selected.image} alt="" />}
          <div>
            <span>{selected.type}</span>
            <strong>{selected.title}</strong>
            {selected.body && <p>{selected.body}</p>}
            <small>{selected.place} · {new Date(selected.time).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
            {selected.href && <Link href={selected.href} aria-label={`${selected.title} 자세히 보기`}>이야기 보기 <Icon name="arrow" size={14} /></Link>}
          </div>
        </article>
      )}
    </div>
  );
}
