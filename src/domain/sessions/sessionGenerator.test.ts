import { describe, expect, it } from "vitest";

import { concepts } from "../testFixtures";
import { makeState } from "../testFixtures";
import { generateSession, insertRemediation, type ReviewCandidate } from "./sessionGenerator";

const capabilities = { speechRecognitionAvailable: true, listeningAudioUnlocked: false };

function review(conceptIndex: number, dueAt: number, stage = 3): ReviewCandidate {
  const concept = concepts[conceptIndex];
  return { concept, state: makeState(concept.id, "ru-en", stage as 3, { nextDueAt: dueAt }) };
}

describe("session generation", () => {
  it("sorts due work by overdue time before lower stage", () => {
    const session = generateSession({
      now: 100, dueReviews: [review(0, 20), review(1, 10)], newConcepts: [], introducedToday: 0,
      seed: "s", capabilities,
    });
    expect(session.map(({ conceptId }) => conceptId)).toEqual(["dog", "cat"]);
  });

  it("prioritizes the due direction with the lowest retrievability", () => {
    const strong = review(0, 0);
    strong.state = { ...strong.state, stability: 20, lastReviewAt: 0 };
    const weak = review(1, 0);
    weak.state = { ...weak.state, stability: 2, lastReviewAt: 0 };
    const session = generateSession({
      now: 10 * 86_400_000,
      dueReviews: [strong, weak],
      newConcepts: [],
      introducedToday: 0,
      seed: "retrievability",
      capabilities,
    });
    expect(session.map(({ conceptId }) => conceptId)).toEqual(["dog", "cat"]);
  });

  it("separates opposite directions of the same concept when possible", () => {
    const dueReviews: ReviewCandidate[] = [
      { concept: concepts[0], state: makeState("cat", "en-ru", 3, { nextDueAt: 0 }) },
      { concept: concepts[0], state: makeState("cat", "ru-en", 3, { nextDueAt: 0 }) },
      { concept: concepts[1], state: makeState("dog", "en-ru", 3, { nextDueAt: 0 }) },
      { concept: concepts[1], state: makeState("dog", "ru-en", 3, { nextDueAt: 0 }) },
    ];
    const session = generateSession({
      now: 100, dueReviews, newConcepts: [], introducedToday: 0,
      seed: "separate-directions", capabilities,
    });
    expect(session.map(({ conceptId }) => conceptId)).toEqual(["cat", "dog", "cat", "dog"]);
    expect(session.every((question, index) => index === 0 || question.conceptId !== session[index - 1].conceptId)).toBe(true);
  });

  it("introduces both directions, honors quota, and is deterministic", () => {
    const input = {
      now: 100, dueReviews: [review(4, 0)], newConcepts: concepts.slice(0, 3), introducedToday: 4,
      seed: "s", capabilities,
    };
    const session = generateSession(input);
    expect(generateSession(input)).toEqual(session);
    expect(session.filter(({ kind }) => kind === "introduction")).toEqual(expect.arrayContaining([
      expect.objectContaining({ conceptId: "cat", direction: "en-ru" }),
      expect.objectContaining({ conceptId: "cat", direction: "ru-en" }),
    ]));
    expect(new Set(session.filter(({ kind }) => kind === "introduction").map(({ conceptId }) => conceptId))).toEqual(new Set(["cat"]));
  });

  it("consumes new concepts in the supplied unit order", () => {
    const session = generateSession({
      now: 100,
      dueReviews: [],
      newConcepts: [concepts[0], concepts[1], concepts[4]],
      introducedToday: 0,
      dailyNewConceptQuota: 2,
      seed: "unit-order",
      capabilities,
    });
    expect([...new Set(session.map(({ conceptId }) => conceptId))]).toEqual(["cat", "dog"]);
  });

  it("suppresses new concepts under a large due backlog", () => {
    const dueReviews = Array.from({ length: 31 }, (_, index) => review(index % concepts.length, index));
    const session = generateSession({ now: 100, dueReviews, newConcepts: concepts, introducedToday: 0, seed: "s", capabilities });
    expect(session.every(({ kind }) => kind === "review")).toBe(true);
  });

  it("honors a configurable question limit", () => {
    const dueReviews = Array.from({ length: 8 }, (_, index) => review(index % concepts.length, index));
    const session = generateSession({
      now: 100, dueReviews, newConcepts: [], introducedToday: 0,
      chunkSize: 6, seed: "configured-limit", capabilities,
    });
    expect(session).toHaveLength(6);
  });

  it("unlocks mature listening exercises per directional spoken recall", () => {
    const candidate = review(0, 0, 6);
    candidate.state.successfulSpokenRecall = true;
    const seen = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      seen.add(generateSession({
        now: 100, dueReviews: [candidate], newConcepts: [], introducedToday: 0,
        seed: `listening-${index}`, capabilities,
      })[0].exerciseType);
    }
    expect(seen.has("stt_audio")).toBe(true);
  });

  it("inserts remediation three to five questions later and clamps to the end", () => {
    const session = generateSession({ now: 100, dueReviews: [review(0, 0), review(1, 1), review(2, 2), review(3, 3)], newConcepts: [], introducedToday: 0, seed: "s", capabilities });
    const remediated = insertRemediation(session, 0, session[0], "s");
    const position = remediated.findIndex(({ kind }) => kind === "remediation");
    expect(position).toBeGreaterThanOrEqual(4);
    expect(position).toBeLessThanOrEqual(6);
    const clamped = insertRemediation(session, session.length - 1, session.at(-1)!, "s");
    expect(clamped.at(-1)?.kind).toBe("remediation");
  });
});
