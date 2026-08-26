export function isMobileWasteCandidate(object: { class_code?: string | null; group_code?: string | null }) {
  return object.class_code?.toUpperCase() === "TRASH" && object.group_code?.toUpperCase() === "WASTE";
}
