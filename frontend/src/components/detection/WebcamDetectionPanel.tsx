"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { DetectionApiError, WebcamDetectionFrame, WebcamDetectionObject, detectWebcamFrame } from "@/lib/detectionApi";
import { getContainedMediaRect, getContainedMediaRectStyle, getOverlayPercentageStyle, normalizeBBoxForDisplayMedia } from "./detectionOverlayGeometry";
import styles from "./DetectionWorkbench.module.css";

export type WebcamPanelStatus = "idle" | "requesting" | "ready" | "running" | "error";

type WebcamDetectionPanelProps = {
  onFrame: (frame: WebcamDetectionFrame | null) => void;
  onStatusChange: (status: WebcamPanelStatus) => void;
  onReportCandidate: (candidate: WebcamReportCandidate) => void;
  reportModalOpen: boolean;
  completedReportClassCode: string | null;
};

type Size = {
  width: number;
  height: number;
};

export type WebcamReportCandidate = {
  object: WebcamDetectionObject;
  frame: WebcamDetectionFrame;
  image: File;
  capturedAt: string;
};

type StickyCandidate = {
  object: WebcamDetectionObject;
  frame: WebcamDetectionFrame;
  blob: Blob;
  detectedAt: string;
  expiresAt: number;
  previewUrl: string;
};

type StableDetection = {
  classCode: string;
  consecutiveFrames: number;
  bestCandidate: StickyCandidate;
};

type CameraFacingMode = "environment" | "user";
type CameraPreference = {
  deviceId?: string;
  facingMode?: CameraFacingMode;
};

const WEBCAM_FRAME_MAX_WIDTH = 640;
const WEBCAM_FRAME_INTERVAL_MS = 300;
const WEBCAM_JPEG_QUALITY = 0.8;
export const WEBCAM_REPORT_CANDIDATE_TTL_MS = 8000;
const WEBCAM_REPORT_CANDIDATE_LIMIT = 3;
export const WEBCAM_AUTO_REPORT_STABLE_FRAMES = 3;
export const WEBCAM_AUTO_REPORT_COOLDOWN_MS = 3000;
const reportableClassCodes = new Set(["BAG", "UMBRELLA", "FOOTWEAR", "BALL"]);

const objectLabels: Record<string, string> = {
  backpack: "백팩",
  handbag: "가방",
  suitcase: "가방",
  umbrella: "우산",
  bottle: "병",
  "sports ball": "공",
  cup: "컵",
  cell_phone: "휴대폰",
  "cell phone": "휴대폰",
  person: "사람",
};

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

function getObjectLabel(label: string) {
  return objectLabels[label] ?? label;
}

function getDisplayLabel(object: WebcamDetectionObject) {
  return object.class_name_ko ?? getObjectLabel(object.label);
}

function isReportableObject(object: WebcamDetectionObject) {
  return object.group_code === "PERSONAL_ITEM" && Boolean(object.class_code && reportableClassCodes.has(object.class_code));
}

function getCameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "카메라 권한이 거부되었습니다. 브라우저 권한을 허용한 뒤 다시 시도해주세요.";
    if (error.name === "NotFoundError") return "사용 가능한 카메라를 찾지 못했습니다.";
    if (error.name === "NotReadableError") return "다른 앱에서 카메라를 사용 중일 수 있습니다.";
  }
  return "카메라를 시작하지 못했습니다. 브라우저 권한과 연결 상태를 확인해주세요.";
}

