import type { ConceptDefinition, Direction, UnitDefinition } from "../../domain/curriculum/model";
import type { ExerciseType } from "../../domain/exercises/policy";
import type { DirectionState } from "../../domain/scheduler/model";

export type AppMetaRecord = { key: string; value: string; updatedAt: number };

export type LearnerSettings = {
  id: "settings";
  dailyNewConceptQuota: number;
  backlogThreshold: number;
  suppressNewOnBacklog: boolean;
  listeningAudioRatio: number;
  englishLocale: "en-US" | "en-GB";
  parentPinHash?: string;
};

export type InstalledUnit = UnitDefinition & {
  state: "inactive" | "introducing" | "fully_introduced";
};

export type InstalledConcept = ConceptDefinition & { retired: boolean };

export type ConceptProgress = {
  conceptId: string;
  introducedAt: number | null;
  introducedFromUnitId: string;
  skipped: boolean;
  retired: boolean;
};

export type Attempt = {
  id: string;
  conceptId: string;
  direction: Direction;
  exerciseType: ExerciseType;
  occurredAt: number;
  outcome: "correct" | "incorrect";
  completionReason: "answer" | "third_stt_mismatch";
  sttAttemptCount: number;
  sttTranscripts: string[][];
  sttAdapterStatus?: string;
  stageBefore: number;
  stageAfter: number;
  isRemediationRetry: boolean;
  sessionId: string;
  questionId: string;
};

export type AnswerOverride = {
  conceptId: string;
  acceptedEn: string[];
  acceptedRu: string[];
  updatedAt: number;
};

export type CurriculumReviewDecision = {
  conceptId: string;
  proposalFingerprint: string;
  status: "approved" | "edited" | "excluded" | "deferred";
  ru: string;
  acceptedEn: string[];
  acceptedRu: string[];
  updatedAt: number;
};

export type CurriculumReviewUnit = {
  unitId: string;
  reviewFingerprint: string;
  approvedAt: number;
};

export type DailyLedger = {
  dateKey: string;
  utcOffsetMinutes: number;
  introducedConceptIds: string[];
  quotaConsumed: number;
  questionsCompleted: number;
  immediateMistakes: number;
  updatedAt: number;
};

export type StudySession = {
  id: string;
  status: "active" | "completed" | "abandoned";
  seed: string;
  createdAt: number;
  updatedAt: number;
};

export type PersistedSessionQuestion = {
  id: string;
  sessionId: string;
  position: number;
  conceptId: string;
  direction: Direction;
  exerciseType: ExerciseType;
  kind: "review" | "introduction" | "remediation";
  status: "pending" | "current" | "revealed" | "completed";
  revealedOutcome?: "correct" | "incorrect";
};

export type MutableBackupPayload = {
  settings: LearnerSettings[];
  unitStates: InstalledUnit[];
  conceptProgress: ConceptProgress[];
  directionStates: DirectionState[];
  attempts: Attempt[];
  answerOverrides: AnswerOverride[];
  dailyLedgers: DailyLedger[];
  curriculumReviewDecisions: CurriculumReviewDecision[];
  curriculumReviewUnits: CurriculumReviewUnit[];
};
