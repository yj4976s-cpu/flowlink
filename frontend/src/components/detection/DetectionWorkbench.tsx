"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { useDaru } from "@/components/mascot";
import { createCitizenReport } from "@/lib/citizenReportsApi";
import {
  DetectionApiError,
  DetectionBBox,
  DetectionEvent,
  DetectionObject,
  WebcamDetectionFrame,
  deleteAllMyDetections,
  deleteMyDetection,
  getMyDetection,
  listMyDetections,
  resolveDetectionMediaUrl,
  uploadDetectionImage,
  uploadDetectionVideo,
} from "@/lib/detectionApi";
import type { CitizenReport } from "@/types/discoveryNetwork";
import { WebcamDetectionPanel } from "./WebcamDetectionPanel";
import type { WebcamPanelStatus, WebcamReportCandidate } from "./WebcamDetectionPanel";
import { getContainedMediaRect, getContainedMediaRectStyle, getOverlayPercentageStyle, normalizeBBoxForDisplayMedia } from "./detectionOverlayGeometry";
import styles from "./DetectionWorkbench.module.css";

type DetectionTab = "image" | "video" | "webcam";
type SubmitState = "idle" | "selected" | "analyzing" | "success" | "error";
type FoundReportCandidate = {
  sourceType: DetectionTab;
  objectClassCode: string;
  objectClassName: string;
  confidence: number;
  bbox: DetectionBBox | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  image: File | null;
  previewUrl: string;
  capturedAt: string;
};
type OverlayItem = {
  key: string;
  bbox: DetectionBBox;
  label: string;
  confidence: number;
};
type Size = {
  width: number;
  height: number;
};

const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const CITIZEN_REPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const REPORT_IMAGE_INITIAL_MAX_EDGE = 1600;
const REPORT_IMAGE_MIN_MAX_EDGE = 960;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const VIDEO_MAX_SECONDS = 30;
const VIDEO_REPORT_FRAME_MAX_WIDTH = 960;
const VIDEO_REPORT_FRAME_TIMEOUT_MS = 8000;
const REPORT_CROP_PADDING_RATIO = 0.08;
const HISTORY_PAGE_SIZE = 8;
const RESULT_PAGE_SIZE = 4;
const CTA_PAGE_SIZE = 4;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const videoTypes = new Set(["video/mp4"]);

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusLabels: Record<string, string> = {
  PENDING: "대기 중",
  PROCESSING: "확인 중",
  COMPLETED: "완료",
  FAILED: "실패",
};

const webcamStatusLabels: Record<WebcamPanelStatus, string> = {
  idle: "대기",
  requesting: "권한 요청 중",
  ready: "카메라 준비",
  running: "실시간 확인 중",
  error: "확인 필요",
};

const sourceTypeLabels: Record<string, string> = {
  IMAGE: "사진",
  VIDEO: "영상",
  WEBCAM: "카메라",
};

const groupLabels: Record<string, string> = {
  WASTE: "폐기물",
  NATURAL: "자연물",
  PERSONAL_ITEM: "개인 물품 후보",
  UNKNOWN: "미확인",
};

const reportableClassNames: Record<string, string> = {
  BAG: "가방",
  UMBRELLA: "우산",
  FOOTWEAR: "신발",
  BALL: "공",
};

function getReportableClassCode(value: string | null | undefined) {
  return value && reportableClassNames[value] ? value : "";
}

