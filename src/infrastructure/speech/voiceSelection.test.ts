import { describe, expect, it } from "vitest";
import { pickBestVoice } from "./voiceSelection";

const voice = (name: string, lang: string, localService: boolean) =>
  ({ name, lang, localService }) as SpeechSynthesisVoice;

describe("pickBestVoice", () => {
  it("prefers an exact local voice", () => {
    const voices = [voice("Remote Russian", "ru-RU", false), voice("Local Russian", "ru-RU", true)];
    expect(pickBestVoice(voices, "ru-RU")?.name).toBe("Local Russian");
  });

  it("falls back to the same base language", () => {
    const voices = [voice("British", "en-GB", true)];
    expect(pickBestVoice(voices, "en-US")?.name).toBe("British");
  });

  it("does not select an unrelated language", () => {
    expect(pickBestVoice([voice("English", "en-US", true)], "ru-RU")).toBeNull();
  });
});
