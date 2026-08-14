#!/usr/bin/env node

import process from "node:process";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { byConceptId, parseArguments, positiveInteger, readJsonl, required, writeJsonl } from "./lib.mjs";
import { candidateBatchSchema, reviewBatchSchema } from "./schemas.mjs";

const mode = process.argv[2];
if (!['generate', 'review'].includes(mode)) throw new Error("First argument must be generate or review");
const args = parseArguments(process.argv.slice(3));
const worklistPath = required(args, "worklist");
const outputPath = required(args, "output");
const batchSize = positiveInteger(args["batch-size"], 20);
const limit = args.limit === undefined ? Infinity : positiveInteger(args.limit);
const model = args.model ?? process.env[mode === "generate" ? "OPENAI_GENERATION_MODEL" : "OPENAI_REVIEW_MODEL"] ?? "gpt-5-mini";
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const worklist = await readJsonl(worklistPath);
const candidates = mode === "review" ? byConceptId(await readJsonl(required(args, "candidates")), "candidates") : null;
const saved = await readJsonl(outputPath, { optional: true });
const completed = byConceptId(saved, outputPath);
let pending = worklist.filter(({ conceptId }) => !completed.has(conceptId)).slice(0, limit);
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const generationPrompt = `Create conservative Russian-learning curriculum records for a Russian-speaking child learning English.
Use the English headword, part of speech, infinitive, unit and Russian skill name as context. canonicalRu must be the most direct child-friendly translation for this sense. acceptedRu and acceptedEn are answer aliases, not broad synonyms: include only forms that are semantically interchangeable in this exact exercise. Do not add an alias merely because it is related. Flag ambiguity, phrases, proper names, fragments, or unsuitable items. Preserve conceptId exactly.`;
const reviewPrompt = `Independently audit proposed Russian-learning curriculum records against their source records. Correct mistranslations, wrong sense, overly broad aliases, morphology errors, and English aliases that are not interchangeable. Prefer fewer accepted answers. Use human_review whenever context is insufficient or multiple materially different senses remain. Preserve conceptId exactly.`;

for (let offset = 0; offset < pending.length; offset += batchSize) {
  const sourceBatch = pending.slice(offset, offset + batchSize);
  const input = mode === "generate"
    ? sourceBatch
    : sourceBatch.map((source) => ({ source, candidate: candidates.get(source.conceptId) ?? (() => { throw new Error(`Missing candidate ${source.conceptId}`); })() }));
  const schema = mode === "generate" ? candidateBatchSchema : reviewBatchSchema;
  let parsed;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await client.responses.parse({
        model,
        input: [{ role: "system", content: mode === "generate" ? generationPrompt : reviewPrompt }, { role: "user", content: JSON.stringify(input) }],
        text: { format: zodTextFormat(schema, `${mode}_curriculum_batch`) },
      });
      parsed = response.output_parsed;
      if (!parsed) throw new Error("Model returned no parsed output");
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.warn(`Batch failed (attempt ${attempt}/3): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }
  const expected = new Set(sourceBatch.map(({ conceptId }) => conceptId));
  const returned = byConceptId(parsed.records, "model response");
  if (returned.size !== expected.size || [...returned.keys()].some((id) => !expected.has(id))) {
    throw new Error(`Model response IDs do not exactly match batch at offset ${offset}`);
  }
  for (const record of parsed.records) completed.set(record.conceptId, record);
  await writeJsonl(outputPath, worklist.flatMap(({ conceptId }) => completed.has(conceptId) ? [completed.get(conceptId)] : []));
  console.log(`${mode}: saved ${Math.min(offset + sourceBatch.length, pending.length)}/${pending.length} pending records (${completed.size} total)`);
}
console.log(`${mode}: complete; output is ${outputPath}`);
