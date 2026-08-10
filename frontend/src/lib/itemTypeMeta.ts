import type { IconName } from "@/components/common/Icon";

export type ItemTypeKey = "ALL" | "BALL" | "BAG" | "BACKPACK" | "UMBRELLA" | "SHOE" | "SLIPPER" | "FOOTWEAR";
export type ItemTypeFamily = "neutral" | "ball" | "bag" | "umbrella" | "footwear";

export type ItemTypeMeta = {
  key: ItemTypeKey;
  apiCode: "BALL" | "BAG" | "UMBRELLA" | "FOOTWEAR" | null;
  label: string;
  filterValue: string;
  icon: IconName;
  family: ItemTypeFamily;
};

export const ITEM_TYPE_META: Record<ItemTypeKey, ItemTypeMeta> = {
  ALL: { key: "ALL", apiCode: null, label: "전체", filterValue: "", icon: "category", family: "neutral" },
  BALL: { key: "BALL", apiCode: "BALL", label: "공", filterValue: "공", icon: "ball", family: "ball" },
  BAG: { key: "BAG", apiCode: "BAG", label: "가방", filterValue: "가방", icon: "bag", family: "bag" },
  BACKPACK: { key: "BACKPACK", apiCode: "BAG", label: "백팩", filterValue: "백팩", icon: "backpack", family: "bag" },
  UMBRELLA: { key: "UMBRELLA", apiCode: "UMBRELLA", label: "우산", filterValue: "우산", icon: "umbrella", family: "umbrella" },
  SHOE: { key: "SHOE", apiCode: "FOOTWEAR", label: "신발", filterValue: "신발", icon: "footwear", family: "footwear" },
  SLIPPER: { key: "SLIPPER", apiCode: "FOOTWEAR", label: "슬리퍼", filterValue: "슬리퍼", icon: "slipper", family: "footwear" },
  FOOTWEAR: { key: "FOOTWEAR", apiCode: "FOOTWEAR", label: "신발·슬리퍼류", filterValue: "신발·슬리퍼류", icon: "footwear", family: "footwear" },
};

const aliases: Array<[RegExp, ItemTypeKey]> = [
  [/백팩|배낭/i, "BACKPACK"], [/슬리퍼|샌들|플립플롭/i, "SLIPPER"],
  [/신발|운동화|구두/i, "SHOE"], [/우산/i, "UMBRELLA"],
  [/가방|숄더백|토트백/i, "BAG"], [/공|볼/i, "BALL"],
];

export function getItemTypeMeta(code?: string | null, label?: string | null): ItemTypeMeta {
  const normalizedCode = code?.trim().toUpperCase();
  if (normalizedCode && normalizedCode in ITEM_TYPE_META) return ITEM_TYPE_META[normalizedCode as ItemTypeKey];
  const match = aliases.find(([pattern]) => pattern.test(label?.trim() ?? ""));
  return match ? ITEM_TYPE_META[match[1]] : ITEM_TYPE_META.ALL;
}

export const discoveryCategoryOptions = (["ALL", "BALL", "BAG", "BACKPACK", "UMBRELLA", "SHOE", "SLIPPER"] as const).map((key) => ITEM_TYPE_META[key]);
