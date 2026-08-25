import type { CardCatalogEntry, CardId, DaruGameTheme, DaruThemeAssets, GameDifficulty } from "./game.types";

export const CARD_CATALOG: readonly CardCatalogEntry[] = [
  { id: "greeting", kind: "daru", label: "인사하는 다루", filename: "daru-greeting.png" },
  { id: "excited", kind: "daru", label: "신난 다루", filename: "daru-excited.png" },
  { id: "heart", kind: "daru", label: "마음을 전하는 다루", filename: "daru-heart.png" },
  { id: "thumbs-up", kind: "daru", label: "응원하는 다루", filename: "daru-thumbs-up.png" },
  { id: "sleeping", kind: "daru", label: "쉬고 있는 다루", filename: "daru-sleeping.png" },
  { id: "sulky", kind: "daru", label: "토라진 다루", filename: "daru-sulky.png" },
  { id: "shy", kind: "daru", label: "수줍은 다루", filename: "daru-shy.png" },
  { id: "search", kind: "daru", label: "찾아보는 다루", filename: "daru-search.png" },
  { id: "coastal-cleanup", kind: "daru", label: "해안가를 청소하는 다루", filename: "daru-coastal-cleanup.png" },
  { id: "splash", kind: "daru", label: "물놀이하는 다루", filename: "daru-splash.png" },
  { id: "branch-play", kind: "daru", label: "나뭇가지로 노는 다루", filename: "daru-branch-play.png" },
  { id: "plastic-sort", kind: "daru", label: "플라스틱을 분류하는 다루", filename: "daru-plastic-sort.png" },
  { id: "umbrella-found", kind: "daru", label: "우산을 발견한 다루", filename: "daru-umbrella-found.png" },
  { id: "shoe-found", kind: "daru", label: "신발을 발견한 다루", filename: "daru-shoe-found.png" },
  { id: "backpack-found", kind: "daru", label: "백팩을 발견한 다루", filename: "daru-backpack-found.png" },
  { id: "proud", kind: "daru", label: "뿌듯한 다루", filename: "daru-proud.png" },
  { id: "umbrella", kind: "detected-item", label: "우산", filename: "item-umbrella.png" },
  { id: "shoe", kind: "detected-item", label: "신발", filename: "item-shoe.png" },
  { id: "backpack", kind: "detected-item", label: "백팩", filename: "item-backpack.png" },
  { id: "ball", kind: "detected-item", label: "공", filename: "item-ball.png" },
  { id: "can", kind: "detected-item", label: "캔", filename: "item-can.png" },
  { id: "plastic-bag", kind: "detected-item", label: "비닐봉지", filename: "item-plastic-bag.png" },
  { id: "plastic-bottle", kind: "detected-item", label: "플라스틱 병", filename: "item-plastic-bottle.png" },
  { id: "styrofoam", kind: "detected-item", label: "스티로폼", filename: "item-styrofoam.png" },
] as const;

export const EASY_CARD_IDS = ["greeting", "excited", "heart", "sleeping", "search", "umbrella", "shoe", "backpack", "ball", "can"] as const satisfies readonly CardId[];
export const MEDIUM_ADDITIONAL_CARD_IDS = ["thumbs-up", "sulky", "coastal-cleanup", "umbrella-found", "plastic-bag", "plastic-bottle"] as const satisfies readonly CardId[];
export const NORMAL_CARD_IDS = [...EASY_CARD_IDS, ...MEDIUM_ADDITIONAL_CARD_IDS] as const satisfies readonly CardId[];
export const HARD_ADDITIONAL_CARD_IDS = ["shy", "splash", "branch-play", "plastic-sort", "shoe-found", "backpack-found", "proud", "styrofoam"] as const satisfies readonly CardId[];

export const CARD_IDS_BY_DIFFICULTY: Record<GameDifficulty, readonly CardId[]> = {
  easy: EASY_CARD_IDS,
  normal: NORMAL_CARD_IDS,
  hard: [...NORMAL_CARD_IDS, ...HARD_ADDITIONAL_CARD_IDS],
};

export function getCardThemeImages(card: CardCatalogEntry): DaruThemeAssets {
  const group = card.kind === "daru" ? "daru" : "items";
  const path = (theme: DaruGameTheme) => `/daru-memory/cards/${theme}/${group}/${card.filename}`;
  return { dawn: path("dawn"), day: path("day"), night: path("night") };
}
