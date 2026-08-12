"use client";

import Link from "next/link";
import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  DetectionApiError,
  DetectionEvent,
  DetectionObject,
  WebcamDetectionFrame,
  deleteAllMyDetections,
  deleteMyDetection,
  getMyDetection,
  listMyDetections,
  uploadDetectionImage,
  uploadDetectionVideo,
} from "@/lib/detectionApi";
import { WebcamDetectionPanel, WebcamPanelStatus } from "./WebcamDetectionPanel";
import styles from "./DetectionWorkbench.module.css";

type DetectionTab = "image" | "video" | "webcam";
type SubmitState = "idle" | "selected" | "analyzing" | "success" | "error";

const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const VIDEO_MAX_SECONDS = 30;
const HISTORY_PAGE_SIZE = 8;
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const videoTypes = new Set(["video/mp4"]);

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusLabels: Record<string, string> = {
  PENDING: "대기 중",
  PROCESSING: "분석 중",
  COMPLETED: "완료",
  FAILED: "실패",
};

const webcamStatusLabels: Record<WebcamPanelStatus, string> = {
  idle: "대기",
  requesting: "권한 요청 중",
  ready: "카메라 준비",
  running: "실시간 분석 중",
  error: "확인 필요",
};

const groupLabels: Record<string, string> = {
  WASTE: "폐기물",
  NATURAL: "자연물",
  PERSONAL_ITEM: "개인 물품 후보",
  UNKNOWN: "미확인",
};

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

function ResultList({ event }: { event: DetectionEvent | null }) {
  if (!event) {
    return (
      <div className={styles.emptyResult}>
        <Icon name="scan" size={24} />
        <p>파일을 선택하고 AI 탐지를 시작하면 결과가 여기에 표시됩니다.</p>
      </div>
    );
  }

  if (event.status === "FAILED") {
    return (
      <div className={styles.emptyResult}>
        <Icon name="spark" size={24} />
        <p>탐지가 완료되지 않았습니다. 모델 연결 또는 파일 상태를 확인해주세요.</p>
      </div>
    );
  }

  if (event.detected_objects.length === 0) {
    return (
      <div className={styles.emptyResult}>
        <Icon name="check" size={24} />
        <p>탐지된 객체가 없습니다. 이는 정상 완료 결과일 수 있습니다.</p>
      </div>
    );
  }

  return (
    <ul className={styles.resultList} aria-label="탐지 객체 목록">
      {event.detected_objects.map((object) => (
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
          <em>탐지 신뢰도 {formatConfidence(object.confidence)}</em>
        </li>
      ))}
    </ul>
  );
}

