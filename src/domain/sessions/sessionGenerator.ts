import type { ConceptDefinition, Direction } from "../curriculum/model";
import type { ExerciseCapabilities, ExerciseType } from "../exercises/policy";
import { selectExerciseType } from "../exercises/policy";
import { createSeededRandom, shuffleWith } from "../random";
import type { DirectionState } from "../scheduler/model";
import { retrievabilityAt } from "../scheduler/scheduler";
import { createLocalStudyCalendar } from "../scheduler/studyCalendar";

export type ReviewCandidate = {
  concept: ConceptDefinition;
  state: DirectionState;
};

export type SessionQuestion = {
  id: string;
  conceptId: string;
  direction: Direction;
  exerciseType: ExerciseType;
  kind: "review" | "introduction" | "remediation";
  sourceExerciseType?: ExerciseType;
};

export type SessionGenerationInput = {
  now: number;
  dueReviews: readonly ReviewCandidate[];
  newConcepts: readonly ConceptDefinition[];
  introducedToday: number;
  dailyNewConceptQuota?: number;
  suppressNewWhenDueExceeds?: number;
  chunkSize?: number;
  seed: string;
  capabilities: ExerciseCapabilities;
};

function compareDue(left: ReviewCandidate, right: ReviewCandidate, now: number): number {
  const calendar = createLocalStudyCalendar();
  const leftRetrievability = retrievabilityAt(left.state, now, calendar) ?? 0;
  const rightRetrievability = retrievabilityAt(right.state, now, calendar) ?? 0;
  const bothUseFsrs = left.state.scheduler === "fsrs-6" && right.state.scheduler === "fsrs-6";
  return (
    (bothUseFsrs ? leftRetrievability - rightRetrievability : 0) ||
    (left.state.nextDueAt ?? Number.POSITIVE_INFINITY) - (right.state.nextDueAt ?? Number.POSITIVE_INFINITY) ||
    left.concept.id.localeCompare(right.concept.id) ||
    left.state.direction.localeCompare(right.state.direction)
  );
}

function introductionQuestion(
  concept: ConceptDefinition,
  direction: Direction,
): SessionQuestion {
  return {
    id: `intro:${concept.id}:${direction}`,
    conceptId: concept.id,
    direction,
    exerciseType: "mc_text",
    kind: "introduction",
  };
}

function interleave<T>(left: readonly T[], right: readonly T[]): T[] {
  const result: T[] = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== undefined) result.push(left[index]);
    if (right[index] !== undefined) result.push(right[index]);
  }
  return result;
}

export function generateSession(input: SessionGenerationInput): SessionQuestion[] {
  const chunkSize = input.chunkSize ?? 15;
  const dailyQuota = input.dailyNewConceptQuota ?? 5;
  const backlogThreshold = input.suppressNewWhenDueExceeds ?? 30;
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new RangeError("Chunk size must be positive");

  const due = input.dueReviews
    .filter((candidate) => candidate.state.nextDueAt !== null && candidate.state.nextDueAt <= input.now)
    .sort((left, right) => compareDue(left, right, input.now));
  const quotaRemaining = Math.max(0, dailyQuota - input.introducedToday);
  const introductionCapacity = Math.floor(chunkSize / 2);
  const newCount = due.length > backlogThreshold ? 0 : Math.min(quotaRemaining, introductionCapacity, input.newConcepts.length);
  const newConcepts = input.newConcepts.slice(0, newCount);

  const firstDirections = newConcepts.map((concept) => introductionQuestion(concept, "en-ru"));
  const secondDirections = newConcepts.map((concept) => introductionQuestion(concept, "ru-en"));
  const introductions = [...firstDirections, ...secondDirections];

  const reviewSlots = Math.max(0, chunkSize - introductions.length);
  const reviews = due.slice(0, reviewSlots).map(({ concept, state }, index) => ({
    id: `review:${state.key}`,
    conceptId: concept.id,
    direction: state.direction,
    exerciseType: selectExerciseType(
      state,
      { ...input.capabilities, listeningAudioUnlocked: input.capabilities.listeningAudioUnlocked || state.successfulSpokenRecall },
      `${input.seed}:review:${index}:${state.key}`,
    ),
    kind: "review" as const,
  }));

  return interleave<SessionQuestion>(reviews, introductions).slice(0, chunkSize);
}

export function insertRemediation(
  questions: readonly SessionQuestion[],
  failedQuestionIndex: number,
  failedQuestion: SessionQuestion,
  seed: string,
): SessionQuestion[] {
  if (failedQuestionIndex < 0 || failedQuestionIndex >= questions.length) {
    throw new RangeError("Failed question index is outside the session");
  }
  const random = createSeededRandom(`${seed}:${failedQuestion.id}:${failedQuestionIndex}`);
  const delay = 3 + Math.floor(random() * 3);
  const insertionIndex = Math.min(questions.length, failedQuestionIndex + 1 + delay);
  const remediation: SessionQuestion = {
    ...failedQuestion,
    id: `remediation:${failedQuestion.id}:${failedQuestionIndex}`,
    exerciseType: failedQuestion.exerciseType.endsWith("audio") ? "mc_audio" : "mc_text",
    sourceExerciseType: failedQuestion.sourceExerciseType ?? failedQuestion.exerciseType,
    kind: "remediation",
  };
  const result = [...questions];
  result.splice(insertionIndex, 0, remediation);
  return result;
}

export function shuffleEqualPriority<T>(values: readonly T[], seed: string): T[] {
  return shuffleWith(values, createSeededRandom(seed));
}
