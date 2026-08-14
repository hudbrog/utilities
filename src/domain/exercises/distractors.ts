import {
  answersForDirection,
  type ConceptDefinition,
  type Direction,
  type UnitDefinition,
} from "../curriculum/model";
import { createSeededRandom, shuffleWith } from "../random";
import { answerLanguage, normalizeAnswer } from "./normalization";

export class DistractorGenerationError extends Error {
  constructor(readonly conceptId: string, readonly availableCount: number) {
    super(`Concept ${conceptId} has only ${availableCount} safe distractors`);
    this.name = "DistractorGenerationError";
  }
}

export type MultipleChoiceOption = {
  conceptId: string;
  text: string;
  correct: boolean;
};

export type DistractorInput = {
  target: ConceptDefinition;
  direction: Direction;
  concepts: readonly ConceptDefinition[];
  units: readonly UnitDefinition[];
  introducedConceptIds: ReadonlySet<string>;
  seed: string;
  count?: number;
};

function normalizedAnswers(concept: ConceptDefinition, direction: Direction): Set<string> {
  const language = answerLanguage(direction);
  return new Set(answersForDirection(concept, direction).map((answer) => normalizeAnswer(answer, language)));
}

function hasAnswerOverlap(target: Set<string>, candidate: ConceptDefinition, direction: Direction): boolean {
  return [...normalizedAnswers(candidate, direction)].some((answer) => target.has(answer));
}

function rankCandidate(
  target: ConceptDefinition,
  candidate: ConceptDefinition,
  unitNumbers: ReadonlyMap<string, number>,
): number {
  const sameCategory = target.semanticCategory && target.semanticCategory === candidate.semanticCategory ? 10_000 : 0;
  const samePartOfSpeech = target.partOfSpeech && target.partOfSpeech === candidate.partOfSpeech ? 5_000 : 0;
  const unitDistance = Math.abs((unitNumbers.get(target.unitId) ?? 0) - (unitNumbers.get(candidate.unitId) ?? 0));
  const orderDistance = target.unitId === candidate.unitId ? Math.abs(target.order - candidate.order) : 1_000;
  return sameCategory + samePartOfSpeech - unitDistance * 100 - orderDistance;
}

export function buildMultipleChoiceOptions(input: DistractorInput): MultipleChoiceOption[] {
  const count = input.count ?? 3;
  const targetAnswers = normalizedAnswers(input.target, input.direction);
  const unitNumbers = new Map(input.units.map((unit) => [unit.id, unit.number]));
  const safeCandidates = input.concepts.filter(
    (candidate) =>
      candidate.id !== input.target.id &&
      !candidate.unsuitableReason &&
      !hasAnswerOverlap(targetAnswers, candidate, input.direction),
  );
  const ranked = (candidates: readonly ConceptDefinition[]) =>
    [...candidates].sort((left, right) => {
      const scoreDifference = rankCandidate(input.target, right, unitNumbers) - rankCandidate(input.target, left, unitNumbers);
      return scoreDifference || left.id.localeCompare(right.id);
    });

  const introduced = ranked(safeCandidates.filter((candidate) => input.introducedConceptIds.has(candidate.id)));
  const expanded = ranked(safeCandidates.filter((candidate) => !input.introducedConceptIds.has(candidate.id)));
  const candidates = [...introduced, ...expanded];
  if (candidates.length < count) throw new DistractorGenerationError(input.target.id, candidates.length);

  const random = createSeededRandom(input.seed);
  const chosen: ConceptDefinition[] = [];
  const takeFromTier = (tier: ConceptDefinition[]) => {
    const remaining = count - chosen.length;
    if (remaining <= 0) return;
    const boundedPool = tier.slice(0, Math.max(remaining * 3, remaining));
    chosen.push(...shuffleWith(boundedPool, random).slice(0, remaining));
  };
  takeFromTier(introduced);
  takeFromTier(expanded);

  const canonicalText = (concept: ConceptDefinition) =>
    input.direction === "en-ru" ? concept.ru : concept.en;
  return shuffleWith(
    [
      { conceptId: input.target.id, text: canonicalText(input.target), correct: true },
      ...chosen.map((concept) => ({ conceptId: concept.id, text: canonicalText(concept), correct: false })),
    ],
    random,
  );
}
