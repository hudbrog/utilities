import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { concepts, units } from "../domain/testFixtures";
import { db } from "../infrastructure/db/database";
import { loadStudy, requestWordChoices, scoreAnswer } from "./studyService";

vi.mock("../infrastructure/curriculum/reviewPackage", () => ({
  loadCurriculumReviewPackage: async () => ({ units: [], curriculumVersion: "test" }),
}));

afterEach(() => db.delete());

test.each([
  { exerciseType: "stt_audio", direction: "en-ru", choices: "mc_audio", correct: true, rating: "hard" },
  { exerciseType: "stt_text", direction: "ru-en", choices: "mc_text", correct: false, rating: "again" },
] as const)("requested choices survive reopening and grade $rating for $exerciseType", async (example) => {
  await db.open();
  await db.concepts.add({ ...concepts[0], retired: false });
  await db.units.add({ ...units[0], state: "inactive" });
  await db.sessions.add({ id: "session", status: "active", seed: "test", createdAt: 1, updatedAt: 1 });
  await db.sessionQuestions.add({
    id: "question", sessionId: "session", position: 0, kind: "review", status: "pending",
    exerciseType: example.exerciseType, direction: example.direction, conceptId: "cat",
  });
  const before = await loadStudy();
  await requestWordChoices("question");
  await expect(scoreAnswer(before, true, { completionMode: "speech" })).rejects.toThrow("Способ ответа изменился");
  expect(await db.attempts.count()).toBe(0);

  db.close();
  await db.open();
  const resumed = await loadStudy();
  expect(resumed.current).toMatchObject({ id: "question", exerciseType: example.choices, status: "current" });
  await scoreAnswer(resumed, example.correct, { completionMode: "multiple-choice" });
  expect(await db.attempts.toArray()).toMatchObject([{ rating: example.rating, completionMode: "multiple-choice" }]);
  expect(await db.directionStates.get("cat:" + example.direction)).toMatchObject({
    successfulSpokenRecall: false, sttApparentFailureCount: 0,
  });
});
