import { z } from "zod";

const confidence = z.enum(["high", "medium", "low"]);
const nullableText = z.string().trim().min(1).nullable();

export const candidateSchema = z.object({
  conceptId: z.string().min(1),
  canonicalRu: z.string().trim().min(1),
  acceptedRu: z.array(z.string().trim().min(1)).max(6),
  acceptedEn: z.array(z.string().trim().min(1)).max(4),
  semanticCategory: nullableText,
  confidence,
  ambiguityReason: nullableText,
  needsReview: z.boolean(),
  unsuitableReason: nullableText,
}).strict();

export const candidateBatchSchema = z.object({ records: z.array(candidateSchema) }).strict();

export const reviewSchema = z.object({
  conceptId: z.string().min(1),
  decision: z.enum(["accept", "correct", "human_review"]),
  canonicalRu: z.string().trim().min(1),
  acceptedRu: z.array(z.string().trim().min(1)).max(6),
  acceptedEn: z.array(z.string().trim().min(1)).max(4),
  semanticCategory: nullableText,
  confidence,
  notes: nullableText,
  unsuitableReason: nullableText,
}).strict();

export const reviewBatchSchema = z.object({ records: z.array(reviewSchema) }).strict();
