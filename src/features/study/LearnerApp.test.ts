// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { concepts, units } from "../../domain/testFixtures";
import { distractorCurriculum, goToNextQuestion, introducedConceptIds, loadStudy, scoreAnswer, type StudySnapshot } from "../../application/studyService";
import { FakeRecognition, recognitionEvent } from "../../test/speechRecognition";
import { LearnerApp } from "./LearnerApp";
import { SpeechTestCard } from "../diagnostics/SpeechTestCard";

vi.mock("../../application/studyService", () => ({
  loadStudy: vi.fn(), scoreAnswer: vi.fn(), goToNextQuestion: vi.fn(), distractorCurriculum: vi.fn(), introducedConceptIds: vi.fn(),
}));
vi.mock("../../infrastructure/speech/synthesis", () => ({ speak: vi.fn(async () => null) }));

const question = {
  id: "question", sessionId: "session", position: 0, conceptId: "cat", direction: "en-ru" as const,
  exerciseType: "stt_text" as const, kind: "review" as const, status: "current" as const,
};
const snapshot: StudySnapshot = {
  session: { id: "session", status: "active", seed: "test", createdAt: 1, updatedAt: 1 },
  questions: [question], current: question, concept: concepts[0], completed: false,
};
let container: HTMLDivElement;
let root: Root | null;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  FakeRecognition.reset();
  vi.mocked(loadStudy).mockResolvedValue(structuredClone(snapshot));
  vi.mocked(distractorCurriculum).mockResolvedValue({ concepts, units });
  vi.mocked(introducedConceptIds).mockResolvedValue(new Set(["cat"]));
  vi.mocked(scoreAnswer).mockImplementation(async (current, correct) => {
    const revealed = { ...current.current!, status: "revealed" as const, revealedOutcome: correct ? "correct" as const : "incorrect" as const };
    return { ...current, current: revealed, questions: [revealed] };
  });
  vi.mocked(goToNextQuestion).mockResolvedValue({ ...snapshot, current: null, concept: null, completed: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(LearnerApp, { openDiagnostics: () => {} })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function microphone(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(".microphone-button")!;
}
async function clickMic() { await act(async () => { microphone().click(); }); }
async function finalResult(text: string) { await act(async () => { FakeRecognition.latest.result([text]); }); }

test("a second press stops capture and scores the late final result exactly once", async () => {
  await clickMic();
  expect(microphone().disabled).toBe(false);
  expect(microphone().getAttribute("aria-label")).toBe("Закончить ответ");
  expect(container.textContent).toContain("Готово");
  const recognition = FakeRecognition.latest;
  await clickMic();
  expect(recognition.stop).toHaveBeenCalledTimes(1);
  expect(recognition.abort).not.toHaveBeenCalled();
  expect(microphone().disabled).toBe(true);
  expect(container.textContent).toContain("Обрабатываю… Микрофон уже выключен.");
  await clickMic();
  expect(recognition.stop).toHaveBeenCalledTimes(1);
  expect(scoreAnswer).not.toHaveBeenCalled();
  await finalResult("кот");
  expect(scoreAnswer).toHaveBeenCalledExactlyOnceWith(expect.anything(), true, {
    completionMode: "speech", sttAttemptCount: 1, sttTranscripts: [["кот"]],
  });
  expect(goToNextQuestion).not.toHaveBeenCalled();
  await act(async () => { recognition.result(["кот"]); recognition.onend?.(); await vi.advanceTimersByTimeAsync(700); });
  expect(scoreAnswer).toHaveBeenCalledTimes(1);
  expect(goToNextQuestion).toHaveBeenCalledTimes(1);
});

test.each(["no-result", "no-speech"])("an empty recording (%s) allows retry without using an attempt", async (code) => {
  await clickMic(); await clickMic();
  await act(async () => {
    if (code === "no-result") FakeRecognition.latest.onend?.();
    else FakeRecognition.latest.error(code);
  });
  expect(scoreAnswer).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Ничего не услышала");
  expect(container.textContent).toContain("Попытка 1 из 3");
  expect(microphone().disabled).toBe(false);
  await clickMic();
  await finalResult("кот");
  expect(scoreAnswer).toHaveBeenCalledWith(expect.anything(), true, expect.objectContaining({ sttAttemptCount: 1 }));
});

test("a final result advances without a second press or end event", async () => {
  await clickMic();
  await finalResult("кот");
  expect(scoreAnswer).toHaveBeenCalledTimes(1);
  expect(FakeRecognition.latest.stop).toHaveBeenCalledTimes(1);
});

test("the stop button works while microphone startup is pending", async () => {
  FakeRecognition.autoStart = false;
  await clickMic();
  expect(container.textContent).toContain("Включаю микрофон");
  expect(microphone().disabled).toBe(false);
  await clickMic();
  await act(async () => { FakeRecognition.latest.onstart?.(); });
  expect(container.textContent).toContain("Обрабатываю");
  expect(microphone().disabled).toBe(true);
  await finalResult("кот");
  expect(scoreAnswer).toHaveBeenCalledTimes(1);
});

test.each([false, true])("leaving the learner ignores any late answer, already stopped: %s", async (stopped) => {
  await clickMic();
  if (stopped) await clickMic();
  const recognition = FakeRecognition.latest;
  const lateResult = recognition.onresult!;
  await act(async () => { root!.unmount(); root = null; });
  expect(recognition.abort).toHaveBeenCalledTimes(1);
  await act(async () => { lateResult(recognitionEvent(["кот"])); });
  expect(scoreAnswer).not.toHaveBeenCalled();
  expect(goToNextQuestion).not.toHaveBeenCalled();
});

test("microphone permission failures still offer multiple choice without scoring", async () => {
  await clickMic();
  await act(async () => { FakeRecognition.latest.error("not-allowed"); });
  expect(container.querySelectorAll(".choice")).toHaveLength(4);
  expect(scoreAnswer).not.toHaveBeenCalled();
});

test("manual stopping preserves the three-mismatch policy", async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await clickMic();
    if (attempt > 1) expect(container.querySelector<HTMLButtonElement>(".speech-answer .text-button")?.disabled).toBe(true);
    await clickMic();
    await finalResult("не тот ответ");
    if (attempt < 3) expect(scoreAnswer).not.toHaveBeenCalled();
  }
  expect(scoreAnswer).toHaveBeenCalledExactlyOnceWith(expect.anything(), false, {
    completionMode: "speech", completionReason: "third_stt_mismatch", sttAttemptCount: 3,
    sttTranscripts: [["не тот ответ"], ["не тот ответ"], ["не тот ответ"]],
  });
});

test("diagnostics can stop recording and display the resulting alternatives", async () => {
  const onDiagnostic = vi.fn();
  await act(async () => {
    root!.render(createElement(SpeechTestCard, {
      locale: "en-US", heading: "English", recognitionPrompt: "cat", ttsText: "cat", onDiagnostic,
    }));
  });
  const button = () => container.querySelector<HTMLButtonElement>(".button--primary")!;
  await act(async () => { button().click(); });
  const active = FakeRecognition.instances.find((instance) => instance.start.mock.calls.length)!;
  expect(button().textContent).toContain("Готово");
  expect(button().disabled).toBe(false);
  await act(async () => { button().click(); });
  expect(active.stop).toHaveBeenCalledTimes(1);
  expect(button().textContent).toContain("Обрабатываю");
  expect(button().disabled).toBe(true);
  expect(onDiagnostic).not.toHaveBeenCalled();
  await act(async () => { active.result(["cat"]); });
  expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ locale: "en-US", alternatives: [{ transcript: "cat", confidence: 0.9 }] }));
  expect(button().textContent).toContain("Проверить STT");
});
