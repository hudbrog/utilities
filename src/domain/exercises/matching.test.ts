import { describe, expect, it } from "vitest";

import { concepts } from "../testFixtures";
import { isAcceptedAnswer } from "./matching";
import { normalizeAnswer } from "./normalization";

describe("answer normalization and matching", () => {
  it("normalizes case, punctuation, whitespace, and Russian ё", () => {
    expect(normalizeAnswer("  ЁЖ,  ДОМА! ", "ru")).toBe("еж дома");
    expect(normalizeAnswer("  The—CAT! ", "en")).toBe("the cat");
  });

  it("accepts canonical and explicitly accepted answers only", () => {
    expect(isAcceptedAnswer("КОТ!", concepts[0], "en-ru")).toBe(true);
    expect(isAcceptedAnswer("кошка", concepts[0], "en-ru")).toBe(true);
    expect(isAcceptedAnswer("котик", concepts[0], "en-ru")).toBe(false);
  });
});
