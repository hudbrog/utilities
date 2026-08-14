#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { parseArguments, required, sha256, uniqueStrings, writeJson, writeJsonl } from "./lib.mjs";

const args = parseArguments(process.argv.slice(2));
const coursePath = required(args, "course");
const wordsPath = required(args, "words");
const output = required(args, "output");
const manifestOutput = args.manifest ?? output.replace(/\.jsonl$/i, ".manifest.json");
const [courseSource, wordsSource] = await Promise.all([readFile(coursePath, "utf8"), readFile(wordsPath, "utf8")]);
const course = JSON.parse(courseSource).currentCourse;
const vocabulary = JSON.parse(wordsSource).vocab_overview;
if (!course || !Array.isArray(course.path) || !Array.isArray(vocabulary)) {
  throw new Error("Unexpected archive shape: currentCourse.path and vocab_overview must be arrays");
}

const skillIdsByName = new Map();
for (const skill of (course.skills ?? []).flat()) {
  if (skill?.name && skill?.id) skillIdsByName.set(skill.name, skill.id);
}
const earliestUnitBySkillId = new Map();
for (const unit of course.path) {
  const unitNumber = Number(unit.unitIndex) + 1;
  for (const level of unit.levels ?? []) {
    const skillId = level.pathLevelMetadata?.skillId ?? level.pathLevelClientData?.skillId;
    if (skillId && (!earliestUnitBySkillId.has(skillId) || unitNumber < earliestUnitBySkillId.get(skillId))) {
      earliestUnitBySkillId.set(skillId, unitNumber);
    }
  }
}

const sourceFingerprint = sha256(`${sha256(courseSource)}:${sha256(wordsSource)}`);
const orderByUnit = new Map();
const unresolved = [];
const worklist = [];
for (const [sourceIndex, word] of vocabulary.entries()) {
  const skillId = skillIdsByName.get(word.skill);
  const unitNumber = skillId ? earliestUnitBySkillId.get(skillId) : undefined;
  if (!word.lexeme_id || !word.word_string || !unitNumber) {
    unresolved.push({ sourceIndex, lexemeId: word.lexeme_id ?? null, word: word.word_string ?? null, skill: word.skill ?? null });
    continue;
  }
  const order = orderByUnit.get(unitNumber) ?? 0;
  orderByUnit.set(unitNumber, order + 1);
  worklist.push({
    conceptId: `duolingo-ru-en:${word.lexeme_id}`,
    sourceLexemeId: word.lexeme_id,
    en: String(word.word_string).normalize("NFC").trim(),
    normalizedEn: String(word.normalized_string ?? word.word_string).normalize("NFC").trim(),
    possibleAcceptedEn: uniqueStrings(
      word.normalized_string && word.normalized_string !== word.word_string ? [String(word.normalized_string)] : [],
    ),
    partOfSpeech: word.pos ?? null,
    infinitive: word.infinitive ?? null,
    skillNameRu: word.skill,
    unitId: `unit-${unitNumber}`,
    unitNumber,
    order,
    relatedLexemes: Array.isArray(word.related_lexemes) ? word.related_lexemes : [],
    sourceFingerprint,
  });
}
worklist.sort((left, right) => left.unitNumber - right.unitNumber || left.order - right.order || left.conceptId.localeCompare(right.conceptId));

const units = [...new Set(worklist.map(({ unitNumber }) => unitNumber))].map((number) => ({
  id: `unit-${number}`,
  number,
  conceptIds: worklist.filter((record) => record.unitNumber === number).map(({ conceptId }) => conceptId),
}));
await writeJsonl(output, worklist);
await writeJson(manifestOutput, {
  schemaVersion: 1,
  curriculumId: "duolingo-ru-en",
  curriculumVersion: args.version ?? new Date().toISOString().slice(0, 10),
  sourceFingerprint,
  sourceCourseId: course.id,
  recordCount: worklist.length,
  unresolved,
  units,
});
console.log(`Wrote ${worklist.length} records to ${output}`);
console.log(`Wrote manifest to ${manifestOutput}${unresolved.length ? ` (${unresolved.length} unresolved)` : ""}`);
