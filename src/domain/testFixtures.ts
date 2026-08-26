import type { ConceptDefinition, Direction, UnitDefinition } from "./curriculum/model";
import type { DirectionState, MasteryStage } from "./scheduler/model";

export const units: UnitDefinition[] = [
  { id: "unit-1", number: 1, conceptIds: ["cat", "dog", "bird", "fish"] },
  { id: "unit-2", number: 2, conceptIds: ["house"] },
];

export const concepts: ConceptDefinition[] = [
  { id: "cat", unitId: "unit-1", order: 0, en: "cat", ru: "кот", acceptedEn: [], acceptedRu: ["кошка"], partOfSpeech: "noun", semanticCategory: "animals" },
  { id: "dog", unitId: "unit-1", order: 1, en: "dog", ru: "собака", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals" },
  { id: "bird", unitId: "unit-1", order: 2, en: "bird", ru: "птица", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals" },
  { id: "fish", unitId: "unit-1", order: 3, en: "fish", ru: "рыба", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "animals" },
  { id: "house", unitId: "unit-2", order: 0, en: "house", ru: "дом", acceptedEn: ["home"], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "places" },
];

export function makeState(
  conceptId = "cat",
  direction: Direction = "ru-en",
  stage: MasteryStage = 0,
  overrides: Partial<DirectionState> = {},
): DirectionState {
  return {
    key: `${conceptId}:${direction}`,
    conceptId,
    direction,
    introduced: stage > 0,
    stage,
    scheduler: "fsrs-6",
    memoryState: stage > 0 ? "review" : "new",
    stability: stage > 0 ? Math.max(0.212, [0, 1, 3, 7, 14, 30, 60, 120][stage]) : null,
    difficulty: stage > 0 ? 5 : null,
    lastReviewAt: stage > 0 ? 0 : null,
    scheduledDays: [0, 1, 3, 7, 14, 30, 60, 120][stage],
    reps: stage,
    lapses: 0,
    successfulReviewCount: stage,
    nextDueAt: 0,
    successfulSpokenRecall: false,
    recentFailureCount: 0,
    lifetimeFailureCount: 0,
    sttApparentFailureCount: 0,
    sttMcConfirmationCount: 0,
    sttProblematic: false,
    updatedAt: 0,
    ...overrides,
  };
}
