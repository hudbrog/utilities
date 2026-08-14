#!/usr/bin/env node

import process from "node:process";
import { parseArguments, readJson, readJsonl, required, writeJson } from "./lib.mjs";

const args = parseArguments(process.argv.slice(2));
const worklist = await readJsonl(required(args, "worklist"));
const manifest = await readJson(required(args, "manifest"));
const approval = await readJson(required(args, "approved"));
const allowed = new Set(args["allow-auto-reviewed"] ? ["approved", "auto_reviewed"] : ["approved"]);
const concepts = worklist.map((source) => {
  const record = approval.records?.[source.conceptId];
  if (!record) throw new Error(`Missing approval record for ${source.conceptId}`);
  if (!allowed.has(record.reviewStatus)) throw new Error(`${source.conceptId} is ${record.reviewStatus}, not approved`);
  if (record.sourceFingerprint !== source.sourceFingerprint || manifest.sourceFingerprint !== source.sourceFingerprint) throw new Error(`Source fingerprint mismatch for ${source.conceptId}`);
  const concept = { id: source.conceptId, unitId: source.unitId, order: source.order, en: source.en, ru: record.ru, acceptedEn: record.acceptedEn ?? [], acceptedRu: record.acceptedRu ?? [] };
  if (source.partOfSpeech) concept.partOfSpeech = source.partOfSpeech;
  if (record.semanticCategory) concept.semanticCategory = record.semanticCategory;
  if (record.unsuitableReason) concept.unsuitableReason = record.unsuitableReason;
  return concept;
});
await writeJson(required(args, "output"), { schemaVersion: 1, curriculumId: manifest.curriculumId, curriculumVersion: manifest.curriculumVersion, sourceFingerprint: manifest.sourceFingerprint, units: manifest.units, concepts });
console.log(`Assembled ${concepts.length} concepts into ${args.output}`);
