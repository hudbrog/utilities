import type { ConceptDefinition } from "../domain/curriculum/model";
import {
  applyReviewOutcome,
  markSuccessfulSpokenRecall,
  recordSttApparentFailure,
  recordSttMcConfirmation,
} from "../domain/scheduler/scheduler";
import { createLocalStudyCalendar } from "../domain/scheduler/studyCalendar";
import { generateSession, insertRemediation, type SessionQuestion } from "../domain/sessions/sessionGenerator";
import { getRecognitionConstructor } from "../infrastructure/speech/recognition";
import { initializeCurriculumReview, loadDistractorCurriculum } from "../infrastructure/db/curriculumReviewRepository";
import { db } from "../infrastructure/db/database";
import type { Attempt, PersistedSessionQuestion, StudySession } from "../infrastructure/db/model";
import {
  advanceSession,
  commitAnswer,
  createStudySession,
  presentQuestion,
  readResumableSession,
} from "../infrastructure/db/sessionRepository";

const calendar = createLocalStudyCalendar();

export type StudySnapshot = {
  session: StudySession;
  questions: PersistedSessionQuestion[];
  current: PersistedSessionQuestion | null;
  concept: ConceptDefinition | null;
  completed: boolean;
  emptyReason?: "no-curriculum" | "no-work";
};

async function ensureDefaults(now: number): Promise<void> {
  await initializeCurriculumReview(db, now);
  if (!(await db.settings.get("settings"))) {
    await db.settings.put({
      id: "settings",
      dailyNewConceptQuota: 5,
      backlogThreshold: 30,
      suppressNewOnBacklog: true,
      listeningAudioRatio: 0.3,
      englishLocale: "en-US",
    });
  }
}

async function createNextSession(now: number): Promise<StudySession | null> {
  const settings = (await db.settings.get("settings"))!;
  const dateKey = calendar.dateKey(now);
  const ledger = await db.dailyLedgers.get(dateKey);
  const states = await db.directionStates.toArray();
  const concepts = await db.concepts.toArray();
  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
  const dueReviews = states
    .filter((state) => state.nextDueAt !== null && state.nextDueAt <= now)
    .flatMap((state) => {
      const concept = conceptById.get(state.conceptId);
      return concept && !concept.retired ? [{ state, concept }] : [];
    });
  const introducingUnit = await db.units.where("state").equals("introducing").first();
  const progress = new Set((await db.conceptProgress.toArray()).filter((item) => item.introducedAt !== null).map((item) => item.conceptId));
  const newConcepts = introducingUnit
    ? introducingUnit.conceptIds.flatMap((id) => {
        const concept = conceptById.get(id);
        return concept && !progress.has(id) && !concept.retired ? [concept] : [];
      })
    : [];
  const seed = `${dateKey}:${crypto.randomUUID()}`;
  const questions = generateSession({
    now,
    dueReviews,
    newConcepts,
    introducedToday: ledger?.quotaConsumed ?? 0,
    dailyNewConceptQuota: settings.dailyNewConceptQuota,
    suppressNewWhenDueExceeds: settings.suppressNewOnBacklog ? settings.backlogThreshold : Number.POSITIVE_INFINITY,
    seed,
    capabilities: { speechRecognitionAvailable: Boolean(getRecognitionConstructor()), listeningAudioUnlocked: false },
  });
  const session: StudySession = {
    id: crypto.randomUUID(), status: "active", seed, createdAt: now, updatedAt: now,
  };
  if (questions.length === 0) return null;
  await createStudySession(db, session, questions);
  return session;
}

export async function loadStudy(now = Date.now()): Promise<StudySnapshot> {
  await ensureDefaults(now);
  let resumable = await readResumableSession(db);
  if (!resumable) {
    const created = await createNextSession(now);
    if (!created) {
      const hasCurriculum = (await db.units.count()) > 0;
      return {
        session: { id: "no-work", status: "completed", seed: calendar.dateKey(now), createdAt: now, updatedAt: now },
        questions: [], current: null, concept: null, completed: true, emptyReason: hasCurriculum ? "no-work" : "no-curriculum",
      };
    }
    resumable = await readResumableSession(db);
  }
  if (!resumable) throw new Error("Не удалось создать учебную сессию");

  let current = resumable.questions.find((question) => question.status === "revealed" || question.status === "current") ?? null;
  if (!current) {
    const pending = resumable.questions.find((question) => question.status === "pending");
    if (pending) {
      current = await presentQuestion(db, pending.id, calendar.dateKey(now), new Date(now).getTimezoneOffset(), now);
      resumable = (await readResumableSession(db))!;
    }
  }
  let concept = current ? await db.concepts.get(current.conceptId) ?? null : null;
  if (concept) {
    const override = await db.answerOverrides.get(concept.id);
    if (override) concept = { ...concept, acceptedEn: override.acceptedEn, acceptedRu: override.acceptedRu };
  }
  return { ...resumable, current, concept, completed: !current };
}

