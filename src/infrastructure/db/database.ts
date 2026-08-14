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
  }
}

export const db = new EnglishSrsDatabase();
