import { z } from "zod";

import { unitDefinitionSchema } from "../../domain/curriculum/schema";
import type { EnglishSrsDatabase } from "./database";
import type { MutableBackupPayload } from "./model";

const direction = z.enum(["en-ru", "ru-en"]);
const exerciseType = z.enum(["mc_text", "stt_text", "mc_audio", "stt_audio"]);
const settingsSchema = z.object({
  id: z.literal("settings"), dailyNewConceptQuota: z.number().int().nonnegative(),
  backlogThreshold: z.number().int().nonnegative(), suppressNewOnBacklog: z.boolean(),
  listeningAudioRatio: z.number().min(0).max(1), englishLocale: z.enum(["en-US", "en-GB"]),
  parentPinHash: z.string().optional(),
});
const installedUnitSchema = unitDefinitionSchema.extend({ state: z.enum(["inactive", "introducing", "fully_introduced"]) });
const conceptProgressSchema = z.object({
  conceptId: z.string().min(1), introducedAt: z.number().nullable(), introducedFromUnitId: z.string(),
  skipped: z.boolean(), retired: z.boolean(),
});
const directionStateSchema = z.object({
  key: z.string().min(1), conceptId: z.string().min(1), direction, introduced: z.boolean(),
  stage: z.number().int().min(0).max(7), nextDueAt: z.number().nullable(), successfulSpokenRecall: z.boolean(),
  recentFailureCount: z.number().int().nonnegative(), lifetimeFailureCount: z.number().int().nonnegative(),
  sttApparentFailureCount: z.number().int().nonnegative(), sttMcConfirmationCount: z.number().int().nonnegative(),
  sttProblematic: z.boolean(), updatedAt: z.number(),
});
const attemptSchema = z.object({
  id: z.string().min(1), conceptId: z.string().min(1), direction, exerciseType,
  occurredAt: z.number(), outcome: z.enum(["correct", "incorrect"]),
  completionReason: z.enum(["answer", "third_stt_mismatch"]),
  sttAttemptCount: z.number().int().nonnegative(), sttTranscripts: z.array(z.array(z.string())),
  sttAdapterStatus: z.string().optional(), stageBefore: z.number().int().min(0).max(7),
  stageAfter: z.number().int().min(0).max(7), isRemediationRetry: z.boolean(),
  sessionId: z.string().min(1), questionId: z.string().min(1),
});
const answerOverrideSchema = z.object({
  conceptId: z.string().min(1), acceptedEn: z.array(z.string()), acceptedRu: z.array(z.string()), updatedAt: z.number(),
});
const dailyLedgerSchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), utcOffsetMinutes: z.number().int(),
  introducedConceptIds: z.array(z.string()), quotaConsumed: z.number().int().nonnegative(),
  questionsCompleted: z.number().int().nonnegative(), immediateMistakes: z.number().int().nonnegative(), updatedAt: z.number(),
});
const payloadSchema = z.object({
  settings: z.array(settingsSchema), unitStates: z.array(installedUnitSchema),
  conceptProgress: z.array(conceptProgressSchema), directionStates: z.array(directionStateSchema),
  attempts: z.array(attemptSchema), answerOverrides: z.array(answerOverrideSchema), dailyLedgers: z.array(dailyLedgerSchema),
});

export const backupEnvelopeSchema = z.object({
  format: z.literal("english-srs-backup"), backupSchemaVersion: z.literal(1),
  exportedAt: z.iso.datetime(), appVersion: z.string().min(1), curriculumVersion: z.string(), payload: payloadSchema,
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

export async function createBackup(
  db: EnglishSrsDatabase,
  appVersion: string,
  exportedAt = new Date().toISOString(),
): Promise<BackupEnvelope> {
  const [settings, unitStates, conceptProgress, directionStates, attempts, answerOverrides, dailyLedgers, curriculumMeta] =
    await db.transaction(
      "r",
      [db.settings, db.units, db.conceptProgress, db.directionStates, db.attempts, db.answerOverrides, db.dailyLedgers, db.appMeta],
      () => Promise.all([
        db.settings.toArray(), db.units.toArray(), db.conceptProgress.toArray(), db.directionStates.toArray(),
        db.attempts.toArray(), db.answerOverrides.toArray(), db.dailyLedgers.toArray(), db.appMeta.get("curriculumVersion"),
      ]),
    );
  return backupEnvelopeSchema.parse({
    format: "english-srs-backup", backupSchemaVersion: 1, exportedAt, appVersion,
    curriculumVersion: curriculumMeta?.value ?? "",
    payload: { settings, unitStates, conceptProgress, directionStates, attempts, answerOverrides, dailyLedgers },
  });
}

export function parseBackup(input: unknown): BackupEnvelope {
  return backupEnvelopeSchema.parse(input);
}

export async function restoreBackup(db: EnglishSrsDatabase, input: unknown): Promise<void> {
  const backup = parseBackup(input);
  const payload = backup.payload as MutableBackupPayload;
  await db.transaction(
    "rw",
    [db.settings, db.units, db.concepts, db.conceptProgress, db.directionStates, db.attempts, db.answerOverrides, db.dailyLedgers, db.sessions, db.sessionQuestions],
    async () => {
      const installedUnits = new Map((await db.units.toArray()).map((unit) => [unit.id, unit]));
      const installedConceptIds = new Set((await db.concepts.toCollection().primaryKeys()).map(String));
      const restoredUnits = payload.unitStates
        .filter((unit) => installedUnits.has(unit.id))
        .map((unit) => ({ ...installedUnits.get(unit.id)!, state: unit.state }));
      await Promise.all([
        db.settings.clear(), db.conceptProgress.clear(), db.directionStates.clear(), db.attempts.clear(),
        db.answerOverrides.clear(), db.dailyLedgers.clear(), db.sessions.clear(), db.sessionQuestions.clear(),
      ]);
      await db.units.bulkPut(restoredUnits);
      await Promise.all([
        db.settings.bulkAdd(payload.settings),
        db.conceptProgress.bulkAdd(payload.conceptProgress.map((progress) => ({
          ...progress,
          retired: progress.retired || !installedConceptIds.has(progress.conceptId),
        }))),
        db.directionStates.bulkAdd(payload.directionStates), db.attempts.bulkAdd(payload.attempts),
        db.answerOverrides.bulkAdd(payload.answerOverrides), db.dailyLedgers.bulkAdd(payload.dailyLedgers),
      ]);
    },
  );
}