function WebcamResultList({ frame, status }: { frame: WebcamDetectionFrame | null; status: WebcamPanelStatus }) {
  if (!frame) {
    return (
      <div className={styles.emptyResult}>
        <Icon name="scanLine" size={24} />
        <p>
          {status === "running"
            ? "웹캠 프레임을 분석하고 있습니다. 첫 결과가 도착하면 여기에 표시됩니다."
            : "카메라를 켜고 실시간 탐지를 시작하면 결과가 여기에 표시됩니다."}
        </p>
      </div>
    );
  }

  if (frame.detected_objects.length === 0) {
    return (
      <div className={styles.emptyResult}>
        <Icon name="check" size={24} />
        <p>현재 프레임에서 탐지된 객체가 없습니다. 카메라 각도나 조명을 조정해보세요.</p>
      </div>
    );
  }

  return (
    <ul className={styles.resultList} aria-label="실시간 웹캠 탐지 객체 목록">
      {frame.detected_objects.map((object, index) => (
        <li key={`${object.label}-${index}-${object.bbox.x}-${object.bbox.y}`}>
          <div>
            <strong>{object.label}</strong>
            <span>
              {Math.round(object.bbox.width)}×{Math.round(object.bbox.height)}px · 실시간 프레임
            </span>
          </div>
          <em>탐지 신뢰도 {formatConfidence(object.confidence)}</em>
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
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const updateSize = useCallback(() => {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setImageSize({ width: rect.width, height: rect.height });
  }, []);

  useEffect(() => {
    updateSize();
    const observer = new ResizeObserver(updateSize);
    if (imageRef.current) observer.observe(imageRef.current);
    return () => observer.disconnect();
  }, [updateSize, previewUrl]);

  const canRenderOverlay = Boolean(
    event?.media_width && event.media_height && event.detected_objects.length > 0 && imageSize.width && imageSize.height,
  );

  return (
    <div className={styles.previewFrame}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imageRef} src={previewUrl} alt="업로드한 이미지 미리보기" onLoad={updateSize} />
      {canRenderOverlay && (
        <div className={styles.overlay} aria-hidden="true">
          {event!.detected_objects.map((object) => (
            <OverlayBox
              key={object.id}
              object={object}
              mediaWidth={event!.media_width!}
              mediaHeight={event!.media_height!}
              imageWidth={imageSize.width}
              imageHeight={imageSize.height}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OverlayBox({
  object,
  mediaWidth,
  mediaHeight,
  imageWidth,
  imageHeight,
}: {
  object: DetectionObject;
  mediaWidth: number;
  mediaHeight: number;
  imageWidth: number;
  imageHeight: number;
}) {
  const scaleX = imageWidth / mediaWidth;
  const scaleY = imageHeight / mediaHeight;
  const style = {
    left: object.bbox.x * scaleX,
    top: object.bbox.y * scaleY,
    width: object.bbox.width * scaleX,
    height: object.bbox.height * scaleY,
  };

  return (
    <span className={styles.overlayBox} style={style}>
      <b>{object.class_name_ko} {formatConfidence(object.confidence)}</b>
    </span>
  );
}

export function DetectionWorkbench() {
  const [tab, setTab] = useState<DetectionTab>("image");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [error, setError] = useState("");
  const [currentEvent, setCurrentEvent] = useState<DetectionEvent | null>(null);
  const [webcamFrame, setWebcamFrame] = useState<WebcamDetectionFrame | null>(null);
  const [webcamStatus, setWebcamStatus] = useState<WebcamPanelStatus>("idle");
  const [history, setHistory] = useState<DetectionEvent[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [deletingHistoryIds, setDeletingHistoryIds] = useState<Set<number>>(() => new Set());
  const [deletingAllHistory, setDeletingAllHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef("");

  const personalItemDetected = useMemo(
    () => currentEvent?.detected_objects.some((object) => object.group_code === "PERSONAL_ITEM") ?? false,
    [currentEvent],
  );
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
      const message = caught instanceof DetectionApiError ? caught.message : "탐지 기록을 불러오지 못했습니다.";
      setHistoryError(message);
    } finally {
      if (!signal?.aborted) setHistoryLoading(false);
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
    };
  }, []);

  const replacePreviewUrl = (nextFile: File | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const objectUrl = nextFile ? URL.createObjectURL(nextFile) : "";
    previewUrlRef.current = objectUrl;
    setPreviewUrl(objectUrl);
  };

  const resetSelectedFile = () => {
    setFile(null);
    setVideoDuration(null);
    setCurrentEvent(null);
    setWebcamFrame(null);
    setWebcamStatus("idle");
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
    setError("");
    try {
      const result = tab === "image" ? await uploadDetectionImage(file) : await uploadDetectionVideo(file);
      setCurrentEvent(result);
      setSubmitState("success");
      setHistoryLoading(true);
      setHistoryError("");
      await refreshHistory();
    } catch (caught) {
      const message = caught instanceof DetectionApiError ? caught.message : "AI 탐지를 처리하지 못했습니다.";
      setError(message);
      setSubmitState("error");
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
      setTab(result.source_type === "VIDEO" ? "video" : "image");
      setWebcamFrame(null);
      setWebcamStatus("idle");
    } catch (caught) {
      const message = caught instanceof DetectionApiError ? caught.message : "탐지 상세를 불러오지 못했습니다.";
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
      const message = caught instanceof DetectionApiError ? caught.message : "탐지 기록을 삭제하지 못했습니다.";
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
    const confirmed = window.confirm("내 AI 탐지 기록을 모두 삭제할까요? 업로드한 이미지·영상 기록도 함께 정리됩니다.");
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
      const message = caught instanceof DetectionApiError ? caught.message : "탐지 기록을 모두 삭제하지 못했습니다.";
      setHistoryError(message);
    } finally {
      setDeletingAllHistory(false);
      setDeletingHistoryIds(new Set());
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

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="detect-title">
        <p className={styles.eyebrow}>AI DETECTION</p>
        <h1 id="detect-title">AI 수면 객체 탐지</h1>
        <p>사진·영상·웹캠으로 수면 위 객체 후보를 빠르게 확인합니다. 결과는 참고용이며 관리자 확인 전 실제 객체와 다를 수 있습니다.</p>
      </section>

      <section className={styles.workbench} aria-labelledby="workbench-title">
        <div className={styles.tabs} role="tablist" aria-label="탐지 유형">
          <button type="button" role="tab" aria-selected={tab === "image"} onClick={() => handleTabChange("image")}>
            이미지 분석
          </button>
          <button type="button" role="tab" aria-selected={tab === "video"} onClick={() => handleTabChange("video")}>
            영상 분석
          </button>
          <button type="button" role="tab" aria-selected={tab === "webcam"} onClick={() => handleTabChange("webcam")}>
            실시간 웹캠
          </button>
        </div>

        <div className={styles.grid}>
          {tab === "webcam" ? (
            <WebcamDetectionPanel onFrame={setWebcamFrame} onStatusChange={setWebcamStatus} />
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
                  {previewUrl && file ? (
                    <div className={styles.dropzonePreview}>
                      {tab === "image" ? (
                        <ImageOverlay previewUrl={previewUrl} event={currentEvent} />
                      ) : (
                        <div className={styles.previewFrame}>
                          <video
                            src={previewUrl}
                            muted
                            playsInline
                            onLoadedMetadata={(event) => {
                              const duration = event.currentTarget.duration;
                              setVideoDuration(Number.isFinite(duration) ? duration : null);
                            }}
                          />
                          {videoDuration !== null && (
                            <span className={styles.durationBadge}>재생 시간 {Math.round(videoDuration)}초</span>
                          )}
                        </div>
                      )}
                      <div className={styles.previewMeta}>
                        <strong>{file.name}</strong>
                        <span>{formatBytes(file.size)} · 클릭해서 파일 교체</span>
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
                    {submitState === "analyzing" ? "AI 탐지 중..." : "AI 탐지 시작"}
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
                <h2>분석 상태</h2>
              </div>
              <span>{displayedStatus}</span>
            </div>

            <div className={styles.summaryCards}>
              <div>
                <span>탐지 객체</span>
                <strong>{displayedObjectCount}개</strong>
              </div>
              <div>
                <span>분석 유형</span>
                <strong>{displayedSourceType}</strong>
              </div>
            </div>

            {tab === "webcam" ? <WebcamResultList frame={webcamFrame} status={webcamStatus} /> : <ResultList event={currentEvent} />}

            <p className={styles.notice}>AI 분석 결과는 참고용이며 동일 물품 또는 소유권을 확정하지 않습니다.</p>

            {personalItemDetected && tab !== "webcam" && (
              <div className={styles.ctaBox}>
                <strong>개인 물품 후보가 탐지되었습니다.</strong>
                <div>
                  <Link className="button button-secondary" href="/found-items">비슷한 발견물 찾아보기</Link>
                  <Link className="button button-primary" href="/lost-reports/new">분실 신고하기</Link>
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>

      <section className={styles.history} aria-labelledby="history-title" aria-busy={historyLoading}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>MY HISTORY</p>
            <h2 id="history-title">최근 내 탐지 기록</h2>
          </div>
          <div className={styles.historyActions}>
            <span>
              {historyLoading
                ? "불러오는 중"
                : `총 ${history.length}건 · ${activeHistoryPage} / ${historyPageCount}`}
            </span>
            <div className={styles.historyPager} aria-label="탐지 기록 페이지">
              <button
                type="button"
                onClick={() => setHistoryPage((current) => Math.max(1, current - 1))}
                disabled={historyLoading || activeHistoryPage <= 1 || deletingAllHistory}
                aria-label="이전 탐지 기록 페이지"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setHistoryPage((current) => Math.min(historyPageCount, current + 1))}
                disabled={historyLoading || activeHistoryPage >= historyPageCount || deletingAllHistory}
                aria-label="다음 탐지 기록 페이지"
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
        {historyLoading && <div className={styles.stateCard} role="status"><Icon name="scan" size={22} /> 탐지 기록을 불러오고 있습니다.</div>}
        {!historyLoading && !historyError && history.length === 0 && (
          <div className={styles.stateCard}>
            <Icon name="document" size={22} />
            <span>아직 저장된 사용자 분석 기록이 없습니다.</span>
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
                    <b>{event.detected_objects.length}개 · {event.detected_objects[0]?.class_name_ko ?? "탐지 객체 없음"}</b>
                  </button>
                  <button
                    type="button"
                    className={styles.historyDeleteButton}
                    onClick={() => void handleDeleteHistory(event.id)}
                    disabled={isDeleting || deletingAllHistory}
                    aria-label={`탐지 기록 ${event.id} 삭제`}
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
