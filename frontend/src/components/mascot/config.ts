import type { DaruAction, DaruCueSource } from "./types";

export const DARU_MODE_STORAGE_KEY = "flowlink:daru-mode";
export const DARU_ACTION_PRIORITY: Record<DaruCueSource, number> = { idle: 0, page: 1, direct: 2, service: 3 };
export const DARU_ACTION_DURATION: Record<DaruAction, number> = {
  idle: 0, alert: 2100, sniff: 2800, listen: 2400, groom: 3600, float: 4600, stretch: 3200,
  wave: 2200, look: 2400, scan: 8000, found: 2800, match: 3200, happy: 2800, think: 6000, rest: 4200,
};
export const DARU_ACTION_LABEL: Record<DaruAction, string> = {
  idle: "다루가 조용히 주변을 살펴보고 있어요.", alert: "다루가 귀를 기울였어요.", sniff: "다루가 궁금한 냄새를 살펴봐요.",
  listen: "어디선가 소리가 들리나 봐요.", groom: "다루가 수염을 정리하고 있어요.", float: "다루가 편안하게 쉬고 있어요.",
  stretch: "다루가 몸을 길게 펴고 있어요.", wave: "안녕하세요, 다루예요.", look: "다루가 주변 정보를 살펴볼게요.",
  scan: "다루가 관심 대상을 관찰하고 있어요.", found: "다루가 무언가를 발견했어요.", match: "서로 닮은 두 곳을 번갈아 보고 있어요.",
  happy: "무사히 연결되어 다루도 기뻐요.", think: "다루가 답을 기다리며 귀를 기울여요.", rest: "다루가 잠시 쉬며 다음 연결을 기다려요.",
};
