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

  it("suppresses new concepts under a large due backlog", () => {
    const dueReviews = Array.from({ length: 31 }, (_, index) => review(index % concepts.length, index));
    const session = generateSession({ now: 100, dueReviews, newConcepts: concepts, introducedToday: 0, seed: "s", capabilities });
    expect(session.every(({ kind }) => kind === "review")).toBe(true);
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
