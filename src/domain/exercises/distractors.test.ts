import { describe, expect, it } from "vitest";

import { concepts, units } from "../testFixtures";
import { buildMultipleChoiceOptions, DistractorGenerationError } from "./distractors";

describe("distractor generation", () => {
  it("creates a stable four-option set with one correct answer", () => {
    const input = {
      target: concepts[0],
      direction: "en-ru" as const,
      concepts,
      units,
      introducedConceptIds: new Set(concepts.slice(0, 4).map(({ id }) => id)),
      seed: "session-1",
    };
    const first = buildMultipleChoiceOptions(input);
    expect(buildMultipleChoiceOptions(input)).toEqual(first);
    expect(first).toHaveLength(4);
    expect(first.filter(({ correct }) => correct)).toHaveLength(1);
    expect(first.filter(({ correct }) => !correct).every(({ conceptId }) => conceptId !== "house")).toBe(true);
  });

  it("expands to unintroduced concepts when the introduced pool is too small", () => {
    const options = buildMultipleChoiceOptions({
      target: concepts[0], direction: "ru-en", concepts, units,
      introducedConceptIds: new Set(["cat", "dog"]), seed: "expand",
    });
    expect(options).toHaveLength(4);
  });

  it("fails diagnostically instead of emitting an undersized question", () => {
    expect(() => buildMultipleChoiceOptions({
      target: concepts[0], direction: "ru-en", concepts: concepts.slice(0, 3), units,
      introducedConceptIds: new Set(), seed: "small",
    })).toThrow(DistractorGenerationError);
  });
});
