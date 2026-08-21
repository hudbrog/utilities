#!/usr/bin/env node

import process from "node:process";
import { byConceptId, parseArguments, readJson, readJsonl, required, sha256, writeJson } from "./lib.mjs";

const args = parseArguments(process.argv.slice(2));
const worklist = await readJsonl(required(args, "worklist"));
const manifest = await readJson(required(args, "manifest"));
const approval = await readJson(required(args, "approved"));
const approvals = approval.records ?? {};
const sources = byConceptId(worklist, "worklist");

for (const conceptId of Object.keys(approvals)) {
  if (!sources.has(conceptId)) throw new Error(`Approval contains unknown concept ${conceptId}`);
}

const proposals = worklist.map((source) => {
  const record = approvals[source.conceptId];
  if (!record) throw new Error(`Missing approval proposal for ${source.conceptId}`);
  if (record.sourceFingerprint !== manifest.sourceFingerprint || source.sourceFingerprint !== manifest.sourceFingerprint) {
    throw new Error(`Source fingerprint mismatch for ${source.conceptId}`);
  }
  const proposal = {
    conceptId: source.conceptId,
    unitId: source.unitId,
    order: source.order,
    en: source.en,
    ru: record.ru,
    acceptedEn: record.acceptedEn ?? [],
    acceptedRu: record.acceptedRu ?? [],
    partOfSpeech: source.partOfSpeech,
    semanticCategory: record.semanticCategory,
    unsuitableReason: record.unsuitableReason,
    initialReviewStatus: record.reviewStatus,
    generationConfidence: record.generationConfidence,
    reviewConfidence: record.reviewConfidence,
    reviewDecision: record.reviewDecision,
    reviewNotes: record.reviewNotes,
  };
  return { ...proposal, proposalFingerprint: sha256(JSON.stringify(proposal)) };
});

const unitTitles = new Map();
for (const source of worklist) {
  const titles = unitTitles.get(source.unitId) ?? [];
  if (source.skillNameRu && !titles.includes(source.skillNameRu)) titles.push(source.skillNameRu);
  unitTitles.set(source.unitId, titles);
}
const proposalById = new Map(proposals.map((proposal) => [proposal.conceptId, proposal]));
const units = manifest.units.map((unit) => {
  const proposalFingerprints = unit.conceptIds.map((conceptId) => {
    const proposal = proposalById.get(conceptId);
    if (!proposal) throw new Error(`Unit ${unit.id} contains unknown concept ${conceptId}`);
    return { conceptId, proposalFingerprint: proposal.proposalFingerprint };
  });
  return {
    ...unit,
    titleRu: unit.titleRu ?? (unitTitles.get(unit.id)?.slice(0, 2).join(" · ") || undefined),
    reviewFingerprint: sha256(JSON.stringify(proposalFingerprints)),
  };
});
const reviewPackage = {
  schemaVersion: 1,
  curriculumId: manifest.curriculumId,
  curriculumVersion: manifest.curriculumVersion,
  sourceFingerprint: manifest.sourceFingerprint,
  generatedAt: args["generated-at"] ?? new Date().toISOString(),
  units,
  proposals,
};
await writeJson(required(args, "output"), reviewPackage);
if (args["approved-copy"]) await writeJson(args["approved-copy"], approval);
console.log(`Wrote ${proposals.length} review proposals across ${units.length} units to ${args.output}`);
