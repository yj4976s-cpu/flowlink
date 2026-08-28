"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { loadKakaoMaps, type KakaoCustomOverlayInstance, type KakaoMapInstance, type KakaoRoot } from "@/lib/kakaoPlaces";
import type { MapMarker, SearchResult } from "./mockOperationsMapData";
import { createProgrammaticViewportGuard } from "./operationsMapViewport";
import styles from "./AdminOperationsMap.module.css";

export type OperationsBounds = { south: number; west: number; north: number; east: number };

type Props = {
  markers: MapMarker[];
  detectionCounts: Record<string, number>;
  selectedId: string | null;
  spotlightCameraId: string | null;
  searchPoint: SearchResult | null;
  expanded: boolean;
  fitToken: number;
  onSelect: (id: string | null) => void;
  onQueryArea: (bounds: OperationsBounds) => void;
  onStateChange: (state: "loading" | "ready" | "error") => void;
};

type OverlayEntry = { overlay: KakaoCustomOverlayInstance; element: HTMLElement; markerId?: string; cleanup: () => void };

const DEFAULT_CENTER = { latitude: 37.5199, longitude: 127.006 };
const MIN_LEVEL = 2;
const MAX_LEVEL = 10;

function boundsOf(map: KakaoMapInstance): OperationsBounds {
  const bounds = map.getBounds();
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  return { south: southWest.getLat(), west: southWest.getLng(), north: northEast.getLat(), east: northEast.getLng() };
}

function markerElement(marker: MapMarker, count: number, onSelect: () => void) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = styles.kakaoMarker;
  button.dataset.kind = marker.kind;
  button.dataset.status = marker.status;
  button.setAttribute("aria-label", `${marker.id} ${marker.kind === "camera" ? "카메라 선택" : marker.title}, ${marker.subtitle}`);
  button.setAttribute("aria-pressed", "false");

  const symbol = document.createElement("span");
  symbol.className = styles.kakaoMarkerSymbol;
  symbol.textContent = marker.kind === "camera" ? "▣" : marker.kind === "found" ? "◆" : "●";
  const label = document.createElement("b");
  label.textContent = marker.id;
  button.append(symbol, label);

  if (marker.kind === "camera" && count > 0) {
    const badge = document.createElement("i");
    badge.className = styles.detectionBadge;
    badge.textContent = String(count);
    badge.setAttribute("aria-label", `AI 탐지 ${count}건`);
    button.appendChild(badge);
  }
  if (marker.status !== "normal") {
    const alert = document.createElement("em");
    alert.className = styles.markerAlert;
    alert.textContent = "!";
    button.appendChild(alert);
  }
  const click = (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); onSelect(); };
  button.addEventListener("click", click);
  return { element: button, cleanup: () => button.removeEventListener("click", click) };
}

