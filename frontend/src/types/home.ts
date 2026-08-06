export type ObjectKind = "backpack" | "umbrella" | "branch" | "container";

export interface FoundItem {
  id: number;
  category: string;
  title: string;
  location: string;
  confidence: number;
  foundAt: string;
  objectKind: ObjectKind;
}
