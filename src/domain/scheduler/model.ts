import type { Direction } from "../curriculum/model";

export type MasteryStage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SchedulerKind = "legacy-stage" | "fsrs-6";
export type MemoryState = "new" | "learning" | "review" | "relearning";
export type FsrsRating = "again" | "hard" | "good";
export type ReviewCompletionMode = "multiple-choice" | "speech";

export type DirectionState = {
  key: string;
  conceptId: string;
  direction: Direction;
  introduced: boolean;
  /** Derived presentation band. It is never used to calculate the next interval. */
  stage: MasteryStage;
  scheduler: SchedulerKind;
  memoryState: MemoryState;
  stability: number | null;
  difficulty: number | null;
  lastReviewAt: number | null;
  scheduledDays: number;
  reps: number;
  lapses: number;
  successfulReviewCount: number;
  nextDueAt: number | null;
  successfulSpokenRecall: boolean;
  recentFailureCount: number;
  lifetimeFailureCount: number;
  sttApparentFailureCount: number;
  sttMcConfirmationCount: number;
  sttProblematic: boolean;
  updatedAt: number;
};

/** Only used to bootstrap legacy records when their review log is unavailable. */
export const intervalDaysByStage: Readonly<Record<MasteryStage, number>> = {
  0: 0,
  1: 1,
  2: 3,
  3: 7,
  4: 14,
  5: 30,
  6: 60,
  7: 120,
};
