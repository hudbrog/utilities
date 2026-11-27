import type { Direction } from "../domain/curriculum/model";
import { createLocalStudyCalendar } from "../domain/scheduler/studyCalendar";
import { createBackup, parseBackup, restoreBackup, type BackupEnvelope } from "../infrastructure/db/backup";
import { pauseIntroducingUnit, setIntroducingUnit } from "../infrastructure/db/curriculumRepository";
import {
  approveCleanWords,
  approveReviewUnit,
  buildReviewUnits,
  materializeReviewUnit,
  exportReviewApprovals,
  initializeCurriculumReview,
  loadReviewUnits,
  saveReviewDecision,
  type ReviewUnitSnapshot,
  toConcept,
} from "../infrastructure/db/curriculumReviewRepository";
import { planCurriculumImport, type ImportChoice } from "../domain/curriculum/import";
import { parseCurriculumBundle } from "../domain/curriculum/schema";
import { importCurriculum } from "../infrastructure/db/curriculumImportRepository";
import { refreshConceptAvailability } from "../infrastructure/db/conceptAvailability";
import { db } from "../infrastructure/db/database";
import { loadLearnerSettings, normalizeLearnerSettings } from "../infrastructure/db/settingsRepository";
import type {
  AnswerOverride,
  Attempt,
  DailyLedger,
  InstalledConcept,
  InstalledUnit,
  LearnerSettings,
  ImportedCurriculum,
  PronunciationFlag,
} from "../infrastructure/db/model";
import type { DirectionState } from "../domain/scheduler/model";
import { resetSttProblemHistory } from "../domain/scheduler/scheduler";
import { loadCurriculumReviewPackage } from "../infrastructure/curriculum/reviewPackage";

const calendar = createLocalStudyCalendar();

export type ParentWordRow = {
  concept: InstalledConcept;
  progressIntroduced: boolean;
  states: Partial<Record<Direction, DirectionState>>;
  attempts: Attempt[];
  override?: AnswerOverride;
};

export type ParentSnapshot = {
  settings: LearnerSettings;
  units: InstalledUnit[];
  words: ParentWordRow[];
  pronunciationFlags: PronunciationFlag[];
  today: DailyLedger | null;
  dueCount: number;
  newAvailableToday: number;
  reviewUnits: ReviewUnitSnapshot[];
  importedCurricula: ImportedCurriculum[];
};

async function initialize(now: number): Promise<void> {
  await initializeCurriculumReview(db, now);
  await loadLearnerSettings(db);
}

export async function loadParentSnapshot(now = Date.now()): Promise<ParentSnapshot> {
  await initialize(now);
  const [settings, units, concepts, progress, states, attempts, overrides, today, reviewUnits, pronunciationFlags] = await Promise.all([
    db.settings.get("settings"),
    db.units.orderBy("number").toArray(),
    db.concepts.orderBy("[unitId+order]").toArray(),
    db.conceptProgress.toArray(),
    db.directionStates.toArray(),
    db.attempts.orderBy("occurredAt").reverse().toArray(),
    db.answerOverrides.toArray(),
    db.dailyLedgers.get(calendar.dateKey(now)),
    loadReviewUnits(db),
    db.pronunciationFlags.orderBy("flaggedAt").reverse().toArray(),
  ]);
  const progressById = new Map(progress.map((item) => [item.conceptId, item]));
  const overrideById = new Map(overrides.map((item) => [item.conceptId, item]));
  const statesById = new Map<string, Partial<Record<Direction, DirectionState>>>();
  for (const state of states) {
    const pair = statesById.get(state.conceptId) ?? {};
    pair[state.direction] = state;
    statesById.set(state.conceptId, pair);
  }
  const attemptsById = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const list = attemptsById.get(attempt.conceptId) ?? [];
    if (list.length < 12) list.push(attempt);
    attemptsById.set(attempt.conceptId, list);
  }
  const words = concepts.map((concept) => ({
    concept,
    progressIntroduced: progressById.get(concept.id)?.introducedAt != null,
    states: statesById.get(concept.id) ?? {},
    attempts: attemptsById.get(concept.id) ?? [],
    override: overrideById.get(concept.id),
  }));
  const available = new Set(concepts.filter((concept) => !concept.retired).map((concept) => concept.id));
  const dueCount = states.filter((state) => available.has(state.conceptId) && state.nextDueAt !== null && state.nextDueAt <= now).length;
  const remainingInActiveUnits = new Set(units
    .filter((unit) => unit.state === "introducing" && unit.available !== false)
    .flatMap((unit) => unit.conceptIds.filter((id) => available.has(id) && progressById.get(id)?.introducedAt == null))).size;
  const normalizedSettings = normalizeLearnerSettings(settings);
  const quotaRemaining = Math.max(0, normalizedSettings.dailyNewConceptQuota - (today?.quotaConsumed ?? 0));
  return {
    settings: normalizedSettings,
    units,
    words,
    pronunciationFlags,
    today: today ?? null,
    dueCount,
    newAvailableToday: normalizedSettings.suppressNewOnBacklog && dueCount > normalizedSettings.backlogThreshold ? 0 : Math.min(remainingInActiveUnits, quotaRemaining),
    reviewUnits,
    importedCurricula: await db.importedCurricula.toArray(),
  };
}

