import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";

import { applyReviewRating } from "../../domain/scheduler/scheduler";
import type { StudyCalendar } from "../../domain/scheduler/studyCalendar";
import { concepts, makeState, units } from "../../domain/testFixtures";
import { installCurriculum, pauseIntroducingUnit, setIntroducingUnit } from "./curriculumRepository";
import { EnglishSrsDatabase } from "./database";
import type { Attempt, StudySession } from "./model";
import {
  advanceSession,
  commitAnswer,
  createStudySession,
  presentQuestion,
  persistedQuestionId,
  QuestionAlreadyAnsweredError,
  readResumableSession,
} from "./sessionRepository";

let db: EnglishSrsDatabase;
const calendar: StudyCalendar = {
  startOfStudyDay: (value) => value,
  addStudyDays: (value, days) => value + days * 1_000,
  dateKey: () => "2026-08-14",
};

beforeEach(() => {
  db = new EnglishSrsDatabase(`test-${crypto.randomUUID()}`);
});

afterEach(async () => {
  await db.delete();
});

function bundle(version = "1", includedConcepts = concepts) {
  return {
    schemaVersion: 1 as const,
    curriculumId: "duolingo-ru-en" as const,
    curriculumVersion: version,
    sourceFingerprint: `fingerprint-${version}`,
    units: units.map((unit) => ({ ...unit, conceptIds: unit.conceptIds.filter((id) => includedConcepts.some((concept) => concept.id === id)) })),
    concepts: includedConcepts,
  };
}

const session: StudySession = { id: "session-1", status: "active", seed: "seed", createdAt: 100, updatedAt: 100 };
const question = {
  id: "intro:cat:ru-en",
  conceptId: "cat",
  direction: "ru-en" as const,
  exerciseType: "mc_text" as const,
  kind: "introduction" as const,
};
const questionId = persistedQuestionId(session.id, question.id);

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: "attempt-1",
    conceptId: "cat",
    direction: "ru-en",
    exerciseType: "mc_text",
    occurredAt: 200,
    outcome: "correct",
    completionReason: "answer",
    sttAttemptCount: 0,
    sttTranscripts: [],
    completionMode: "multiple-choice",
    stageBefore: 0,
    stageAfter: 1,
    isRemediationRetry: false,
    sessionId: session.id,
    questionId,
    ...overrides,
  };
}

describe("curriculum persistence", () => {
  it("updates packaged definitions while preserving progress and retiring removed concepts", async () => {
    await installCurriculum(db, bundle(), 10);
    await db.conceptProgress.put({ conceptId: "house", introducedAt: 5, introducedFromUnitId: "unit-2", skipped: false, retired: false });
    await installCurriculum(db, bundle("2", concepts.slice(0, 4)), 20);
    expect(await db.concepts.get("house")).toMatchObject({ retired: true, en: "house" });
    expect(await db.conceptProgress.get("house")).toMatchObject({ introducedAt: 5, retired: true });
    expect((await db.appMeta.get("curriculumVersion"))?.value).toBe("2");
  });

  it("validates the complete bundle before mutating storage", async () => {
    await expect(installCurriculum(db, { bad: true }, 10)).rejects.toThrow();
    expect(await db.concepts.count()).toBe(0);
  });

  it("keeps multiple units active and pauses them independently", async () => {
    await installCurriculum(db, bundle(), 10);
    await setIntroducingUnit(db, "unit-2");
    await setIntroducingUnit(db, "unit-1");
    expect((await db.units.where("state").equals("introducing").sortBy("number")).map(({ id }) => id))
      .toEqual(["unit-1", "unit-2"]);

    await pauseIntroducingUnit(db, "unit-1");
    expect(await db.units.get("unit-1")).toMatchObject({ state: "inactive" });
    expect(await db.units.get("unit-2")).toMatchObject({ state: "introducing" });
  });
});

