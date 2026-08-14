import { describe, expect, it } from "vitest";

import { makeState } from "../testFixtures";
import { selectExerciseType } from "./policy";

describe("exercise policy", () => {
  const full = { speechRecognitionAvailable: true, listeningAudioUnlocked: true };

  it("uses multiple choice for early stages", () => {
    expect(selectExerciseType(makeState("cat", "ru-en", 1), full, "x")).toBe("mc_text");
  });

  it("uses speech recall at middle stages and falls back when STT is unavailable", () => {
    expect(selectExerciseType(makeState("cat", "ru-en", 3), full, "x")).toBe("stt_text");
    expect(selectExerciseType(makeState("cat", "ru-en", 3), { ...full, speechRecognitionAvailable: false }, "x")).toBe("mc_text");
  });

  it("keeps mature items text-only until listening is unlocked", () => {
    expect(selectExerciseType(makeState("cat", "ru-en", 6), { ...full, listeningAudioUnlocked: false }, "x")).toBe("stt_text");
  });

  it("is deterministic and never assigns STT to a problematic item", () => {
    const state = makeState("cat", "ru-en", 6, { sttProblematic: true });
    const first = selectExerciseType(state, full, "stable-seed");
    expect(selectExerciseType(state, full, "stable-seed")).toBe(first);
    expect(first.startsWith("mc_")).toBe(true);
  });
});
