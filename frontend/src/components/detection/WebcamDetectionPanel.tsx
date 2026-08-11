"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/common/Icon";
import { DetectionApiError, WebcamDetectionFrame, WebcamDetectionObject, detectWebcamFrame } from "@/lib/detectionApi";
import styles from "./DetectionWorkbench.module.css";

export type WebcamPanelStatus = "idle" | "requesting" | "ready" | "running" | "error";

type WebcamDetectionPanelProps = {
  onFrame: (frame: WebcamDetectionFrame | null) => void;
  onStatusChange: (status: WebcamPanelStatus) => void;
};

type Size = {
  width: number;
  height: number;
};

const WEBCAM_FRAME_MAX_WIDTH = 640;
const WEBCAM_FRAME_INTERVAL_MS = 300;
const WEBCAM_JPEG_QUALITY = 0.8;

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

function getCameraErrorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return "카메라 권한이 거부되었습니다. 브라우저 권한을 허용한 뒤 다시 시도해주세요.";
    if (error.name === "NotFoundError") return "사용 가능한 카메라를 찾지 못했습니다.";
    if (error.name === "NotReadableError") return "다른 앱에서 카메라를 사용 중일 수 있습니다.";
  }
  return "카메라를 시작하지 못했습니다. 브라우저 권한과 연결 상태를 확인해주세요.";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function getVideoContentMetrics(container: Size, media: Size) {
  if (!container.width || !container.height || !media.width || !media.height) return null;
  const scale = Math.min(container.width / media.width, container.height / media.height);
  const width = media.width * scale;
  const height = media.height * scale;
  return {
    scale,
    offsetX: (container.width - width) / 2,
    offsetY: (container.height - height) / 2,
  };
}

function WebcamOverlayBox({
  object,
  metrics,
}: {
  object: WebcamDetectionObject;
  metrics: NonNullable<ReturnType<typeof getVideoContentMetrics>>;
}) {
  const style = {
    left: metrics.offsetX + object.bbox.x * metrics.scale,
    top: metrics.offsetY + object.bbox.y * metrics.scale,
    width: object.bbox.width * metrics.scale,
    height: object.bbox.height * metrics.scale,
  };

  return (
    <span className={styles.overlayBox} style={style}>
      <b>
        {getObjectLabel(object.label)} {formatConfidence(object.confidence)}
      </b>
    </span>
  );
}

export function WebcamDetectionPanel({ onFrame, onStatusChange }: WebcamDetectionPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopGenerationRef = useRef(0);
  const cameraRequestGenerationRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  const [cameraStatus, setCameraStatus] = useState<WebcamPanelStatus>("idle");
  const [cameraActive, setCameraActive] = useState(false);
  const [frame, setFrame] = useState<WebcamDetectionFrame | null>(null);
  const [previewSize, setPreviewSize] = useState<Size>({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

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
  }, [onFrame, stopDetection, stopStream]);

  useEffect(() => {
    mountedRef.current = true;
    const videoElement = videoRef.current;
    return () => {
      mountedRef.current = false;
      cameraRequestGenerationRef.current += 1;
      loopGenerationRef.current += 1;
      clearPendingRequest();
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoElement) videoElement.srcObject = null;
    };
  }, [clearPendingRequest, stopStream]);

  useEffect(() => {
    const updatePreviewSize = () => {
      const rect = previewRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPreviewSize({ width: rect.width, height: rect.height });
    };

    updatePreviewSize();
    const observer = new ResizeObserver(updatePreviewSize);
    if (previewRef.current) observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [expanded]);

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

  const captureFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
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
      } catch (caught) {
        if (isAbortError(caught) || !mountedRef.current || generation !== loopGenerationRef.current) return;
        const message = caught instanceof DetectionApiError ? caught.message : "실시간 웹캠 탐지를 처리하지 못했습니다.";
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

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저에서는 웹캠을 사용할 수 없습니다.");
      setCameraStatus("error");
      return;
    }

    setError("");
    setCameraStatus("requesting");
    const requestGeneration = cameraRequestGenerationRef.current + 1;
    cameraRequestGenerationRef.current = requestGeneration;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "environment",
        },
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
      setCameraStatus("ready");
    } catch (caught) {
      if (!mountedRef.current || requestGeneration !== cameraRequestGenerationRef.current) return;
      setError(getCameraErrorMessage(caught));
      setCameraActive(false);
      setCameraStatus("error");
    }
  };

  const startDetection = () => {
    if (!streamRef.current || cameraStatus === "running") return;
    loopGenerationRef.current += 1;
    const generation = loopGenerationRef.current;
    setError("");
    setCameraStatus("running");
    runDetectionLoop(generation);
  };

  const metrics = useMemo(
    () => (frame ? getVideoContentMetrics(previewSize, { width: frame.media_width, height: frame.media_height }) : null),
    [frame, previewSize],
  );

  return (
    <section className={styles.webcamPanel} aria-labelledby="webcam-title">
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>LIVE WEBCAM</p>
          <h2 id="webcam-title">실시간 웹캠 탐지</h2>
        </div>
        <span>{cameraStatus === "running" ? "분석 중" : cameraActive ? "카메라 준비" : "대기"}</span>
      </div>

      <div className={`${styles.webcamStage} ${expanded ? styles.webcamStageExpanded : ""}`} ref={previewRef}>
        <video ref={videoRef} className={styles.webcamVideo} playsInline muted />
        {!cameraActive && (
          <div className={styles.webcamEmpty}>
            <Icon name="scanLine" size={32} />
            <strong>카메라를 켜고 실시간 탐지를 시작해보세요.</strong>
            <span>브라우저 권한을 허용하면 현재 화면의 프레임만 서버로 전송해 분석합니다.</span>
          </div>
        )}
        {cameraStatus === "running" && <span className={styles.liveBadge}>LIVE</span>}
        {frame && metrics && (
          <div className={styles.overlay} aria-hidden="true">
            {frame.detected_objects.map((object, index) => (
              <WebcamOverlayBox key={`${object.label}-${index}-${object.bbox.x}-${object.bbox.y}`} object={object} metrics={metrics} />
            ))}
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
              실시간 탐지 시작
              <Icon name="scanLine" size={18} />
            </button>
            <button className="button button-secondary" type="button" onClick={cameraStatus === "running" ? stopDetection : stopCamera}>
              {cameraStatus === "running" ? "탐지 일시정지" : "카메라 끄기"}
            </button>
          </>
        )}
      </div>

      <p className={styles.webcamNotice}>
        웹캠 프레임은 저장하지 않고 실시간 탐지 요청에만 사용합니다. 정확한 판단이 필요한 경우 관리자 확인이 필요합니다.
      </p>
    </section>
  );
}
