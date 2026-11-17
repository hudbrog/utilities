// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CurriculumImport } from "./CurriculumImport";
import { addCurriculum, previewCurriculumImport } from "../../application/parentService";
import { planCurriculumImport } from "../../domain/curriculum/import";
import type { CurriculumBundle } from "../../domain/curriculum/model";

vi.mock("../../application/parentService", () => ({ addCurriculum: vi.fn(), previewCurriculumImport: vi.fn() }));
const bundle: CurriculumBundle = {
  schemaVersion: 1, curriculumId: "academy-stars-1-workbook-2017", curriculumVersion: "1", sourceFingerprint: "test",
  units: [{ id: "welcome", number: 0, conceptIds: ["cat", "orange"] }],
  concepts: [
    { id: "cat", unitId: "welcome", order: 0, en: "cat", ru: "кот", acceptedEn: [], acceptedRu: [] },
    { id: "orange", unitId: "welcome", order: 1, en: "orange", ru: "апельсин / оранжевый", acceptedEn: [], acceptedRu: [] },
  ],
};
let root: Root;
let container: HTMLDivElement;
const onImported = vi.fn(async () => {});
const button = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === text)!;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => bundle })));
  vi.mocked(previewCurriculumImport).mockResolvedValue({ bundle, rows: planCurriculumImport(bundle, [{ ...bundle.concepts[0], id: "duo-cat" }]), introduced: ["duo-cat"] });
  vi.mocked(addCurriculum).mockResolvedValue({ id: bundle.curriculumId, title: "Academy Stars 1", bundle, conceptMap: { cat: "duo-cat", orange: null }, importedAt: 1 });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(CurriculumImport, { onImported, academyInstalled: false })); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

test("preview preserves known progress and requires an explicit ambiguity decision before import", async () => {
  await act(async () => button("Добавить Academy Stars 1").click());
  expect(container.textContent).toContain("1 уже в занятиях");
  expect(button("Добавить блоки").disabled).toBe(true);
  expect(addCurriculum).not.toHaveBeenCalled();
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "skip"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(button("Добавить блоки").disabled).toBe(false);
  await act(async () => button("Добавить блоки").click());
  expect(addCurriculum).toHaveBeenCalledWith(bundle, "Academy Stars 1", { cat: "link:duo-cat", orange: "skip" });
  expect(onImported).toHaveBeenCalledWith(bundle.curriculumId);
  expect(container.querySelector(".import-preview")).toBeNull();
});

test("cancel leaves the course unimported and parse failures are visible", async () => {
  await act(async () => button("Добавить Academy Stars 1").click());
  await act(async () => button("Отмена").click());
  expect(addCurriculum).not.toHaveBeenCalled();
  vi.mocked(previewCurriculumImport).mockRejectedValueOnce(new Error("Неверный формат файла"));
  await act(async () => button("Добавить Academy Stars 1").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Неверный формат файла");
});
