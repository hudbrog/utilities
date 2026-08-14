import type { Direction } from "../domain/curriculum/model";
import { createLocalStudyCalendar } from "../domain/scheduler/studyCalendar";
import { fixtureCurriculum } from "../generated/fixtureCurriculum";
import { createBackup, parseBackup, restoreBackup, type BackupEnvelope } from "../infrastructure/db/backup";
import { installCurriculum, setIntroducingUnit } from "../infrastructure/db/curriculumRepository";
import { db } from "../infrastructure/db/database";
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
};

const defaultSettings: LearnerSettings = {
  id: "settings",
  dailyNewConceptQuota: 5,
  backlogThreshold: 30,
  suppressNewOnBacklog: true,
  listeningAudioRatio: 0.3,
  englishLocale: "en-US",
};

async function initialize(now: number): Promise<void> {
  await installCurriculum(db, fixtureCurriculum, now);
  if (!(await db.settings.get("settings"))) await db.settings.put(defaultSettings);
}

export async function loadParentSnapshot(now = Date.now()): Promise<ParentSnapshot> {
  await initialize(now);
  const [settings, units, concepts, progress, states, attempts, overrides, today] = await Promise.all([
    db.settings.get("settings"),
    db.units.orderBy("number").toArray(),
    db.concepts.orderBy("[unitId+order]").toArray(),
    db.conceptProgress.toArray(),
    db.directionStates.toArray(),
    db.attempts.orderBy("occurredAt").reverse().toArray(),
    db.answerOverrides.toArray(),
    db.dailyLedgers.get(calendar.dateKey(now)),
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
  const introducing = units.find((unit) => unit.state === "introducing");
  const remainingInUnit = introducing?.conceptIds.filter((id) => !progressById.get(id)?.introducedAt).length ?? 0;
  const quotaRemaining = Math.max(0, (settings ?? defaultSettings).dailyNewConceptQuota - (today?.quotaConsumed ?? 0));
  return {
    settings: settings ?? defaultSettings,
    units,
    words,
    today: today ?? null,
    dueCount,
    newAvailableToday: Math.min(remainingInUnit, quotaRemaining),
  };
}

export async function saveSettings(settings: LearnerSettings): Promise<void> {
  await db.settings.put(settings);
}

export async function startUnit(unitId: string): Promise<void> {
  await setIntroducingUnit(db, unitId);
}

export async function pauseNewWords(): Promise<void> {
  const active = await db.units.where("state").equals("introducing").toArray();
  await db.units.bulkPut(active.map((unit) => ({ ...unit, state: "inactive" as const })));
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

export async function exportLearnerBackup(appVersion: string): Promise<BackupEnvelope> {
  return createBackup(db, appVersion);
}

export function inspectLearnerBackup(input: unknown): BackupEnvelope {
  return parseBackup(input);
}

export async function importLearnerBackup(input: unknown): Promise<void> {
  await restoreBackup(db, input);
}