function isReportablePersonalItem(object: Pick<DetectionObject, "class_code" | "group_code">) {
  return object.group_code === "PERSONAL_ITEM" && Boolean(getReportableClassCode(object.class_code));
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "일시 확인 중" : dateFormatter.format(date);
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatMilliseconds(value: number | null) {
  if (value === null) return "";
  return `${(value / 1000).toFixed(1)}초`;
}

function getVideoReportTimestampMs(object: DetectionObject) {
  const firstSeen = object.first_seen_ms;
  const lastSeen = object.last_seen_ms;
  if (firstSeen !== null && lastSeen !== null) return (firstSeen + lastSeen) / 2;
  return firstSeen ?? lastSeen ?? 0;
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/jpeg", quality = 0.86) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decodeImageFile(file: File) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  if (typeof document === "undefined") throw new Error("이미지 처리는 브라우저에서만 가능합니다.");

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function closeImageSource(source: ImageBitmap | HTMLImageElement) {
  if ("close" in source) source.close();
}

function getReportCropRect(
  bbox: DetectionBBox,
  mediaWidth: number,
  mediaHeight: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  if (mediaWidth <= 0 || mediaHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scaleX = sourceWidth / mediaWidth;
  const scaleY = sourceHeight / mediaHeight;
  const paddingX = Math.max(2, bbox.width * scaleX * REPORT_CROP_PADDING_RATIO);
  const paddingY = Math.max(2, bbox.height * scaleY * REPORT_CROP_PADDING_RATIO);
  const left = Math.max(0, bbox.x * scaleX - paddingX);
  const top = Math.max(0, bbox.y * scaleY - paddingY);
  const right = Math.min(sourceWidth, (bbox.x + bbox.width) * scaleX + paddingX);
  const bottom = Math.min(sourceHeight, (bbox.y + bbox.height) * scaleY + paddingY);
  const width = right - left;
  const height = bottom - top;
  return width >= 1 && height >= 1 ? { left, top, width, height } : null;
}

async function prepareCitizenReportImage(
  file: File,
  bbox: DetectionBBox,
  mediaWidth: number,
  mediaHeight: number,
) {
  if (!imageTypes.has(file.type)) {
    throw new Error("발견 제보에는 JPG, PNG, WebP 이미지만 첨부할 수 있습니다.");
  }

  const image = await decodeImageFile(file);
  try {
    const sourceWidth = image.width;
    const sourceHeight = image.height;
    if (!sourceWidth || !sourceHeight) throw new Error("이미지 크기를 확인하지 못했습니다.");

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지를 변환하지 못했습니다.");

    const crop = getReportCropRect(bbox, mediaWidth, mediaHeight, sourceWidth, sourceHeight);
    if (!crop) throw new Error("탐지된 물건 영역을 확인하지 못했습니다.");

    const qualities = [0.86, 0.78, 0.7, 0.62];
    const maxEdges = [REPORT_IMAGE_INITIAL_MAX_EDGE, 1440, 1280, 1120, REPORT_IMAGE_MIN_MAX_EDGE];

    for (const maxEdge of maxEdges) {
      const scale = Math.min(1, maxEdge / Math.max(crop.width, crop.height));
      canvas.width = Math.max(1, Math.round(crop.width * scale));
      canvas.height = Math.max(1, Math.round(crop.height * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        crop.left,
        crop.top,
        crop.width,
        crop.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );

      for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, "image/jpeg", quality);
        if (blob && blob.size <= CITIZEN_REPORT_IMAGE_MAX_BYTES) {
          const baseName = file.name.replace(/\.[^.]+$/, "") || "detection-report";
          return new File([blob], `${baseName}-object.jpg`, { type: "image/jpeg" });
        }
      }
    }

    throw new Error("이미지를 5MB 이하로 준비하지 못했습니다. 더 작은 이미지를 선택해주세요.");
  } finally {
    closeImageSource(image);
  }
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: "loadedmetadata" | "seeked", timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("영상 프레임을 준비하지 못했습니다."));
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timer);
      video.removeEventListener(eventName, handleEvent);
      video.removeEventListener("error", handleError);
    }

    function handleEvent() {
      cleanup();
      resolve();
    }

    function handleError() {
      cleanup();
      reject(new Error("영상 프레임을 읽지 못했습니다."));
    }

    video.addEventListener(eventName, handleEvent, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

async function captureVideoReportFrame(videoFile: File, object: DetectionObject) {
  if (typeof document === "undefined") return null;

  const objectUrl = URL.createObjectURL(videoFile);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";

  try {
    video.src = objectUrl;
    video.load();
    await waitForVideoEvent(video, "loadedmetadata", VIDEO_REPORT_FRAME_TIMEOUT_MS);

    if (!video.videoWidth || !video.videoHeight) return null;

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const targetSeconds = duration
      ? Math.min(Math.max(getVideoReportTimestampMs(object) / 1000, 0), Math.max(duration - 0.05, 0))
      : 0;

    video.currentTime = targetSeconds;
    await waitForVideoEvent(video, "seeked", VIDEO_REPORT_FRAME_TIMEOUT_MS);

    const crop = getReportCropRect(object.bbox, video.videoWidth, video.videoHeight, video.videoWidth, video.videoHeight);
    if (!crop) return null;
    const scale = Math.min(1, VIDEO_REPORT_FRAME_MAX_WIDTH / crop.width);
    const width = Math.max(1, Math.round(crop.width * scale));
    const height = Math.max(1, Math.round(crop.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, crop.left, crop.top, crop.width, crop.height, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", 0.86);
    if (!blob) return null;

    const timestampMs = Math.round(targetSeconds * 1000);
    return new File([blob], `flowlink-video-object-${timestampMs}.jpg`, { type: "image/jpeg" });
  } catch {
    return null;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

function toDatetimeLocalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDatetimeToIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function validateFile(file: File, tab: DetectionTab) {
  if (tab === "webcam") return "";
  if (tab === "image") {
    if (!imageTypes.has(file.type)) return "JPG, PNG, WEBP 이미지만 업로드할 수 있습니다.";
    if (file.size > IMAGE_MAX_BYTES) return "이미지는 최대 20MB까지 업로드할 수 있습니다.";
    return "";
  }
  if (!videoTypes.has(file.type)) return "MP4 영상만 업로드할 수 있습니다.";
  if (file.size > VIDEO_MAX_BYTES) return "영상은 최대 100MB까지 업로드할 수 있습니다.";
  return "";
}

function detectionObjectToOverlayItem(object: DetectionObject): OverlayItem {
  return {
    key: String(object.id),
    bbox: object.bbox,
    label: object.class_name_ko,
    confidence: object.confidence,
  };
}

function reportCandidateOverlayItem(candidate: FoundReportCandidate): OverlayItem | null {
  if (!candidate.bbox) return null;
  return {
    key: `${candidate.sourceType}-${candidate.objectClassCode}-${candidate.bbox.x}-${candidate.bbox.y}`,
    bbox: candidate.bbox,
    label: candidate.objectClassName,
    confidence: candidate.confidence,
  };
}

function BboxOverlay({
  items,
  mediaWidth,
  mediaHeight,
  mediaRect,
  displayMediaSize,
}: {
  items: OverlayItem[];
  mediaWidth: number | null | undefined;
  mediaHeight: number | null | undefined;
  mediaRect: NonNullable<ReturnType<typeof getContainedMediaRect>>;
  displayMediaSize: Size;
}) {
  if (items.length === 0) return null;

  return (
    <div className={styles.mediaLayer} style={getContainedMediaRectStyle(mediaRect)} aria-hidden="true">
      <div className={styles.overlay}>
        {items.map((item) => {
          const normalized = mediaWidth && mediaHeight
            ? normalizeBBoxForDisplayMedia(
                item.bbox,
                { width: mediaWidth, height: mediaHeight },
                displayMediaSize,
              )
            : null;
          if (!normalized) return null;
          return (
            <span key={item.key} className={styles.overlayBox} style={getOverlayPercentageStyle(normalized)}>
              <b>{item.label} {formatConfidence(item.confidence)}</b>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PreviewImageWithOverlay({
  previewUrl,
  alt,
  className,
  mediaWidth,
  mediaHeight,
  overlayItems,
}: {
  previewUrl: string;
  alt: string;
  className: string;
  mediaWidth: number | null | undefined;
  mediaHeight: number | null | undefined;
  overlayItems: OverlayItem[];
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 });
  const [loadedImage, setLoadedImage] = useState<{ url: string; size: Size }>({
    url: "",
    size: { width: 0, height: 0 },
  });

  const updateSize = useCallback(() => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    setContainerSize({ width: rect.width, height: rect.height });
  }, []);

  useEffect(() => {
    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (frameRef.current) observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [updateSize, previewUrl]);

  const handleImageLoad = useCallback(() => {
    const image = imgRef.current;
    updateSize();
    setLoadedImage({
      url: previewUrl,
      size: {
        width: image?.naturalWidth ?? 0,
        height: image?.naturalHeight ?? 0,
      },
    });
  }, [previewUrl, updateSize]);

  const activeNaturalSize = loadedImage.url === previewUrl ? loadedImage.size : { width: 0, height: 0 };
  const mediaRect = getContainedMediaRect(containerSize, activeNaturalSize);

  return (
    <div ref={frameRef} className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={previewUrl} alt={alt} onLoad={handleImageLoad} />
      {mediaRect && mediaWidth && mediaHeight && (
        <BboxOverlay
          items={overlayItems}
          mediaWidth={mediaWidth}
          mediaHeight={mediaHeight}
          mediaRect={mediaRect}
          displayMediaSize={activeNaturalSize}
        />
      )}
    </div>
  );
}

function ResultList({ event }: { event: DetectionEvent | null }) {
  const [pageState, setPageState] = useState({ key: "", page: 1 });
  const objects = event?.detected_objects ?? [];
  const pageKey = `${event?.id ?? "empty"}:${objects.length}`;
  const pageCount = Math.max(1, Math.ceil(objects.length / RESULT_PAGE_SIZE));
  const requestedPage = pageState.key === pageKey ? pageState.page : 1;
  const activePage = Math.min(requestedPage, pageCount);
  const pagedObjects = objects.slice((activePage - 1) * RESULT_PAGE_SIZE, activePage * RESULT_PAGE_SIZE);
  const setResultPage = (updater: (current: number) => number) => {
    setPageState((current) => {
      const currentPage = current.key === pageKey ? current.page : 1;
      return { key: pageKey, page: updater(currentPage) };
    });
  };

  if (!event) {
    return (
      <div className={styles.emptyResult}>
        <Icon name="scan" size={24} />
        <p>사진이나 영상을 선택하고 물건 확인을 시작하면 결과가 여기에 표시됩니다.</p>
      </div>
    );
  }

  if (event.status === "FAILED") {
    return (
      <div className={styles.emptyResult}>
        <Icon name="spark" size={24} />
        <p>물건 확인을 완료하지 못했습니다. 파일 상태를 확인하고 다시 시도해주세요.</p>
      </div>
    );
  }

  if (event.detected_objects.length === 0) {
    return (
      <div className={styles.emptyResult}>
        <Icon name="check" size={24} />
        <p>확인된 물건이 없습니다. 이는 정상 완료 결과일 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className={styles.resultListWrap}>
      <ul className={styles.resultList} aria-label="확인된 물건 목록">
        {pagedObjects.map((object) => (
          <li key={object.id}>
            <div>
              <strong>{object.class_name_ko}</strong>
              <span>{object.class_code} · {groupLabels[object.group_code] ?? object.group_code}</span>
              {event.source_type === "VIDEO" && (
                <small className={styles.trackMeta}>
                  {object.track_id !== null && `Track #${object.track_id} · `}
                  {object.first_seen_ms !== null && object.last_seen_ms !== null
                    ? `${formatMilliseconds(object.first_seen_ms)} ~ ${formatMilliseconds(object.last_seen_ms)} · `
                    : ""}
                  {object.appearance_count}프레임에서 확인
                </small>
              )}
            </div>
            <em>인식 신뢰도 {formatConfidence(object.confidence)}</em>
          </li>
        ))}
      </ul>
      {objects.length > RESULT_PAGE_SIZE && (
        <div className={styles.inlinePager} aria-label="확인된 물건 목록 페이지">
          <button type="button" onClick={() => setResultPage((current) => Math.max(1, current - 1))} disabled={activePage <= 1} aria-label="이전 물건">
            ←
          </button>
          <span>{activePage} / {pageCount}</span>
          <button type="button" onClick={() => setResultPage((current) => Math.min(pageCount, current + 1))} disabled={activePage >= pageCount} aria-label="다음 물건">
            →
          </button>
        </div>
      )}
    </div>
  );
}

function WebcamResultList({ frame, status }: { frame: WebcamDetectionFrame | null; status: WebcamPanelStatus }) {
  if (!frame) {
    return (
      <div className={styles.emptyResult}>
        <Icon name="scanLine" size={24} />
        <p>
          {status === "running"
            ? "카메라 화면을 확인하고 있습니다. 첫 결과가 도착하면 여기에 표시됩니다."
            : "카메라를 켜고 물건 확인을 시작하면 결과가 여기에 표시됩니다."}
        </p>
      </div>
    );
  }

  if (frame.detected_objects.length === 0) {
    return (
      <div className={styles.emptyResult}>
        <Icon name="check" size={24} />
        <p>현재 카메라 화면에서 확인된 물건이 없습니다. 각도나 조명을 조정해보세요.</p>
      </div>
    );
  }

  return (
    <ul className={styles.resultList} aria-label="카메라로 확인된 물건 목록">
      {frame.detected_objects.map((object, index) => (
        <li key={`${object.label}-${index}-${object.bbox.x}-${object.bbox.y}`}>
          <div>
            <strong>{object.label}</strong>
            <span>
              {Math.round(object.bbox.width)}×{Math.round(object.bbox.height)}px · 확인 화면
            </span>
          </div>
          <em>인식 신뢰도 {formatConfidence(object.confidence)}</em>
        </li>
      ))}
    </ul>
  );
}

function ImageOverlay({
  event,
  previewUrl,
}: {
  event: DetectionEvent | null;
  previewUrl: string;
}) {
  return (
    <PreviewImageWithOverlay
      previewUrl={previewUrl}
      alt="업로드한 이미지 미리보기"
      className={styles.previewFrame}
      mediaWidth={event?.media_width}
      mediaHeight={event?.media_height}
      overlayItems={event?.detected_objects.map(detectionObjectToOverlayItem) ?? []}
    />
  );
}

function WebcamReportModal({
  candidate,
  submitting,
  error,
  success,
  onClose,
  onSubmit,
}: {
  candidate: FoundReportCandidate;
  submitting: boolean;
  error: string;
  success: CitizenReport | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const previewUrl = candidate.previewUrl;
  const defaultClassCode = candidate.objectClassCode || "BAG";
  const label = candidate.objectClassName;
  const emptyPreviewTitle = candidate.sourceType === "image" ? "이미지를 첨부하지 못했습니다." : "대표 이미지는 첨부하지 않습니다.";
  const emptyPreviewText = candidate.sourceType === "image"
    ? "이미지 변환에 실패했습니다. 아래 정보를 확인해 이미지 없이 제보하거나 더 작은 이미지를 선택해주세요."
    : candidate.sourceType === "video"
      ? "영상 프레임을 캡처하지 못한 경우 물품 종류와 설명만으로 제보를 시작합니다."
      : "현재 프레임을 캡처하지 못한 경우 물품 종류와 설명만으로 제보를 시작합니다.";
  const overlayItem = reportCandidateOverlayItem(candidate);

  return (
    <div className={styles.reportModalBackdrop} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.reportModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="webcam-report-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.reportModalHeading}>
          <div>
            <p className={styles.eyebrow}>CITIZEN REPORT</p>
            <h2 id="webcam-report-title">발견 제보하기</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="발견 제보 창 닫기">
            <Icon name="close" size={20} />
          </button>
        </div>

        {success ? (
          <div className={styles.reportSuccess}>
            <Icon name="check" size={28} />
            <strong>발견 제보가 접수되었습니다.</strong>
            <p>관리자가 확인 내용과 발견 정보를 검토한 뒤 공식 발견물로 등록합니다.</p>
            <div>
              <Link className="button button-secondary" href="/mypage#my-activity">내 제보 확인</Link>
              <button className="button button-primary" type="button" onClick={onClose}>계속 확인하기</button>
            </div>
          </div>
        ) : (
          <form className={styles.reportForm} onSubmit={onSubmit}>
            <div className={styles.reportPreviewGrid}>
              {previewUrl ? (
                <PreviewImageWithOverlay
                  previewUrl={previewUrl}
                  alt="발견 제보에 첨부할 확인 이미지"
                  className={styles.reportPreviewFrame}
                  mediaWidth={candidate.mediaWidth}
                  mediaHeight={candidate.mediaHeight}
                  overlayItems={overlayItem ? [overlayItem] : []}
                />
              ) : (
                <div className={styles.reportPreviewEmpty}>
                  <Icon name="document" size={26} />
                  <strong>{emptyPreviewTitle}</strong>
                  <p>{emptyPreviewText}</p>
                </div>
              )}
              <div className={styles.reportCandidateMeta}>
                <span>물건 종류 후보</span>
                <strong>{label}</strong>
                <em>인식 신뢰도 {formatConfidence(candidate.confidence)}</em>
                <p>물품 종류는 참고값입니다. 실제 제보 내용에 맞게 수정할 수 있어요.</p>
              </div>
            </div>

            <div className={styles.reportFields}>
              <label>
                물품 종류
                <select name="objectClass" defaultValue={defaultClassCode} required>
                  {Object.entries(reportableClassNames).map(([code, name]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                색상
                <input name="color" placeholder="예: 검정, 파랑" />
              </label>
              <label>
                발견 구역
                <input name="areaName" placeholder="예: 한강공원 A구역" required />
              </label>
              <label>
                발견 시각
                <input name="foundAt" type="datetime-local" defaultValue={toDatetimeLocalInput(candidate.capturedAt)} required />
              </label>
              <label className={styles.reportDescriptionField}>
                설명
                <textarea name="description" minLength={5} maxLength={1000} placeholder="발견 위치, 주변 상황, 물품 특징을 적어주세요." required />
              </label>
            </div>

            {error && <p className={styles.error} role="alert">{error}</p>}

            <div className={styles.reportModalActions}>
              <button className="button button-secondary" type="button" onClick={onClose} disabled={submitting}>취소</button>
              <button className="button button-primary" type="submit" disabled={submitting}>
                {submitting ? "제보 접수 중..." : "제보 접수하기"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

type DetectionWorkbenchProps = {
  initialTab?: DetectionTab;
};

export function DetectionWorkbench({ initialTab = "image" }: DetectionWorkbenchProps) {
  const { cue: cueDaru } = useDaru();
  const [tab, setTab] = useState<DetectionTab>(initialTab);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [videoThumbnailUrl, setVideoThumbnailUrl] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState("");
  const [currentEvent, setCurrentEvent] = useState<DetectionEvent | null>(null);
  const [webcamFrame, setWebcamFrame] = useState<WebcamDetectionFrame | null>(null);
  const [webcamStatus, setWebcamStatus] = useState<WebcamPanelStatus>("idle");
  const [webcamReportCandidate, setWebcamReportCandidate] = useState<FoundReportCandidate | null>(null);
  const [webcamReportSubmitting, setWebcamReportSubmitting] = useState(false);
  const [webcamReportError, setWebcamReportError] = useState("");
  const [webcamReportSuccess, setWebcamReportSuccess] = useState<CitizenReport | null>(null);
  const [history, setHistory] = useState<DetectionEvent[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [deletingHistoryIds, setDeletingHistoryIds] = useState<Set<number>>(() => new Set());
  const [deletingAllHistory, setDeletingAllHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [ctaPageState, setCtaPageState] = useState({ key: "", page: 1 });
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef("");
  const reportPreviewUrlRef = useRef("");
  const webcamReportSubmittingRef = useRef(false);
  const webcamFoundSignatureRef = useRef("");

  useEffect(() => {
    if (tab !== "webcam") return;
    if (webcamStatus === "running") cueDaru("scan", { source: "service" });
    else if (webcamStatus === "error") cueDaru("rest", { source: "service" });
  }, [cueDaru, tab, webcamStatus]);

  useEffect(() => {
    if (tab !== "webcam") return;
    const signature = (webcamFrame?.detected_objects ?? []).map((object) => object.class_code).sort().join(":");
    if (!signature) {
      webcamFoundSignatureRef.current = "";
      return;
    }
    if (signature !== webcamFoundSignatureRef.current) {
      webcamFoundSignatureRef.current = signature;
      cueDaru("found", { source: "service" });
    }
  }, [cueDaru, tab, webcamFrame]);

  const personalItemObjects = useMemo(
    () => currentEvent?.detected_objects.filter(isReportablePersonalItem) ?? [],
    [currentEvent],
  );
  const ctaPageKey = `${currentEvent?.id ?? "empty"}:${personalItemObjects.length}`;
  const ctaPageCount = Math.max(1, Math.ceil(personalItemObjects.length / CTA_PAGE_SIZE));
  const requestedCtaPage = ctaPageState.key === ctaPageKey ? ctaPageState.page : 1;
  const activeCtaPage = Math.min(requestedCtaPage, ctaPageCount);
  const pagedPersonalItemObjects = useMemo(() => {
    const start = (activeCtaPage - 1) * CTA_PAGE_SIZE;
    return personalItemObjects.slice(start, start + CTA_PAGE_SIZE);
  }, [activeCtaPage, personalItemObjects]);
  const setCtaPage = (updater: (current: number) => number) => {
    setCtaPageState((current) => {
      const currentPage = current.key === ctaPageKey ? current.page : 1;
      return { key: ctaPageKey, page: updater(currentPage) };
    });
  };
  const historyPageCount = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const activeHistoryPage = Math.min(historyPage, historyPageCount);
  const pagedHistory = useMemo(() => {
    const start = (activeHistoryPage - 1) * HISTORY_PAGE_SIZE;
    return history.slice(start, start + HISTORY_PAGE_SIZE);
  }, [history, activeHistoryPage]);

  const refreshHistory = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await listMyDetections(signal);
      setHistory(data);
      setHistoryPage(1);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      const message = caught instanceof DetectionApiError ? caught.message : "확인 기록을 불러오지 못했습니다.";
      setHistoryError(message);
    } finally {
      if (!signal?.aborted) setHistoryLoading(false);
    }
  }, []);

  const revokeReportPreviewUrl = useCallback(() => {
    if (reportPreviewUrlRef.current) {
      URL.revokeObjectURL(reportPreviewUrlRef.current);
      reportPreviewUrlRef.current = "";
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => void refreshHistory(controller.signal));
    return () => controller.abort();
  }, [refreshHistory]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (reportPreviewUrlRef.current) URL.revokeObjectURL(reportPreviewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (tab !== "video" || !previewUrl) return;

    let cancelled = false;
    let captured = false;
    let candidateTimes: number[] = [];
    let candidateIndex = 0;
    const video = document.createElement("video");

    const isMostlyDarkFrame = (context: CanvasRenderingContext2D, width: number, height: number) => {
      const sampleWidth = Math.min(80, width);
      const sampleHeight = Math.min(45, height);
      const sample = context.getImageData(
        Math.max(0, Math.floor((width - sampleWidth) / 2)),
        Math.max(0, Math.floor((height - sampleHeight) / 2)),
        sampleWidth,
        sampleHeight,
      ).data;

      let totalBrightness = 0;
      for (let index = 0; index < sample.length; index += 4) {
        totalBrightness += (sample[index] + sample[index + 1] + sample[index + 2]) / 3;
      }

      return totalBrightness / (sample.length / 4) < 18;
    };

    const seekToNextCandidate = () => {
      if (cancelled || candidateIndex >= candidateTimes.length) return;
      try {
        video.currentTime = candidateTimes[candidateIndex];
      } catch {
        candidateIndex += 1;
        seekToNextCandidate();
      }
    };

    const captureThumbnail = () => {
      if (cancelled || captured || !video.videoWidth || !video.videoHeight) return;

      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (isMostlyDarkFrame(context, canvas.width, canvas.height) && candidateIndex < candidateTimes.length - 1) {
          candidateIndex += 1;
          seekToNextCandidate();
          return;
        }

        captured = true;
        setVideoThumbnailUrl(canvas.toDataURL("image/jpeg", 0.86));
      } catch {
        setVideoThumbnailUrl("");
      }
    };

    const handleLoadedMetadata = () => {
      const duration = video.duration;
      if (!cancelled) setVideoDuration(Number.isFinite(duration) ? duration : null);

      const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
      const safeEnd = Math.max(0, safeDuration - 0.2);
      candidateTimes = safeDuration
        ? [0.2, 0.5, 0.75, 0.05].map((ratio) => Math.min(safeEnd, Math.max(0, safeDuration * ratio)))
        : [0];
      seekToNextCandidate();
    };

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("seeked", captureThumbnail);
    video.src = previewUrl;
    video.load();

    return () => {
      cancelled = true;
      video.pause();
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("seeked", captureThumbnail);
      video.removeAttribute("src");
      video.load();
    };
  }, [previewUrl, tab]);

  const replacePreviewUrl = (nextFile: File | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const objectUrl = nextFile ? URL.createObjectURL(nextFile) : "";
    previewUrlRef.current = objectUrl;
    setPreviewUrl(objectUrl);
  };

  const resetSelectedFile = () => {
    revokeReportPreviewUrl();
    setFile(null);
    setVideoDuration(null);
    setVideoThumbnailUrl("");
    setCurrentEvent(null);
    setWebcamFrame(null);
    setWebcamStatus("idle");
    setWebcamReportCandidate(null);
    setWebcamReportError("");
    setWebcamReportSuccess(null);
    setError("");
    setSubmitState("idle");
    replacePreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleTabChange = (nextTab: DetectionTab) => {
    if (submitState === "analyzing") return;
    setTab(nextTab);
    resetSelectedFile();
  };

  const acceptFile = (nextFile: File | undefined) => {
    if (!nextFile || tab === "webcam") return;
    const validationMessage = validateFile(nextFile, tab);
    setCurrentEvent(null);
    setVideoDuration(null);
    setVideoThumbnailUrl("");
    if (validationMessage) {
      setFile(null);
      replacePreviewUrl(null);
      setError(validationMessage);
      setSubmitState("error");
      return;
    }
    setFile(nextFile);
    replacePreviewUrl(nextFile);
    setError("");
    setSubmitState("selected");
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    acceptFile(event.target.files?.[0]);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
    acceptFile(event.dataTransfer.files?.[0]);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tab === "webcam" || !file || submitState === "analyzing") return;
    const validationMessage = validateFile(file, tab);
    if (validationMessage) {
      setError(validationMessage);
      setSubmitState("error");
      return;
    }
    if (tab === "video" && videoDuration !== null && videoDuration > VIDEO_MAX_SECONDS) {
      setError("영상은 최대 30초까지 권장합니다. 짧은 MP4 파일을 선택해주세요.");
      setSubmitState("error");
      return;
    }

    setSubmitState("analyzing");
    cueDaru("scan", { source: "service" });
    setError("");
    try {
      const result = tab === "image" ? await uploadDetectionImage(file) : await uploadDetectionVideo(file);
      setCurrentEvent(result);
      setSubmitState("success");
      cueDaru(result.detected_objects.length ? "found" : "look", { source: "service" });
      setHistoryLoading(true);
      setHistoryError("");
      await refreshHistory();
    } catch (caught) {
      const message = caught instanceof DetectionApiError ? caught.message : "물건 확인을 처리하지 못했습니다.";
      setError(message);
      setSubmitState("error");
      cueDaru("rest", { source: "service" });
    }
  };

  const loadHistoryDetail = async (id: number) => {
    setError("");
    try {
      const result = await getMyDetection(id);
      setCurrentEvent(result);
      setSubmitState("success");
      setFile(null);
      replacePreviewUrl(null);
      setVideoDuration(null);
      setVideoThumbnailUrl("");
      setTab(result.source_type === "VIDEO" ? "video" : "image");
      setWebcamFrame(null);
      setWebcamStatus("idle");
    } catch (caught) {
      const message = caught instanceof DetectionApiError ? caught.message : "확인 상세를 불러오지 못했습니다.";
      setError(message);
      setSubmitState("error");
    }
  };

  const handleDeleteHistory = async (id: number) => {
    if (deletingHistoryIds.has(id) || deletingAllHistory) return;
    setHistoryError("");
    setDeletingHistoryIds((current) => new Set(current).add(id));
    try {
      await deleteMyDetection(id);
      setHistory((current) => current.filter((event) => event.id !== id));
      setCurrentEvent((event) => (event?.id === id ? null : event));
      if (currentEvent?.id === id) {
        setSubmitState(file ? "selected" : "idle");
      }
    } catch (caught) {
      const message = caught instanceof DetectionApiError ? caught.message : "확인 기록을 삭제하지 못했습니다.";
      setHistoryError(message);
    } finally {
      setDeletingHistoryIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDeleteAllHistory = async () => {
    if (deletingAllHistory || history.length === 0) return;
    const confirmed = window.confirm("내 물건 확인 기록을 모두 삭제할까요? 업로드한 이미지·영상 기록도 함께 정리됩니다.");
    if (!confirmed) return;

    setHistoryError("");
    setDeletingAllHistory(true);
    try {
      await deleteAllMyDetections();
      setHistory([]);
      setHistoryPage(1);
      setCurrentEvent(null);
      setSubmitState(file ? "selected" : "idle");
    } catch (caught) {
      const message = caught instanceof DetectionApiError ? caught.message : "확인 기록을 모두 삭제하지 못했습니다.";
      setHistoryError(message);
    } finally {
      setDeletingAllHistory(false);
      setDeletingHistoryIds(new Set());
    }
  };

  const openWebcamReport = async (candidate: WebcamReportCandidate) => {
    const classCode = getReportableClassCode(candidate.object.class_code);
    if (!classCode) return;
    let croppedImage: File | null = null;
    let imageError = "";
    try {
      croppedImage = await prepareCitizenReportImage(
        candidate.image,
        candidate.object.bbox,
        candidate.frame.media_width,
        candidate.frame.media_height,
      );
    } catch {
      imageError = "탐지된 물건 이미지를 잘라내지 못했습니다. 다시 탐지해 주세요.";
    }
    const reportPreviewUrl = croppedImage ? URL.createObjectURL(croppedImage) : "";
    revokeReportPreviewUrl();
    reportPreviewUrlRef.current = reportPreviewUrl;
    setWebcamReportCandidate({
      sourceType: "webcam",
      objectClassCode: classCode,
      objectClassName: candidate.object.class_name_ko ?? reportableClassNames[classCode] ?? candidate.object.label,
      confidence: candidate.object.confidence,
      bbox: null,
      mediaWidth: null,
      mediaHeight: null,
      image: croppedImage,
      previewUrl: reportPreviewUrl,
      capturedAt: candidate.capturedAt,
    });
    setWebcamReportError(imageError);
    setWebcamReportSuccess(null);
  };

  const openDetectionReport = async (object: DetectionObject) => {
    const classCode = getReportableClassCode(object.class_code);
    if (!classCode || !currentEvent) return;
    const sourceType = tab;
    const sourceFile = file;
    const sourceEvent = currentEvent;
    let image: File | null = null;
    let imageError = "";

    if (sourceType === "image" && sourceFile) {
      try {
        if (!sourceEvent.media_width || !sourceEvent.media_height) throw new Error("탐지 이미지 크기가 없습니다.");
        image = await prepareCitizenReportImage(
          sourceFile,
          object.bbox,
          sourceEvent.media_width,
          sourceEvent.media_height,
        );
      } catch {
        imageError = "이미지를 발견 제보용으로 준비하지 못했습니다. 이미지 없이 제보하거나 더 작은 이미지를 선택해주세요.";
      }
    } else if (sourceType === "video" && sourceFile) {
      image = await captureVideoReportFrame(sourceFile, object);
    }

    const reportPreviewUrl = image ? URL.createObjectURL(image) : "";
    revokeReportPreviewUrl();
    reportPreviewUrlRef.current = reportPreviewUrl;

    setWebcamReportCandidate({
      sourceType,
      objectClassCode: classCode,
      objectClassName: object.class_name_ko || reportableClassNames[classCode],
      confidence: object.confidence,
      bbox: null,
      mediaWidth: null,
      mediaHeight: null,
      image,
      previewUrl: reportPreviewUrl,
      capturedAt: sourceEvent.processing_completed_at ?? sourceEvent.created_at,
    });
    setWebcamReportError(imageError);
    setWebcamReportSuccess(null);
  };

  const closeWebcamReport = () => {
    if (webcamReportSubmittingRef.current) return;
    revokeReportPreviewUrl();
    setWebcamReportCandidate(null);
    setWebcamReportError("");
    setWebcamReportSuccess(null);
  };

  const handleWebcamReportSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!webcamReportCandidate || webcamReportSubmittingRef.current) return;

    const formData = new FormData(event.currentTarget);
    const objectClass = String(formData.get("objectClass") ?? "");
    const color = String(formData.get("color") ?? "").trim();
    const areaName = String(formData.get("areaName") ?? "").trim();
    const foundAt = localDatetimeToIso(String(formData.get("foundAt") ?? ""));
    const description = String(formData.get("description") ?? "").trim();

    if (!objectClass || !areaName || !foundAt || description.length < 5) {
      setWebcamReportError("물품 종류, 발견 구역, 발견 시각, 설명을 확인해주세요.");
      return;
    }

    if (webcamReportCandidate.sourceType === "webcam" && (!webcamReportCandidate.image || webcamReportCandidate.image.size === 0)) {
      setWebcamReportError("카메라 확인 화면을 첨부하지 못했습니다. 다시 확인한 뒤 발견 제보를 접수해 주세요.");
      return;
    }

    webcamReportSubmittingRef.current = true;
    setWebcamReportSubmitting(true);
    setWebcamReportError("");
    try {
      const report = await createCitizenReport({
        category: objectClass,
        color,
        areaName,
        foundAt,
        description,
        image: webcamReportCandidate.image ?? undefined,
      });
      setWebcamReportSuccess(report);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "발견 제보를 접수하지 못했습니다. 잠시 후 다시 시도해주세요.";
      setWebcamReportError(message);
    } finally {
      webcamReportSubmittingRef.current = false;
      setWebcamReportSubmitting(false);
    }
  };

  const displayedStatus = tab === "webcam"
    ? webcamStatusLabels[webcamStatus]
    : currentEvent
      ? statusLabels[currentEvent.status] ?? currentEvent.status
      : "대기";
  const displayedObjectCount = tab === "webcam"
    ? webcamFrame?.detected_objects.length ?? 0
    : currentEvent?.detected_objects.length ?? 0;
  const displayedSourceType = tab === "webcam" ? "WEBCAM" : currentEvent?.source_type ?? (tab === "image" ? "IMAGE" : "VIDEO");
  const displayedSourceTypeLabel = sourceTypeLabels[displayedSourceType] ?? displayedSourceType;
  const resultVideoUrl = currentEvent?.source_type === "VIDEO" && currentEvent.result_media_url
    ? resolveDetectionMediaUrl(currentEvent.result_media_url)
    : "";
  const originalVideoUrl = currentEvent?.source_type === "VIDEO" && currentEvent.original_media_url
    ? resolveDetectionMediaUrl(currentEvent.original_media_url)
    : "";
  const displayedVideoUrl = resultVideoUrl || originalVideoUrl;
  const displayedVideoLabel = resultVideoUrl ? "탐지 결과 영상" : "업로드한 원본 영상";
  const displayedVideoDescription = resultVideoUrl
    ? "Bounding Box가 포함된 결과 영상"
    : "결과 영상이 아직 생성되지 않아 원본 영상만 표시됩니다.";

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="detect-title">
        <p className={styles.eyebrow}>AI 자동 분석</p>
        <h1 id="detect-title">사진·영상 속 물건을 확인해요</h1>
        <p>사진·영상 또는 카메라를 사용하면 화면 속 물건의 종류와 위치를 자동으로 확인해드려요. 결과를 확인한 뒤 발견 제보나 분실 신고로 이어갈 수 있어요.</p>
      </section>

      <section className={styles.workbench} aria-labelledby="workbench-title">
        <div className={styles.tabs} role="tablist" aria-label="물건 확인 방법">
          <button type="button" role="tab" aria-selected={tab === "image"} onClick={() => handleTabChange("image")}>
            사진으로 확인
          </button>
          <button type="button" role="tab" aria-selected={tab === "video"} onClick={() => handleTabChange("video")}>
            영상으로 확인
          </button>
          <button type="button" role="tab" aria-selected={tab === "webcam"} onClick={() => handleTabChange("webcam")}>
            카메라로 확인
          </button>
        </div>

        <div className={styles.grid}>
          {tab === "webcam" ? (
            <WebcamDetectionPanel onFrame={setWebcamFrame} onStatusChange={setWebcamStatus} onReportCandidate={openWebcamReport} reportModalOpen={webcamReportCandidate !== null} completedReportClassCode={webcamReportSuccess ? webcamReportCandidate?.objectClassCode ?? null : null} />
          ) : (
            <section className={styles.uploadPanel} aria-labelledby="workbench-title">
              <div className={styles.panelHeading}>
                <div>
                  <p className={styles.eyebrow}>UPLOAD</p>
                  <h2 id="workbench-title">{tab === "image" ? "이미지 업로드" : "영상 업로드"}</h2>
                </div>
                <span>{tab === "image" ? "JPG · PNG · WEBP / 20MB" : "MP4 / 100MB · 최대 30초 안내"}</span>
              </div>

              <form onSubmit={handleSubmit}>
                <label
                  className={`${styles.dropzone} ${previewUrl ? styles.dropzoneSelected : ""} ${dragActive ? styles.dropzoneActive : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={tab === "image" ? "image/jpeg,image/png,image/webp" : "video/mp4"}
                    onChange={handleFileChange}
                  />
                  {(previewUrl && file) || displayedVideoUrl ? (
                    <div className={`${styles.dropzonePreview} ${tab === "video" ? styles.videoDropzonePreview : ""}`}>
                      {tab === "image" ? (
                        <ImageOverlay previewUrl={previewUrl} event={currentEvent} />
                      ) : displayedVideoUrl ? (
                        <div className={`${styles.previewFrame} ${styles.detectedVideoFrame}`}>
                          <video
                            src={displayedVideoUrl}
                            poster={videoThumbnailUrl || undefined}
                            controls
                            playsInline
                            preload="metadata"
                            onClick={(event) => event.stopPropagation()}
                          >
                            브라우저가 MP4 영상 재생을 지원하지 않습니다.
                          </video>
                        </div>
                      ) : (
                        <div className={`${styles.previewFrame} ${styles.videoPreviewFrame}`}>
                          {videoThumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={videoThumbnailUrl} alt="업로드한 영상 썸네일" />
                          ) : (
                            <span className={styles.videoThumbnailStatus}>영상 미리보기를 준비 중입니다.</span>
                          )}
                          <span className={styles.videoPlayIndicator} aria-hidden="true" />
                          {videoDuration !== null && (
                            <span className={styles.durationBadge}>재생 시간 {Math.round(videoDuration)}초</span>
                          )}
                        </div>
                      )}
                      <div className={styles.previewMeta}>
                        <strong>{file?.name ?? displayedVideoLabel}</strong>
                        <span>{file ? `${formatBytes(file.size)} · 클릭해서 파일 교체` : displayedVideoDescription}</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Icon name="scan" size={32} />
                      <strong>파일을 끌어오거나 선택해주세요.</strong>
                      <span>{tab === "image" ? "이미지는 20MB 이하로 업로드할 수 있습니다." : "영상은 MP4, 100MB 이하를 권장하며 30초 이내를 표시합니다."}</span>
                    </>
                  )}
                </label>

                {error && <p className={styles.error} role="alert">{error}</p>}

                <div className={styles.actions}>
                  <button className="button button-primary" type="submit" disabled={!file || submitState === "analyzing"}>
                    {submitState === "analyzing" ? "물건 확인 중..." : "물건 확인 시작"}
                    <Icon name="arrow" size={18} />
                  </button>
                  <button className="button button-secondary" type="button" onClick={resetSelectedFile} disabled={submitState === "analyzing"}>
                    초기화
                  </button>
                </div>
              </form>
            </section>
          )}

          <aside className={styles.resultPanel} aria-live="polite">
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>RESULT</p>
                <h2>확인 결과</h2>
              </div>
              <span>{displayedStatus}</span>
            </div>

            <div className={styles.summaryCards}>
              <div>
                <span>확인된 물건</span>
                <strong>{displayedObjectCount}개</strong>
              </div>
              <div>
                <span>확인 방법</span>
                <strong>{displayedSourceTypeLabel}</strong>
              </div>
            </div>

            {tab === "webcam" ? <WebcamResultList frame={webcamFrame} status={webcamStatus} /> : <ResultList event={currentEvent} />}

            <p className={styles.notice}>자동 확인 결과는 참고용이며 동일한 물건이나 소유권을 확정하지 않습니다.</p>

            {personalItemObjects.length > 0 && tab !== "webcam" && (
              <div className={styles.ctaBox}>
                <strong>확인된 물건을 어떻게 처리할까요?</strong>
                <p>AI가 실제 소유자를 확정하지는 않습니다. 상황에 맞는 다음 행동을 선택해주세요.</p>
                <div className={styles.ctaObjectList}>
                  {pagedPersonalItemObjects.map((object) => (
                    <article key={object.id} className={styles.ctaObjectCard}>
                      <span>{object.class_name_ko || reportableClassNames[object.class_code]}</span>
                      <small>인식 신뢰도 {formatConfidence(object.confidence)}</small>
                      <div>
                        <button className="button button-secondary" type="button" onClick={() => void openDetectionReport(object)}>
                          발견한 물건을 제보할게요
                        </button>
                        <Link className="button button-primary" href={`/lost-reports/new?class_code=${encodeURIComponent(object.class_code)}&source=detection`}>
                          내가 잃어버린 물건이에요
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
                <div className={styles.ctaFooter}>
                  <Link className="button button-secondary" href="/found-items">비슷한 발견물 보기</Link>
                  {personalItemObjects.length > CTA_PAGE_SIZE && (
                    <div className={styles.inlinePager} aria-label="개인 물품 후보 페이지">
                      <button type="button" onClick={() => setCtaPage((current) => Math.max(1, current - 1))} disabled={activeCtaPage <= 1} aria-label="이전 개인 물품 후보">
                        ←
                      </button>
                      <span>{activeCtaPage} / {ctaPageCount}</span>
                      <button type="button" onClick={() => setCtaPage((current) => Math.min(ctaPageCount, current + 1))} disabled={activeCtaPage >= ctaPageCount} aria-label="다음 개인 물품 후보">
                        →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>

      {webcamReportCandidate && (
        <WebcamReportModal
          candidate={webcamReportCandidate}
          submitting={webcamReportSubmitting}
          error={webcamReportError}
          success={webcamReportSuccess}
          onClose={closeWebcamReport}
          onSubmit={handleWebcamReportSubmit}
        />
      )}

      <section className={styles.history} aria-labelledby="history-title" aria-busy={historyLoading}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>MY HISTORY</p>
            <h2 id="history-title">최근 내 확인 기록</h2>
          </div>
          <div className={styles.historyActions}>
            <span>
              {historyLoading
                ? "불러오는 중"
                : `총 ${history.length}건 · ${activeHistoryPage} / ${historyPageCount}`}
            </span>
            <div className={styles.historyPager} aria-label="확인 기록 페이지">
              <button
                type="button"
                onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                disabled={historyLoading || activeHistoryPage <= 1 || deletingAllHistory}
                aria-label="이전 확인 기록 페이지"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setHistoryPage((current) => Math.min(historyPageCount, current + 1))}
                disabled={historyLoading || activeHistoryPage >= historyPageCount || deletingAllHistory}
                aria-label="다음 확인 기록 페이지"
              >
                →
              </button>
            </div>
            <button
              type="button"
              onClick={() => void handleDeleteAllHistory()}
              disabled={historyLoading || history.length === 0 || deletingAllHistory}
            >
              {deletingAllHistory ? "삭제 중" : "모두 삭제"}
            </button>
          </div>
        </div>

        {historyError && <p className={styles.error} role="alert">{historyError}</p>}
        {historyLoading && <div className={styles.stateCard} role="status"><Icon name="scan" size={22} /> 확인 기록을 불러오고 있습니다.</div>}
        {!historyLoading && !historyError && history.length === 0 && (
          <div className={styles.stateCard}>
            <Icon name="document" size={22} />
            <span>아직 저장된 물건 확인 기록이 없습니다.</span>
          </div>
        )}
        {!historyLoading && !historyError && history.length > 0 && (
          <div className={styles.historyGrid} role="list">
            {pagedHistory.map((event) => {
              const isDeleting = deletingHistoryIds.has(event.id);
              return (
                <article key={event.id} className={styles.historyCard} role="listitem" aria-busy={isDeleting}>
                  <button
                    type="button"
                    className={styles.historyDetailButton}
                    onClick={() => void loadHistoryDetail(event.id)}
                    disabled={isDeleting || deletingAllHistory}
                  >
                    <span>{event.source_type}</span>
                    <strong>{statusLabels[event.status] ?? event.status}</strong>
                    <em>{formatDateTime(event.created_at)}</em>
                    <b>{event.detected_objects.length}개 · {event.detected_objects[0]?.class_name_ko ?? "확인된 물건 없음"}</b>
                  </button>
                  <button
                    type="button"
                    className={styles.historyDeleteButton}
                    onClick={() => void handleDeleteHistory(event.id)}
                    disabled={isDeleting || deletingAllHistory}
                    aria-label={`확인 기록 ${event.id} 삭제`}
                  >
                    {isDeleting ? "삭제 중" : "삭제"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