async function importCandidates() {
  const reviewUnits = await loadReviewUnits(db);
  // Reserve the same identity even for a Duolingo word in a not-yet-started unit.
  const candidates = new Map(reviewUnits.flatMap(({ words }) => words
    .filter((word) => word.status !== "excluded" && !word.proposal.unsuitableReason)
    .map((word) => { const concept = toConcept(word); return [concept.id, concept] as const; })));
  for (const concept of await db.concepts.filter((item) => !item.retired).toArray()) candidates.set(concept.id, concept);
  return [...candidates.values()];
}

export async function previewCurriculumImport(input: unknown) {
  const bundle = parseCurriculumBundle(input);
  if (bundle.curriculumId === "duolingo-ru-en") throw new Error("Для Duolingo используйте проверку блоков курса.");
  if (await db.importedCurricula.get(bundle.curriculumId)) throw new Error("Этот курс уже добавлен. Выберите его в списке курсов.");
  const candidates = await importCandidates();
  const introduced = (await db.conceptProgress.toArray()).filter((item) => item.introducedAt !== null).map((item) => item.conceptId);
  return { bundle, rows: planCurriculumImport(bundle, candidates), introduced };
}

export async function addCurriculum(input: unknown, title: string, choices: Record<string, ImportChoice>) {
  return importCurriculum(db, input, title, await importCandidates(), choices);
}

export async function saveSettings(settings: LearnerSettings): Promise<void> {
  await db.settings.put(normalizeLearnerSettings(settings));
}

export async function startUnit(unitId: string): Promise<void> {
  await setIntroducingUnit(db, unitId);
}

export async function pauseNewWords(unitId: string): Promise<void> {
  await pauseIntroducingUnit(db, unitId);
}

export async function saveAnswerOverride(
  conceptId: string,
  acceptedEn: string[],
  acceptedRu: string[],
  now = Date.now(),
): Promise<void> {
  await db.answerOverrides.put({ conceptId, acceptedEn, acceptedRu, updatedAt: now });
}

export function clearPronunciationFlag(key: string): Promise<void> {
  return db.pronunciationFlags.delete(key);
}

export async function resetWordStt(conceptId: string, now = Date.now()): Promise<void> {
  const states = await db.directionStates.where("conceptId").equals(conceptId).toArray();
  await db.directionStates.bulkPut(states.map((state) => resetSttProblemHistory(state, now)));
}

export async function reviewConcept(
  conceptId: string,
  status: "approved" | "edited" | "excluded" | "deferred",
  values?: { ru: string; acceptedEn: string[]; acceptedRu: string[] },
): Promise<void> {
  await saveReviewDecision(db, conceptId, status, values);
}

export async function approveCleanReviewWords(unitId: string): Promise<void> {
  await approveCleanWords(db, unitId);
}

export async function approveCurriculumUnit(unitId: string): Promise<void> {
  await approveReviewUnit(db, unitId);
}

export async function exportCurriculumApprovals(): Promise<unknown> {
  return exportReviewApprovals(db);
}

export async function exportLearnerBackup(appVersion: string): Promise<BackupEnvelope> {
  return createBackup(db, appVersion);
}

export function inspectLearnerBackup(input: unknown): BackupEnvelope {
  return parseBackup(input);
}

export async function importLearnerBackup(input: unknown): Promise<void> {
  const backup = parseBackup(input);
  // Fetch and validate the complete reconstruction before touching local data.
  const reviewPackage = await loadCurriculumReviewPackage();
  const reviewUnits = buildReviewUnits(reviewPackage, backup.payload.curriculumReviewDecisions, backup.payload.curriculumReviewUnits);
  for (const unit of reviewUnits) {
    if (unit.approvedAt !== null && unit.unresolvedCount) throw new Error(`Осталось проверить слов: ${unit.unresolvedCount}`);
  }
  await db.transaction("rw", db.tables, async () => {
    await restoreBackup(db, backup);
    for (const unit of reviewUnits) {
      if (unit.approvedAt !== null) await materializeReviewUnit(db, reviewPackage, unit, unit.approvedAt);
      else {
        await db.units.where("id").equals(unit.unit.id).modify({ available: false });
      }
    }
    const desiredStateById = new Map(backup.payload.unitStates.map((unit) => [unit.id, unit.state]));
    const validApprovals = new Set(reviewUnits.filter((unit) => unit.approvedAt !== null).map(({ unit }) => unit.id));
    const importedSources = new Set((await db.importedCurricula.toArray()).map((source) => source.id));
    const installed = await db.units.toArray();
    await db.units.bulkPut(installed.map((unit) => ({
      ...unit,
      state: (validApprovals.has(unit.id) || importedSources.has(unit.curriculumId ?? "")) && unit.conceptIds.length ? desiredStateById.get(unit.id) ?? "inactive" : "inactive",
    })));
    await refreshConceptAvailability(db);
  });
}
