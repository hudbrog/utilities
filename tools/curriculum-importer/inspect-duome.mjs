#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--") continue;
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function mapSetAdd(map, key, value) {
  const set = map.get(key) ?? new Set();
  set.add(value);
  map.set(key, set);
}

function countBy(items, valueFor) {
  const counts = new Map();
  for (const item of items) {
    const value = valueFor(item) ?? "(missing)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])));
}

function markdownTable(rows) {
  return [
    "| Metric | Value |",
    "|---|---:|",
    ...rows.map(([metric, value]) => `| ${metric} | ${value} |`),
  ].join("\n");
}

const args = parseArguments(process.argv.slice(2));
if (!args.course || !args.words) {
  throw new Error(
    "Usage: pnpm curriculum:inspect -- --course <enfromru141.json> --words <enfromru141-words.json> [--output <report.md>]",
  );
}

const [courseSource, wordsSource] = await Promise.all([
  readFile(args.course, "utf8"),
  readFile(args.words, "utf8"),
]);
const courseRoot = JSON.parse(courseSource);
const wordsRoot = JSON.parse(wordsSource);
const course = courseRoot.currentCourse;
const units = course?.path;
const vocabulary = wordsRoot.vocab_overview;

if (!course || !Array.isArray(units) || !Array.isArray(vocabulary)) {
  throw new Error("Unexpected archive shape: currentCourse.path and vocab_overview must both be arrays");
}

const skillDefinitions = (course.skills ?? []).flat().filter((skill) => skill && typeof skill === "object");
const skillIdsByName = new Map();
for (const skill of skillDefinitions) mapSetAdd(skillIdsByName, skill.name, skill.id);

const unitsBySkillId = new Map();
const levelTypeCounts = new Map();
for (const unit of units) {
  const unitNumber = Number(unit.unitIndex) + 1;
  for (const level of unit.levels ?? []) {
    levelTypeCounts.set(level.type, (levelTypeCounts.get(level.type) ?? 0) + 1);
    const skillId = level.pathLevelMetadata?.skillId ?? level.pathLevelClientData?.skillId;
    if (skillId) mapSetAdd(unitsBySkillId, skillId, unitNumber);
  }
}

const mapping = { unique: 0, repeated: 0, missing: 0 };
const missingSkillNames = new Set();
const repeatedSkillNames = new Set();
for (const word of vocabulary) {
  const skillIds = skillIdsByName.get(word.skill) ?? new Set();
  const mappedUnits = new Set();
  for (const skillId of skillIds) {
    for (const unitNumber of unitsBySkillId.get(skillId) ?? []) mappedUnits.add(unitNumber);
  }
  if (mappedUnits.size === 0) {
    mapping.missing += 1;
    missingSkillNames.add(word.skill);
  } else if (mappedUnits.size === 1) {
    mapping.unique += 1;
  } else {
    mapping.repeated += 1;
    repeatedSkillNames.add(word.skill);
  }
}

const vocabularyFields = [...new Set(vocabulary.flatMap((word) => Object.keys(word)))].sort();
const translationFields = vocabularyFields.filter((field) => /(translat|meaning|accepted|russian|\bru\b)/i.test(field));
const lexemeIds = vocabulary.map((word) => word.lexeme_id).filter(Boolean);
const uniqueLexemeIds = new Set(lexemeIds);
const duplicateLexemeRows = vocabulary.length - uniqueLexemeIds.size;
const idMatchesLexeme = vocabulary.filter((word) => word.id && word.id === word.lexeme_id).length;
const uniqueWordStrings = new Set(vocabulary.map((word) => String(word.word_string ?? "").trim().toLocaleLowerCase("en")));
const skillsWithSeveralDefinitions = [...skillIdsByName.values()].filter((ids) => ids.size > 1).length;
const skillIdsRepeatedAcrossUnits = [...unitsBySkillId.values()].filter((unitNumbers) => unitNumbers.size > 1).length;
const partOfSpeechRows = countBy(vocabulary, (word) => word.pos).slice(0, 10);
const levelRows = [...levelTypeCounts.entries()].sort((left, right) => right[1] - left[1]);
const fingerprint = sha256(`${sha256(courseSource)}:${sha256(wordsSource)}`);

const report = `# Stage 0 — Duome archive import-shape report

Source archive: \`enfromru141.7z\`<br>
Course: \`${course.id}\` (${course.fromLanguage} → ${course.learningLanguage})<br>
Source fingerprint: \`${fingerprint}\`

## Conclusion

The archive is useful for curriculum order and English lexeme identity, but it is **not sufficient by itself to build the bilingual vocabulary concepts required by V0.1**.

- The course JSON contains the 141-unit path, skill IDs, skill names, and ordering.
- The vocabulary JSON contains stable-looking Duolingo lexeme IDs, English surface forms, normalized strings, part of speech, and a skill name.
- The vocabulary rows contain **no Russian translation field and no accepted-answer lists**. Russian prose in tips/guidebook metadata is not a word-level translation source.
- Vocabulary rows identify their skill by display name rather than skill ID. Most can be joined through the course skill definitions, but skills can reappear in several path units. Import policy should assign a lexeme to the earliest unit where its owning skill is taught, while reporting every repeated or unresolved mapping for review.

The next data step therefore needs a conservative EN↔RU translation source or a separately exported Duolingo dictionary/lexeme payload. Machine-generated synonyms should not be accepted automatically.

## Archive contents

| File | Shape | Purpose |
|---|---|---|
| \`enfromru141.json\` | object with \`currentCourse\` | path, units, skills, sections, course metadata |
| \`enfromru141-words.json\` | object with \`vocab_overview\` | English lexemes and per-word metadata |

## Structural metrics

${markdownTable([
  ["Path units", units.length],
  ["Course skill definitions", skillDefinitions.length],
  ["Distinct skill display names", skillIdsByName.size],
  ["Skill names resolving to several IDs", skillsWithSeveralDefinitions],
  ["Skill IDs appearing in several units", skillIdsRepeatedAcrossUnits],
  ["Vocabulary rows", vocabulary.length],
  ["Unique lexeme IDs", uniqueLexemeIds.size],
  ["Duplicate lexeme-ID rows", duplicateLexemeRows],
  ["Rows where id equals lexeme_id", idMatchesLexeme],
  ["Distinct case-folded English word strings", uniqueWordStrings.size],
  ["Rows with a unique unit mapping", mapping.unique],
  ["Rows whose skill appears in several units", mapping.repeated],
  ["Rows without a path-unit mapping", mapping.missing],
])}

## Vocabulary record contract found

Fields present on vocabulary rows:

\`${vocabularyFields.join("`, `")}\`

Translation-like fields detected: ${translationFields.length ? `\`${translationFields.join("`, `")}\`` : "**none**"}.

