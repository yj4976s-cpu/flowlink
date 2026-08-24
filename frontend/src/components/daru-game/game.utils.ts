import { CARD_CATALOG, CARD_IDS_BY_DIFFICULTY, getCardThemeImages } from "./card.catalog";
import { DETECTION_POWER_WEIGHTS, DIFFICULTY_CONFIG, POINT_CONFIG, RANK_THRESHOLDS } from "./game.config";
import type { DaruGameTheme, DetectionMetrics, GameCard, GameDifficulty, GameRank } from "./game.types";

export function shuffleCards(cards: GameCard[], random = Math.random) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function createGameDeck(difficulty: GameDifficulty, random = Math.random) {
  const catalogById = new Map(CARD_CATALOG.map((card) => [card.id, card]));
  const pairs: Omit<GameCard, "id">[] = CARD_IDS_BY_DIFFICULTY[difficulty].map((cardId) => {
    const card = catalogById.get(cardId);
    if (!card) throw new Error(`Unknown daru memory card: ${cardId}`);
    const themeImages = getCardThemeImages(card);
    return { pairId: card.id, kind: card.kind, image: themeImages.day, label: card.label, themeImages };
  });

  const cards = pairs.flatMap((pair) => [0, 1].map((copy) => ({ ...pair, id: `${pair.pairId}-${copy}` })));
  return shuffleCards(cards, random);
}

export function calculatePairPoints(combo: number) {
  const comboBonus = Math.min(Math.max(0, combo - 1) * POINT_CONFIG.comboBonusStep, POINT_CONFIG.maxComboBonus);
  return { pairPoint: POINT_CONFIG.pairPoint, comboBonus, total: POINT_CONFIG.pairPoint + comboBonus };
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function calculateDetectionMetrics(difficulty: GameDifficulty, elapsedSeconds: number, attempts: number, maxCombo: number): DetectionMetrics {
  const config = DIFFICULTY_CONFIG[difficulty];
  const memoryEfficiency = attempts > 0 ? clampPercent((config.pairCount / attempts) * 100) : 0;
  const speedScore = calculateSpeedScore(elapsedSeconds, config.speedBenchmarkSeconds, config.timeLimitSeconds);
  const comboScore = clampPercent((maxCombo / config.comboTarget) * 100);
  const detectionPower = Math.round(memoryEfficiency * DETECTION_POWER_WEIGHTS.memory + speedScore * DETECTION_POWER_WEIGHTS.speed + comboScore * DETECTION_POWER_WEIGHTS.combo);
  return { memoryEfficiency: Math.round(memoryEfficiency), speedScore: Math.round(speedScore), comboScore: Math.round(comboScore), detectionPower: clampPercent(detectionPower) };
}

export function calculateSpeedScore(elapsedSeconds: number, benchmarkSeconds: number, timeLimitSeconds: number, withinTimeLimit = true) {
  if (!withinTimeLimit) return 0;
  const elapsed = Math.max(1, elapsedSeconds);
  if (elapsed <= benchmarkSeconds) return clampPercent(80 + 20 * (1 - elapsed / benchmarkSeconds));
  const overtimeRatio = (elapsed - benchmarkSeconds) / (timeLimitSeconds - benchmarkSeconds);
  return Math.min(100, Math.max(40, 80 - 40 * overtimeRatio));
}

export function calculateDetectionMetricsWithEligibility(difficulty: GameDifficulty, elapsedSeconds: number, attempts: number, maxCombo: number, withinTimeLimit: boolean): DetectionMetrics {
  const metrics = calculateDetectionMetrics(difficulty, elapsedSeconds, attempts, maxCombo);
  if (withinTimeLimit) return metrics;
  const detectionPower = Math.round(metrics.memoryEfficiency * DETECTION_POWER_WEIGHTS.memory + metrics.comboScore * DETECTION_POWER_WEIGHTS.combo);
  return { ...metrics, speedScore: 0, detectionPower: clampPercent(detectionPower) };
}

export function getGameRank(detectionPower: number): GameRank {
  if (detectionPower >= RANK_THRESHOLDS.S) return "S";
  if (detectionPower >= RANK_THRESHOLDS.A) return "A";
  if (detectionPower >= RANK_THRESHOLDS.B) return "B";
  return "C";
}

export function formatElapsedTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function resolveDaruCardImage(card: GameCard, theme: DaruGameTheme) {
  return card.themeImages[theme];
}