export type ScoreMetadata = {
  completionReason?: Attempt["completionReason"];
  sttAttemptCount?: number;
  sttTranscripts?: string[][];
  sttAdapterStatus?: string;
};

export async function scoreAnswer(
  snapshot: StudySnapshot,
  correct: boolean,
  metadata: ScoreMetadata = {},
  now = Date.now(),
): Promise<StudySnapshot> {
  const question = snapshot.current;
  if (!question || question.status !== "current") throw new Error("Вопрос уже отвечен");
  const state = await db.directionStates.get(`${question.conceptId}:${question.direction}`);
  if (!state) throw new Error("Не найдено состояние слова");
  const isRemediation = question.kind === "remediation";
  let stateAfter = isRemediation ? state : applyReviewOutcome(state, correct ? "success" : "failure", now, calendar);
  if (!isRemediation && question.exerciseType.startsWith("stt_") && correct) {
    stateAfter = markSuccessfulSpokenRecall(stateAfter, now);
  }
  if (!isRemediation && question.exerciseType.startsWith("stt_") && !correct && metadata.completionReason === "third_stt_mismatch") {
    stateAfter = recordSttApparentFailure(stateAfter, now);
  }
  if (isRemediation && question.exerciseType.startsWith("mc_") && correct) {
    stateAfter = recordSttMcConfirmation(stateAfter, now);
  }
  const attempt: Attempt = {
    id: crypto.randomUUID(), conceptId: question.conceptId, direction: question.direction,
    exerciseType: question.exerciseType, occurredAt: now, outcome: correct ? "correct" : "incorrect",
    completionReason: metadata.completionReason ?? "answer",
    sttAttemptCount: metadata.sttAttemptCount ?? 0,
    sttTranscripts: metadata.sttTranscripts ?? [],
    sttAdapterStatus: metadata.sttAdapterStatus,
    stageBefore: state.stage,
    stageAfter: stateAfter.stage, isRemediationRetry: isRemediation, sessionId: question.sessionId, questionId: question.id,
  };

  let remediation: PersistedSessionQuestion | undefined;
  if (!correct && !isRemediation) {
    const domainQuestions: SessionQuestion[] = snapshot.questions.map(({ id, conceptId, direction, exerciseType, kind }) => ({
      id, conceptId, direction, exerciseType, kind,
    }));
    const failedIndex = snapshot.questions.findIndex((item) => item.id === question.id);
    const withRetry = insertRemediation(domainQuestions, failedIndex, domainQuestions[failedIndex], snapshot.session.seed);
    const retry = withRetry.find((item) => item.kind === "remediation" && !snapshot.questions.some(({ id }) => id === item.id));
    if (retry) {
      remediation = {
        ...retry,
        sessionId: question.sessionId,
        position: withRetry.findIndex((item) => item.id === retry.id),
        status: "pending",
      };
    }
  }
  await commitAnswer(db, {
    attempt,
    directionStateAfter: isRemediation && stateAfter === state ? undefined : stateAfter,
    dateKey: calendar.dateKey(now),
    utcOffsetMinutes: new Date(now).getTimezoneOffset(),
    remediation,
  });
  return loadStudy(now);
}

export async function goToNextQuestion(snapshot: StudySnapshot, now = Date.now()): Promise<StudySnapshot> {
  if (!snapshot.current) return snapshot;
  await advanceSession(db, snapshot.current.id, now);
  const session = await db.sessions.get(snapshot.session.id);
  if (session?.status === "completed") {
    const questions = (await db.sessionQuestions.filter((question) => question.sessionId === session.id).toArray())
      .sort((left, right) => left.position - right.position);
    return { session, questions, current: null, concept: null, completed: true };
  }
  return loadStudy(now);
}

export async function introducedConceptIds(): Promise<Set<string>> {
  return new Set((await db.conceptProgress.toArray()).filter((item) => item.introducedAt !== null).map((item) => item.conceptId));
}

export async function distractorCurriculum(): Promise<{ concepts: ConceptDefinition[]; units: import("../domain/curriculum/model").UnitDefinition[] }> {
  return loadDistractorCurriculum(db);
}
