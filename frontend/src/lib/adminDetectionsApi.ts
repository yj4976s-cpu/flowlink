import { resolveUploadedMediaUrl } from "@/lib/mediaUrl";
import { buildApiUrl, getPublicApiBaseUrl } from "@/lib/apiBase";

export type DetectionObject = {
  id: number; object_class: string; object_class_name: string; final_class_code: string | null;
  confidence: number; bbox_x: number; bbox_y: number; bbox_width: number; bbox_height: number;
  cropped_image_url: string | null; detected_at: string; processing_status: "PENDING" | "CONFIRMED" | "REJECTED";
  ai_color: string | null; confirmed_color: string | null;
  admin_memo: string | null;
  track_id: number | null; first_seen_ms: number | null; last_seen_ms: number | null; appearance_count: number;
  follow_up_kind: "FOUND_ITEM" | "WASTE" | "NONE";
  found_item_id: number | null;
  waste_collection_completed: boolean;
};
export type DetectionEvent = {
  id: number; purpose: "OPERATION" | "USER_ANALYSIS"; source_type: string; original_media_url: string; result_media_url: string | null; status: string;
  captured_at: string; processing_started_at: string | null; processing_completed_at: string | null;
  error_message: string | null; camera_id: number | null; detected_objects: DetectionObject[];
};
export type DetectionObjectUpdate = { final_class_code?: string; processing_status?: DetectionObject["processing_status"]; admin_memo?: string; confirmed_color?: string };
export type AdminCamera = { id: number; code: string; name: string; area_name: string; latitude: number; longitude: number };
export type AdminMobileWasteRegistrationResponse = {
  detection_event_id: number;
  detected_object_id: number;
  processing_status: "CONFIRMED";
  follow_up_kind: "WASTE";
  waste_collection_completed: false;
  original_media_url: string;
  cropped_image_url: string | null;
};

export class AdminDetectionsApiError extends Error { constructor(message: string, readonly status?: number) { super(message); this.name = "AdminDetectionsApiError"; } }
function baseUrl() { return getPublicApiBaseUrl(); }
async function request<T>(path: string, init?: RequestInit) { const response = await fetch(buildApiUrl(path), { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } }); if (!response.ok) throw new AdminDetectionsApiError(response.status === 403 ? "관리자 권한이 필요합니다." : "탐지 관리 요청을 처리하지 못했습니다.", response.status); return response.json() as Promise<T>; }
export function listAdminDetections(signal?: AbortSignal) { return request<DetectionEvent[]>("/api/admin/detections?skip=0&limit=100", { signal }); }
export function listAdminCameras(signal?: AbortSignal) { return request<AdminCamera[]>("/api/admin/cameras", { signal }); }
export async function createOperationDetection(cameraId: number, file: File) {
  const body = new FormData(); body.append("camera_id", String(cameraId)); body.append("file", file);
  const response = await fetch(buildApiUrl("/api/admin/detections/images"), { method: "POST", credentials: "include", body });
  if (!response.ok) { let message = "운영 탐지를 실행하지 못했습니다."; try { const payload = await response.json() as { detail?: string }; if (payload.detail) message = payload.detail; } catch { /* safe fallback */ } throw new AdminDetectionsApiError(message, response.status); }
  return response.json() as Promise<{ message: string }>;
}
export async function registerMobileWasteCandidate(cameraId: number, file: File, bbox: { x: number; y: number; width: number; height: number }, signal?: AbortSignal) {
  const body = new FormData();
  body.append("camera_id", String(cameraId));
  body.append("file", file);
  body.append("bbox_x", String(bbox.x));
  body.append("bbox_y", String(bbox.y));
  body.append("bbox_width", String(bbox.width));
  body.append("bbox_height", String(bbox.height));
  const response = await fetch(buildApiUrl("/api/admin/detections/mobile-waste"), { method: "POST", credentials: "include", body, signal });
  if (!response.ok) {
    let message = "모바일 폐기물 등록을 처리하지 못했습니다.";
    try {
      const payload = await response.json() as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // safe fallback
    }
    throw new AdminDetectionsApiError(message, response.status);
  }
  return response.json() as Promise<AdminMobileWasteRegistrationResponse>;
}
export function updateDetectedObject(id: number, update: DetectionObjectUpdate) { return request<{ message: string }>(`/api/admin/detected-objects/${id}`, { method: "PATCH", body: JSON.stringify(update) }); }
export function createFoundItemFromDetection(id: number) { return request<{ detected_object_id: number; found_item_id: number; source_type: "AI"; follow_up_status: "COMPLETED" }>(`/api/admin/detected-objects/${id}/found-item`, { method: "POST" }); }
export function completeDetectedWasteCollection(id: number, signal?: AbortSignal) { return request<{ detected_object_id: number; waste_collection_completed: true; follow_up_status: "COMPLETED" }>(`/api/admin/detected-objects/${id}/collect`, { method: "POST", signal }); }
export function adminDetectionMediaUrl(value?: string | null) {
  return resolveUploadedMediaUrl(value, baseUrl());
}
