import { buildApiUrl as buildCommonApiUrl, resolveMediaUrl } from "@/lib/apiBase";
import { calculateVideoUploadProgress } from "@/lib/videoUploadProgress";

export type DetectionBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectionObject = {
  id: number;
  class_code: string;
  class_name_ko: string;
  group_code: string;
  confidence: number;
  bbox: DetectionBBox;
  track_id: number | null;
  first_seen_ms: number | null;
  last_seen_ms: number | null;
  appearance_count: number;
};

export type DetectionEvent = {
  id: number;
  source_type: "IMAGE" | "VIDEO";
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  purpose: "USER_ANALYSIS" | "OPERATION";
  original_media_url: string;
  result_media_url: string | null;
  ai_model_id: string | null;
  media_width: number | null;
  media_height: number | null;
  created_at: string;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  detected_objects: DetectionObject[];
};

export type VideoDetectionAccepted = {
  detection_event_id: number;
  video_job_id: number;
  status: "PROCESSING";
  stage: "QUEUED";
};

export type VideoProcessingStatus = {
  detection_event_id: number;
  video_job_id: number;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  stage: "QUEUED" | "ANALYZING" | "RENDERING" | "SAVING" | "COMPLETED" | "FAILED";
  failed_stage: "QUEUED" | "ANALYZING" | "RENDERING" | "SAVING" | null;
  processed_frames: number;
  total_frames: number | null;
  analysis_progress: number | null;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  result_ready: boolean;
  error_message: string | null;
};

export type WebcamDetectionObject = {
  label: string;
  class_code: string | null;
  class_name_ko: string | null;
  group_code: string | null;
  confidence: number;
  bbox: DetectionBBox;
};

export type WebcamDetectionFrame = {
  media_width: number;
  media_height: number;
  inference_ms: number;
  detected_objects: WebcamDetectionObject[];
};

export class DetectionApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DetectionApiError";
  }
}


function buildApiUrl(path: string, params?: Record<string, string | number | undefined>) {
  return buildCommonApiUrl(path, params);
}

export function resolveDetectionMediaUrl(value: string | null | undefined) {
  return resolveMediaUrl(value) ?? "";
}

function getFallbackMessage(status: number) {
  if (status === 401) return "로그인이 필요하거나 로그인 세션이 만료되었습니다.";
  if (status === 413) return "파일 크기가 너무 큽니다. 안내된 최대 용량을 확인해주세요.";
  if (status === 415 || status === 422) return "지원하지 않는 파일 형식입니다.";
  if (status === 503) return "AI 모델 연결을 준비하고 있습니다. 모델 파일이 연결되면 다시 시도해주세요.";
  return "AI 탐지를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

async function readErrorMessage(response: Response) {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (detail === "AI detection model is not configured") return getFallbackMessage(503);
      if (detail === "Webcam detection model is unavailable") return getFallbackMessage(503);
    }
  } catch {
    return getFallbackMessage(response.status);
  }
  return getFallbackMessage(response.status);
}

function readXhrErrorMessage(xhr: XMLHttpRequest) {
  try {
    const body: unknown = JSON.parse(xhr.responseText);
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (detail === "AI detection model is not configured") return getFallbackMessage(503);
      if (detail === "Webcam detection model is unavailable") return getFallbackMessage(503);
    }
  } catch {
    return getFallbackMessage(xhr.status);
  }
  return getFallbackMessage(xhr.status);
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
  });

  if (!response.ok) {
    throw new DetectionApiError(await readErrorMessage(response), response.status);
  }

  return response.json() as Promise<T>;
}

function uploadDetection(path: string, file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return requestJson<DetectionEvent>(buildApiUrl(path), {
    method: "POST",
    body: formData,
  });
}

export function uploadDetectionImage(file: File) {
  return uploadDetection("/api/detections/images", file);
}

export type DetectionVideoUploadOptions = {
  onUploadProgress?: (progress: number | null) => void;
  onUploadComplete?: () => void;
  signal?: AbortSignal;
};

export function uploadDetectionVideo(file: File, options: DetectionVideoUploadOptions = {}) {
  return new Promise<VideoDetectionAccepted>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    const abortRequest = () => xhr.abort();
    const cleanup = () => options.signal?.removeEventListener("abort", abortRequest);
    formData.append("file", file);
    xhr.open("POST", buildApiUrl("/api/detections/videos"));
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => options.onUploadProgress?.(
      calculateVideoUploadProgress(event.loaded, event.total, event.lengthComputable),
    );
    xhr.upload.onload = () => options.onUploadComplete?.();
    xhr.onload = () => {
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new DetectionApiError(readXhrErrorMessage(xhr), xhr.status));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as VideoDetectionAccepted);
      } catch {
        reject(new DetectionApiError("영상 분석 결과를 확인하지 못했습니다.", xhr.status));
      }
    };
    xhr.onerror = () => { cleanup(); reject(new DetectionApiError("영상을 업로드하지 못했어요. 네트워크 연결을 확인한 뒤 다시 시도해주세요.", xhr.status || undefined)); };
    xhr.onabort = () => { cleanup(); reject(new DOMException("Video upload aborted", "AbortError")); };
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new DOMException("Video upload aborted", "AbortError"));
        return;
      }
      options.signal.addEventListener("abort", abortRequest, { once: true });
    }
    xhr.send(formData);
  });
}

export function getVideoProcessingStatus(eventId: number, signal?: AbortSignal) {
  return requestJson<VideoProcessingStatus>(buildApiUrl(`/api/detections/${eventId}/processing-status`), { signal });
}

export function detectWebcamFrame(blob: Blob, signal?: AbortSignal) {
  const formData = new FormData();
  formData.append("file", blob, "webcam-frame.jpg");
  return requestJson<WebcamDetectionFrame>(buildApiUrl("/api/detections/webcam/frame"), {
    method: "POST",
    body: formData,
    signal,
  });
}

export function listMyDetections(signal?: AbortSignal) {
  return requestJson<DetectionEvent[]>(buildApiUrl("/api/detections/me", { skip: 0, limit: 20 }), { signal });
}

export function getMyDetection(id: number, signal?: AbortSignal) {
  return requestJson<DetectionEvent>(buildApiUrl(`/api/detections/${id}`), { signal });
}

export function deleteMyDetection(id: number) {
  return requestJson<{ message: string }>(buildApiUrl(`/api/detections/${id}`), { method: "DELETE" });
}

export function deleteAllMyDetections() {
  return requestJson<{ message: string }>(buildApiUrl("/api/detections/me"), { method: "DELETE" });
}
