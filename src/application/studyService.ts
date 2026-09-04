import type { ConceptDefinition } from "../domain/curriculum/model";
import {
  applyReviewRating,
  markSuccessfulSpokenRecall,
  migrateLegacyState,
  normalizeDirectionState,
  ratingForPerformance,
  recordSttApparentFailure,
  recordSttMcConfirmation,
  retrievabilityAt,
} from "../domain/scheduler/scheduler";
import { createLocalStudyCalendar } from "../domain/scheduler/studyCalendar";
import { generateSession, insertRemediation, type SessionQuestion } from "../domain/sessions/sessionGenerator";
import { getRecognitionConstructor } from "../infrastructure/speech/recognition";
import { initializeCurriculumReview, loadDistractorCurriculum } from "../infrastructure/db/curriculumReviewRepository";
import { db } from "../infrastructure/db/database";
import { loadLearnerSettings } from "../infrastructure/db/settingsRepository";
import type { Attempt, PersistedSessionQuestion, StudySession } from "../infrastructure/db/model";
import {
  advanceSession,
  commitAnswer,
  createStudySession,
  presentQuestion,
  readResumableSession,
  reconcileResumableSession,
  recoverUnfinishedIntroductions,
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
  await loadLearnerSettings(db);
}

async function createNextSession(now: number): Promise<StudySession | null> {
  await recoverUnfinishedIntroductions(db);
  const settings = await loadLearnerSettings(db);
  const dateKey = calendar.dateKey(now);
  const ledger = await db.dailyLedgers.get(dateKey);
  const states = (await db.directionStates.toArray()).map(normalizeDirectionState);
  const concepts = await db.concepts.toArray();
  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
  const dueReviews = states
    .filter((state) => state.nextDueAt !== null && state.nextDueAt <= now)
    .flatMap((state) => {
      const concept = conceptById.get(state.conceptId);
      return concept && !concept.retired ? [{ state, concept }] : [];
    });
  const introducingUnits = (await db.units.where("state").equals("introducing").toArray())
    .sort((left, right) => left.number - right.number);
  const progress = new Set((await db.conceptProgress.toArray()).filter((item) => item.introducedAt !== null).map((item) => item.conceptId));
  const newConcepts = introducingUnits.flatMap((unit) =>
    unit.conceptIds.flatMap((id) => {
      const concept = conceptById.get(id);
      return concept && !progress.has(id) && !concept.retired ? [concept] : [];
    }),
  );
  const seed = `${dateKey}:${crypto.randomUUID()}`;
  const questions = generateSession({
    now,
    dueReviews,
    newConcepts,
    introducedToday: ledger?.quotaConsumed ?? 0,
    dailyNewConceptQuota: settings.dailyNewConceptQuota,
    suppressNewWhenDueExceeds: settings.suppressNewOnBacklog ? settings.backlogThreshold : Number.POSITIVE_INFINITY,
    chunkSize: settings.sessionQuestionLimit,
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
  await reconcileResumableSession(db, now);
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
  completionMode?: Attempt["completionMode"];
};

function historicalRating(attempt: Attempt) {
  return attempt.rating ?? ratingForPerformance(
    attempt.outcome === "correct",
    attempt.completionMode ?? (attempt.exerciseType.startsWith("stt_") ? "speech" : "multiple-choice"),
    attempt.sttAttemptCount,
  );
}

export async function scoreAnswer(
  snapshot: StudySnapshot,
  correct: boolean,
  metadata: ScoreMetadata = {},
  now = Date.now(),
): Promise<StudySnapshot> {
  const question = snapshot.current;
  if (!question || question.status !== "current") throw new Error("Вопрос уже отвечен");
  const storedState = await db.directionStates.get(`${question.conceptId}:${question.direction}`);
  if (!storedState) throw new Error("Не найдено состояние слова");
  let state = normalizeDirectionState(storedState);
  if (state.scheduler === "legacy-stage") {
    const history = await db.attempts.where("conceptId").equals(question.conceptId)
      .filter((attempt) => attempt.direction === question.direction && !attempt.isRemediationRetry)
      .toArray();
    state = migrateLegacyState(
      state,
      history.map((attempt) => ({ occurredAt: attempt.occurredAt, rating: historicalRating(attempt) })),
      calendar,
    );
  }
  const isRemediation = question.kind === "remediation";
  const completionMode = metadata.completionMode ?? (question.exerciseType.startsWith("stt_") ? "speech" : "multiple-choice");
  const rating = ratingForPerformance(correct, completionMode, metadata.sttAttemptCount ?? 0);
  let stateAfter = isRemediation ? state : applyReviewRating(state, rating, now, calendar);
  if (!isRemediation && completionMode === "speech" && correct) {
    stateAfter = markSuccessfulSpokenRecall(stateAfter, now);
  }
  if (!isRemediation && completionMode === "speech" && !correct && metadata.completionReason === "third_stt_mismatch") {
    stateAfter = recordSttApparentFailure(stateAfter, now);
  }
  if (isRemediation && question.sourceExerciseType?.startsWith("stt_") && completionMode === "multiple-choice" && correct) {
    stateAfter = recordSttMcConfirmation(stateAfter, now);
  }
  const attempt: Attempt = {
    id: crypto.randomUUID(), conceptId: question.conceptId, direction: question.direction,
    exerciseType: question.exerciseType, occurredAt: now, outcome: correct ? "correct" : "incorrect",
    completionReason: metadata.completionReason ?? "answer",
    sttAttemptCount: metadata.sttAttemptCount ?? 0,
    sttTranscripts: metadata.sttTranscripts ?? [],
    sttAdapterStatus: metadata.sttAdapterStatus,
    completionMode,
    schedulerVersion: "fsrs-6",
    rating: isRemediation ? undefined : rating,
    stabilityBefore: state.stability,
    difficultyBefore: state.difficulty,
    retrievabilityBefore: retrievabilityAt(state, now, calendar),
    stabilityAfter: stateAfter.stability,
    difficultyAfter: stateAfter.difficulty,
    scheduledDaysAfter: stateAfter.scheduledDays,
    stageBefore: state.stage,
    stageAfter: stateAfter.stage, isRemediationRetry: isRemediation, sessionId: question.sessionId, questionId: question.id,
  };

  let remediation: PersistedSessionQuestion | undefined;
  if (!correct && !isRemediation) {
    const domainQuestions: SessionQuestion[] = snapshot.questions.map(({ id, conceptId, direction, exerciseType, kind, sourceExerciseType }) => ({
      id, conceptId, direction, exerciseType, kind, sourceExerciseType,
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
