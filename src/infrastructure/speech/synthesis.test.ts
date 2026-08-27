import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { speak, speechCompletionTimeoutMs } from "./synthesis";

class FakeUtterance {
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
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
    getVoices: vi.fn(() => [voice]),
    speak: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { setTimeout, clearTimeout, speechSynthesis: synth });
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    cancel.mockClear();
    synth.getVoices.mockClear();
    synth.speak.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("completes normally when the browser emits onend", async () => {
    synth.speak.mockImplementation((utterance: FakeUtterance) => utterance.onend?.());
    await expect(speak("cat", "en-US")).resolves.toMatchObject({ name: "Test voice" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels and rejects when the browser never emits a completion event", async () => {
    const result = expect(speak("cat", "en-US")).rejects.toThrow("speech-synthesis-timeout");
    await vi.advanceTimersByTimeAsync(speechCompletionTimeoutMs("cat"));
    await result;
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
