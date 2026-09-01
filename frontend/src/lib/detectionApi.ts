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
  original_media_bytes: number | null;
  result_media_url: string | null;
  result_media_bytes: number | null;
  ai_model_id: string | null;
  media_width: number | null;
  media_height: number | null;
  video_duration_seconds: number | null;
  created_at: string;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  detected_objects: DetectionObject[];
};

export type DetectionSummaryPeriod = 7 | 30 | 90;

export type DetectionClassDistributionItem = {
  class_code: string;
  class_name_ko: string;
  count: number;
  ratio: number;
};

export type DetectionConfidenceDistributionItem = {
  code: "GE_90" | "GE_70" | "GE_50" | "LT_50";
  label: string;
  count: number;
  ratio: number;
};

export type DetectionDailyTrendItem = {
  date: string;
  analysis_count: number;
  object_count: number;
};

export type DetectionRecentEventSummary = {
  id: number;
  source_type: "IMAGE" | "VIDEO";
  status: DetectionEvent["status"];
  created_at: string;
  processing_completed_at: string | null;
  object_count: number;
  primary_class_code: string | null;
  primary_class_name_ko: string | null;
  average_confidence: number | null;
};

export type DetectionAnalysisSummary = {
  period_days: DetectionSummaryPeriod;
  period_start: string;
  period_end: string;
  generated_at: string;
  total_analyses: number;
  completed_count: number;
  failed_count: number;
  in_progress_count: number;
  completion_rate: number;
  image_count: number;
  video_count: number;
  total_detected_objects: number;
  average_confidence: number | null;
  class_distribution: DetectionClassDistributionItem[];
  confidence_distribution: DetectionConfidenceDistributionItem[];
  daily_trend: DetectionDailyTrendItem[];
  recent_events: DetectionRecentEventSummary[];
};

export type DetectionUploadPolicy = {
  image: {
    allowed_content_types: string[];
    source_max_bytes: number;
    source_max_pixels: number;
    normalized_max_edge: number;
    normalized_target_bytes: number;
    normalized_hard_max_bytes: number;
  };
  video: {
    allowed_content_types: string[];
    max_bytes: number;
    max_duration_seconds: number;
    max_source_edge: number;
    normalized_max_width: number;
    normalized_max_height: number;
    normalized_max_fps: number;
  };
  quota: {
    image_count_last_24h: number;
    video_count_last_24h: number;
    media_storage_bytes: number;
    active_video_jobs: number;
  };
};

export type DetectionStorageUsage = {
  used_bytes: number;
  limit_bytes: number;
  usage_ratio: number;
  remaining_bytes: number;
  image_count_last_24h: number;
  image_limit_last_24h: number;
  video_count_last_24h: number;
  video_limit_last_24h: number;
  active_video_jobs: number;
  active_video_job_limit: number;
  has_unknown_legacy_usage: boolean;
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
  stage: "QUEUED" | "NORMALIZING" | "ANALYZING" | "RENDERING" | "SAVING" | "COMPLETED" | "FAILED";
  failed_stage: "QUEUED" | "NORMALIZING" | "ANALYZING" | "RENDERING" | "SAVING" | null;
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

async function readErrorMessage(response: Response): Promise<string> {
  return readSafeDetectionErrorMessage(response);
}

function readXhrErrorMessage(xhr: XMLHttpRequest): string {
  return readSafeXhrDetectionErrorMessage(xhr);
}

const MODEL_UNAVAILABLE_DETAILS = new Set([
  "AI detection model is not configured",
  "Webcam detection model is unavailable",
]);

const SAFE_UPLOAD_ERROR_DETAILS = new Set([
  "사용자 탐지 저장 공간 한도를 초과했습니다. 기존 분석 기록을 정리한 뒤 다시 시도해 주세요.",
  "최근 24시간 이미지 분석 가능 횟수를 초과했습니다.",
  "최근 24시간 영상 분석 가능 횟수를 초과했습니다.",
  "이미 처리 중인 영상 분석이 있습니다. 완료 후 다시 업로드해 주세요.",
  "Uploaded file is empty",
  "Uploaded file is too large",
  "Image must be 5MB or smaller",
  "Image dimensions are too large",
  "Image cannot be optimized under 2MB",
  "Image cannot be optimized under the server storage limit.",
  "Uploaded file is not a valid image",
  "HEIC/HEIF images are not supported. Please upload JPG, PNG, or WebP.",
  "Only JPEG, PNG, and WebP images are allowed",
  "Only JPG, PNG, and WebP images are supported.",
  "Animated WebP images are not supported.",
  "Only MP4 videos are supported.",
  "Video is larger than the upload limit.",
  "Uploaded file is not a valid MP4 video",
  "Uploaded file does not contain a video stream",
  "Invalid video metadata",
  "Video must be 30 seconds or shorter.",
  "Video dimensions are too large.",
  "Video processing timed out",
]);

function safeFallbackMessage(status: number) {
  if (status === 401) return "로그인이 필요하거나 로그인 세션이 만료되었습니다.";
  if (status === 409) return "이미 처리 중인 영상 분석이 있습니다. 완료 후 다시 업로드해 주세요.";
  if (status === 413) return "파일 크기나 해상도가 너무 큽니다. 안내된 최대 용량을 확인해 주세요.";
  if (status === 415 || status === 422) return "지원하지 않는 파일 형식이거나 파일 내용을 확인할 수 없습니다.";
  if (status === 503) return "AI 모델 연결이 준비되지 않았습니다. 모델 파일이 연결되면 다시 시도해 주세요.";
  if (status === 504) return "영상 처리 시간이 초과되었습니다. 더 짧은 영상으로 다시 시도해 주세요.";
  return "AI 분석을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function safeErrorMessageFromBody(body: unknown, status: number) {
  if (!body || typeof body !== "object" || !("detail" in body)) return safeFallbackMessage(status);
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail !== "string") return safeFallbackMessage(status);
  if (MODEL_UNAVAILABLE_DETAILS.has(detail)) return safeFallbackMessage(503);
  if (SAFE_UPLOAD_ERROR_DETAILS.has(detail)) return detail;
  return safeFallbackMessage(status);
}

export async function readSafeDetectionErrorMessage(response: Response) {
  try {
    return safeErrorMessageFromBody(await response.json(), response.status);
  } catch {
    return safeFallbackMessage(response.status);
  }
}

export function readSafeXhrDetectionErrorMessage(xhr: Pick<XMLHttpRequest, "responseText" | "status">) {
  try {
    return safeErrorMessageFromBody(JSON.parse(xhr.responseText), xhr.status);
  } catch {
    return safeFallbackMessage(xhr.status);
  }
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

export function getDetectionUploadPolicy(signal?: AbortSignal) {
  return requestJson<DetectionUploadPolicy>(buildApiUrl("/api/detections/upload-policy"), { signal });
}

export function getDetectionStorageUsage(signal?: AbortSignal) {
  return requestJson<DetectionStorageUsage>(buildApiUrl("/api/detections/me/storage-usage"), { signal });
}

export function getMyDetectionSummary(days: DetectionSummaryPeriod = 30, signal?: AbortSignal) {
  return requestJson<DetectionAnalysisSummary>(buildApiUrl("/api/detections/me/summary", { days }), { signal });
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
