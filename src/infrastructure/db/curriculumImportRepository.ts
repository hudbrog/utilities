import type { ConceptDefinition, CurriculumBundle } from "../../domain/curriculum/model";
import { importedId, planCurriculumImport, type ImportChoice } from "../../domain/curriculum/import";
import { parseCurriculumBundle } from "../../domain/curriculum/schema";
import type { EnglishSrsDatabase } from "./database";
import type { ImportedCurriculum, InstalledConcept, InstalledUnit } from "./model";
import { refreshConceptAvailability } from "./conceptAvailability";

export async function importCurriculum(
  db: EnglishSrsDatabase,
  input: unknown,
  title: string,
  candidates: ConceptDefinition[],
  choices: Record<string, ImportChoice>,
  now = Date.now(),
): Promise<ImportedCurriculum> {
  const bundle: CurriculumBundle = parseCurriculumBundle(input);
  if (bundle.curriculumId === "duolingo-ru-en") throw new Error("Для Duolingo используйте проверку блоков курса.");
  if (!title.trim()) throw new Error("Введите название курса.");
  return db.transaction("rw", [db.importedCurricula, db.units, db.concepts, db.conceptProgress], async () => {
    const previous = await db.importedCurricula.get(bundle.curriculumId);
    if (previous) {
      if (JSON.stringify(previous.bundle) !== JSON.stringify(bundle)) {
        throw new Error("Этот курс уже импортирован. Для нового набора блоков используйте новый curriculumId.");
      }
      return previous;
    }
    const installed = await db.concepts.toArray();
    const existing = new Map(candidates.map((concept) => [concept.id, concept]));
    installed.filter((concept) => !concept.retired).forEach((concept) => existing.set(concept.id, concept));
    const rows = planCurriculumImport(bundle, [...existing.values()]);
    const definitions = new Map<string, InstalledConcept>();
    const conceptMap: Record<string, string | null> = Object.create(null);
    for (const row of rows) {
      const choice = choices[row.concept.id] ?? row.choice;
      if (choice === "review") throw new Error(`Проверьте совпадение: ${row.concept.en}`);
      if (choice === "skip") { conceptMap[row.concept.id] = null; continue; }
      if (choice === "new") {
        const id = importedId(bundle.curriculumId, row.concept.id);
        definitions.set(id, { ...row.concept, id, unitId: importedId(bundle.curriculumId, row.concept.unitId), retired: false });
        conceptMap[row.concept.id] = id;
      } else {
        const id = choice.slice(5);
        const target = existing.get(id) ?? definitions.get(id);
        // Only links offered in this preview are valid; no dangling or arbitrary IDs.
        if (!target || !row.candidates.some((candidate) => candidate.id === id)) throw new Error(`Совпадение изменилось: ${row.concept.en}. Откройте предпросмотр заново.`);
        if (row.ambiguous) throw new Error(`Разделите значения слова ${row.concept.en} перед объединением или пропустите его.`);
        if (!installed.some((concept) => concept.id === id && !concept.retired)) definitions.set(id, { ...target, retired: false });
        conceptMap[row.concept.id] = id;
      }
    }
    const introduced = new Set((await db.conceptProgress.toArray()).filter((item) => item.introducedAt !== null).map((item) => item.conceptId));
    const units: InstalledUnit[] = bundle.units.map((unit) => {
      const conceptIds = [...new Set(unit.conceptIds.flatMap((id) => conceptMap[id] ? [conceptMap[id]!] : []))];
      return {
        ...unit, id: importedId(bundle.curriculumId, unit.id), conceptIds,
        curriculumId: bundle.curriculumId, curriculumTitle: title.trim(), available: true,
        state: conceptIds.length && conceptIds.every((id) => introduced.has(id)) ? "fully_introduced" : "inactive",
      };
    });
    const source: ImportedCurriculum = { id: bundle.curriculumId, title: title.trim(), bundle, conceptMap, importedAt: now };
    await db.concepts.bulkPut([...definitions.values()]);
    await db.units.bulkPut(units);
    await db.importedCurricula.add(source);
    await refreshConceptAvailability(db);
    return source;
  });
}
