export type DetectionObject = {
  id: number; object_class: string; object_class_name: string; final_class_code: string | null;
  confidence: number; bbox_x: number; bbox_y: number; bbox_width: number; bbox_height: number;
  cropped_image_url: string | null; detected_at: string; processing_status: "PENDING" | "CONFIRMED" | "REJECTED";
  admin_memo: string | null;
  track_id: number | null; first_seen_ms: number | null; last_seen_ms: number | null; appearance_count: number;
  follow_up_kind: "FOUND_ITEM" | "WASTE" | "NONE";
  found_item_id: number | null;
  waste_collection_completed: boolean;
};
export type DetectionEvent = {
  id: number; source_type: string; original_media_url: string; result_media_url: string | null; status: string;
  captured_at: string; processing_started_at: string | null; processing_completed_at: string | null;
  error_message: string | null; camera_id: number | null; detected_objects: DetectionObject[];
};
export type DetectionObjectUpdate = { final_class_code?: string; processing_status?: DetectionObject["processing_status"]; admin_memo?: string };

export class AdminDetectionsApiError extends Error { constructor(message: string, readonly status?: number) { super(message); this.name = "AdminDetectionsApiError"; } }
function baseUrl() { const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim(); if (!value) throw new AdminDetectionsApiError("API 서버 주소가 설정되지 않았습니다."); return value.replace(/\/+$/, ""); }
async function request<T>(path: string, init?: RequestInit) { const response = await fetch(`${baseUrl()}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } }); if (!response.ok) throw new AdminDetectionsApiError(response.status === 403 ? "관리자 권한이 필요합니다." : "탐지 관리 요청을 처리하지 못했습니다.", response.status); return response.json() as Promise<T>; }
export function listAdminDetections(signal?: AbortSignal) { return request<DetectionEvent[]>("/api/admin/detections?skip=0&limit=100", { signal }); }
export function updateDetectedObject(id: number, update: DetectionObjectUpdate) { return request<{ message: string }>(`/api/admin/detected-objects/${id}`, { method: "PATCH", body: JSON.stringify(update) }); }
export function createFoundItemFromDetection(id: number) { return request<{ detected_object_id: number; found_item_id: number; source_type: "AI"; follow_up_status: "COMPLETED" }>(`/api/admin/detected-objects/${id}/found-item`, { method: "POST" }); }
export function completeDetectedWasteCollection(id: number) { return request<{ detected_object_id: number; waste_collection_completed: true; follow_up_status: "COMPLETED" }>(`/api/admin/detected-objects/${id}/collect`, { method: "POST" }); }
export function adminDetectionMediaUrl(value?: string | null) { if (!value) return null; try { const url = new URL(value, `${baseUrl()}/`); return ["http:", "https:"].includes(url.protocol) ? url.toString() : null; } catch { return null; } }
