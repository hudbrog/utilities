import type { EnglishSrsDatabase } from "./database";

/** A word remains available while any approved/imported block contains it.
 * Pausing introductions does not pause its reviews. */
export async function refreshConceptAvailability(db: EnglishSrsDatabase): Promise<void> {
  const members = new Set((await db.units.toArray())
    .filter((unit) => unit.available !== false).flatMap((unit) => unit.conceptIds));
  await db.concepts.toCollection().modify((concept) => { concept.retired = !members.has(concept.id); });
  await db.conceptProgress.toCollection().modify((progress) => { progress.retired = !members.has(progress.conceptId); });
}
