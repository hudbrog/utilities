import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelSpeech,
  getSpeechPlaybackDiagnostics,
  prepareSpeechSynthesis,
  speak,
  speechCompletionTimeoutMs,
} from "./synthesis";

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
    getVoices: vi.fn(() => [voice]),
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
    const result = speak("cat", "en-US");
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
    const first = speak("stuck", "en-US");
    const second = speak("next", "en-US");
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
