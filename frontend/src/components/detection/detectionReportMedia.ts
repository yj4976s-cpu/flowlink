const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MEDIA_TYPES = new Set(["video/mp4"]);
const GENERIC_MEDIA_TYPES = new Set(["", "application/octet-stream"]);

export type DetectionReportSourceType = "image" | "video";

type LoadDetectionMediaFileOptions = {
  mediaUrl: string;
  eventId: number;
  sourceType: DetectionReportSourceType;
  resolveMediaUrl: (value: string) => string;
  fetchMedia?: typeof fetch;
};

export async function loadDetectionMediaFile({
  mediaUrl,
  eventId,
  sourceType,
  resolveMediaUrl,
  fetchMedia = fetch,
}: LoadDetectionMediaFileOptions) {
  const resolvedUrl = resolveMediaUrl(mediaUrl);
  if (!resolvedUrl) throw new Error("저장된 원본 미디어 주소가 올바르지 않습니다.");

  const response = await fetchMedia(resolvedUrl, { credentials: "include" });
  if (!response.ok) throw new Error("저장된 원본 미디어를 불러오지 못했습니다.");

  const blob = await response.blob();
  if (!blob.size) throw new Error("저장된 원본 미디어가 비어 있습니다.");

  const responseType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const detectedType = responseType || blob.type.toLowerCase();
  const allowedTypes = sourceType === "image" ? IMAGE_MEDIA_TYPES : VIDEO_MEDIA_TYPES;
  if (!allowedTypes.has(detectedType) && !GENERIC_MEDIA_TYPES.has(detectedType)) {
    throw new Error("저장된 원본 미디어 형식이 탐지 기록과 일치하지 않습니다.");
  }

  const fileType = allowedTypes.has(detectedType)
    ? detectedType
    : sourceType === "image" ? "image/jpeg" : "video/mp4";
  const extension = fileType === "image/png" ? "png" : fileType === "image/webp" ? "webp" : fileType === "video/mp4" ? "mp4" : "jpg";
  return new File([blob], `history-detection-${eventId}.${extension}`, { type: fileType });
}

type PrepareDetectionReportPreviewOptions = {
  sourceType: DetectionReportSourceType;
  localFile: File | null;
  originalMediaUrl: string | null | undefined;
  loadHistoryFile: () => Promise<File>;
  prepareImage: (sourceFile: File) => Promise<File | null>;
  captureVideo: (sourceFile: File) => Promise<File | null>;
};

export async function prepareDetectionReportPreview({
  sourceType,
  localFile,
  originalMediaUrl,
  loadHistoryFile,
  prepareImage,
  captureVideo,
}: PrepareDetectionReportPreviewOptions) {
  const sourceFile = localFile ?? (originalMediaUrl ? await loadHistoryFile() : null);
  if (!sourceFile) return null;
  return sourceType === "image" ? prepareImage(sourceFile) : captureVideo(sourceFile);
}
