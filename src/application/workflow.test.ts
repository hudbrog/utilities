import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { db } from "../infrastructure/db/database";
import { approveReviewUnit, loadReviewUnits, saveReviewDecision } from "../infrastructure/db/curriculumReviewRepository";
import { setIntroducingUnit } from "../infrastructure/db/curriculumRepository";
import { loadStudy, scoreAnswer, goToNextQuestion } from "./studyService";
import { exportLearnerBackup, importLearnerBackup } from "./parentService";

const fixture = vi.hoisted(() => ({
  schemaVersion: 1, curriculumId: "duolingo-ru-en", curriculumVersion: "review-1", sourceFingerprint: "source-1",
  generatedAt: "2026-09-04T12:00:00.000Z",
  units: [{ id: "unit-1", number: 1, titleRu: "Animals", conceptIds: ["cat", "dog"], reviewFingerprint: "unit-v1" }],
  proposals: ["cat", "dog"].map((id, order) => ({
    conceptId: id, proposalFingerprint: `${id}-v1`, unitId: "unit-1", order, en: id,
    ru: id === "cat" ? "кот" : "собака", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun",
    semanticCategory: "animals", unsuitableReason: null, initialReviewStatus: "approved",
    generationConfidence: "high", reviewConfidence: "high", reviewDecision: "accept", reviewNotes: null,
  })),
}));
vi.mock("../infrastructure/curriculum/reviewPackage", () => ({ loadCurriculumReviewPackage: async () => structuredClone(fixture) }));
const now = new Date(2026, 8, 4, 12).getTime();

beforeEach(async () => {
  vi.stubGlobal("window", {});
  fixture.units[0].reviewFingerprint = "unit-v1";
  await db.open();
});
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); vi.unstubAllGlobals(); });

async function start(singleWord = false) {
  if (singleWord) await saveReviewDecision(db, "dog", "excluded", undefined, now);
  await approveReviewUnit(db, "unit-1", now);
  await setIntroducingUnit(db, "unit-1");
  return loadStudy(now);
}

test.each([false, true])("restore recovers both unanswered directions, fresh database: %s", async (fresh) => {
  await start(true);
  const backup = await exportLearnerBackup("test");
  if (fresh) { await db.delete(); await db.open(); }
  await importLearnerBackup(backup);
  const restored = await loadStudy(now + 1);
  expect(restored.questions.map((q) => q.direction).sort()).toEqual(["en-ru", "ru-en"]);
  expect(restored.questions.every((q) => q.conceptId === "cat")).toBe(true);
  const next = await goToNextQuestion(await scoreAnswer(restored, true, {}, now + 2), now + 3);
  expect(next.current?.direction).not.toBe(restored.current?.direction);
  expect((await db.dailyLedgers.toArray())[0].quotaConsumed).toBe(1);
});

test("restore preserves the answered direction's schedule while recovering its unseen reverse", async () => {
  const original = await start(true);
  await scoreAnswer(original, true, {}, now + 1);
  const before = await db.directionStates.get("cat:en-ru");
  await importLearnerBackup(await exportLearnerBackup("test"));
  const restored = await loadStudy(now + 2);
  expect(restored.current).toMatchObject({ conceptId: "cat", direction: "ru-en" });
  expect(await db.directionStates.get("cat:en-ru")).toEqual(before);
  expect(await db.attempts.count()).toBe(1);
});

test("excluded words cannot be scored from an old snapshot or resumed from the queue", async () => {
  const original = await start();
  await saveReviewDecision(db, "cat", "excluded", undefined, now + 1);
  await expect(scoreAnswer(original, true, {}, now + 2)).rejects.toThrow("no longer approved");
  expect(await db.attempts.count()).toBe(0);
  const resumed = await loadStudy(now + 3);
  expect(resumed.current?.conceptId).toBe("dog");
  expect(resumed.questions.map((q) => q.conceptId)).toEqual(["dog", "dog"]);
  expect(resumed.questions.map((q) => q.position)).toEqual([0, 1]);
  const scored = await scoreAnswer(resumed, false, {}, now + 4);
  expect(scored.questions.map((q) => q.position)).toEqual([0, 1, 2]);
  expect((await goToNextQuestion(scored, now + 5)).current?.conceptId).toBe("dog");
});

test("a changed unit fingerprint invalidates all unfinished questions", async () => {
  const original = await start();
  fixture.units[0].reviewFingerprint = "unit-v2";
  const resumed = await loadStudy(now + 1);
  expect((await loadReviewUnits(db))[0].approvedAt).toBeNull();
  expect(resumed.current).toBeNull();
  expect((await db.sessions.get(original.session.id))?.status).toBe("completed");
  expect(await db.sessionQuestions.count()).toBe(0);
});

test("saving an edited exclusion installs the word and reopens a completed unit", async () => {
  await start(true);
  expect((await db.units.get("unit-1"))?.state).toBe("fully_introduced");
  await saveReviewDecision(db, "dog", "edited", { ru: "пёс", acceptedEn: [], acceptedRu: ["собака"] }, now + 1);
  expect((await loadReviewUnits(db))[0].approvedAt).not.toBeNull();
  expect(await db.concepts.get("dog")).toMatchObject({ ru: "пёс", acceptedRu: ["собака"], retired: false });
  expect(await db.units.get("unit-1")).toMatchObject({ conceptIds: ["cat", "dog"], state: "inactive" });
});

test("restoring an approved unit whose words were all excluded succeeds", async () => {
  await start();
  await saveReviewDecision(db, "cat", "excluded", undefined, now + 1);
  await saveReviewDecision(db, "dog", "excluded", undefined, now + 1);
  const backup = await exportLearnerBackup("test");
  await db.delete(); await db.open();
  await importLearnerBackup(backup);
  expect(await db.units.get("unit-1")).toMatchObject({ conceptIds: [], state: "inactive" });
  expect((await loadStudy(now + 2)).current).toBeNull();
});

test("a reconstruction write failure rolls back the entire restore", async () => {
  await start();
  const backup = await exportLearnerBackup("test");
  await db.answerOverrides.put({ conceptId: "local-only", acceptedEn: [], acceptedRu: [], updatedAt: now });
  const before = await Promise.all(db.tables.map((table) => table.toArray()));
  vi.spyOn(db.appMeta, "put").mockRejectedValueOnce(new Error("write-failed"));
  await expect(importLearnerBackup(backup)).rejects.toThrow("write-failed");
  expect(await Promise.all(db.tables.map((table) => table.toArray()))).toEqual(before);
});

test("unresolved backup approvals fail before any writes", async () => {
  await start();
  const backup = await exportLearnerBackup("test");
  backup.payload.curriculumReviewDecisions.push({ conceptId: "cat", proposalFingerprint: "cat-v1", status: "deferred", ru: "кот", acceptedEn: [], acceptedRu: [], updatedAt: now });
  const before = await Promise.all(db.tables.map((table) => table.toArray()));
  await expect(importLearnerBackup(backup)).rejects.toThrow("Осталось проверить слов");
  expect(await Promise.all(db.tables.map((table) => table.toArray()))).toEqual(before);
});
