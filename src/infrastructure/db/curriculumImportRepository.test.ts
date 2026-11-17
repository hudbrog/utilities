import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Dexie from "dexie";
import { EnglishSrsDatabase } from "./database";
import { importCurriculum } from "./curriculumImportRepository";
import { importedId } from "../../domain/curriculum/import";
import { makeState } from "../../domain/testFixtures";
import { createBackup, restoreBackup } from "./backup";
import { createStudySession, presentQuestion } from "./sessionRepository";
import type { CurriculumBundle } from "../../domain/curriculum/model";

let db: EnglishSrsDatabase;
const cat = { id: "duo-cat", unitId: "duo-1", order: 1, en: "cat", ru: "кот", acceptedEn: [], acceptedRu: [] };
const bundle: CurriculumBundle = {
  schemaVersion: 1, curriculumId: "school", curriculumVersion: "1", sourceFingerprint: "file",
  units: [{ id: "unit-1", number: 0, conceptIds: ["cat", "dog"] }],
  concepts: [ { ...cat, id: "cat", unitId: "unit-1" }, { ...cat, id: "dog", unitId: "unit-1", order: 2, en: "dog", ru: "собака" } ],
};
beforeEach(() => { db = new EnglishSrsDatabase(`import-${crypto.randomUUID()}`); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

test("links an introduced word without changing either direction, aliases, quota or history", async () => {
  await db.concepts.put({ ...cat, retired: false });
  await db.units.put({ id: cat.unitId, number: 1, conceptIds: [cat.id], state: "fully_introduced" });
  await db.conceptProgress.put({ conceptId: cat.id, introducedAt: 10, introducedFromUnitId: cat.unitId, skipped: false, retired: false });
  const states = [makeState(cat.id, "en-ru", 5, { nextDueAt: 5000 }), makeState(cat.id, "ru-en", 2, { nextDueAt: 1000 })];
  await db.directionStates.bulkPut(states);
  const override = { conceptId: cat.id, acceptedEn: ["kitty"], acceptedRu: ["кошка"], updatedAt: 10 };
  await db.answerOverrides.put(override);
  const source = await importCurriculum(db, bundle, "School", [], {}, 20);
  expect(source.conceptMap.cat).toBe(cat.id);
  expect(await db.directionStates.toArray()).toEqual(states);
  expect(await db.answerOverrides.get(cat.id)).toEqual(override);
  expect(await db.dailyLedgers.count()).toBe(0);
  expect(await db.attempts.count()).toBe(0);
  expect(await db.concepts.count()).toBe(2);
  expect(await db.units.get(importedId("school", "unit-1"))).toMatchObject({ state: "inactive", conceptIds: [cat.id, importedId("school", "dog")] });
  await importCurriculum(db, bundle, "School", [], {}, 30);
  expect(await db.concepts.count()).toBe(2);
  expect(await db.importedCurricula.count()).toBe(1);
});

test("reserves a future Duolingo identity and can introduce it through the school block", async () => {
  await importCurriculum(db, bundle, "School", [cat], {}, 20);
  await db.units.update(importedId("school", "unit-1"), { state: "introducing" });
  await createStudySession(db, { id: "session", status: "active", seed: "1", createdAt: 20, updatedAt: 20 }, [
    { id: "question", conceptId: cat.id, direction: "en-ru", kind: "introduction", exerciseType: "mc_text" },
  ]);
  await presentQuestion(db, "session:question", "2026-11-17", -180, 30);
  expect(await db.conceptProgress.get(cat.id)).toMatchObject({ introducedFromUnitId: importedId("school", "unit-1"), introducedAt: 30 });
  expect(await db.dailyLedgers.get("2026-11-17")).toMatchObject({ quotaConsumed: 1 });
});

test("reuses identities across imports and tolerates overlapping source-local IDs", async () => {
  await importCurriculum(db, bundle, "School", [], {}, 20);
  await importCurriculum(db, { ...bundle, curriculumId: "other" }, "Other", [], {}, 30);
  expect(await db.concepts.count()).toBe(2);
  expect(await db.units.count()).toBe(2);
  expect((await db.units.toArray())[0].conceptIds).toEqual((await db.units.toArray())[1].conceptIds);
});

test("ambiguous matches and invalid links fail atomically", async () => {
  const ambiguous = { ...bundle, concepts: bundle.concepts.map((c) => c.id === "cat" ? { ...c, ru: "кот / кошка" } : c) };
  await expect(importCurriculum(db, ambiguous, "School", [cat], {}, 20)).rejects.toThrow("Проверьте");
  await expect(importCurriculum(db, ambiguous, "School", [cat], { cat: `link:${cat.id}` }, 20)).rejects.toThrow("Разделите");
  await expect(importCurriculum(db, bundle, "School", [cat], { cat: "link:unknown" }, 20)).rejects.toThrow("Совпадение");
  expect(await db.concepts.count()).toBe(0);
  expect(await db.units.count()).toBe(0);
  expect(await db.importedCurricula.count()).toBe(0);
});

test("a failed import write rolls back all definitions", async () => {
  vi.spyOn(db.importedCurricula, "add").mockRejectedValueOnce(new Error("disk-full"));
  await expect(importCurriculum(db, bundle, "School", [], {}, 20)).rejects.toThrow("disk-full");
  expect(await db.concepts.count()).toBe(0);
  expect(await db.units.count()).toBe(0);
});

test("restores imported definitions, mappings and progress into an empty device", async () => {
  await importCurriculum(db, bundle, "School", [cat], {}, 20);
  await db.directionStates.put(makeState(cat.id, "ru-en", 4, { nextDueAt: 9000 }));
  const backup = await createBackup(db, "test");
  const before = await Promise.all([db.units.toArray(), db.concepts.toArray(), db.importedCurricula.toArray(), db.directionStates.toArray()]);
  await db.delete(); await db.open();
  await restoreBackup(db, JSON.parse(JSON.stringify(backup)));
  expect(await Promise.all([db.units.toArray(), db.concepts.toArray(), db.importedCurricula.toArray(), db.directionStates.toArray()])).toEqual(before);
});

test.each([1, 2, 3])("upgrades database version %s without resetting existing IDs or progress", async (version) => {
  const name = `old-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(version).stores({ concepts: "id, unitId", conceptProgress: "conceptId", directionStates: "key", attempts: "id" });
  await old.table("concepts").put(cat);
  await old.table("conceptProgress").put({ conceptId: cat.id, introducedAt: 10 });
  await old.table("directionStates").put(makeState(cat.id, "ru-en", 4, { nextDueAt: 9000 }));
  old.close();
  const upgraded = new EnglishSrsDatabase(name);
  try {
    expect(await upgraded.concepts.get(cat.id)).toEqual(cat);
    expect(await upgraded.conceptProgress.get(cat.id)).toMatchObject({ introducedAt: 10 });
    expect(await upgraded.directionStates.get(`${cat.id}:ru-en`)).toMatchObject({ nextDueAt: 9000, stage: 4 });
    expect(await upgraded.importedCurricula.count()).toBe(0);
  } finally { await upgraded.delete(); }
});
