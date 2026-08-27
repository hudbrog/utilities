import type { EnglishSrsDatabase } from "./database";
import type { LearnerSettings } from "./model";

export const DEFAULT_SESSION_QUESTION_LIMIT = 15;
export const MIN_SESSION_QUESTION_LIMIT = 2;
export const MAX_SESSION_QUESTION_LIMIT = 100;

export const defaultLearnerSettings: LearnerSettings = {
  id: "settings",
  dailyNewConceptQuota: 5,
  backlogThreshold: 30,
  suppressNewOnBacklog: true,
  sessionQuestionLimit: DEFAULT_SESSION_QUESTION_LIMIT,
  listeningAudioRatio: 0.3,
  englishLocale: "en-US",
};

export function normalizeLearnerSettings(
  settings: Partial<LearnerSettings> | null | undefined,
): LearnerSettings {
  const requestedLimit = settings?.sessionQuestionLimit;
  const sessionQuestionLimit = typeof requestedLimit === "number" &&
    Number.isInteger(requestedLimit) &&
    requestedLimit >= MIN_SESSION_QUESTION_LIMIT &&
    requestedLimit <= MAX_SESSION_QUESTION_LIMIT
    ? requestedLimit
    : DEFAULT_SESSION_QUESTION_LIMIT;
  return {
    ...defaultLearnerSettings,
    ...settings,
    id: "settings",
    sessionQuestionLimit,
  };
}

export async function loadLearnerSettings(db: EnglishSrsDatabase): Promise<LearnerSettings> {
  const stored = await db.settings.get("settings");
  const normalized = normalizeLearnerSettings(stored);
  if (!stored || stored.sessionQuestionLimit !== normalized.sessionQuestionLimit) {
    await db.settings.put(normalized);
  }
  return normalized;
}
