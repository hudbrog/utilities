import { describe, expect, it } from "vitest";

import { makeState } from "../testFixtures";
import { applyReviewOutcome, recordSttApparentFailure, recordSttMcConfirmation, resetSttProblemHistory } from "./scheduler";
import type { StudyCalendar } from "./studyCalendar";

const day = 86_400_000;
const calendar: StudyCalendar = {
  startOfStudyDay: (timestamp) => timestamp,
  addStudyDays: (timestamp, days) => timestamp + days * day,
  dateKey: () => "test",
};

describe("scheduler", () => {
  it("promotes stage zero to stage one and schedules tomorrow on success", () => {
    const result = applyReviewOutcome(makeState(), "success", 1_000, calendar);
    expect(result.stage).toBe(1);
    expect(result.nextDueAt).toBe(1_000 + day);
  });

  it("uses the interval of the new stage", () => {
    expect(applyReviewOutcome(makeState("cat", "ru-en", 4), "success", 0, calendar).nextDueAt).toBe(30 * day);
    expect(applyReviewOutcome(makeState("cat", "ru-en", 7), "success", 0, calendar).nextDueAt).toBe(120 * day);
  });

  it("drops two stages on failure but never below one", () => {
    expect(applyReviewOutcome(makeState("cat", "ru-en", 6), "failure", 0, calendar).stage).toBe(4);
    expect(applyReviewOutcome(makeState("cat", "ru-en", 0), "failure", 0, calendar).stage).toBe(1);
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
