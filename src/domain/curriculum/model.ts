export type Direction = "en-ru" | "ru-en";

export type UnitDefinition = {
  id: string;
  number: number;
  titleRu?: string;
  conceptIds: string[];
};

export type ConceptDefinition = {
  id: string;
  unitId: string;
  order: number;
  en: string;
  ru: string;
  acceptedEn: string[];
  acceptedRu: string[];
  partOfSpeech?: string;
  semanticCategory?: string;
  unsuitableReason?: string;
};

export type CurriculumBundle = {
  schemaVersion: 1;
  curriculumId: "duolingo-ru-en";
  curriculumVersion: string;
  sourceFingerprint: string;
  units: UnitDefinition[];
  concepts: ConceptDefinition[];
};

export function answersForDirection(
  concept: ConceptDefinition,
  direction: Direction,
): string[] {
  const canonical = direction === "en-ru" ? concept.ru : concept.en;
  const accepted = direction === "en-ru" ? concept.acceptedRu : concept.acceptedEn;
  return [...new Set([canonical, ...accepted])];
}
