import type { CurriculumBundle } from "../domain/curriculum/model";

export const fixtureCurriculum: CurriculumBundle = {
  schemaVersion: 1,
  curriculumId: "duolingo-ru-en",
  curriculumVersion: "fixture-2026-08-14",
  sourceFingerprint: "fixture:not-production-curriculum",
  units: [
    {
      id: "fixture-family",
      number: 1,
      titleRu: "Семья и дом",
      conceptIds: ["daughter", "mother", "father", "sister", "brother", "family", "house", "room"],
    },
  ],
  concepts: [
    { id: "daughter", unitId: "fixture-family", order: 0, en: "daughter", ru: "дочь", acceptedEn: [], acceptedRu: ["дочка"], partOfSpeech: "noun", semanticCategory: "family" },
    { id: "mother", unitId: "fixture-family", order: 1, en: "mother", ru: "мама", acceptedEn: ["mom", "mum"], acceptedRu: ["мать"], partOfSpeech: "noun", semanticCategory: "family" },
    { id: "father", unitId: "fixture-family", order: 2, en: "father", ru: "папа", acceptedEn: ["dad"], acceptedRu: ["отец"], partOfSpeech: "noun", semanticCategory: "family" },
    { id: "sister", unitId: "fixture-family", order: 3, en: "sister", ru: "сестра", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "family" },
    { id: "brother", unitId: "fixture-family", order: 4, en: "brother", ru: "брат", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "family" },
    { id: "family", unitId: "fixture-family", order: 5, en: "family", ru: "семья", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "family" },
    { id: "house", unitId: "fixture-family", order: 6, en: "house", ru: "дом", acceptedEn: ["home"], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "home" },
    { id: "room", unitId: "fixture-family", order: 7, en: "room", ru: "комната", acceptedEn: [], acceptedRu: [], partOfSpeech: "noun", semanticCategory: "home" },
  ],
};
