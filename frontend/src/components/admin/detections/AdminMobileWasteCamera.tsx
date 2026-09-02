"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import {
  completeDetectedWasteCollection,
  listAdminCameras,
  registerMobileWasteCandidate,
  type AdminCamera,
} from "@/lib/adminDetectionsApi";
import { detectWebcamFrame, type WebcamDetectionFrame, type WebcamDetectionObject } from "@/lib/detectionApi";
import {
  getContainedMediaRect,
  getContainedMediaRectStyle,
  getOverlayPercentageStyle,
  normalizeBBoxForDisplayMedia,
} from "@/components/detection/detectionOverlayGeometry";
import { isMobileWasteCandidate } from "./mobileWasteFilters";
import styles from "./AdminMobileWasteCamera.module.css";

const FRAME_INTERVAL_MS = 650;
const JPEG_QUALITY = 0.9;

type CameraStatus = "idle" | "requesting" | "ready" | "running" | "selected" | "registering" | "registered" | "collecting" | "completed";
type FacingMode = "environment" | "user";

type DetectionSnapshot = {
  frame: WebcamDetectionFrame;
  blob: Blob;
};

type FrozenCandidate = {
  object: WebcamDetectionObject;
  frame: WebcamDetectionFrame;
  file: File;
  previewUrl: string;
};

type RegistrationResult = {
  detectionEventId: number;
  detectedObjectId: number;
};