export function AdminKakaoOperationsMap({ markers, detectionCounts, selectedId, spotlightCameraId, searchPoint, expanded, fitToken, onSelect, onQueryArea, onStateChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const kakaoRef = useRef<KakaoRoot | null>(null);
  const overlaysRef = useRef<OverlayEntry[]>([]);
  const onSelectRef = useRef(onSelect);
  const onStateChangeRef = useRef(onStateChange);
  const fitMarkersRef = useRef(markers);
  const fitSearchPointRef = useRef(searchPoint);
  const [readyVersion, setReadyVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const viewportGuardRef = useRef<ReturnType<typeof createProgrammaticViewportGuard> | null>(null);

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { fitMarkersRef.current = markers; fitSearchPointRef.current = searchPoint; }, [markers, searchPoint]);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let removeSdkListeners = () => undefined;
    let frame = 0;
    onStateChangeRef.current("loading");
    void loadKakaoMaps().then((kakao) => {
      if (disposed || !containerRef.current) return;
      const center = new kakao.maps.LatLng(DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude);
      const map = new kakao.maps.Map(containerRef.current, { center, level: 8 });
      kakaoRef.current = kakao;
      mapRef.current = map;
      const selectNone = () => onSelectRef.current(null);
      const markDirty = () => setDirty(true);
      const viewportGuard = createProgrammaticViewportGuard(markDirty);
      viewportGuardRef.current = viewportGuard;
      kakao.maps.event.addListener(map, "click", selectNone);
      kakao.maps.event.addListener(map, "dragend", markDirty);
      const handleZoomChanged = () => viewportGuard.onZoomChanged();
      kakao.maps.event.addListener(map, "zoom_changed", handleZoomChanged);
      resizeObserver = new ResizeObserver(() => {
        window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => map.relayout());
      });
      resizeObserver.observe(containerRef.current);
      setReadyVersion((value) => value + 1);
      onStateChangeRef.current("ready");
      frame = window.requestAnimationFrame(() => { map.relayout(); map.setCenter(center); });
      removeSdkListeners = () => {
        kakao.maps.event.removeListener(map, "click", selectNone);
        kakao.maps.event.removeListener(map, "dragend", markDirty);
        kakao.maps.event.removeListener(map, "zoom_changed", handleZoomChanged);
      };
    }).catch((error) => {
      console.error("Failed to load Kakao operations map", error);
      if (!disposed) onStateChangeRef.current("error");
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      removeSdkListeners();
      overlaysRef.current.forEach(({ overlay, cleanup }) => { overlay.setMap(null); cleanup(); });
      overlaysRef.current = [];
      viewportGuardRef.current?.reset();
      viewportGuardRef.current = null;
      mapRef.current = null;
      kakaoRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const kakao = kakaoRef.current;
    if (!map || !kakao) return;
    overlaysRef.current.forEach(({ overlay, cleanup }) => { overlay.setMap(null); cleanup(); });
    overlaysRef.current = markers.map((marker) => {
      const content = markerElement(marker, detectionCounts[marker.id] ?? 0, () => onSelectRef.current(marker.id));
      const overlay = new kakao.maps.CustomOverlay({
        map,
        position: new kakao.maps.LatLng(marker.latitude, marker.longitude),
        content: content.element,
        xAnchor: .5,
        yAnchor: 1,
        zIndex: marker.kind === "camera" ? 8 : 6,
      });
      return { overlay, element: content.element, markerId: marker.id, cleanup: content.cleanup };
    });
    if (searchPoint && !searchPoint.markerId) {
      const element = document.createElement("span");
      element.className = styles.kakaoSearchPoint;
      element.textContent = `● ${searchPoint.title}`;
      const overlay = new kakao.maps.CustomOverlay({ map, position: new kakao.maps.LatLng(searchPoint.latitude, searchPoint.longitude), content: element, xAnchor: .5, yAnchor: 1.2, zIndex: 10 });
      overlaysRef.current.push({ overlay, element, cleanup: () => undefined });
    }
  }, [detectionCounts, markers, readyVersion, searchPoint]);

  useEffect(() => {
    overlaysRef.current.forEach(({ element, markerId }) => {
      if (!markerId) return;
      const marker = markers.find((item) => item.id === markerId);
      const selected = selectedId === markerId;
      const spotlighted = spotlightCameraId === markerId;
      if (selected) element.dataset.selected = "true"; else delete element.dataset.selected;
      if (spotlighted) element.dataset.spotlight = "true"; else delete element.dataset.spotlight;
      if (spotlightCameraId && !spotlighted) element.dataset.dimmed = "true"; else delete element.dataset.dimmed;
      element.setAttribute("aria-pressed", String(selected));
      if (marker?.kind === "camera") element.setAttribute("aria-label", spotlighted ? `${marker.id} 카메라, 현재 집중 보기` : `${marker.id} 카메라 선택, ${marker.subtitle}`);
    });
  }, [markers, readyVersion, selectedId, spotlightCameraId]);

  useEffect(() => {
    const map = mapRef.current;
    const kakao = kakaoRef.current;
    const target = searchPoint ?? markers.find((marker) => marker.id === selectedId);
    if (!map || !kakao || !target) return;
    setDirty(false);
    map.panTo(new kakao.maps.LatLng(target.latitude, target.longitude));
    if (map.getLevel() > 5) viewportGuardRef.current?.run(map, () => map.setLevel(5));
  }, [markers, searchPoint, selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    const kakao = kakaoRef.current;
    const camera = markers.find((marker) => marker.id === spotlightCameraId && marker.kind === "camera");
    if (!map || !kakao || !camera) return;
    setDirty(false);
    map.panTo(new kakao.maps.LatLng(camera.latitude, camera.longitude));
    viewportGuardRef.current?.run(map, () => map.setLevel(6));
  }, [markers, spotlightCameraId]);

  useEffect(() => {
    const map = mapRef.current;
    const kakao = kakaoRef.current;
    const fitMarkers = fitMarkersRef.current;
    const fitSearchPoint = fitSearchPointRef.current;
    if (!map || !kakao || !fitMarkers.length) return;
    setDirty(false);
    if (fitMarkers.length === 1) {
      map.setCenter(new kakao.maps.LatLng(fitMarkers[0].latitude, fitMarkers[0].longitude));
      viewportGuardRef.current?.run(map, () => map.setLevel(5));
      return;
    }
    const bounds = new kakao.maps.LatLngBounds();
    fitMarkers.forEach((marker) => bounds.extend(new kakao.maps.LatLng(marker.latitude, marker.longitude)));
    if (fitSearchPoint) bounds.extend(new kakao.maps.LatLng(fitSearchPoint.latitude, fitSearchPoint.longitude));
    viewportGuardRef.current?.run(map, () => map.setBounds(bounds, 72));
  }, [fitToken, readyVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const frame = window.requestAnimationFrame(() => {
      map.relayout();
      const target = searchPoint ?? markers.find((marker) => marker.id === selectedId);
      if (target && kakaoRef.current) map.setCenter(new kakaoRef.current.maps.LatLng(target.latitude, target.longitude));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, markers, searchPoint, selectedId]);

  const zoom = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    setDirty(true);
    map.setLevel(Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, map.getLevel() + delta)));
  };

  return <div className={styles.kakaoMapShell}>
    <div ref={containerRef} className={styles.kakaoMapCanvas} aria-label="카메라 중심 실시간 운영 지도" />
    <div className={styles.mapTint} aria-hidden="true" />
    {dirty && <button className={styles.queryArea} type="button" onClick={() => { const map = mapRef.current; if (!map) return; onQueryArea(boundsOf(map)); setDirty(false); }}><Icon name="refresh" size={15} />이 구역 조회</button>}
    <div className={styles.mapLegend} aria-label="지도 범례"><span data-kind="camera">카메라</span><span data-kind="detection">AI 집계</span><span data-kind="found">발견물</span><span data-kind="citizen">시민 제보</span></div>
    <div className={styles.mapControls} aria-label="지도 확대 및 축소"><button type="button" aria-label="지도 확대" onClick={() => zoom(-1)}>+</button><button type="button" aria-label="지도 축소" onClick={() => zoom(1)}>−</button></div>
  </div>;
}
