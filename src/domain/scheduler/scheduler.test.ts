import { describe, expect, it } from "vitest";

import { makeState } from "../testFixtures";
import {
  applyReviewRating,
  migrateLegacyState,
  recordSttApparentFailure,
  recordSttMcConfirmation,
  ratingForPerformance,
  resetSttProblemHistory,
  retrievabilityAt,
} from "./scheduler";
import type { StudyCalendar } from "./studyCalendar";

const day = 86_400_000;
const calendar: StudyCalendar = {
  startOfStudyDay: (timestamp) => timestamp,
  addStudyDays: (timestamp, days) => timestamp + days * day,
  dateKey: (timestamp) => new Date(timestamp).toISOString().slice(0, 10),
};

describe("FSRS scheduler", () => {
  it("derives ratings automatically without asking the child to self-grade", () => {
    expect(ratingForPerformance(false, "multiple-choice", 0)).toBe("again");
    expect(ratingForPerformance(true, "multiple-choice", 0)).toBe("hard");
    expect(ratingForPerformance(true, "speech", 1)).toBe("good");
    expect(ratingForPerformance(true, "speech", 2)).toBe("hard");
  });

  it("maps an initial multiple-choice pass to Hard and schedules one day", () => {
    const result = applyReviewRating(makeState(), "hard", 0, calendar);
    expect(result).toMatchObject({
      scheduler: "fsrs-6",
      memoryState: "review",
      stability: 1.2931,
      scheduledDays: 1,
      nextDueAt: day,
      reps: 1,
      successfulReviewCount: 1,
    });
  });

  it("gives first-attempt spoken recall a longer Good interval", () => {
    const result = applyReviewRating(makeState(), "good", 0, calendar);
    expect(result.stability).toBe(2.3065);
    expect(result.scheduledDays).toBe(2);
  });

  it("uses elapsed time and memory strength instead of a fixed stage table", () => {
    const first = applyReviewRating(makeState(), "good", 0, calendar);
    const onTime = applyReviewRating(first, "good", 2 * day, calendar);
    const late = applyReviewRating(first, "good", 10 * day, calendar);
    expect(late.stability!).toBeGreaterThan(onTime.stability!);
    expect(late.scheduledDays).toBeGreaterThan(onTime.scheduledDays);
    expect(retrievabilityAt(first, 10 * day, calendar)!).toBeLessThan(retrievabilityAt(first, 2 * day, calendar)!);
  });

  it("treats a miss as Again and tracks a lapse", () => {
    const learned = applyReviewRating(makeState(), "good", 0, calendar);
    const result = applyReviewRating(learned, "again", 2 * day, calendar);
    expect(result.memoryState).toBe("relearning");
    expect(result.lapses).toBe(1);
    expect(result.lifetimeFailureCount).toBe(1);
    expect(result.scheduledDays).toBe(1);
  });

  it("replays legacy history lazily without changing the existing due date", () => {
    const legacy = {
      ...makeState("cat", "ru-en", 4, { nextDueAt: 99 * day }),
      scheduler: "legacy-stage" as const,
      stability: null,
      difficulty: null,
      lastReviewAt: null,
    };
    const migrated = migrateLegacyState(legacy, [
      { occurredAt: 0, rating: "hard" },
      { occurredAt: day, rating: "good" },
    ], calendar);
    expect(migrated.scheduler).toBe("fsrs-6");
    expect(migrated.reps).toBe(2);
    expect(migrated.stability).not.toBeNull();
    expect(migrated.nextDueAt).toBe(99 * day);
  });

  it("flags STT only after both evidence thresholds and can reset just that history", () => {
    let state = makeState();
    for (let index = 0; index < 3; index += 1) state = recordSttApparentFailure(state, index);
    state = recordSttMcConfirmation(state, 4);
    expect(state.sttProblematic).toBe(false);
    state = recordSttMcConfirmation(state, 5);
    expect(state.sttProblematic).toBe(true);
    expect(resetSttProblemHistory({ ...state, lifetimeFailureCount: 9 }, 6)).toMatchObject({
      sttProblematic: false,
      sttApparentFailureCount: 0,
      sttMcConfirmationCount: 0,
      lifetimeFailureCount: 9,
    });
  });
});
