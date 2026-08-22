import "fake-indexeddb/auto";

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { approveReviewUnit, loadDistractorCurriculum, loadReviewUnits, saveReviewDecision } from "./curriculumReviewRepository";
import { EnglishSrsDatabase } from "./database";

const proposals = [
  { conceptId: "cat", proposalFingerprint: "cat-v1", unitId: "unit-1", order: 0, en: "cat", ru: "кот", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals", unsuitableReason: null, initialReviewStatus: "approved", generationConfidence: "high", reviewConfidence: "high", reviewDecision: "accept", reviewNotes: null },
  { conceptId: "dog", proposalFingerprint: "dog-v1", unitId: "unit-1", order: 1, en: "dog", ru: "собака", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals", unsuitableReason: null, initialReviewStatus: "needs_human_review", generationConfidence: "medium", reviewConfidence: "medium", reviewDecision: "human_review", reviewNotes: "Check the sense" },
  { conceptId: "bird", proposalFingerprint: "bird-v1", unitId: "unit-2", order: 0, en: "bird", ru: "птица", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals", unsuitableReason: null, initialReviewStatus: "auto_reviewed", generationConfidence: "high", reviewConfidence: "high", reviewDecision: "accept", reviewNotes: null },
  { conceptId: "fish", proposalFingerprint: "fish-v1", unitId: "unit-2", order: 1, en: "fish", ru: "рыба", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals", unsuitableReason: null, initialReviewStatus: "needs_human_review", generationConfidence: "medium", reviewConfidence: "medium", reviewDecision: "human_review", reviewNotes: null },
  { conceptId: "cow", proposalFingerprint: "cow-v1", unitId: "unit-2", order: 2, en: "cow", ru: "корова", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals", unsuitableReason: null, initialReviewStatus: "auto_reviewed", generationConfidence: "high", reviewConfidence: "high", reviewDecision: "accept", reviewNotes: null },
];
const reviewPackage = {
  schemaVersion: 1, curriculumId: "duolingo-ru-en", curriculumVersion: "review-1", sourceFingerprint: "source-1",
  generatedAt: "2026-08-21T12:00:00.000Z", units: [
    { id: "unit-1", number: 1, titleRu: "Основы", conceptIds: ["cat", "dog"], reviewFingerprint: "unit-review-1" },
    { id: "unit-2", number: 2, titleRu: "Животные", conceptIds: ["bird", "fish", "cow"], reviewFingerprint: "unit-review-2" },
  ], proposals,
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

  it("exposes unapproved units only through the distractor pool", async () => {
    await saveReviewDecision(db, "dog", "approved", undefined, 5);
    await approveReviewUnit(db, "unit-1", 10);

    const curriculum = await loadDistractorCurriculum(db);
    expect(await db.concepts.toCollection().primaryKeys()).toEqual(["cat", "dog"]);
    expect(curriculum.concepts.map(({ id }) => id)).toEqual(["cat", "dog", "bird", "fish", "cow"]);
    expect(await db.units.toCollection().primaryKeys()).toEqual(["unit-1"]);
    expect(curriculum.units.map(({ id }) => id)).toEqual(["unit-1", "unit-2"]);
  });
});