Recommended source-to-domain mapping:

| Source | V0.1 field | Notes |
|---|---|---|
| \`lexeme_id\` | \`ConceptDefinition.id\` input | Stable upstream identity; prefix with curriculum ID in emitted data |
| owning skill → earliest path unit | \`unitId\`, \`order\` | Deterministic, but repeated/missing joins remain reportable diagnostics |
| \`word_string\` | \`en\` | Surface form; preserve source spelling |
| \`normalized_string\` | possible English alias | Review before accepting when it differs from the surface form |
| \`pos\` | \`partOfSpeech\` | Source values should be normalized to an importer enum later |
| no source field | \`ru\`, \`acceptedRu\` | Blocking gap |
| no source field | broader \`acceptedEn\` aliases | Must be curated conservatively |

## Path level types

${markdownTable(levelRows)}

## Most common parts of speech

${markdownTable(partOfSpeechRows)}

## Mapping diagnostics

Skill names with vocabulary rows but no resolved path unit (${missingSkillNames.size}):

${missingSkillNames.size ? [...missingSkillNames].sort().slice(0, 30).map((name) => `- ${name}`).join("\n") : "- None"}

Skill names that map to several path units (${repeatedSkillNames.size}):

${repeatedSkillNames.size ? [...repeatedSkillNames].sort().slice(0, 30).map((name) => `- ${name}`).join("\n") : "- None"}

## Importer decisions to carry into Phase 1

1. Treat \`lexeme_id\` as the upstream stable concept key; never derive identity from translated display text.
2. Join vocabulary skill name → course skill ID → path unit, choosing the earliest unit for repeated skill appearances.
3. Preserve the complete list of repeated and missing joins in every import report.
4. Do not interpret \`related_lexemes\` as accepted synonyms without manual validation.
5. Add an explicit curated translation input before emitting \`CurriculumBundle\` records.
6. Keep the original source fingerprint in the generated bundle for reproducibility.
`;

if (args.output) {
  await writeFile(args.output, report, "utf8");
  console.log(`Wrote ${args.output}`);
} else {
  process.stdout.write(report);
}
