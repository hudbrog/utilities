// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { loadParentSnapshot } from "../../application/parentService";
import { concepts } from "../../domain/testFixtures";
import { defaultLearnerSettings } from "../../infrastructure/db/settingsRepository";
import { speak } from "../../infrastructure/speech/synthesis";
import { ParentApp } from "./ParentApp";

vi.mock("../../application/parentService", () => ({ loadParentSnapshot: vi.fn() }));
vi.mock("../../infrastructure/speech/synthesis", () => ({ speak: vi.fn(async () => null), cancelSpeech: vi.fn() }));

test("the speaker in the word list plays English independently of opening the word", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(loadParentSnapshot).mockResolvedValue({
    settings: defaultLearnerSettings, units: [], today: null, dueCount: 0, newAvailableToday: 0,
    reviewUnits: [], importedCurricula: [],
    words: [{ concept: { ...concepts[0], retired: false }, progressIntroduced: true, states: {}, attempts: [] }],
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(ParentApp, {
      close: vi.fn(), openDiagnostics: vi.fn(), pwa: { offlineReady: true, needRefresh: false },
      checkForUpdate: vi.fn(), applyUpdate: null,
    })));
    const wordsTab = [...container.querySelectorAll("button")].find((button) => button.textContent === "Слова")!;
    await act(async () => wordsTab.click());
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Послушать: cat"]')!.click());
    expect(speak).toHaveBeenCalledExactlyOnceWith("cat", "en-US", { source: "replay" });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(".word-summary")!.click());
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("cat");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
