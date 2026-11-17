import { expect, test } from "vitest";
import workbookFile from "../../../public/academy-stars-1.json";
import { planCurriculumImport } from "./import";
import { parseCurriculumBundle } from "./schema";
import { newConceptsAcrossSources } from "./newConcepts";
import { concepts } from "../testFixtures";

const bundle = (en: string, ru: string) => parseCurriculumBundle({
  schemaVersion: 1, curriculumId: "school", curriculumVersion: "1", sourceFingerprint: "test",
  units: [{ id: "welcome", number: 0, conceptIds: ["word"] }],
  concepts: [{ id: "word", unitId: "welcome", order: 0, en, ru, acceptedEn: [], acceptedRu: [] }],
});

test("loads the actual workbook including Welcome and optional extras", () => {
  const workbook = parseCurriculumBundle(workbookFile);
  expect(workbook.units).toHaveLength(22);
  expect(workbook.concepts).toHaveLength(263);
  const orange = planCurriculumImport(workbook, []).find((row) => row.concept.en === "orange")!;
  expect(orange).toMatchObject({ ambiguous: true, choice: "review" });
});

test("matches both canonical forms but leaves aliases and other meanings for review", () => {
  const cat = { ...concepts[0], id: "cat", en: "cat", ru: "кошка", acceptedRu: ["кот"] };
  expect(planCurriculumImport(bundle(" CAT ", "Кошка"), [cat])[0].choice).toBe("link:cat");
  expect(planCurriculumImport(bundle("cat", "кот"), [cat])[0].choice).toBe("review");
  const fruit = { ...cat, id: "fruit", en: "orange", ru: "апельсин" };
  expect(planCurriculumImport(bundle("orange", "оранжевый"), [fruit])[0].choice).toBe("review");
  expect(planCurriculumImport(bundle("orange", "апельсин / оранжевый"), [fruit])[0].choice).toBe("review");
});

test("does not collapse punctuation or conflicting parts of speech", () => {
  const cannot = { ...concepts[0], en: "can't", ru: "не могу", partOfSpeech: "verb" };
  expect(planCurriculumImport(bundle("cant", "не могу"), [cannot])[0].choice).toBe("new");
  const noun = bundle("can't", "не могу"); noun.concepts[0].partOfSpeech = "noun";
  expect(planCurriculumImport(noun, [cannot])[0].choice).toBe("review");
});

test("keeps uncertain duplicate targets for explicit review", () => {
  const b = bundle("cat", "кот");
  expect(planCurriculumImport(b, [0, 1].map((id) => ({ ...b.concepts[0], id: String(id) })))[0].choice).toBe("review");
});

test("interleaves sources without duplicating shared words or starving a source across small chunks", () => {
  const words = ["a", "shared", "b", "c"].map((id) => ({ ...concepts[0], id }));
  const units = [
    { number: 1, curriculumId: "duolingo", conceptIds: ["a", "shared", "b"] },
    { number: 0, curriculumId: "school", conceptIds: ["shared", "c"] },
  ];
  expect(newConceptsAcrossSources(units, words, new Set(), 0).map(({ id }) => id)).toEqual(["a", "shared", "b", "c"]);
  expect(newConceptsAcrossSources(units, words, new Set(["a"]), 1)[0].id).toBe("shared");
  expect(newConceptsAcrossSources(units, words, new Set(["shared"]), 0).map(({ id }) => id)).toEqual(["a", "c", "b"]);
});

test("a quota of one can continue from the other source on the next study day", () => {
  const words = ["a", "b", "c", "d"].map((id) => ({ ...concepts[0], id }));
  const units = [
    { number: 1, curriculumId: "duolingo", conceptIds: ["a", "b"] },
    { number: 1, curriculumId: "school", conceptIds: ["c", "d"] },
  ];
  const introduced = new Set<string>();
  const selected: string[] = [];
  for (let day = 0; day < 4; day++) {
    const first = newConceptsAcrossSources(units, words, introduced, introduced.size)[0];
    introduced.add(first.id); selected.push(first.id);
  }
  expect(selected).toEqual(["a", "c", "b", "d"]);
});
