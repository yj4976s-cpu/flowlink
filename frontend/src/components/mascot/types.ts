export type DaruMode = "active" | "quiet" | "hidden";

export type DaruAction =
  | "idle"
  | "alert"
  | "sniff"
  | "listen"
  | "groom"
  | "float"
  | "stretch"
  | "wave"
  | "look"
  | "scan"
  | "found"
  | "match"
  | "happy"
  | "think"
  | "rest";

export type DaruIdleAction = "rest" | "alert" | "sniff" | "listen" | "groom" | "float" | "stretch";
export type DaruRhythm = "dawn" | "day" | "night";

export type DaruCueSource = "idle" | "page" | "direct" | "service";

export interface DaruCueOptions {
  source?: DaruCueSource;
  duration?: number;
  message?: string;
}
