import Dexie from "dexie";

import type { DirectionState } from "../../domain/scheduler/model";
import type { SessionQuestion } from "../../domain/sessions/sessionGenerator";
import type { EnglishSrsDatabase } from "./database";
import type { Attempt, DailyLedger, PersistedSessionQuestion, StudySession } from "./model";

export class QuestionAlreadyAnsweredError extends Error {}
export class SessionStateError extends Error {}

function initialLedger(dateKey: string, utcOffsetMinutes: number, now: number): DailyLedger {
  return {
    dateKey,
    utcOffsetMinutes,
    introducedConceptIds: [],
    quotaConsumed: 0,
    questionsCompleted: 0,
    immediateMistakes: 0,
    updatedAt: now,
  };
}

export async function createStudySession(
  db: EnglishSrsDatabase,
  session: StudySession,
  questions: readonly SessionQuestion[],
): Promise<void> {
  const records: PersistedSessionQuestion[] = questions.map((question, position) => ({
    ...question,
    sessionId: session.id,
    position,
    status: "pending",
  }));
  await db.transaction("rw", db.sessions, db.sessionQuestions, async () => {
    const active = await db.sessions.where("status").equals("active").first();
    if (active) throw new SessionStateError(`Session ${active.id} is already active`);
    await db.sessions.add(session);
    await db.sessionQuestions.bulkAdd(records);
  });
}

export async function readResumableSession(db: EnglishSrsDatabase): Promise<{
  session: StudySession;
  questions: PersistedSessionQuestion[];
} | null> {
  const session = await db.sessions.where("status").equals("active").first();
  if (!session) return null;
  const questions = await db.sessionQuestions
    .where("[sessionId+position]")
    .between([session.id, Dexie.minKey], [session.id, Dexie.maxKey])
    .toArray();
  return { session, questions };
}

export async function presentQuestion(
  db: EnglishSrsDatabase,
  questionId: string,
  dateKey: string,
  utcOffsetMinutes: number,
  now: number,
): Promise<PersistedSessionQuestion> {
  return db.transaction("rw", [db.sessionQuestions, db.units, db.concepts, db.conceptProgress, db.directionStates, db.dailyLedgers], async () => {
    const question = await db.sessionQuestions.get(questionId);
    if (!question || question.status !== "pending") throw new SessionStateError("Question is not pending");
    const current = await db.sessionQuestions.where("[sessionId+status]").equals([question.sessionId, "current"]).first();
    if (current) throw new SessionStateError(`Question ${current.id} is already current`);

    if (question.kind === "introduction") {
      const progress = await db.conceptProgress.get(question.conceptId);
      if (progress?.introducedAt == null) {
        const concept = await db.concepts.get(question.conceptId);
        if (!concept) throw new SessionStateError(`Unknown concept: ${question.conceptId}`);
        await db.conceptProgress.put({
          conceptId: question.conceptId,
          introducedAt: now,
          introducedFromUnitId: progress?.introducedFromUnitId || concept.unitId,
          skipped: progress?.skipped ?? false,
          retired: progress?.retired ?? false,
        });
        const ledger = (await db.dailyLedgers.get(dateKey)) ?? initialLedger(dateKey, utcOffsetMinutes, now);
        if (!ledger.introducedConceptIds.includes(question.conceptId)) {
          ledger.introducedConceptIds.push(question.conceptId);
          ledger.quotaConsumed += 1;
          ledger.updatedAt = now;
          await db.dailyLedgers.put(ledger);
        }
        const unit = await db.units.get(concept.unitId);
        if (unit) {
          const progressRows = await db.conceptProgress.bulkGet(unit.conceptIds);
          if (progressRows.every((item) => item?.introducedAt != null)) {
            await db.units.put({ ...unit, state: "fully_introduced" });
          }
        }
      }
    }

    const key = `${question.conceptId}:${question.direction}`;
    if (!(await db.directionStates.get(key))) {
      await db.directionStates.add({
        key,
        conceptId: question.conceptId,
        direction: question.direction,
        introduced: true,
        stage: 0,
        nextDueAt: null,
        successfulSpokenRecall: false,
        recentFailureCount: 0,
        lifetimeFailureCount: 0,
        sttApparentFailureCount: 0,
        sttMcConfirmationCount: 0,
        sttProblematic: false,
        updatedAt: now,
      });
    }
    const presented = { ...question, status: "current" as const };
    await db.sessionQuestions.put(presented);
    return presented;
  });
}

export type CommitAnswerInput = {
  attempt: Attempt;
  directionStateAfter?: DirectionState;
  dateKey: string;
  utcOffsetMinutes: number;
  remediation?: PersistedSessionQuestion;
  injectFailure?: () => void;
};

export async function commitAnswer(db: EnglishSrsDatabase, input: CommitAnswerInput): Promise<void> {
  await db.transaction(
    "rw",
    db.attempts,
    db.directionStates,
    db.dailyLedgers,
    db.sessionQuestions,
    db.sessions,
    async () => {
      const question = await db.sessionQuestions.get(input.attempt.questionId);
      if (!question || question.status !== "current") throw new QuestionAlreadyAnsweredError(input.attempt.questionId);
      if (await db.attempts.where("questionId").equals(input.attempt.questionId).first()) {
        throw new QuestionAlreadyAnsweredError(input.attempt.questionId);
      }
      await db.attempts.add(input.attempt);
      if (!input.attempt.isRemediationRetry && input.directionStateAfter) {
        await db.directionStates.put(input.directionStateAfter);
      }
      const ledger = (await db.dailyLedgers.get(input.dateKey)) ??
        initialLedger(input.dateKey, input.utcOffsetMinutes, input.attempt.occurredAt);
      ledger.questionsCompleted += 1;
      if (input.attempt.outcome === "incorrect") ledger.immediateMistakes += 1;
      ledger.updatedAt = input.attempt.occurredAt;
      await db.dailyLedgers.put(ledger);
      await db.sessionQuestions.put({ ...question, status: "revealed", revealedOutcome: input.attempt.outcome });

      if (input.remediation) {
        const later = await db.sessionQuestions
          .where("[sessionId+position]")
          .between([question.sessionId, input.remediation.position], [question.sessionId, Dexie.maxKey], true, true)
          .reverse()
          .toArray();
        await db.sessionQuestions.bulkPut(later.map((item) => ({ ...item, position: item.position + 1 })));
        await db.sessionQuestions.add(input.remediation);
      }
      input.injectFailure?.();
    },
  );
}

export async function advanceSession(db: EnglishSrsDatabase, questionId: string, now: number): Promise<void> {
  await db.transaction("rw", db.sessions, db.sessionQuestions, async () => {
    const question = await db.sessionQuestions.get(questionId);
    if (!question || question.status !== "revealed") throw new SessionStateError("Question is not revealed");
    await db.sessionQuestions.put({ ...question, status: "completed" });
    const next = await db.sessionQuestions
      .where("[sessionId+position]")
      .between([question.sessionId, question.position], [question.sessionId, Dexie.maxKey], false, true)
      .first();
    if (!next) {
      const session = await db.sessions.get(question.sessionId);
      if (session) await db.sessions.put({ ...session, status: "completed", updatedAt: now });
    }
  });
}