function isAbortError(reason: unknown) {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function objectLabel(object: WebcamDetectionObject) {
  return object.class_name_ko || object.label || object.class_code || "폐기물";
}

function OverlayBox({
  object,
  frame,
  displayMediaSize,
  selected,
  onSelect,
}: {
  object: WebcamDetectionObject;
  frame: WebcamDetectionFrame;
  displayMediaSize: { width: number; height: number };
  selected?: boolean;
  onSelect?: () => void;
}) {
  const normalized = normalizeBBoxForDisplayMedia(
    object.bbox,
    { width: frame.media_width, height: frame.media_height },
    displayMediaSize,
  );
  if (!normalized) return null;

  const content = (
    <>
      <span>{objectLabel(object)} {Math.round(object.confidence * 100)}%</span>
    </>
  );

  return onSelect ? (
    <button
      type="button"
      className={styles.overlayBox}
      data-selected={selected}
      style={getOverlayPercentageStyle(normalized)}
      onClick={onSelect}
      aria-label={`${objectLabel(object)} 폐기물 후보 선택`}
    >
      {content}
    </button>
  ) : (
    <span className={styles.overlayBox} data-selected={selected} style={getOverlayPercentageStyle(normalized)}>
      {content}
    </span>
  );
}

export function AdminMobileWasteCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackingSessionId = useId();
  const trackingSessionIdRef = useRef(`admin-webcam-${trackingSessionId}`);
  const stageRef = useRef<HTMLDivElement>(null);
  const detectTimerRef = useRef<number | null>(null);
  const detectAbortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const analyzeFrameRef = useRef<() => void>(() => undefined);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameras, setCameras] = useState<AdminCamera[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<DetectionSnapshot | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [frozen, setFrozen] = useState<FrozenCandidate | null>(null);
  const [frozenNaturalSize, setFrozenNaturalSize] = useState({ width: 0, height: 0 });
  const [registered, setRegistered] = useState<RegistrationResult | null>(null);

  const wasteObjects = useMemo(() => snapshot?.frame.detected_objects.filter(isMobileWasteCandidate) ?? [], [snapshot]);
  const selectedObjectId = frozen ? `${frozen.object.bbox.x}-${frozen.object.bbox.y}-${frozen.object.bbox.width}-${frozen.object.bbox.height}` : "";
  const cameraActive = status !== "idle" && status !== "requesting";
  const secureHint = typeof window !== "undefined" && !window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1";

  const liveMediaRect = useMemo(() => {
    if (!snapshot) return null;
    const frame = snapshot.frame;
    const naturalSize = videoSize.width && videoSize.height ? videoSize : { width: frame.media_width, height: frame.media_height };
    return getContainedMediaRect(stageSize, naturalSize);
  }, [snapshot, stageSize, videoSize]);
  const liveDisplayMediaSize = videoSize.width && videoSize.height
    ? videoSize
    : snapshot
      ? { width: snapshot.frame.media_width, height: snapshot.frame.media_height }
      : { width: 0, height: 0 };
  const frozenMediaRect = frozen ? getContainedMediaRect(stageSize, frozenNaturalSize) : null;

  const clearTimer = () => {
    if (detectTimerRef.current !== null) {
      window.clearTimeout(detectTimerRef.current);
      detectTimerRef.current = null;
    }
  };

  const stopDetection = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    clearTimer();
    detectAbortRef.current?.abort();
    detectAbortRef.current = null;
    setStatus((current) => current === "running" ? "ready" : current);
  }, []);

  const stopStream = useCallback(() => {
    stopDetection();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSnapshot(null);
    setVideoSize({ width: 0, height: 0 });
    setStatus("idle");
  }, [stopDetection]);

  const revokeFrozen = useCallback(() => {
    setFrozen((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setFrozenNaturalSize({ width: 0, height: 0 });
    setRegistered(null);
  }, []);

  const updateVideoSize = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoSize({ width: video.videoWidth || 0, height: video.videoHeight || 0 });
  }, []);

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      throw new Error("카메라 화면을 아직 캡처할 수 없습니다.");
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("카메라 캡처를 준비하지 못했습니다.");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("카메라 캡처 이미지를 만들지 못했습니다."));
      }, "image/jpeg", JPEG_QUALITY);
    });
  }, []);

  const analyzeFrame = useCallback(async () => {
    if (!runningRef.current) return;
    const controller = new AbortController();
    detectAbortRef.current = controller;
    try {
      const blob = await captureFrame();
      const nextFrame = await detectWebcamFrame(blob, trackingSessionIdRef.current, controller.signal);
      if (controller.signal.aborted || !runningRef.current) return;
      setSnapshot({ frame: nextFrame, blob });
      setError("");
    } catch (reason) {
      if (!isAbortError(reason)) {
        setError(reason instanceof Error ? reason.message : "카메라 폐기물 확인을 처리하지 못했습니다.");
      }
    } finally {
      if (detectAbortRef.current === controller) detectAbortRef.current = null;
      if (runningRef.current) {
        clearTimer();
        detectTimerRef.current = window.setTimeout(() => {
          analyzeFrameRef.current();
        }, FRAME_INTERVAL_MS);
      }
    }
  }, [captureFrame]);

  useEffect(() => {
    analyzeFrameRef.current = () => {
      void analyzeFrame();
    };
  }, [analyzeFrame]);

  const startDetection = useCallback(() => {
    if (!streamRef.current || runningRef.current) return;
    revokeFrozen();
    setError("");
    runningRef.current = true;
    setIsRunning(true);
    setStatus("running");
    void analyzeFrame();
  }, [analyzeFrame, revokeFrozen]);

  const startCamera = useCallback(async (nextDeviceId?: string | null, nextFacingMode: FacingMode = facingMode) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저에서는 카메라를 사용할 수 없습니다.");
      return;
    }
    setStatus("requesting");
    setError("");
    revokeFrozen();
    stopStream();

    try {
      const constraints: MediaStreamConstraints = {
        video: nextDeviceId
          ? { deviceId: { exact: nextDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: nextFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      updateVideoSize();
      setStatus("ready");
      const rows = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
      setDevices(rows);
      setActiveDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? nextDeviceId ?? null);
    } catch (reason) {
      stopStream();
      setError(reason instanceof Error ? reason.message : "카메라 권한을 확인해 주세요.");
    }
  }, [facingMode, revokeFrozen, stopStream, updateVideoSize]);

  const switchCamera = async () => {
    const wasRunning = runningRef.current;
    stopDetection();
    if (devices.length > 1) {
      const index = Math.max(0, devices.findIndex((device) => device.deviceId === activeDeviceId));
      const next = devices[(index + 1) % devices.length];
      await startCamera(next.deviceId, facingMode);
    } else {
      const nextFacing = facingMode === "environment" ? "user" : "environment";
      setFacingMode(nextFacing);
      await startCamera(null, nextFacing);
    }
    if (wasRunning) startDetection();
  };

  const selectObject = (object: WebcamDetectionObject, sourceSnapshot: DetectionSnapshot) => {
    stopDetection();
    revokeFrozen();
    const file = new File([sourceSnapshot.blob], "mobile-waste-frame.jpg", { type: "image/jpeg" });
    setFrozen({ object, frame: sourceSnapshot.frame, file, previewUrl: URL.createObjectURL(sourceSnapshot.blob) });
    setStatus("selected");
  };

  const registerSelected = async () => {
    if (!frozen || !cameraId) return;
    setStatus("registering");
    setError("");
    try {
      const result = await registerMobileWasteCandidate(cameraId ? Number(cameraId) : 0, frozen.file, frozen.object.bbox);
      setRegistered({ detectionEventId: result.detection_event_id, detectedObjectId: result.detected_object_id });
      setStatus("registered");
    } catch (reason) {
      setStatus("selected");
      setError(reason instanceof Error ? reason.message : "폐기물 후보를 등록하지 못했습니다.");
    }
  };

  const completeCollection = async () => {
    if (!registered) return;
    setStatus("collecting");
    setError("");
    try {
      await completeDetectedWasteCollection(registered.detectedObjectId);
      setStatus("completed");
    } catch (reason) {
      setStatus("registered");
      setError(reason instanceof Error ? reason.message : "폐기물 수거 완료 처리에 실패했습니다.");
    }
  };

  const resetSelection = () => {
    revokeFrozen();
    setStatus(streamRef.current ? "ready" : "idle");
  };

  useEffect(() => {
    const controller = new AbortController();
    listAdminCameras(controller.signal)
      .then((rows) => {
        setCameras(rows);
        setCameraId(String(rows[0]?.id ?? ""));
      })
      .catch((reason) => {
        if (!isAbortError(reason)) setError("운영 카메라 목록을 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setStageSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    stopStream();
    revokeFrozen();
  }, [revokeFrozen, stopStream]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <nav aria-label="현재 위치"><Link href="/admin/detections">AI 탐지 검토</Link><Icon name="chevron" size={13} /><span>모바일 폐기물 회수</span></nav>
          <p>MOBILE FIELD TOOL</p>
          <h1>모바일 폐기물 회수</h1>
          <span>관리자 휴대폰 카메라로 현장 폐기물만 선택해 등록하고 바로 수거 완료까지 처리합니다.</span>
        </div>
        <Link className={styles.backLink} href="/admin/detections"><Icon name="chevronLeft" size={16} />검토 화면으로</Link>
      </header>

      {secureHint && (
        <p className={styles.notice} role="note">
          모바일 카메라는 HTTPS 또는 localhost에서 안정적으로 동작합니다. 현장 시연은 DuckDNS HTTPS 주소를 권장합니다.
        </p>
      )}

      <section className={styles.shell}>
        <div className={styles.cameraPanel}>
          <div className={styles.controls}>
            <label>
              <span>운영 카메라</span>
              <select value={cameraId} onChange={(event) => setCameraId(event.target.value)} disabled={!cameras.length || status === "registering" || status === "collecting"}>
                {cameras.length ? cameras.map((camera) => (
                  <option value={camera.id} key={camera.id}>{camera.name} · {camera.area_name}</option>
                )) : <option value="">활성 카메라 없음</option>}
              </select>
            </label>
            <div>
              <button type="button" className="button button-secondary" onClick={() => void startCamera()} disabled={status === "requesting"}>
                <Icon name="camera" size={17} />{cameraActive ? "카메라 재시작" : "카메라 켜기"}
              </button>
              {cameraActive && (
                <button type="button" className="button button-secondary" onClick={() => void switchCamera()} disabled={status === "registering" || status === "collecting"}>
                  <Icon name="refresh" size={17} />전·후면 전환
                </button>
              )}
            </div>
          </div>

          <div className={styles.stage} ref={stageRef}>
            {frozen ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={frozen.previewUrl} alt="선택한 폐기물 등록 프레임" onLoad={(event) => setFrozenNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
                {frozenMediaRect && (
                  <div className={styles.mediaLayer} style={getContainedMediaRectStyle(frozenMediaRect)} aria-hidden="true">
                    <OverlayBox object={frozen.object} frame={frozen.frame} displayMediaSize={frozenNaturalSize} selected />
                  </div>
                )}
                <span className={styles.frozenBadge}>선택 프레임 고정</span>
              </>
            ) : (
              <>
                <video ref={videoRef} playsInline muted onLoadedMetadata={updateVideoSize} onResize={updateVideoSize} />
                {!cameraActive && (
                  <div className={styles.empty}>
                    <Icon name="camera" size={34} />
                    <strong>카메라를 켜고 폐기물을 비춰 주세요.</strong>
                    <span>실시간 프레임은 탐지 요청에만 사용되고, 선택·등록한 한 장만 저장됩니다.</span>
                  </div>
                )}
                {status === "running" && <span className={styles.liveBadge}>LIVE · TRASH 탐지 중</span>}
                {snapshot && liveMediaRect && (
                  <div className={styles.mediaLayer} style={getContainedMediaRectStyle(liveMediaRect)}>
                    {wasteObjects.map((object, index) => (
                      <OverlayBox
                        key={`${object.class_code}-${index}-${object.bbox.x}-${object.bbox.y}`}
                        object={object}
                        frame={snapshot.frame}
                        displayMediaSize={liveDisplayMediaSize}
                        selected={selectedObjectId === `${object.bbox.x}-${object.bbox.y}-${object.bbox.width}-${object.bbox.height}`}
                        onSelect={() => selectObject(object, snapshot)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <canvas ref={canvasRef} className={styles.hiddenCanvas} aria-hidden="true" />

          {error && <p className={styles.error} role="alert">{error}</p>}

          <div className={styles.actions}>
            {cameraActive && !frozen && (
              isRunning ? (
                <button type="button" className="button button-secondary" onClick={stopDetection}>탐지 일시정지</button>
              ) : (
                <button type="button" className="button button-primary" onClick={startDetection} disabled={!cameraId}>폐기물 탐지 시작<Icon name="scanLine" size={18} /></button>
              )
            )}
            {frozen && status !== "completed" && (
              <>
                <button type="button" className="button button-secondary" onClick={resetSelection} disabled={status === "registering" || status === "collecting"}>다시 선택</button>
                {!registered ? (
                  <button type="button" className="button button-primary" onClick={() => void registerSelected()} disabled={!cameraId || status === "registering"}>
                    {status === "registering" ? "등록 중..." : "회수 대상으로 등록"}<Icon name="archive" size={18} />
                  </button>
                ) : (
                  <button type="button" className="button button-primary" onClick={() => void completeCollection()} disabled={status === "collecting"}>
                    {status === "collecting" ? "처리 중..." : "수거 완료 처리"}<Icon name="packageCheck" size={18} />
                  </button>
                )}
              </>
            )}
            {status === "completed" && (
              <>
                <Link className="button button-secondary" href={`/admin/detections?detection=${registered?.detectionEventId ?? ""}`}>등록 기록 보기</Link>
                <button type="button" className="button button-primary" onClick={resetSelection}>새 폐기물 탐지</button>
              </>
            )}
          </div>
        </div>

        <aside className={styles.sidePanel} aria-label="폐기물 후보">
          <div>
            <p>TRASH CANDIDATES</p>
            <h2>폐기물 후보</h2>
            <span>서버가 확인한 TRASH/WASTE 후보만 표시합니다.</span>
          </div>
          {frozen ? (
            <div className={styles.selectedCard}>
              <Icon name="check" size={22} />
              <strong>{objectLabel(frozen.object)}</strong>
              <span>신뢰도 {Math.round(frozen.object.confidence * 100)}%</span>
              {registered ? <b>등록 완료 · 수거 처리를 진행하세요.</b> : <b>이 프레임 한 장만 서버에 등록됩니다.</b>}
            </div>
          ) : wasteObjects.length ? (
            <div className={styles.candidateList}>
              {wasteObjects.map((object, index) => (
                <button type="button" onClick={() => snapshot && selectObject(object, snapshot)} key={`${object.label}-${index}-${object.bbox.x}`}>
                  <Icon name="trash" size={18} />
                  <strong>{objectLabel(object)}</strong>
                  <span>신뢰도 {Math.round(object.confidence * 100)}%</span>
                  <small>선택해서 프레임 고정</small>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.emptySide}>
              <Icon name="scanLine" size={26} />
              <strong>아직 선택 가능한 폐기물이 없습니다.</strong>
              <span>카메라를 켠 뒤 폐기물 탐지를 시작해 주세요.</span>
            </div>
          )}
          <p className={styles.privacyNote}>실시간 프레임은 반복 저장하지 않습니다. 관리자가 후보를 선택하고 등록한 프레임만 탐지 기록과 crop 이미지로 저장됩니다.</p>
        </aside>
      </section>
    </main>
  );
}
