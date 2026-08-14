#!/usr/bin/env node

import process from "node:process";
import { byConceptId, parseArguments, readJsonl, required, uniqueStrings, writeJson } from "./lib.mjs";

const args = parseArguments(process.argv.slice(2));
const worklist = await readJsonl(required(args, "worklist"));
const candidates = byConceptId(await readJsonl(required(args, "candidates")), "candidates");
const reviews = byConceptId(await readJsonl(required(args, "reviews")), "reviews");
const records = {};
for (const source of worklist) {
  const candidate = candidates.get(source.conceptId);
  const review = reviews.get(source.conceptId);
  if (!candidate || !review) throw new Error(`Missing candidate or review for ${source.conceptId}`);
  const autoReviewed = !args["require-human"] && review.decision === "accept" && review.confidence === "high" && candidate.confidence === "high" && !candidate.needsReview;
  records[source.conceptId] = {
    sourceFingerprint: source.sourceFingerprint,
    en: source.en,
    ru: review.canonicalRu,
    acceptedEn: uniqueStrings(review.acceptedEn),
    acceptedRu: uniqueStrings(review.acceptedRu),
    semanticCategory: review.semanticCategory,
    unsuitableReason: review.unsuitableReason,
    reviewStatus: autoReviewed ? "auto_reviewed" : "needs_human_review",
    generationConfidence: candidate.confidence,
    reviewConfidence: review.confidence,
    reviewDecision: review.decision,
    reviewNotes: review.notes,
  };
}
await writeJson(required(args, "output"), { schemaVersion: 1, records });
console.log(`Prepared ${Object.keys(records).length} records. Change reviewStatus to approved after human review.`);
