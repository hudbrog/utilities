import { z } from "zod";

const nonEmptyText = z.string().trim().min(1);
const nullableText = nonEmptyText.nullable();

export const reviewProposalSchema = z.object({
  conceptId: nonEmptyText,
  proposalFingerprint: nonEmptyText,
  unitId: nonEmptyText,
  order: z.number().int().nonnegative(),
  en: nonEmptyText,
  ru: nonEmptyText,
  acceptedEn: z.array(nonEmptyText),
  acceptedRu: z.array(nonEmptyText),
  partOfSpeech: nullableText,
  semanticCategory: nullableText,
  unsuitableReason: nullableText,
  initialReviewStatus: z.enum(["approved", "auto_reviewed", "needs_human_review"]),
  generationConfidence: z.enum(["high", "medium", "low"]),
  reviewConfidence: z.enum(["high", "medium", "low"]),
  reviewDecision: z.enum(["accept", "correct", "human_review"]),
  reviewNotes: nullableText,
});

export const curriculumReviewPackageSchema = z.object({
  schemaVersion: z.literal(1),
  curriculumId: z.literal("duolingo-ru-en"),
  curriculumVersion: nonEmptyText,
  sourceFingerprint: nonEmptyText,
  generatedAt: z.iso.datetime(),
  units: z.array(z.object({
    id: nonEmptyText,
    number: z.number().int().positive(),
    titleRu: nonEmptyText.optional(),
    conceptIds: z.array(nonEmptyText),
    reviewFingerprint: nonEmptyText,
  })),
  proposals: z.array(reviewProposalSchema),
}).superRefine((value, context) => {
  const proposalIds = new Set<string>();
  const unitIds = new Set<string>();
  value.proposals.forEach((proposal, index) => {
    if (proposalIds.has(proposal.conceptId)) context.addIssue({ code: "custom", path: ["proposals", index, "conceptId"], message: "Duplicate proposal" });
    proposalIds.add(proposal.conceptId);
  });
  value.units.forEach((unit, index) => {
    if (unitIds.has(unit.id)) context.addIssue({ code: "custom", path: ["units", index, "id"], message: "Duplicate unit" });
    unitIds.add(unit.id);
  });
  value.proposals.forEach((proposal, index) => {
    if (!unitIds.has(proposal.unitId)) context.addIssue({ code: "custom", path: ["proposals", index, "unitId"], message: "Unknown unit" });
  });
  value.units.forEach((unit, unitIndex) => unit.conceptIds.forEach((conceptId, conceptIndex) => {
    if (!proposalIds.has(conceptId)) context.addIssue({ code: "custom", path: ["units", unitIndex, "conceptIds", conceptIndex], message: "Unknown proposal" });
    const proposal = value.proposals.find((candidate) => candidate.conceptId === conceptId);
    if (proposal && proposal.unitId !== unit.id) context.addIssue({ code: "custom", path: ["units", unitIndex, "conceptIds", conceptIndex], message: "Proposal belongs to another unit" });
  }));
});

export type CurriculumReviewPackage = z.infer<typeof curriculumReviewPackageSchema>;
export type CurriculumReviewProposal = z.infer<typeof reviewProposalSchema>;
