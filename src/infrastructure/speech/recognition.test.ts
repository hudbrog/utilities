import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeRecognition, recognitionEvent } from "../../test/speechRecognition";
import { listenOnce, startListening } from "./recognition";

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.reset();
  vi.stubGlobal("window", { setTimeout, clearTimeout, SpeechRecognition: FakeRecognition });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test("stop finishes capture once and waits for the recognizer's final alternatives", async () => {
  const phases = vi.fn();
  const session = startListening("ru-RU", { localOnly: true, onPhaseChange: phases });
  const recognition = FakeRecognition.latest;
  expect(recognition).toMatchObject({ lang: "ru-RU", continuous: false, interimResults: false, maxAlternatives: 5, processLocally: true });
  let resolved = false;
  void session.result.then(() => { resolved = true; });
  session.stop(); session.stop();
  await Promise.resolve();
  expect(resolved).toBe(false);
  expect(recognition.stop).toHaveBeenCalledTimes(1);
  expect(recognition.abort).not.toHaveBeenCalled();
  expect(phases.mock.calls.flat()).toEqual(["starting", "listening", "processing"]);
  recognition.result([" кот ", "кошка", "кот", " "]);
  await expect(session.result).resolves.toEqual({
    alternatives: [{ transcript: "кот", confidence: 0.9 }, { transcript: "кошка", confidence: 0.9 }], localOnlyApplied: true,
  });
  expect(vi.getTimerCount()).toBe(0);
});

test("uses an automatic final result without waiting for end", async () => {
  const result = listenOnce("en-US", { localOnly: false });
  FakeRecognition.latest.result(["cat"]);
  await expect(result).resolves.toMatchObject({ alternatives: [{ transcript: "cat" }], localOnlyApplied: false });
  expect(FakeRecognition.latest.stop).toHaveBeenCalledTimes(1);
  expect(FakeRecognition.latest.onend).toBeNull();
});

test("stop before the start event cannot return to a listening state", async () => {
  FakeRecognition.autoStart = false;
  const phases = vi.fn();
  const session = startListening("en-US", { localOnly: false, onPhaseChange: phases });
  session.stop();
  FakeRecognition.latest.onstart?.();
  expect(phases.mock.calls.flat()).toEqual(["starting", "processing"]);
  FakeRecognition.latest.result(["cat"]);
  await expect(session.result).resolves.toBeDefined();
});

test("an empty recording reports no-result", async () => {
  const session = startListening("en-US", { localOnly: false });
  const result = expect(session.result).rejects.toMatchObject({ code: "no-result" });
  session.stop();
  FakeRecognition.latest.onend?.();
  await result;
});

test("interim text never becomes a scored answer", async () => {
  const session = startListening("en-US", { localOnly: false });
  FakeRecognition.latest.result(["wrong interim answer"], false);
  expect(FakeRecognition.latest.stop).not.toHaveBeenCalled();
  session.stop();
  FakeRecognition.latest.result(["cat"]);
  await expect(session.result).resolves.toMatchObject({ alternatives: [{ transcript: "cat" }] });
});

test("cancel discards late results and cannot be turned into a stop", async () => {
  const phases = vi.fn();
  const session = startListening("en-US", { localOnly: false, onPhaseChange: phases });
  const recognition = FakeRecognition.latest;
  const lateResult = recognition.onresult!;
  const result = expect(session.result).rejects.toMatchObject({ code: "aborted" });
  session.cancel(); session.cancel(); session.stop();
  lateResult(recognitionEvent(["cat"]));
  await result;
  expect(recognition.abort).toHaveBeenCalledTimes(1);
  expect(recognition.stop).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("timeout aborts capture even when stop never produces a result", async () => {
  const session = startListening("en-US", { localOnly: false, timeoutMs: 1000 });
  const result = expect(session.result).rejects.toMatchObject({ code: "timeout" });
  session.stop();
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(FakeRecognition.latest.abort).toHaveBeenCalledTimes(1);
});

test("an automatic audio end updates the phase while recognition finishes", async () => {
  const phases = vi.fn();
  const session = startListening("en-US", { localOnly: false, onPhaseChange: phases });
  FakeRecognition.latest.onaudioend?.();
  expect(phases).toHaveBeenLastCalledWith("processing");
  FakeRecognition.latest.result(["cat"]);
  await expect(session.result).resolves.toBeDefined();
});

test("stop errors settle the request and release capture", async () => {
  const session = startListening("en-US", { localOnly: false });
  FakeRecognition.latest.stop.mockImplementation(() => { throw new Error("stop failed"); });
  const result = expect(session.result).rejects.toThrow("stop failed");
  session.stop();
  await result;
  expect(FakeRecognition.latest.abort).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("unsupported browsers return a rejected result and safe controls", async () => {
  delete window.SpeechRecognition;
  const session = startListening("en-US", { localOnly: false });
  await expect(session.result).rejects.toMatchObject({ code: "not-supported" });
  expect(() => { session.stop(); session.cancel(); }).not.toThrow();
});

test("permission errors leave no active timeout or event handlers", async () => {
  const session = startListening("en-US", { localOnly: false });
  const result = expect(session.result).rejects.toMatchObject({ code: "not-allowed" });
  FakeRecognition.latest.error("not-allowed");
  await result;
  expect(vi.getTimerCount()).toBe(0);
  expect(FakeRecognition.latest.onresult).toBeNull();
});

test("a synchronous start failure cleans up the session", async () => {
  class FailedRecognition extends FakeRecognition {
    start = vi.fn(() => { throw new Error("cannot start"); });
  }
  vi.stubGlobal("window", { setTimeout, clearTimeout, SpeechRecognition: FailedRecognition });
  const session = startListening("en-US", { localOnly: false });
  await expect(session.result).rejects.toThrow("cannot start");
  expect(vi.getTimerCount()).toBe(0);
  expect(FakeRecognition.latest.onresult).toBeNull();
});
