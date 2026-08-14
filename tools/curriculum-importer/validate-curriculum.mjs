#!/usr/bin/env node

import process from "node:process";
import { byConceptId, normalizeText, parseArguments, readJson, readJsonl, required, writeJson } from "./lib.mjs";

const args = parseArguments(process.argv.slice(2));
const worklist = await readJsonl(required(args, "worklist"));
const sourceById = byConceptId(worklist, "worklist");
const approval = await readJson(required(args, "approved"));
const records = approval.records ?? {};
const errors = [];
const warnings = [];
const add = (collection, code, conceptId, message) => collection.push({ code, conceptId, message });

for (const source of worklist) {
  const record = records[source.conceptId];
  if (!record) { add(errors, "missing_record", source.conceptId, "No approval record"); continue; }
  if (!String(record.ru ?? "").trim()) add(errors, "missing_ru", source.conceptId, "Canonical Russian answer is empty");
  if (!record.unsuitableReason && !/[а-яё]/iu.test(record.ru ?? "")) add(warnings, "no_cyrillic", source.conceptId, "Russian answer contains no Cyrillic letters");
  if (record.sourceFingerprint !== source.sourceFingerprint) add(errors, "source_changed", source.conceptId, "Source fingerprint does not match worklist");
  if (args["require-approved"] && record.reviewStatus !== "approved") add(errors, "not_approved", source.conceptId, `Status is ${record.reviewStatus}`);
  else if (!["approved", "auto_reviewed"].includes(record.reviewStatus)) add(warnings, "pending_review", source.conceptId, `Status is ${record.reviewStatus}`);
  for (const [field, locale] of [["acceptedRu", "ru"], ["acceptedEn", "en"]]) {
    if (!Array.isArray(record[field])) add(errors, "invalid_aliases", source.conceptId, `${field} must be an array`);
    else if (new Set(record[field].map((value) => normalizeText(value, locale))).size !== record[field].length) add(errors, "duplicate_alias", source.conceptId, `${field} contains duplicates`);
  }
  if ((record.acceptedRu ?? []).some((value) => normalizeText(value, "ru") === normalizeText(record.ru, "ru"))) add(errors, "canonical_alias", source.conceptId, "acceptedRu repeats canonical ru");
  if ((record.acceptedEn ?? []).some((value) => normalizeText(value) === normalizeText(source.en))) add(errors, "canonical_alias", source.conceptId, "acceptedEn repeats canonical en");
}
for (const id of Object.keys(records)) if (!sourceById.has(id)) add(errors, "unknown_record", id, "Approval record is not in worklist");

for (const locale of ["ru", "en"]) {
  const answers = new Map();
  for (const source of worklist) {
    const record = records[source.conceptId];
    if (!record) continue;
    const values = locale === "ru" ? [record.ru, ...(record.acceptedRu ?? [])] : [source.en, ...(record.acceptedEn ?? [])];
    for (const value of values) {
      const key = `${source.unitId}:${normalizeText(value, locale)}`;
      if (!key.endsWith(":")) answers.set(key, [...(answers.get(key) ?? []), source.conceptId]);
    }
  }
  for (const [answer, ids] of answers) if (new Set(ids).size > 1) add(warnings, "answer_collision", [...new Set(ids)].join(","), `${locale} answer collision in ${answer}`);
}
const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), recordCount: worklist.length, errorCount: errors.length, warningCount: warnings.length, errors, warnings };
if (args.report) await writeJson(args.report, report);
console.log(`Validated ${worklist.length} records: ${errors.length} errors, ${warnings.length} warnings`);
if (errors.length) process.exitCode = 1;
