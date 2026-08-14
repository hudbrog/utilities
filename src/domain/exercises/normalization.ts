import type { Direction } from "../curriculum/model";

const punctuationOrSymbol = /[\p{P}\p{S}]+/gu;
const whitespace = /\s+/gu;

export function normalizeAnswer(value: string, language: "en" | "ru"): string {
  let normalized = value.normalize("NFC").toLocaleLowerCase(language).replace(punctuationOrSymbol, " ");
  if (language === "ru") normalized = normalized.replaceAll("ё", "е");
  return normalized.replace(whitespace, " ").trim();
}

export function answerLanguage(direction: Direction): "en" | "ru" {
  return direction === "en-ru" ? "ru" : "en";
}
