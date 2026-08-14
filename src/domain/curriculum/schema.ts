import { z } from "zod";

import type { CurriculumBundle } from "./model";

const nonEmptyText = z.string().trim().min(1);

export const unitDefinitionSchema = z.object({
  id: nonEmptyText,
  number: z.number().int().positive(),
  titleRu: nonEmptyText.optional(),
  conceptIds: z.array(nonEmptyText),
});

export const conceptDefinitionSchema = z.object({
  id: nonEmptyText,
  unitId: nonEmptyText,
  order: z.number().int().nonnegative(),
  en: nonEmptyText,
  ru: nonEmptyText,
  acceptedEn: z.array(nonEmptyText),
  acceptedRu: z.array(nonEmptyText),
  partOfSpeech: nonEmptyText.optional(),
  semanticCategory: nonEmptyText.optional(),
  unsuitableReason: nonEmptyText.optional(),
});

export const curriculumBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    curriculumId: z.literal("duolingo-ru-en"),
    curriculumVersion: nonEmptyText,
    sourceFingerprint: nonEmptyText,
    units: z.array(unitDefinitionSchema).min(1),
    concepts: z.array(conceptDefinitionSchema).min(1),
  })
  .superRefine((bundle, context) => {
    const unitIds = new Set<string>();
    const conceptIds = new Set<string>();
    const unitNumbers = new Set<number>();

    bundle.units.forEach((unit, index) => {
      if (unitIds.has(unit.id)) {
        context.addIssue({ code: "custom", path: ["units", index, "id"], message: "Duplicate unit id" });
      }
      if (unitNumbers.has(unit.number)) {
        context.addIssue({ code: "custom", path: ["units", index, "number"], message: "Duplicate unit number" });
      }
      unitIds.add(unit.id);
      unitNumbers.add(unit.number);
    });

    bundle.concepts.forEach((concept, index) => {
      if (conceptIds.has(concept.id)) {
        context.addIssue({ code: "custom", path: ["concepts", index, "id"], message: "Duplicate concept id" });
      }
      if (!unitIds.has(concept.unitId)) {
        context.addIssue({ code: "custom", path: ["concepts", index, "unitId"], message: "Unknown unit id" });
      }
      conceptIds.add(concept.id);
    });

    bundle.units.forEach((unit, unitIndex) => {
      const listed = new Set<string>();
      unit.conceptIds.forEach((conceptId, conceptIndex) => {
        const concept = bundle.concepts.find((candidate) => candidate.id === conceptId);
        if (!concept) {
          context.addIssue({ code: "custom", path: ["units", unitIndex, "conceptIds", conceptIndex], message: "Unknown concept id" });
        } else if (concept.unitId !== unit.id) {
          context.addIssue({ code: "custom", path: ["units", unitIndex, "conceptIds", conceptIndex], message: "Concept belongs to a different unit" });
        }
        if (listed.has(conceptId)) {
          context.addIssue({ code: "custom", path: ["units", unitIndex, "conceptIds", conceptIndex], message: "Duplicate concept in unit" });
        }
        listed.add(conceptId);
      });
    });

    bundle.concepts.forEach((concept, index) => {
      const owner = bundle.units.find((unit) => unit.id === concept.unitId);
      if (owner && !owner.conceptIds.includes(concept.id)) {
        context.addIssue({ code: "custom", path: ["concepts", index, "id"], message: "Concept is missing from its unit ordering" });
      }
    });
  });

export function parseCurriculumBundle(input: unknown): CurriculumBundle {
  return curriculumBundleSchema.parse(input) as CurriculumBundle;
}
