import { playEnglishClip } from "./englishAudio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelSpeech,
  getSpeechPlaybackDiagnostics,
  prepareSpeechSynthesis,
  speak,
  speechCompletionTimeoutMs,
} from "./synthesis";

vi.mock("./englishAudio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./englishAudio")>()),
  playEnglishClip: vi.fn(),
}));

class FakeUtterance {
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public readonly text: string) {}
}

const voice = {
  default: true,
  lang: "en-US",
  localService: true,
  name: "Test voice",
  voiceURI: "test",
} as SpeechSynthesisVoice;

describe("speech synthesis", () => {
  const cancel = vi.fn();
  const synth = {
    cancel,
    paused: false,
    resume: vi.fn(),
    addEventListener: vi.fn(),
    getVoices: vi.fn(() => [voice, { ...voice, lang: "ru-RU" }]),
    speak: vi.fn(),
  };
  const utterances: FakeUtterance[] = [];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout, speechSynthesis: synth, localStorage: null });
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    cancelSpeech();
    utterances.length = 0;
    cancel.mockClear();
    synth.getVoices.mockClear();
    synth.speak.mockReset();
    synth.speak.mockImplementation((utterance: FakeUtterance) => utterances.push(utterance));
    prepareSpeechSynthesis();
  });

  afterEach(() => {
    cancelSpeech();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not cancel a speech request before starting it", async () => {
    const result = speak("кошка", "ru-RU");
    expect(cancel).not.toHaveBeenCalled();
    expect(utterances).toHaveLength(1);
    utterances[0].onstart?.();
    utterances[0].onend?.();
    await expect(result).resolves.toMatchObject({ name: "Test voice" });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("serializes answer and following audio prompt without cutting the answer off", async () => {
    const first = speak("very long word", "en-US", { source: "answer" });
    const second = speak("next prompt", "en-US", { source: "prompt" });
    expect(utterances.map(({ text }) => text)).toEqual(["very long word"]);
    utterances[0].onend?.();
    await expect(first).resolves.toMatchObject({ name: "Test voice" });
    await vi.advanceTimersByTimeAsync(0);
    expect(utterances.map(({ text }) => text)).toEqual(["very long word", "next prompt"]);
    utterances[1].onstart?.();
    utterances[1].onend?.();
    await expect(second).resolves.toMatchObject({ name: "Test voice" });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("times out a stuck utterance, recovers, and then plays the queued word", async () => {
    const first = speak("stuck", "ru-RU");
    const second = speak("next", "ru-RU");
    const rejection = expect(first).rejects.toThrow("speech-synthesis-timeout");
    await vi.advanceTimersByTimeAsync(speechCompletionTimeoutMs("stuck"));
    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(utterances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(utterances).toHaveLength(2);
    utterances[1].onend?.();
    await expect(second).resolves.toMatchObject({ name: "Test voice" });
  });

  it("explicit cancellation clears the active utterance and queued requests", async () => {
    const first = speak("active", "en-US");
    const second = speak("queued", "en-US");
    cancelSpeech();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(utterances).toHaveLength(1);
  });

  it("plays a packaged English word without native speech and queues the next Russian answer", async () => {
    let end!: () => void;
    vi.mocked(playEnglishClip).mockImplementationOnce(async (_clip, _signal, started) => {
      started();
      await new Promise<void>((resolve) => { end = resolve; });
    });
    const english = speak(" Daughter ", "en-US", { source: "prompt" });
    const russian = speak("дочь", "ru-RU", { source: "answer" });
    expect(utterances).toHaveLength(0);
    end();
    await expect(english).resolves.toMatchObject({ name: "Kokoro · af_heart" });
    await vi.advanceTimersByTimeAsync(0);
    expect(utterances[0].text).toBe("дочь");
    utterances[0].onend?.();
    await russian;
  });

  it("can cancel a recording during loading and resolve queued replays", async () => {
    let signal!: AbortSignal;
    vi.mocked(playEnglishClip).mockImplementationOnce(async (_clip, abort) => {
      signal = abort;
      await new Promise<void>((resolve) => abort.addEventListener("abort", () => resolve()));
    });
    const first = speak("read", "en-US");
    const second = speak("wind", "en-US", { source: "replay" });
    cancelSpeech();
    expect(signal.aborted).toBe(true);
    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    expect(utterances).toHaveLength(0);
  });

  it("reports an unavailable recording without silently switching voices", async () => {
    vi.mocked(playEnglishClip).mockRejectedValueOnce(new Error("english-audio-pack-unavailable"));
    await expect(speak("cat", "en-US")).rejects.toThrow("english-audio-pack-unavailable");
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("records browser lifecycle events and never stores spoken text", async () => {
    const result = speak("private-example", "en-US", { source: "answer" });
    utterances[0].onstart?.();
    utterances[0].onend?.();
    await result;
    const diagnostics = getSpeechPlaybackDiagnostics();
    const last = diagnostics.at(-1)!;
    expect(last.source).toBe("answer");
    expect(last.locale).toBe("en-US");
    expect(last.events.map(({ kind }) => kind)).toEqual(["requested", "dispatched", "started", "ended"]);
    expect(JSON.stringify(last)).not.toContain("private-example");
  });
});
