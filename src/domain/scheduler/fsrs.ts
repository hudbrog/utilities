import type { FsrsRating } from "./model";

// Adapted from ts-fsrs v5.4.1 (FSRS-6), MIT licensed.
// https://github.com/open-spaced-repetition/ts-fsrs/tree/v5.4.1
export const FSRS_PARAMETERS = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194,
  0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629,
  1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);

export const DESIRED_RETENTION = 0.9;
export const MAXIMUM_INTERVAL_DAYS = 365;
const MINIMUM_STABILITY = 0.001;

type Memory = { stability: number; difficulty: number };

function ratingNumber(rating: FsrsRating): 1 | 2 | 3 {
  if (rating === "again") return 1;
  if (rating === "hard") return 2;
  return 3;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function round(value: number): number {
  return Number(value.toFixed(8));
}

function decayAndFactor(): { decay: number; factor: number } {
  const decay = -FSRS_PARAMETERS[20];
  return {
    decay,
    factor: round(Math.exp(Math.log(0.9) / decay) - 1),
  };
}

export function retrievability(elapsedDays: number, stability: number): number {
  const { decay, factor } = decayAndFactor();
  return round(Math.pow(1 + (factor * Math.max(0, elapsedDays)) / stability, decay));
}

function initialDifficulty(grade: number): number {
  return clamp(round(FSRS_PARAMETERS[4] - Math.exp((grade - 1) * FSRS_PARAMETERS[5]) + 1), 1, 10);
}

function nextDifficulty(difficulty: number, grade: number): number {
  const delta = -FSRS_PARAMETERS[6] * (grade - 3);
  const damped = round((delta * (10 - difficulty)) / 9);
  const next = difficulty + damped;
  const reverted = round(
    FSRS_PARAMETERS[7] * initialDifficulty(4) + (1 - FSRS_PARAMETERS[7]) * next,
  );
  return clamp(reverted, 1, 10);
}

function nextRecallStability(memory: Memory, recall: number, grade: number): number {
  const w = FSRS_PARAMETERS;
  const hardPenalty = grade === 2 ? w[15] : 1;
  return round(clamp(
    memory.stability * (
      1 + Math.exp(w[8]) * (11 - memory.difficulty) * Math.pow(memory.stability, -w[9]) *
      (Math.exp((1 - recall) * w[10]) - 1) * hardPenalty
    ),
    MINIMUM_STABILITY,
    36_500,
  ));
}

function nextForgetStability(memory: Memory, recall: number): number {
  const w = FSRS_PARAMETERS;
  const afterFailure = round(clamp(
    w[11] * Math.pow(memory.difficulty, -w[12]) *
      (Math.pow(memory.stability + 1, w[13]) - 1) * Math.exp((1 - recall) * w[14]),
    MINIMUM_STABILITY,
    36_500,
  ));
  // Short-term learning is handled by the app's remediation queue.
  return Math.min(memory.stability, afterFailure);
}

export function nextMemory(
  current: Memory | null,
  elapsedDays: number,
  rating: FsrsRating,
): Memory {
  const grade = ratingNumber(rating);
  if (!current) {
    return {
      stability: Math.max(FSRS_PARAMETERS[grade - 1], 0.1),
      difficulty: initialDifficulty(grade),
    };
  }
  const recall = retrievability(elapsedDays, current.stability);
  return {
    stability: rating === "again"
      ? nextForgetStability(current, recall)
      : nextRecallStability(current, recall, grade),
    difficulty: nextDifficulty(current.difficulty, grade),
  };
}

export function nextIntervalDays(stability: number): number {
  const { decay, factor } = decayAndFactor();
  const modifier = (Math.pow(DESIRED_RETENTION, 1 / decay) - 1) / factor;
  return Math.min(MAXIMUM_INTERVAL_DAYS, Math.max(1, Math.round(stability * modifier)));
}
