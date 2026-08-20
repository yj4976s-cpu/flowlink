export type ObjectKind = "backpack" | "umbrella" | "branch" | "ball" | "container";

export interface HomeStats {
  recentFound: number;
  matchingActive: number;
  returned: number;
  todayDetections: number;
}

export interface HomeRecentItem {
  id: number;
  category: string;
  title: string;
  location: string;
  imageUrl: string | null;
  confidence: number | null;
  foundAt: string;
  objectKind: ObjectKind;
}

export interface HomeSummary {
  stats: HomeStats;
  recentItems: HomeRecentItem[];
}
