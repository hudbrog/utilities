import type { ConceptDefinition, CurriculumBundle } from "./model";

// Identity matching deliberately preserves punctuation: "can't" is not "cant".
const textKey = (text: string) => text.normalize("NFC").trim().toLocaleLowerCase("en-US").replace(/ё/g, "е").replace(/\s+/g, " ");
export const importedId = (sourceId: string, itemId: string) => `import:${encodeURIComponent(sourceId)}:${encodeURIComponent(itemId)}`;
export type ImportChoice = "new" | "skip" | "review" | `link:${string}`;
export type ImportRow = {
  concept: ConceptDefinition;
  candidates: ConceptDefinition[];
  choice: ImportChoice;
  ambiguous: boolean;
};

export function planCurriculumImport(bundle: CurriculumBundle, existing: ConceptDefinition[]): ImportRow[] {
  const candidates = [...existing];
  return bundle.concepts.map((concept) => {
    const english = new Set([concept.en, ...concept.acceptedEn].map(textKey));
    const matches = candidates.filter((item) => [item.en, ...item.acceptedEn].some((answer) => english.has(textKey(answer))));
    const ambiguous = /[\/;]/.test(concept.ru) || Boolean(concept.unsuitableReason);
    const exact = ambiguous ? [] : matches.filter((item) =>
      !item.unsuitableReason && textKey(item.en) === textKey(concept.en) && textKey(item.ru) === textKey(concept.ru) &&
      (!item.partOfSpeech || !concept.partOfSpeech || textKey(item.partOfSpeech) === textKey(concept.partOfSpeech)));
    const choice: ImportChoice = exact.length === 1 ? `link:${exact[0].id}` : matches.length || ambiguous ? "review" : "new";
    // Later duplicate entries in this file can point at the first new identity.
    if (choice === "new") candidates.push({ ...concept, id: importedId(bundle.curriculumId, concept.id) });
    return { concept, candidates: matches, choice, ambiguous };
  });
}
