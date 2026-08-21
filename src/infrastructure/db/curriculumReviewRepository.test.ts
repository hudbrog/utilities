import "fake-indexeddb/auto";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { approveReviewUnit, loadReviewUnits, saveReviewDecision } from "./curriculumReviewRepository";
import { EnglishSrsDatabase } from "./database";

const proposals = [
  { conceptId: "cat", proposalFingerprint: "cat-v1", unitId: "unit-1", order: 0, en: "cat", ru: "кот", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals", unsuitableReason: null, initialReviewStatus: "approved", generationConfidence: "high", reviewConfidence: "high", reviewDecision: "accept", reviewNotes: null },
  { conceptId: "dog", proposalFingerprint: "dog-v1", unitId: "unit-1", order: 1, en: "dog", ru: "собака", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals", unsuitableReason: null, initialReviewStatus: "needs_human_review", generationConfidence: "medium", reviewConfidence: "medium", reviewDecision: "human_review", reviewNotes: "Check the sense" },
];
const reviewPackage = {
  schemaVersion: 1, curriculumId: "duolingo-ru-en", curriculumVersion: "review-1", sourceFingerprint: "source-1",
  generatedAt: "2026-08-21T12:00:00.000Z", units: [{ id: "unit-1", number: 1, titleRu: "Основы", conceptIds: ["cat", "dog"], reviewFingerprint: "unit-review-1" }], proposals,
};

let db: EnglishSrsDatabase;

beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(reviewPackage), { status: 200 })));
});

beforeEach(() => { db = new EnglishSrsDatabase(`review-${crypto.randomUUID()}`); });
afterEach(async () => { await db.delete(); });

describe("incremental curriculum review", () => {
  it("does not activate a unit while a word remains unresolved", async () => {
    expect((await loadReviewUnits(db))[0].unresolvedCount).toBe(1);
    await expect(approveReviewUnit(db, "unit-1", 10)).rejects.toThrow("Осталось проверить слов: 1");
    expect(await db.units.count()).toBe(0);
    expect(await db.concepts.count()).toBe(0);
  });

  it("promotes only the resolved unit into the active curriculum", async () => {
    await db.conceptProgress.put({ conceptId: "dog", introducedAt: 1, introducedFromUnitId: "unit-1", skipped: false, retired: true });
    await saveReviewDecision(db, "dog", "edited", { ru: "пёс", acceptedEn: [], acceptedRu: ["собака"] }, 5);
    await approveReviewUnit(db, "unit-1", 10);
    expect(await db.units.get("unit-1")).toMatchObject({ conceptIds: ["cat", "dog"], state: "inactive" });
    expect(await db.concepts.get("dog")).toMatchObject({ ru: "пёс", acceptedRu: ["собака"], retired: false });
    expect(await db.conceptProgress.get("dog")).toMatchObject({ introducedAt: 1, retired: false });
    expect((await loadReviewUnits(db))[0]).toMatchObject({ unresolvedCount: 0, approvedAt: 10 });
  });
});
