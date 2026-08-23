import { nextIntervalDays, nextMemory, retrievability } from "./fsrs";
import type { DirectionState, FsrsRating, MasteryStage, ReviewCompletionMode } from "./model";
import { intervalDaysByStage } from "./model";
import type { StudyCalendar } from "./studyCalendar";

export type HistoricalReview = {
  occurredAt: number;
  rating: FsrsRating;
};

const DAY_MS = 86_400_000;

export function ratingForPerformance(
  correct: boolean,
  completionMode: ReviewCompletionMode,
  speechAttemptCount: number,
): FsrsRating {
  if (!correct) return "again";
  if (completionMode === "speech" && speechAttemptCount <= 1) return "good";
  return "hard";
}

export function createDirectionState(
  conceptId: string,
  direction: DirectionState["direction"],
  now: number,
): DirectionState {
  return {
    key: `${conceptId}:${direction}`,
    conceptId,
    direction,
    introduced: true,
    stage: 0,
    scheduler: "fsrs-6",
    memoryState: "new",
    stability: null,
    difficulty: null,
    lastReviewAt: null,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    successfulReviewCount: 0,
    nextDueAt: null,
    successfulSpokenRecall: false,
    recentFailureCount: 0,
    lifetimeFailureCount: 0,
    sttApparentFailureCount: 0,
    sttMcConfirmationCount: 0,
    sttProblematic: false,
    updatedAt: now,
  };
}

/** Upgrades a persisted pre-FSRS row without changing its current due date. */
export function normalizeDirectionState(state: DirectionState): DirectionState {
  const stored = state as DirectionState & Partial<DirectionState>;
  if (stored.scheduler) return stored;
  return {
    ...stored,
    scheduler: "legacy-stage",
    memoryState: stored.stage > 0 ? "review" : "new",
    stability: null,
    difficulty: null,
    lastReviewAt: null,
    scheduledDays: intervalDaysByStage[stored.stage] ?? 0,
    reps: 0,
    lapses: stored.lifetimeFailureCount,
    successfulReviewCount: stored.stage,
  };
}

function localDayNumber(timestamp: number, calendar: StudyCalendar): number {
  const [year, month, day] = calendar.dateKey(timestamp).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function elapsedStudyDays(lastReviewAt: number | null, now: number, calendar: StudyCalendar): number {
  return lastReviewAt === null ? 0 : Math.max(0, localDayNumber(now, calendar) - localDayNumber(lastReviewAt, calendar));
}

export function deriveMasteryStage(state: Pick<DirectionState, "successfulReviewCount" | "stability">): MasteryStage {
  if (state.successfulReviewCount === 0 || state.stability === null) return 0;
  if (state.successfulReviewCount === 1 || state.stability < 1.5) return 1;
  if (state.stability < 4) return 2;
  if (state.stability < 8) return 3;
  if (state.stability < 16) return 4;
  if (state.stability < 32) return 5;
  if (state.stability < 64) return 6;
  return 7;
}

export function retrievabilityAt(
  state: DirectionState,
  now: number,
  calendar: StudyCalendar,
): number | null {
  const normalized = normalizeDirectionState(state);
  if (normalized.stability === null || normalized.lastReviewAt === null) return null;
  return retrievability(elapsedStudyDays(normalized.lastReviewAt, now, calendar), normalized.stability);
}

function applyMemoryReview(
  state: DirectionState,
  rating: FsrsRating,
  now: number,
  calendar: StudyCalendar,
): DirectionState {
  const current = state.stability === null || state.difficulty === null
    ? null
    : { stability: state.stability, difficulty: state.difficulty };
  const memory = nextMemory(current, elapsedStudyDays(state.lastReviewAt, now, calendar), rating);
  const scheduledDays = nextIntervalDays(memory.stability);
  const successfulReviewCount = state.successfulReviewCount + (rating === "again" ? 0 : 1);
  const next = {
    ...state,
    introduced: true,
    scheduler: "fsrs-6" as const,
    memoryState: rating === "again"
      ? (state.memoryState === "new" ? "learning" as const : "relearning" as const)
      : "review" as const,
    stability: memory.stability,
    difficulty: memory.difficulty,
    lastReviewAt: now,
    scheduledDays,
    reps: state.reps + 1,
    lapses: state.lapses + (rating === "again" ? 1 : 0),
    successfulReviewCount,
    nextDueAt: calendar.addStudyDays(now, scheduledDays),
    recentFailureCount: rating === "again" ? state.recentFailureCount + 1 : 0,
    lifetimeFailureCount: state.lifetimeFailureCount + (rating === "again" ? 1 : 0),
    updatedAt: now,
  };
  return { ...next, stage: deriveMasteryStage(next) };
}

export function migrateLegacyState(
  input: DirectionState,
  history: readonly HistoricalReview[],
  calendar: StudyCalendar,
): DirectionState {
  const original = normalizeDirectionState(input);
  if (original.scheduler === "fsrs-6") return original;

  let migrated = createDirectionState(original.conceptId, original.direction, original.updatedAt);
  const ordered = [...history].sort((left, right) => left.occurredAt - right.occurredAt);
  if (ordered.length > 0) {
    for (const review of ordered) {
      migrated = applyMemoryReview(migrated, review.rating, review.occurredAt, calendar);
    }
  } else if (original.stage > 0) {
    const stability = Math.max(0.212, intervalDaysByStage[original.stage]);
    migrated = {
      ...migrated,
      memoryState: "review",
      stability,
      difficulty: 5,
      lastReviewAt: original.updatedAt,
      scheduledDays: intervalDaysByStage[original.stage],
      reps: original.stage,
      successfulReviewCount: original.stage,
      stage: original.stage,
    };
  }

  return {
    ...migrated,
    nextDueAt: original.nextDueAt,
    successfulSpokenRecall: original.successfulSpokenRecall,
    recentFailureCount: original.recentFailureCount,
    lifetimeFailureCount: original.lifetimeFailureCount,
    lapses: Math.max(migrated.lapses, original.lifetimeFailureCount),
    sttApparentFailureCount: original.sttApparentFailureCount,
    sttMcConfirmationCount: original.sttMcConfirmationCount,
    sttProblematic: original.sttProblematic,
    updatedAt: original.updatedAt,
  };
}

export function applyReviewRating(
  state: DirectionState,
  rating: FsrsRating,
  now: number,
  calendar: StudyCalendar,
): DirectionState {
  return applyMemoryReview(normalizeDirectionState(state), rating, now, calendar);
}

export function markSuccessfulSpokenRecall(state: DirectionState, now: number): DirectionState {
  return { ...state, successfulSpokenRecall: true, updatedAt: now };
}

export function recordSttApparentFailure(state: DirectionState, now: number): DirectionState {
  return deriveSttFlag({
    ...state,
    sttApparentFailureCount: state.sttApparentFailureCount + 1,
    updatedAt: now,
  });
}

export function recordSttMcConfirmation(state: DirectionState, now: number): DirectionState {
  return deriveSttFlag({
    ...state,
    sttMcConfirmationCount: state.sttMcConfirmationCount + 1,
    updatedAt: now,
  });
}

export function resetSttProblemHistory(state: DirectionState, now: number): DirectionState {
  return {
    ...state,
    sttApparentFailureCount: 0,
    sttMcConfirmationCount: 0,
    sttProblematic: false,
    updatedAt: now,
  };
}

function deriveSttFlag(state: DirectionState): DirectionState {
  return {
    ...state,
    sttProblematic: state.sttApparentFailureCount >= 3 && state.sttMcConfirmationCount >= 2,
  };
}
