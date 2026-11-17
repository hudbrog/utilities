import type { ConceptDefinition } from "./model";

/** Share the daily allowance across active sources; retain block order inside each. */
export function newConceptsAcrossSources(
  units: { number: number; curriculumId?: string; conceptIds: string[] }[],
  concepts: ConceptDefinition[],
  introduced: Set<string>,
  introductionsSoFar: number,
): ConceptDefinition[] {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const sources = new Map<string, ConceptDefinition[]>();
  for (const unit of [...units].sort((a, b) => a.number - b.number)) {
    const sourceId = unit.curriculumId ?? "duolingo-ru-en";
    const list = sources.get(sourceId) ?? [];
    for (const id of unit.conceptIds) {
      const concept = byId.get(id);
      if (concept && !introduced.has(id)) list.push(concept);
    }
    sources.set(sourceId, list);
  }
  const queues = [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, list]) => [...list]);
  const result: ConceptDefinition[] = [];
  const seen = new Set<string>();
  if (!queues.length) return result;
  // Continue across calendar days too, including a daily quota of just one.
  let turn = introductionsSoFar % queues.length;
  while (queues.some((queue) => queue.length)) {
    const queue = queues[turn];
    let concept = queue.shift();
    while (concept && seen.has(concept.id)) concept = queue.shift();
    if (concept) { seen.add(concept.id); result.push(concept); }
    turn = (turn + 1) % queues.length;
  }
  return result;
}
