import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--") continue;
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const name = key.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[name] = true;
    else {
      parsed[name] = next;
      index += 1;
    }
  }
  return parsed;
}

export function required(args, name) {
  const value = args[name];
  if (typeof value !== "string" || !value) throw new Error(`Missing --${name}`);
  return value;
}

export function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, got ${value}`);
  return parsed;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonl(path, { optional = false } = {}) {
  try {
    const source = await readFile(path, "utf8");
    return source.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`); }
    });
  } catch (error) {
    if (optional && error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeJsonl(path, records) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "", "utf8");
}

export function normalizeText(value, locale = "en") {
  let result = String(value ?? "").normalize("NFC").toLocaleLowerCase(locale)
    .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (locale === "ru") result = result.replaceAll("ё", "е");
  return result;
}

export function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizeText(value, /[а-яё]/iu.test(value) ? "ru" : "en");
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function byConceptId(records, label) {
  const result = new Map();
  for (const record of records) {
    if (!record?.conceptId) throw new Error(`${label} contains a record without conceptId`);
    if (result.has(record.conceptId)) throw new Error(`${label} contains duplicate ${record.conceptId}`);
    result.set(record.conceptId, record);
  }
  return result;
}
