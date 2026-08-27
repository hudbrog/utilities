import type { Direction } from "../domain/curriculum/model";
import { createLocalStudyCalendar } from "../domain/scheduler/studyCalendar";
import { createBackup, parseBackup, restoreBackup, type BackupEnvelope } from "../infrastructure/db/backup";
import { pauseIntroducingUnit, setIntroducingUnit } from "../infrastructure/db/curriculumRepository";
import {
  approveCleanWords,
  approveReviewUnit,
  exportReviewApprovals,
  initializeCurriculumReview,
  loadReviewUnits,
  saveReviewDecision,
  type ReviewUnitSnapshot,
} from "../infrastructure/db/curriculumReviewRepository";
import { db } from "../infrastructure/db/database";
import { loadLearnerSettings, normalizeLearnerSettings } from "../infrastructure/db/settingsRepository";
import type {
  AnswerOverride,
  Attempt,
  DailyLedger,
  InstalledConcept,
  InstalledUnit,
  LearnerSettings,
} from "../infrastructure/db/model";
import type { DirectionState } from "../domain/scheduler/model";
import { resetSttProblemHistory } from "../domain/scheduler/scheduler";

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
  today: DailyLedger | null;
  dueCount: number;
  newAvailableToday: number;
  reviewUnits: ReviewUnitSnapshot[];
};

async function initialize(now: number): Promise<void> {
  await initializeCurriculumReview(db, now);
  await loadLearnerSettings(db);
}

export async function loadParentSnapshot(now = Date.now()): Promise<ParentSnapshot> {
  await initialize(now);
  const [settings, units, concepts, progress, states, attempts, overrides, today, reviewUnits] = await Promise.all([
    db.settings.get("settings"),
    db.units.orderBy("number").toArray(),
    db.concepts.orderBy("[unitId+order]").toArray(),
    db.conceptProgress.toArray(),
    db.directionStates.toArray(),
    db.attempts.orderBy("occurredAt").reverse().toArray(),
    db.answerOverrides.toArray(),
    db.dailyLedgers.get(calendar.dateKey(now)),
    loadReviewUnits(db),
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
  const dueCount = states.filter((state) => state.nextDueAt !== null && state.nextDueAt <= now).length;
  const remainingInActiveUnits = units
    .filter((unit) => unit.state === "introducing")
    .reduce((sum, unit) => sum + unit.conceptIds.filter((id) => !progressById.get(id)?.introducedAt).length, 0);
  const normalizedSettings = normalizeLearnerSettings(settings);
  const quotaRemaining = Math.max(0, normalizedSettings.dailyNewConceptQuota - (today?.quotaConsumed ?? 0));
  return {
    settings: normalizedSettings,
    units,
    words,
    today: today ?? null,
    dueCount,
    newAvailableToday: Math.min(remainingInActiveUnits, quotaRemaining),
    reviewUnits,
  };
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
  await restoreBackup(db, backup);
  const reviewUnits = await loadReviewUnits(db);
  for (const unit of reviewUnits) {
    if (unit.approvedAt !== null) await approveReviewUnit(db, unit.unit.id, unit.approvedAt);
  }
  const desiredStateById = new Map(backup.payload.unitStates.map((unit) => [unit.id, unit.state]));
  const installed = await db.units.toArray();
  await db.units.bulkPut(installed.map((unit) => ({ ...unit, state: desiredStateById.get(unit.id) ?? "inactive" })));
}
