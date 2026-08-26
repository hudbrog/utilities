import Dexie, { type EntityTable } from "dexie";

import type { DirectionState } from "../../domain/scheduler/model";
import type {
  AnswerOverride,
  AppMetaRecord,
  Attempt,
  ConceptProgress,
  DailyLedger,
  InstalledConcept,
  InstalledUnit,
  LearnerSettings,
  PersistedSessionQuestion,
  StudySession,
  CurriculumReviewDecision,
  CurriculumReviewUnit,
} from "./model";

export class EnglishSrsDatabase extends Dexie {
  appMeta!: EntityTable<AppMetaRecord, "key">;
  settings!: EntityTable<LearnerSettings, "id">;
  units!: EntityTable<InstalledUnit, "id">;
  concepts!: EntityTable<InstalledConcept, "id">;
  conceptProgress!: EntityTable<ConceptProgress, "conceptId">;
  directionStates!: EntityTable<DirectionState, "key">;
  attempts!: EntityTable<Attempt, "id">;
  answerOverrides!: EntityTable<AnswerOverride, "conceptId">;
  dailyLedgers!: EntityTable<DailyLedger, "dateKey">;
  sessions!: EntityTable<StudySession, "id">;
  sessionQuestions!: EntityTable<PersistedSessionQuestion, "id">;
  curriculumReviewDecisions!: EntityTable<CurriculumReviewDecision, "conceptId">;
  curriculumReviewUnits!: EntityTable<CurriculumReviewUnit, "unitId">;

  constructor(name = "english-srs-v1") {
    super(name);
    this.version(1).stores({
      appMeta: "key, updatedAt",
      settings: "id",
      units: "id, number, state",
      concepts: "id, unitId, [unitId+order], retired",
      conceptProgress: "conceptId, introducedAt, skipped, retired",
      directionStates: "key, nextDueAt, [direction+nextDueAt], conceptId",
      attempts: "id, conceptId, occurredAt, sessionId, questionId",
      answerOverrides: "conceptId, updatedAt",
      dailyLedgers: "dateKey, updatedAt",
      sessions: "id, status, createdAt, updatedAt",
      sessionQuestions: "id, [sessionId+position], [sessionId+status], status",
    });
    this.version(2).stores({
      appMeta: "key, updatedAt",
      settings: "id",
      units: "id, number, state",
      concepts: "id, unitId, [unitId+order], retired",
      conceptProgress: "conceptId, introducedAt, skipped, retired",
      directionStates: "key, nextDueAt, [direction+nextDueAt], conceptId",
      attempts: "id, conceptId, occurredAt, sessionId, questionId",
      answerOverrides: "conceptId, updatedAt",
      dailyLedgers: "dateKey, updatedAt",
      sessions: "id, status, createdAt, updatedAt",
      sessionQuestions: "id, [sessionId+position], [sessionId+status], status",
      curriculumReviewDecisions: "conceptId, status, updatedAt",
      curriculumReviewUnits: "unitId, approvedAt",
    });
    this.version(3).stores({
      appMeta: "key, updatedAt",
      settings: "id",
      units: "id, number, state",
      concepts: "id, unitId, [unitId+order], retired",
      conceptProgress: "conceptId, introducedAt, skipped, retired",
      directionStates: "key, nextDueAt, [direction+nextDueAt], conceptId",
      attempts: "id, conceptId, occurredAt, sessionId, questionId",
      answerOverrides: "conceptId, updatedAt",
      dailyLedgers: "dateKey, updatedAt",
      sessions: "id, status, createdAt, updatedAt",
      sessionQuestions: "id, [sessionId+position], [sessionId+status], status",
      curriculumReviewDecisions: "conceptId, status, updatedAt",
      curriculumReviewUnits: "unitId, approvedAt",
    }).upgrade(async (transaction) => {
      await transaction.table("directionStates").toCollection().modify((state) => {
        if (state.scheduler) return;
        state.scheduler = "legacy-stage";
        state.memoryState = state.stage > 0 ? "review" : "new";
        state.stability = null;
        state.difficulty = null;
        state.lastReviewAt = null;
        state.scheduledDays = [0, 1, 3, 7, 14, 30, 60, 120][state.stage] ?? 0;
        state.reps = 0;
        state.lapses = state.lifetimeFailureCount;
        state.successfulReviewCount = state.stage;
      });
      await transaction.table("attempts").toCollection().modify((attempt) => {
        if (!attempt.completionMode) {
          attempt.completionMode = String(attempt.exerciseType).startsWith("stt_") ? "speech" : "multiple-choice";
        }
      });
    });
  }
}

export const db = new EnglishSrsDatabase();
