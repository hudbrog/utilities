import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { EnglishSrsDatabase } from "./database";
import { loadLearnerSettings } from "./settingsRepository";

let database: EnglishSrsDatabase | undefined;

afterEach(async () => {
  await database?.delete();
  database = undefined;
});

describe("learner settings", () => {
  it("adds the default question limit to an existing settings record", async () => {
    database = new EnglishSrsDatabase(`settings-${crypto.randomUUID()}`);
    await database.table("settings").put({
      id: "settings",
      dailyNewConceptQuota: 5,
      backlogThreshold: 30,
      suppressNewOnBacklog: true,
      listeningAudioRatio: 0.3,
      englishLocale: "en-US",
    });

    expect((await loadLearnerSettings(database)).sessionQuestionLimit).toBe(15);
    expect((await database.settings.get("settings"))?.sessionQuestionLimit).toBe(15);
  });
});
