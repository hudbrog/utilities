import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";

const exec = promisify(execFile);
let directory;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
const run = (script, args) => exec(process.execPath, [new URL(script, import.meta.url).pathname, ...args]);

test("builds, validates, and assembles an approved bundle", async () => {
  directory = await mkdtemp(join(tmpdir(), "curriculum-pipeline-"));
  const course = join(directory, "course.json");
  const words = join(directory, "words.json");
  const worklist = join(directory, "worklist.jsonl");
  const manifest = join(directory, "manifest.json");
  await writeFile(course, JSON.stringify({ currentCourse: { id: "course", skills: [[{ id: "skill-1", name: "Основы" }]], path: [{ unitIndex: 0, levels: [{ pathLevelMetadata: { skillId: "skill-1" } }] }] } }));
  await writeFile(words, JSON.stringify({ vocab_overview: [{ lexeme_id: "cat-n", word_string: "cat", normalized_string: "cat", pos: "Noun", skill: "Основы", related_lexemes: [] }] }));
  await run("./build-worklist.mjs", ["--course", course, "--words", words, "--output", worklist, "--manifest", manifest, "--version", "test-1"]);
  const source = JSON.parse((await readFile(worklist, "utf8")).trim());
  const candidates = join(directory, "candidates.jsonl");
  const reviews = join(directory, "reviews.jsonl");
  await writeFile(candidates, `${JSON.stringify({ conceptId: source.conceptId, canonicalRu: "кот", acceptedRu: ["кошка"], acceptedEn: [], semanticCategory: "animals", confidence: "high", ambiguityReason: null, needsReview: false, unsuitableReason: null })}\n`);
  await writeFile(reviews, `${JSON.stringify({ conceptId: source.conceptId, decision: "accept", canonicalRu: "кот", acceptedRu: ["кошка"], acceptedEn: [], semanticCategory: "animals", confidence: "high", notes: null, unsuitableReason: null })}\n`);
  const approved = join(directory, "approved.json");
  await run("./prepare-approval.mjs", ["--worklist", worklist, "--candidates", candidates, "--reviews", reviews, "--output", approved]);
  const approval = JSON.parse(await readFile(approved, "utf8"));
  approval.records[source.conceptId].reviewStatus = "approved";
  await writeFile(approved, JSON.stringify(approval));
  await run("./validate-curriculum.mjs", ["--worklist", worklist, "--approved", approved, "--require-approved"]);
  const bundle = join(directory, "bundle.json");
  await run("./assemble-curriculum.mjs", ["--worklist", worklist, "--manifest", manifest, "--approved", approved, "--output", bundle]);
  expect(JSON.parse(await readFile(bundle, "utf8"))).toMatchObject({ curriculumVersion: "test-1", concepts: [{ en: "cat", ru: "кот" }] });
});

test("LLM stages require an OpenRouter key", async () => {
  directory = await mkdtemp(join(tmpdir(), "curriculum-key-"));
  const worklist = join(directory, "worklist.jsonl");
  const output = join(directory, "generated.jsonl");
  await writeFile(worklist, `${JSON.stringify({ conceptId: "word-0", en: "cat" })}\n`);
  await expect(exec(process.execPath, [new URL("./run-llm-stage.mjs", import.meta.url).pathname, "generate", "--worklist", worklist, "--output", output], {
    env: { ...process.env, OPENROUTER_API_KEY: "", OPENAI_API_KEY: "should-not-be-used" },
  })).rejects.toMatchObject({ stderr: expect.stringContaining("OPENROUTER_API_KEY is required") });
});

test("LLM stages resume with only unprocessed records", async () => {
  directory = await mkdtemp(join(tmpdir(), "curriculum-resume-"));
  const worklist = join(directory, "worklist.jsonl");
  const output = join(directory, "generated.jsonl");
  const sources = ["cat", "dog", "bird"].map((en, index) => ({ conceptId: `word-${index}`, en }));
  const completed = { conceptId: "word-0", canonicalRu: "кот", acceptedRu: [], acceptedEn: [], semanticCategory: null, confidence: "high", ambiguityReason: null, needsReview: false, unsuitableReason: null };
  await writeFile(worklist, `${sources.map(JSON.stringify).join("\n")}\n`);
  await writeFile(output, `${JSON.stringify(completed)}\n`);

  const result = await run("./run-llm-stage.mjs", ["generate", "--worklist", worklist, "--output", output, "--limit", "1", "--dry-run"]);

  expect(result.stdout).toContain("1 already complete; 2 unprocessed; 1 scheduled this run");
  expect(result.stdout).toContain("no API requests made");
  expect((await readFile(output, "utf8")).trim()).toBe(JSON.stringify(completed));

  const candidates = join(directory, "candidates.jsonl");
  const reviews = join(directory, "reviews.jsonl");
  await writeFile(candidates, `${sources.map((source, index) => JSON.stringify({ ...completed, conceptId: source.conceptId, canonicalRu: ["кот", "собака", "птица"][index] })).join("\n")}\n`);
  await writeFile(reviews, `${JSON.stringify({ conceptId: "word-0", decision: "accept", canonicalRu: "кот", acceptedRu: [], acceptedEn: [], semanticCategory: null, confidence: "high", notes: null, unsuitableReason: null })}\n`);
  const reviewResult = await run("./run-llm-stage.mjs", ["review", "--worklist", worklist, "--candidates", candidates, "--output", reviews, "--limit", "1", "--dry-run"]);
  expect(reviewResult.stdout).toContain("1 already complete; 2 unprocessed; 1 scheduled this run");
});

test("a completed LLM stage exits without an API key", async () => {
  directory = await mkdtemp(join(tmpdir(), "curriculum-complete-"));
  const worklist = join(directory, "worklist.jsonl");
  const output = join(directory, "generated.jsonl");
  const source = { conceptId: "word-0", en: "cat" };
  const completed = { conceptId: "word-0", canonicalRu: "кот", acceptedRu: [], acceptedEn: [], semanticCategory: null, confidence: "high", ambiguityReason: null, needsReview: false, unsuitableReason: null };
  await writeFile(worklist, `${JSON.stringify(source)}\n`);
  await writeFile(output, `${JSON.stringify(completed)}\n`);

  const result = await exec(process.execPath, [new URL("./run-llm-stage.mjs", import.meta.url).pathname, "generate", "--worklist", worklist, "--output", output], {
    env: { ...process.env, OPENROUTER_API_KEY: "" },
  });

  expect(result.stdout).toContain("0 unprocessed");
  expect(result.stdout).toContain("nothing to process");
});
