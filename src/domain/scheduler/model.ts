import type { Direction } from "../curriculum/model";

export type MasteryStage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type DirectionState = {
  key: string;
  conceptId: string;
  direction: Direction;
  introduced: boolean;
  stage: MasteryStage;
  nextDueAt: number;
  successfulSpokenRecall: boolean;
  recentFailureCount: number;
  lifetimeFailureCount: number;
  sttApparentFailureCount: number;
  sttMcConfirmationCount: number;
  sttProblematic: boolean;
  updatedAt: number;
};

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
