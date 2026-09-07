// Shared by saved image/video results, webcam candidates, and the report form.
export const reportableClassNames: Readonly<Record<string, string>> = Object.freeze({
  BAG: "가방",
  UMBRELLA: "우산",
  FOOTWEAR: "신발",
  BALL: "공",
  HAT: "모자",
});

export function getReportableClassCode(value: string | null | undefined) {
  return value && Object.hasOwn(reportableClassNames, value) ? value : "";
}

export function isReportablePersonalItem(object: {
  class_code?: string | null;
  group_code?: string | null;
}) {
  return object.group_code === "PERSONAL_ITEM" && Boolean(getReportableClassCode(object.class_code));
}
