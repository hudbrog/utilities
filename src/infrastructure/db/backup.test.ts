import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { concepts, makeState, units } from "../../domain/testFixtures";
import { createBackup, restoreBackup } from "./backup";
import { installCurriculum } from "./curriculumRepository";
import { EnglishSrsDatabase } from "./database";

let source: EnglishSrsDatabase;
let target: EnglishSrsDatabase;
const bundle = {
  schemaVersion: 1 as const, curriculumId: "duolingo-ru-en" as const, curriculumVersion: "test-1",
  sourceFingerprint: "fingerprint", units, concepts,
};

beforeEach(async () => {
  source = new EnglishSrsDatabase(`backup-source-${crypto.randomUUID()}`);
  target = new EnglishSrsDatabase(`backup-target-${crypto.randomUUID()}`);
  await Promise.all([installCurriculum(source, bundle, 1), installCurriculum(target, bundle, 1)]);
});

afterEach(async () => {
  await Promise.all([source.delete(), target.delete()]);
});

describe("backup and restore", () => {
  it("round-trips mutable learner data", async () => {
    await source.settings.put({
      id: "settings", dailyNewConceptQuota: 5, backlogThreshold: 30, suppressNewOnBacklog: true,
      listeningAudioRatio: 0.3, englishLocale: "en-US",
    });
    await source.directionStates.put(makeState("cat", "ru-en", 4, { nextDueAt: 123 }));
    await source.answerOverrides.put({ conceptId: "cat", acceptedEn: ["kitty"], acceptedRu: ["кот"], updatedAt: 5 });
    await source.curriculumReviewDecisions.put({ conceptId: "cat", proposalFingerprint: "proposal-1", status: "edited", ru: "кот", acceptedEn: ["kitty"], acceptedRu: [], updatedAt: 6 });
    await source.curriculumReviewUnits.put({ unitId: "unit-1", reviewFingerprint: "review-fingerprint", approvedAt: 7 });
    const backup = await createBackup(source, "0.0.1", "2026-08-14T12:00:00.000Z");
    await restoreBackup(target, JSON.parse(JSON.stringify(backup)));
    expect(await target.settings.toArray()).toEqual(await source.settings.toArray());
    expect(await target.directionStates.toArray()).toEqual(await source.directionStates.toArray());
    expect(await target.answerOverrides.toArray()).toEqual(await source.answerOverrides.toArray());
    expect(await target.curriculumReviewDecisions.toArray()).toEqual(await source.curriculumReviewDecisions.toArray());
    expect(await target.curriculumReviewUnits.toArray()).toEqual(await source.curriculumReviewUnits.toArray());
  });

  it("validates before opening a write transaction", async () => {
    await target.directionStates.put(makeState("dog", "en-ru", 3));
    await expect(restoreBackup(target, { format: "english-srs-backup", backupSchemaVersion: 99 })).rejects.toThrow();
    expect(await target.directionStates.get("dog:en-ru")).toMatchObject({ stage: 3 });
  });

  it("discards an obsolete active queue during restore", async () => {
    const backup = await createBackup(source, "0.0.1", "2026-08-14T12:00:00.000Z");
    await target.sessions.put({ id: "old", status: "active", seed: "old", createdAt: 1, updatedAt: 1 });
    await restoreBackup(target, backup);
    expect(await target.sessions.count()).toBe(0);
    expect(await target.sessionQuestions.count()).toBe(0);
  });
});
