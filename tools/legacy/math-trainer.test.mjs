import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const html = readFileSync(new URL("../../public/legacy/math-trainer.html", import.meta.url), "utf8");
let dom;
let document;

beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://example.test/legacy/math-trainer.html",
    beforeParse(window) {
      window.setTimeout = (callback, delay) => setTimeout(callback, delay);
    },
  });
  document = dom.window.document;
});

afterEach(() => {
  dom.window.close();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function field(id, value) {
  document.getElementById(id).value = String(value);
}

function checkbox(id, checked) {
  const element = document.getElementById(id);
  element.checked = checked;
  element.dispatchEvent(new dom.window.Event("change"));
}

function possibleProblems() {
  return dom.window.eval("buildAllPossibleProblems()");
}

function stats() {
  return JSON.parse(dom.window.localStorage.getItem("mathTrainerStats") || "{}");
}

function startSingleDigit(answer = 5) {
  field("min1", answer);
  field("max1", answer);
  field("min2", 0);
  field("max2", 0);
  checkbox("opSub", false);
  field("answerMode", "keypad");
  document.getElementById("startBtn").click();
}

test("optional result bounds keep both operands in 1–19 and every answer in 1–9", () => {
  field("max1", 19);
  field("max2", 19);
  checkbox("limitResult", true);
  const problems = possibleProblems();
  expect(problems.length).toBeGreaterThan(0);
  expect(problems.some(p => p.operand1 === 18 && p.operand2 === 9 && p.operator === "-")).toBe(true);
  expect(problems.some(p => p.operand1 === 8 && p.operand2 === 1 && p.operator === "+")).toBe(true);
  for (const problem of problems) {
    expect(problem.operand1).toBeGreaterThanOrEqual(1);
    expect(problem.operand1).toBeLessThanOrEqual(19);
    expect(problem.operand2).toBeGreaterThanOrEqual(1);
    expect(problem.operand2).toBeLessThanOrEqual(19);
    expect(problem.correctAnswer).toBeGreaterThanOrEqual(1);
    expect(problem.correctAnswer).toBeLessThanOrEqual(9);
  }
});

test("result bounds are optional, inclusive, and combine with tens-crossing rules", () => {
  expect(document.getElementById("minResult").disabled).toBe(true);
  expect(possibleProblems().some(p => p.correctAnswer === 0)).toBe(true);
  expect(possibleProblems().some(p => p.correctAnswer === 18)).toBe(true);
  field("max1", 19);
  checkbox("limitResult", true);
  expect(document.getElementById("maxResult").disabled).toBe(false);
  field("minResult", 0);
  expect(possibleProblems().some(p => p.correctAnswer === 0)).toBe(true);
  checkbox("onlyCrossTens", true);
  const crossing = possibleProblems();
  expect(crossing.length).toBeGreaterThan(0);
  expect(crossing.every(p => p.crosses && p.correctAnswer <= 9)).toBe(true);
  checkbox("onlyCrossTens", false);
  checkbox("allowCrossTens", false);
  expect(possibleProblems().every(p => !p.crosses && p.correctAnswer <= 9)).toBe(true);
});

test.each(["reversed", "blank", "fractional", "empty-pool"])("invalid result settings (%s) keep configuration visible", kind => {
  checkbox("limitResult", true);
  if (kind === "reversed") field("minResult", 10);
  if (kind === "blank") field("maxResult", "");
  if (kind === "fractional") field("maxResult", 9.5);
  if (kind === "empty-pool") {
    field("minResult", 100);
    field("maxResult", 101);
  }
  document.getElementById("startBtn").click();
  expect(document.getElementById("config").classList.contains("hidden")).toBe(false);
  expect(document.getElementById("problemContainer").classList.contains("hidden")).toBe(true);
  expect(document.getElementById("configError").textContent).not.toBe("");
});

test("the ten phone-layout buttons submit immediately, allow retry, and ignore duplicate submissions", () => {
  startSingleDigit();
  const buttons = [...document.querySelectorAll("#digitKeypad button")];
  expect(buttons.map(button => button.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);
  expect(document.getElementById("digitKeypad").classList.contains("hidden")).toBe(false);
  expect(document.getElementById("typedAnswerControls").classList.contains("hidden")).toBe(true);
  document.querySelector('[data-digit="9"]').click();
  expect(stats()["5 + 0"]).toEqual({ attempts: 1, correct: 0 });
  expect(document.getElementById("feedback").textContent).toContain("Неправильно");
  document.querySelector('[data-digit="5"]').click();
  document.querySelector('[data-digit="5"]').click();
  dom.window.eval("checkAnswer()");
  expect(stats()["5 + 0"]).toEqual({ attempts: 2, correct: 1 });
  expect(document.querySelectorAll("#problemLog > div")).toHaveLength(2);
  expect(buttons.every(button => button.disabled)).toBe(true);
  vi.advanceTimersByTime(299);
  expect(document.getElementById("congrats").classList.contains("hidden")).toBe(true);
  vi.advanceTimersByTime(1);
  expect(document.getElementById("congrats").classList.contains("hidden")).toBe(false);
  vi.advanceTimersByTime(1500);
  expect(document.querySelectorAll(".confetti-container")).toHaveLength(0);
});

test("zero works via the keypad and physical digit keys; held keys do not submit", () => {
  startSingleDigit(0);
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "0", repeat: true, bubbles: true }));
  expect(stats()).toEqual({});
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "0", bubbles: true }));
  expect(stats()["0 + 0"]).toEqual({ attempts: 1, correct: 1 });
});

test("keypad mode falls back to typed input for two-digit results in a mixed session", () => {
  field("min1", 1);
  field("max1", 1);
  field("min2", 1);
  field("max2", 9);
  checkbox("opSub", false);
  field("answerMode", "keypad");
  document.getElementById("startBtn").click();
  for (let index = 0; index < 9; index++) {
    const answer = dom.window.eval("problems[currentIndex].correctAnswer");
    const isKeypad = answer < 10;
    expect(document.getElementById("digitKeypad").classList.contains("hidden")).toBe(!isKeypad);
    expect(document.getElementById("typedAnswerControls").classList.contains("hidden")).toBe(isKeypad);
    if (isKeypad) document.querySelector(`[data-digit="${answer}"]`).click();
    else {
      field("userAnswer", answer);
      document.getElementById("submitAnswerBtn").click();
    }
    vi.advanceTimersByTime(300);
  }
  expect(Object.keys(stats())).toHaveLength(9);
  expect(Object.values(stats()).every(value => value.attempts === 1 && value.correct === 1)).toBe(true);
  expect(document.getElementById("congrats").classList.contains("hidden")).toBe(false);
});

test("typed mode still accepts Enter and ignores empty or fractional answers", () => {
  startSingleDigit();
  field("answerMode", "typed");
  dom.window.eval("showProblem()");
  expect(document.getElementById("typedAnswerControls").classList.contains("hidden")).toBe(false);
  const input = document.getElementById("userAnswer");
  document.getElementById("submitAnswerBtn").click();
  field("userAnswer", 5.5);
  document.getElementById("submitAnswerBtn").click();
  expect(stats()).toEqual({});
  field("userAnswer", 5);
  input.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  expect(stats()["5 + 0"]).toEqual({ attempts: 1, correct: 1 });
});
