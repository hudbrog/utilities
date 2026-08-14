import { answersForDirection, type ConceptDefinition, type Direction } from "../curriculum/model";
import { answerLanguage, normalizeAnswer } from "./normalization";

export function isAcceptedAnswer(
  input: string,
  concept: ConceptDefinition,
  direction: Direction,
): boolean {
  const language = answerLanguage(direction);
  const normalizedInput = normalizeAnswer(input, language);
  return answersForDirection(concept, direction).some(
    (answer) => normalizeAnswer(answer, language) === normalizedInput,
  );
}
