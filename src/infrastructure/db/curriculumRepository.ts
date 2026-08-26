import type { CurriculumBundle } from "../../domain/curriculum/model";
import { parseCurriculumBundle } from "../../domain/curriculum/schema";
import type { EnglishSrsDatabase } from "./database";
import type { InstalledConcept, InstalledUnit } from "./model";

export async function installCurriculum(
  db: EnglishSrsDatabase,
  input: unknown,
  now: number,
): Promise<CurriculumBundle> {
  const bundle = parseCurriculumBundle(input);
  await db.transaction("rw", db.appMeta, db.units, db.concepts, db.conceptProgress, async () => {
    const [existingUnits, existingConcepts] = await Promise.all([db.units.toArray(), db.concepts.toArray()]);
    const unitState = new Map(existingUnits.map((unit) => [unit.id, unit.state]));
    const packagedConceptIds = new Set(bundle.concepts.map((concept) => concept.id));

    const units: InstalledUnit[] = bundle.units.map((unit) => ({
      ...unit,
      state: unitState.get(unit.id) ?? "inactive",
    }));
    const concepts: InstalledConcept[] = bundle.concepts.map((concept) => ({ ...concept, retired: false }));

    await db.units.bulkPut(units);
    await db.concepts.bulkPut(concepts);
    for (const oldConcept of existingConcepts) {
      if (!packagedConceptIds.has(oldConcept.id)) {
        await db.concepts.put({ ...oldConcept, retired: true });
        const progress = await db.conceptProgress.get(oldConcept.id);
        if (progress) await db.conceptProgress.put({ ...progress, retired: true });
      }
    }
    await db.appMeta.put({ key: "curriculumVersion", value: bundle.curriculumVersion, updatedAt: now });
    await db.appMeta.put({ key: "sourceFingerprint", value: bundle.sourceFingerprint, updatedAt: now });
  });
  return bundle;
}

export async function setIntroducingUnit(db: EnglishSrsDatabase, unitId: string): Promise<void> {
  await db.transaction("rw", db.units, async () => {
    const target = await db.units.get(unitId);
    if (!target) throw new Error(`Unknown unit: ${unitId}`);
    if (target.state === "fully_introduced") return;
    await db.units.put({ ...target, state: "introducing" });
  });
}

export async function pauseIntroducingUnit(db: EnglishSrsDatabase, unitId: string): Promise<void> {
  await db.transaction("rw", db.units, async () => {
    const target = await db.units.get(unitId);
    if (!target) throw new Error(`Unknown unit: ${unitId}`);
    if (target.state === "introducing") await db.units.put({ ...target, state: "inactive" });
  });
}
