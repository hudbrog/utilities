import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { StudyPrompt } from "./StudyPrompt";

test.each(["en-ru", "ru-en"] as const)("failed %s audio exposes the prompt and keeps replay available", (direction) => {
  const html = renderToStaticMarkup(createElement(StudyPrompt, {
    text: direction === "en-ru" ? "cat" : "кот", direction, audio: true, audioFailed: true, onReplay: () => {},
  }));
  expect(html).toContain(direction === "en-ru" ? '<h1 lang="en">cat</h1>' : '<h1 lang="ru">кот</h1>');
  expect(html).toContain('role="status"');
  expect(html).toContain("Послушать ещё раз");
});

test("working audio keeps the listening prompt hidden", () => {
  const html = renderToStaticMarkup(createElement(StudyPrompt, {
    text: "cat", direction: "en-ru", audio: true, audioFailed: false, onReplay: () => {},
  }));
  expect(html).not.toContain("<h1");
});
