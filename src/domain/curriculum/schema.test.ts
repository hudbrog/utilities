import { describe, expect, it } from "vitest";

import { concepts, units } from "../testFixtures";
import { curriculumBundleSchema } from "./schema";

const validBundle = {
  schemaVersion: 1 as const,
  curriculumId: "duolingo-ru-en" as const,
  curriculumVersion: "test-1",
  sourceFingerprint: "sha256:test",
  units,
  concepts,
};

describe("curriculumBundleSchema", () => {
  it("accepts a referentially consistent bundle", () => {
    expect(curriculumBundleSchema.parse(validBundle)).toEqual(validBundle);
  });

  it("rejects a concept missing from its unit ordering", () => {
    const result = curriculumBundleSchema.safeParse({
      ...validBundle,
      units: [{ ...units[0], conceptIds: units[0].conceptIds.slice(1) }, units[1]],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate identifiers and cross-unit references", () => {
    const result = curriculumBundleSchema.safeParse({
      ...validBundle,
      concepts: [...concepts, { ...concepts[0], unitId: "unit-2" }],
    });
    expect(result.success).toBe(false);
  });
});