describe("database migration", () => {
  it("keeps legacy due dates and marks scheduler state for lazy replay", async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      directionStates: "key, nextDueAt, [direction+nextDueAt], conceptId",
      attempts: "id, conceptId, occurredAt, sessionId, questionId",
    });
    await legacy.table("directionStates").put({
      key: "cat:ru-en", conceptId: "cat", direction: "ru-en", introduced: true,
      stage: 4, nextDueAt: 12_345, successfulSpokenRecall: false,
      recentFailureCount: 0, lifetimeFailureCount: 2, sttApparentFailureCount: 0,
      sttMcConfirmationCount: 0, sttProblematic: false, updatedAt: 10,
    });
    await legacy.close();

    const upgraded = new EnglishSrsDatabase(name);
    try {
      const state = await upgraded.directionStates.get("cat:ru-en");
      expect(state).toMatchObject({
        scheduler: "legacy-stage",
        memoryState: "review",
        stability: null,
        nextDueAt: 12_345,
        successfulReviewCount: 4,
        lapses: 2,
      });
    } finally {
      await upgraded.delete();
    }
  });
});

describe("resumable atomic sessions", () => {
  beforeEach(async () => {
    await installCurriculum(db, bundle(), 10);
    await createStudySession(db, session, [question]);
  });

  it("consumes new-word quota only when the first introduction is displayed", async () => {
    expect(await db.dailyLedgers.count()).toBe(0);
    await presentQuestion(db, questionId, "2026-08-14", -120, 150);
    expect(await db.dailyLedgers.get("2026-08-14")).toMatchObject({
      introducedConceptIds: ["cat"], quotaConsumed: 1,
    });
    expect(await db.directionStates.get("cat:ru-en")).toMatchObject({ stage: 0, nextDueAt: null });
  });

  it("persists reveal state and rejects duplicate scoring", async () => {
    await presentQuestion(db, questionId, "2026-08-14", -120, 150);
    const before = (await db.directionStates.get("cat:ru-en"))!;
    const after = applyReviewRating(before, "hard", 200, calendar);
    await commitAnswer(db, { attempt: attempt(), directionStateAfter: after, dateKey: "2026-08-14", utcOffsetMinutes: -120 });
    expect((await readResumableSession(db))?.questions[0]).toMatchObject({ status: "revealed", revealedOutcome: "correct" });
    expect(await db.attempts.count()).toBe(1);
    await expect(commitAnswer(db, { attempt: attempt({ id: "attempt-2" }), directionStateAfter: after, dateKey: "2026-08-14", utcOffsetMinutes: -120 }))
      .rejects.toBeInstanceOf(QuestionAlreadyAnsweredError);
    expect(await db.attempts.count()).toBe(1);
  });

  it("rolls the entire answer transaction back on failure", async () => {
    await presentQuestion(db, questionId, "2026-08-14", -120, 150);
    const before = (await db.directionStates.get("cat:ru-en"))!;
    const after = applyReviewRating(before, "again", 200, calendar);
    await expect(commitAnswer(db, {
      attempt: attempt({ outcome: "incorrect", stageAfter: after.stage }), directionStateAfter: after,
      dateKey: "2026-08-14", utcOffsetMinutes: -120, injectFailure: () => { throw new Error("injected"); },
    })).rejects.toThrow("injected");
    expect(await db.attempts.count()).toBe(0);
    expect(await db.directionStates.get("cat:ru-en")).toEqual(before);
    expect(await db.sessionQuestions.get(questionId)).toMatchObject({ status: "current" });
    expect(await db.dailyLedgers.get("2026-08-14")).toMatchObject({ questionsCompleted: 0, immediateMistakes: 0 });
  });

  it("completes the session only after advancing past the saved reveal", async () => {
    await presentQuestion(db, questionId, "2026-08-14", -120, 150);
    const state = (await db.directionStates.get("cat:ru-en"))!;
    await commitAnswer(db, { attempt: attempt(), directionStateAfter: applyReviewRating(state, "hard", 200, calendar), dateKey: "2026-08-14", utcOffsetMinutes: -120 });
    expect((await db.sessions.get(session.id))?.status).toBe("active");
    await advanceSession(db, questionId, 250);
    expect((await db.sessions.get(session.id))?.status).toBe("completed");
  });

  it("scopes repeated question keys to their session", async () => {
    await db.sessions.update(session.id, { status: "completed" });
    const nextSession: StudySession = { ...session, id: "session-2", createdAt: 300, updatedAt: 300 };
    await createStudySession(db, nextSession, [question]);
    expect(await db.sessionQuestions.toCollection().primaryKeys()).toEqual([
      persistedQuestionId(session.id, question.id),
      persistedQuestionId(nextSession.id, question.id),
    ]);
  });
});