function getCameraSupportMessage() {
  if (typeof window === "undefined") return "";
  if (!window.isSecureContext) {
    return "모바일 카메라는 HTTPS 주소에서 사용할 수 있습니다. 발표 시연은 HTTPS 배포 주소에서 진행해주세요.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "이 브라우저에서는 웹캠을 사용할 수 없습니다.";
  }
  return "";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function WebcamOverlayBox({
  object,
  mediaWidth,
  mediaHeight,
  displayMediaSize,
}: {
  object: WebcamDetectionObject;
  mediaWidth: number;
  mediaHeight: number;
  displayMediaSize: Size;
}) {
  const normalized = normalizeBBoxForDisplayMedia(
    object.bbox,
    { width: mediaWidth, height: mediaHeight },
    displayMediaSize,
  );
  if (!normalized) return null;

  return (
    <span className={styles.overlayBox} style={getOverlayPercentageStyle(normalized)}>
      <b>
        {getDisplayLabel(object)} {formatConfidence(object.confidence)}
      </b>
    </span>
  );
}

export function WebcamDetectionPanel({ onFrame, onStatusChange, onReportCandidate, reportModalOpen, completedReportClassCode }: WebcamDetectionPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopGenerationRef = useRef(0);
  const cameraRequestGenerationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const reportModalWasOpenRef = useRef(false);
  const reportModalOpenRef = useRef(reportModalOpen);
  const openedClassCodeRef = useRef<string | null>(null);
  const reportCooldownClassesRef = useRef(new Set<string>());
  const reportCooldownTimersRef = useRef(new Map<string, number>());
  const stableDetectionRef = useRef<StableDetection | null>(null);
  const candidatesRef = useRef<StickyCandidate[]>([]);

  const [cameraStatus, setCameraStatus] = useState<WebcamPanelStatus>("idle");
  const [cameraActive, setCameraActive] = useState(false);
  const [frame, setFrame] = useState<WebcamDetectionFrame | null>(null);
  const [previewSize, setPreviewSize] = useState<Size>({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState<Size>({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [candidates, setCandidates] = useState<StickyCandidate[]>([]);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState("");
  const [preferredFacingMode, setPreferredFacingMode] = useState<CameraFacingMode>("environment");
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [supportMessage, setSupportMessage] = useState("");

  const replaceCandidates = useCallback((next: StickyCandidate[]) => {
    const retainedUrls = new Set(next.map((candidate) => candidate.previewUrl));
    candidatesRef.current.forEach((candidate) => {
      if (!retainedUrls.has(candidate.previewUrl)) URL.revokeObjectURL(candidate.previewUrl);
    });
    candidatesRef.current = next;
    setCandidates(next);
  }, []);

  const clearCandidates = useCallback(() => replaceCandidates([]), [replaceCandidates]);

  useEffect(() => {
    reportModalOpenRef.current = reportModalOpen;
  }, [reportModalOpen]);

  useEffect(() => {
    queueMicrotask(() => setSupportMessage(getCameraSupportMessage()));
  }, []);

  useEffect(() => {
    onStatusChange(cameraStatus);
  }, [cameraStatus, onStatusChange]);

  const clearPendingRequest = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const stopStream = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const stopDetection = useCallback(() => {
    loopGenerationRef.current += 1;
    clearPendingRequest();
    setCameraStatus((current) => (current === "running" ? "ready" : current));
  }, [clearPendingRequest]);

  const stopCamera = useCallback(() => {
    cameraRequestGenerationRef.current += 1;
    stopDetection();
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (!mountedRef.current) return;
    setCameraActive(false);
    setFrame(null);
    onFrame(null);
    setExpanded(false);
    setCameraStatus("idle");
    setActiveDeviceId("");
    clearCandidates();
  }, [clearCandidates, onFrame, stopDetection, stopStream]);

  useEffect(() => {
    mountedRef.current = true;
    const videoElement = videoRef.current;
    const cooldownTimers = reportCooldownTimersRef.current;
    return () => {
      mountedRef.current = false;
      cameraRequestGenerationRef.current += 1;
      loopGenerationRef.current += 1;
      clearPendingRequest();
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoElement) videoElement.srcObject = null;
      candidatesRef.current.forEach((candidate) => URL.revokeObjectURL(candidate.previewUrl));
      candidatesRef.current = [];
      cooldownTimers.forEach((timer) => window.clearTimeout(timer));
      cooldownTimers.clear();
    };
  }, [clearPendingRequest, stopStream]);

  useEffect(() => {
    const updatePreviewSize = () => {
      const rect = videoRef.current?.getBoundingClientRect() ?? previewRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPreviewSize({ width: rect.width, height: rect.height });
    };

    updatePreviewSize();
    const observer = new ResizeObserver(updatePreviewSize);
    if (previewRef.current) observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [expanded]);

  const updateVideoSize = useCallback(() => {
    const video = videoRef.current;
    setVideoSize({
      width: video?.videoWidth ?? 0,
      height: video?.videoHeight ?? 0,
    });
  }, []);

  useEffect(() => {
    if (!expanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [expanded]);

  const captureFrame = useCallback(async (useDedicatedCanvas = false) => {
    const video = videoRef.current;
    const canvas = useDedicatedCanvas ? document.createElement("canvas") : canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return null;

    const targetWidth = Math.min(WEBCAM_FRAME_MAX_WIDTH, video.videoWidth);
    const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth);
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, targetWidth, targetHeight);

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", WEBCAM_JPEG_QUALITY);
    });
  }, []);

  const openReport = (candidate: StickyCandidate) => {
    if (reportModalOpenRef.current || !candidate.blob.size) return;
    reportModalOpenRef.current = true;
    stableDetectionRef.current = null;
    openedClassCodeRef.current = candidate.object.class_code;
    stopDetection();
    const image = new File([candidate.blob], `webcam-report-${Date.parse(candidate.detectedAt)}.jpg`, { type: "image/jpeg" });
    if (!image.size) {
      reportModalOpenRef.current = false;
      return;
    }
    onReportCandidate({ object: candidate.object, frame: candidate.frame, image, capturedAt: candidate.detectedAt });
  };

  const dismissCandidate = (classCode: string | null) => {
    replaceCandidates(candidatesRef.current.filter((candidate) => candidate.object.class_code !== classCode));
  };

  function runDetectionLoop(generation: number) {
    void (async () => {
      const blob = await captureFrame();
      if (!mountedRef.current || generation !== loopGenerationRef.current) return;
      if (!blob) {
        if (generation === loopGenerationRef.current) {
          timeoutRef.current = setTimeout(() => runDetectionLoop(generation), WEBCAM_FRAME_INTERVAL_MS);
        }
        return;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        const nextFrame = await detectWebcamFrame(blob, controller.signal);
        if (!mountedRef.current || generation !== loopGenerationRef.current) return;
        setFrame(nextFrame);
        onFrame(nextFrame);
        setError("");
        const detectedAt = new Date().toISOString();
        const expiresAt = Date.now() + WEBCAM_REPORT_CANDIDATE_TTL_MS;
        const reportable = Array.from(nextFrame.detected_objects.filter(isReportableObject).reduce((byClass, object) => {
          const classCode = object.class_code as string;
          const current = byClass.get(classCode);
          if (!current || object.confidence > current.confidence) byClass.set(classCode, object);
          return byClass;
        }, new Map<string, WebcamDetectionObject>()).values());
        if (reportable.length) {
          let next = [...candidatesRef.current];
          const frameCandidates: StickyCandidate[] = [];
          for (const object of reportable) {
            const reportBlob = blob;
            const previewUrl = URL.createObjectURL(reportBlob);
            const candidate = { object, frame: nextFrame, blob: reportBlob, detectedAt, expiresAt, previewUrl };
            frameCandidates.push(candidate);
            const existingIndex = next.findIndex((item) => item.object.class_code === object.class_code);
            if (existingIndex >= 0) next.splice(existingIndex, 1, candidate);
            else next.unshift(candidate);
          }
          next = next.sort((a, b) => b.expiresAt - a.expiresAt).slice(0, WEBCAM_REPORT_CANDIDATE_LIMIT);
          const retainedUrls = new Set(next.map((candidate) => candidate.previewUrl));
          frameCandidates.forEach((candidate) => {
            if (!retainedUrls.has(candidate.previewUrl)) URL.revokeObjectURL(candidate.previewUrl);
          });
          replaceCandidates(next);

          const representative = frameCandidates.reduce((best, candidate) => (
            candidate.object.confidence > best.object.confidence ? candidate : best
          ));
          const classCode = representative.object.class_code as string;
          const previous = stableDetectionRef.current;
          stableDetectionRef.current = previous?.classCode === classCode
            ? {
                classCode,
                consecutiveFrames: previous.consecutiveFrames + 1,
                bestCandidate: representative.object.confidence >= previous.bestCandidate.object.confidence
                  ? representative
                  : previous.bestCandidate,
              }
            : { classCode, consecutiveFrames: 1, bestCandidate: representative };

          const stable = stableDetectionRef.current;
          if (
            stable.consecutiveFrames >= WEBCAM_AUTO_REPORT_STABLE_FRAMES
            && !reportCooldownClassesRef.current.has(classCode)
            && !reportModalOpenRef.current
          ) {
            openReport(stable.bestCandidate);
            return;
          }
        } else {
          stableDetectionRef.current = null;
        }
      } catch (caught) {
        if (isAbortError(caught) || !mountedRef.current || generation !== loopGenerationRef.current) return;
        const message = caught instanceof DetectionApiError ? caught.message : "카메라로 물건을 확인하지 못했습니다.";
        setError(message);
        setCameraStatus("error");
        return;
      } finally {
        if (abortControllerRef.current === controller) abortControllerRef.current = null;
      }

      if (generation === loopGenerationRef.current) {
        timeoutRef.current = setTimeout(() => runDetectionLoop(generation), WEBCAM_FRAME_INTERVAL_MS);
      }
    })();
  }

  const refreshCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
      setCameraDevices(devices);
      return devices;
    } catch {
      return [];
    }
  }, []);

  const buildVideoConstraints = (preference: CameraPreference): MediaTrackConstraints => ({
    width: { ideal: 1280 },
    height: { ideal: 720 },
    ...(preference.deviceId
      ? { deviceId: { exact: preference.deviceId } }
      : { facingMode: { ideal: preference.facingMode ?? "environment" } }),
  });

  const startCamera = async (preference: CameraPreference = { facingMode: preferredFacingMode }) => {
    const issue = getCameraSupportMessage();
    setSupportMessage(issue);
    if (issue) {
      setError(issue);
      setCameraStatus("error");
      return false;
    }

    setError("");
    setCameraStatus("requesting");
    const requestGeneration = cameraRequestGenerationRef.current + 1;
    cameraRequestGenerationRef.current = requestGeneration;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: buildVideoConstraints(preference),
      });
      if (!mountedRef.current || requestGeneration !== cameraRequestGenerationRef.current) {
        stopStream(stream);
        return;
      }
      const video = videoRef.current;
      if (!video) {
        stopStream(stream);
        return;
      }
      stopStream(streamRef.current);
      streamRef.current = stream;
      video.srcObject = stream;
      try {
        await video.play();
        updateVideoSize();
      } catch (playError) {
        if (streamRef.current === stream) streamRef.current = null;
        video.srcObject = null;
        stopStream(stream);
        if (!mountedRef.current || requestGeneration !== cameraRequestGenerationRef.current) return;
        throw playError;
      }
      if (!mountedRef.current || requestGeneration !== cameraRequestGenerationRef.current) {
        if (streamRef.current === stream) streamRef.current = null;
        video.srcObject = null;
        stopStream(stream);
        return;
      }
      setCameraActive(true);
      const settings = stream.getVideoTracks()[0]?.getSettings();
      const nextDeviceId = settings?.deviceId ?? preference.deviceId ?? "";
      setActiveDeviceId(nextDeviceId);
      if (preference.facingMode) setPreferredFacingMode(preference.facingMode);
      void refreshCameraDevices();
      setCameraStatus("ready");
      return true;
    } catch (caught) {
      if (!mountedRef.current || requestGeneration !== cameraRequestGenerationRef.current) return;
      setError(getCameraErrorMessage(caught));
      setCameraActive(false);
      setCameraStatus("error");
      return false;
    }
  };

  const beginDetection = (force = false) => {
    if (!streamRef.current || (!force && cameraStatus === "running")) return;
    loopGenerationRef.current += 1;
    const generation = loopGenerationRef.current;
    setError("");
    setCameraStatus("running");
    runDetectionLoop(generation);
  };

  const startDetection = () => beginDetection(false);

  const switchCamera = async () => {
    if (switchingCamera || cameraStatus === "requesting") return;
    const devices = cameraDevices.length ? cameraDevices : await refreshCameraDevices();
    if (devices.length < 2) return;

    const wasRunning = cameraStatus === "running";
    const currentIndex = Math.max(0, devices.findIndex((device) => device.deviceId === activeDeviceId));
    const nextDevice = devices[(currentIndex + 1) % devices.length];
    const fallbackFacingMode: CameraFacingMode = preferredFacingMode === "environment" ? "user" : "environment";

    setSwitchingCamera(true);
    stopDetection();
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    let switched = await startCamera({ deviceId: nextDevice.deviceId });
    if (!switched) switched = await startCamera({ facingMode: fallbackFacingMode });
    if (switched) {
      setPreferredFacingMode(fallbackFacingMode);
      if (wasRunning) beginDetection(true);
    }
    setSwitchingCamera(false);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (candidatesRef.current.some((candidate) => candidate.expiresAt <= now)) {
        replaceCandidates(candidatesRef.current.filter((candidate) => candidate.expiresAt > now));
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [replaceCandidates]);

  useEffect(() => {
    if (!completedReportClassCode) return;
    const timer = window.setTimeout(() => replaceCandidates(candidatesRef.current.filter((candidate) => candidate.object.class_code !== completedReportClassCode)), 0);
    return () => window.clearTimeout(timer);
  }, [completedReportClassCode, replaceCandidates]);

  useEffect(() => {
    if (reportModalOpen) {
      reportModalWasOpenRef.current = true;
      reportModalOpenRef.current = true;
    }
    else if (reportModalWasOpenRef.current) {
      reportModalWasOpenRef.current = false;
      reportModalOpenRef.current = false;
      stableDetectionRef.current = null;
      const classCode = openedClassCodeRef.current;
      if (classCode) {
        reportCooldownClassesRef.current.add(classCode);
        const previousTimer = reportCooldownTimersRef.current.get(classCode);
        if (previousTimer) window.clearTimeout(previousTimer);
        const timer = window.setTimeout(() => {
          reportCooldownClassesRef.current.delete(classCode);
          reportCooldownTimersRef.current.delete(classCode);
        }, WEBCAM_AUTO_REPORT_COOLDOWN_MS);
        reportCooldownTimersRef.current.set(classCode, timer);
        openedClassCodeRef.current = null;
      }
      if (streamRef.current && cameraStatus === "ready") startDetection();
    }
  // startDetection intentionally uses the latest render state when the modal closes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraStatus, reportModalOpen]);

  const mediaRect = useMemo(
    () => {
      if (!frame) return null;
      const naturalVideoSize = videoSize.width && videoSize.height
        ? videoSize
        : { width: frame.media_width, height: frame.media_height };
      return getContainedMediaRect(previewSize, naturalVideoSize);
    },
    [frame, previewSize, videoSize],
  );
  const displayVideoSize = videoSize.width && videoSize.height
    ? videoSize
    : frame
      ? { width: frame.media_width, height: frame.media_height }
      : { width: 0, height: 0 };

  return (
    <section className={styles.webcamPanel} aria-labelledby="webcam-title">
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>LIVE WEBCAM</p>
          <h2 id="webcam-title">카메라로 물건 확인</h2>
        </div>
        <span>{cameraStatus === "running" ? "확인 중" : cameraActive ? "카메라 준비" : "대기"}</span>
      </div>

      <div className={`${styles.webcamStage} ${expanded ? styles.webcamStageExpanded : ""}`} ref={previewRef}>
        <video ref={videoRef} className={styles.webcamVideo} playsInline muted onLoadedMetadata={updateVideoSize} onResize={updateVideoSize} />
        {!cameraActive && (
          <div className={styles.webcamEmpty}>
            <Icon name="scanLine" size={32} />
            <strong>카메라를 켜고 물건 확인을 시작해보세요.</strong>
            <span>{supportMessage || "브라우저 권한을 허용하면 현재 화면의 프레임만 서버로 전송해 확인합니다."}</span>
          </div>
        )}
        {cameraStatus === "running" && <span className={styles.liveBadge}>LIVE · 확인 중</span>}
        {frame && mediaRect && (
          <div className={styles.mediaLayer} style={getContainedMediaRectStyle(mediaRect)} aria-hidden="true">
            <div className={styles.overlay}>
              {frame.detected_objects.map((object, index) => (
                <WebcamOverlayBox
                  key={`${object.label}-${index}-${object.bbox.x}-${object.bbox.y}`}
                  object={object}
                  mediaWidth={frame.media_width}
                  mediaHeight={frame.media_height}
                  displayMediaSize={displayVideoSize}
                />
              ))}
            </div>
          </div>
        )}
        {cameraActive && !expanded && (
          <button className={styles.webcamExpandButton} type="button" onClick={() => setExpanded((value) => !value)}>
            크게 보기
          </button>
        )}
        {expanded && (
          <button className={styles.webcamCloseButton} type="button" onClick={() => setExpanded(false)} aria-label="확대 화면 닫기">
            <Icon name="close" size={22} />
          </button>
        )}
      </div>

      <canvas ref={canvasRef} className={styles.hiddenCanvas} aria-hidden="true" />

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.actions}>
        {!cameraActive ? (
          <button className="button button-primary" type="button" onClick={() => void startCamera()} disabled={cameraStatus === "requesting"}>
            {cameraStatus === "requesting" ? "카메라 요청 중..." : "카메라 켜기"}
            <Icon name="scan" size={18} />
          </button>
        ) : (
          <>
            <button className="button button-primary" type="button" onClick={startDetection} disabled={cameraStatus === "running"}>
              물건 확인 시작
              <Icon name="scanLine" size={18} />
            </button>
            {cameraDevices.length > 1 && (
              <button className="button button-secondary" type="button" onClick={() => void switchCamera()} disabled={switchingCamera || cameraStatus === "requesting"}>
                {switchingCamera ? "전환 중..." : "전·후면 전환"}
              </button>
            )}
            <button className="button button-secondary" type="button" onClick={cameraStatus === "running" ? stopDetection : stopCamera}>
              {cameraStatus === "running" ? "확인 일시정지" : "카메라 끄기"}
            </button>
          </>
        )}
      </div>

      {candidates.length > 0 && (
        <div className={styles.webcamReportPanel}>
          <div>
            <strong>발견 제보로 연결할 수 있는 후보가 있어요.</strong>
            <span>발견 제보 선택을 위해 확인 화면을 브라우저에서 최대 8초간 임시 보관합니다.</span>
          </div>
          <div className={styles.webcamReportActions}>
            {candidates.map((candidate) => <article key={candidate.object.class_code} className={styles.webcamCandidateCard}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={candidate.previewUrl} alt={`${getDisplayLabel(candidate.object)} 확인 화면`} />
              <div><strong>{getDisplayLabel(candidate.object)} 후보를 발견했어요</strong><span>인식 신뢰도 {formatConfidence(candidate.object.confidence)}</span></div>
              <button type="button" onClick={() => openReport(candidate)}>발견 제보하기</button>
              <button type="button" className={styles.webcamCandidateClose} aria-label={`${getDisplayLabel(candidate.object)} 후보 닫기`} onClick={() => dismissCandidate(candidate.object.class_code)}><Icon name="close" size={15} /></button>
            </article>)}
          </div>
        </div>
      )}

      <p className={styles.webcamNotice}>
        카메라 화면은 물건 확인을 위해 서버로 전송되지만 탐지 기록으로 저장하지 않습니다. 발견 제보를 선택한 경우에만 해당 화면을 첨부합니다.
      </p>
    </section>
  );
}
