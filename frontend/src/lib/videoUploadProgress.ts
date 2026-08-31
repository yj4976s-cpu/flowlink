export function calculateVideoUploadProgress(loaded: number, total: number, lengthComputable: boolean) {
  if (!lengthComputable || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}
