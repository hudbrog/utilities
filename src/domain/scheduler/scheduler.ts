import type { DirectionState, MasteryStage } from "./model";
import { intervalDaysByStage } from "./model";
import type { StudyCalendar } from "./studyCalendar";

export type ReviewOutcome = "success" | "failure";

export function applyReviewOutcome(
  state: DirectionState,
  outcome: ReviewOutcome,
  now: number,
  calendar: StudyCalendar,
): DirectionState {
  if (outcome === "success") {
    const stage = Math.min(7, state.stage + 1) as MasteryStage;
    return {
      ...state,
      introduced: true,
      stage,
      nextDueAt: calendar.addStudyDays(now, intervalDaysByStage[stage]),
      recentFailureCount: 0,
      updatedAt: now,
    };
  }

  const stage = (state.stage === 0 ? 1 : Math.max(1, state.stage - 2)) as MasteryStage;
  return {
    ...state,
    introduced: true,
    stage,
    nextDueAt: calendar.addStudyDays(now, 1),
    recentFailureCount: state.recentFailureCount + 1,
    lifetimeFailureCount: state.lifetimeFailureCount + 1,
    updatedAt: now,
  };
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
