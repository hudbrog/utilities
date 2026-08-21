import type { ConceptDefinition, UnitDefinition } from "../../domain/curriculum/model";
import type { CurriculumReviewPackage, CurriculumReviewProposal } from "../../domain/curriculum/review";
import { normalizeAnswer } from "../../domain/exercises/normalization";
import { loadCurriculumReviewPackage } from "../curriculum/reviewPackage";
import type { EnglishSrsDatabase } from "./database";
import type { CurriculumReviewDecision, CurriculumReviewUnit } from "./model";

export type EffectiveReviewStatus = "approved" | "edited" | "excluded" | "deferred" | "auto_reviewed" | "needs_human_review";

export type ReviewWord = {
  proposal: CurriculumReviewProposal;
  status: EffectiveReviewStatus;
  ru: string;
  acceptedEn: string[];
  acceptedRu: string[];
  staleDecision: boolean;
};

export type ReviewUnitSnapshot = {
  unit: CurriculumReviewPackage["units"][number];
  words: ReviewWord[];
  approvedAt: number | null;
  unresolvedCount: number;
  attentionCount: number;
  cleanCount: number;
};

function effectiveWord(proposal: CurriculumReviewProposal, decision?: CurriculumReviewDecision): ReviewWord {
  const staleDecision = Boolean(decision && decision.proposalFingerprint !== proposal.proposalFingerprint);
  if (decision && !staleDecision) {
    return { proposal, status: decision.status, ru: decision.ru, acceptedEn: decision.acceptedEn, acceptedRu: decision.acceptedRu, staleDecision: false };
  }
  return {
    proposal,
    status: proposal.initialReviewStatus === "approved" ? "approved" : proposal.initialReviewStatus,
    ru: proposal.ru,
    acceptedEn: proposal.acceptedEn,
    acceptedRu: proposal.acceptedRu,
    staleDecision,
  };
}

const resolvedStatuses = new Set<EffectiveReviewStatus>(["approved", "edited", "excluded"]);

export async function initializeCurriculumReview(db: EnglishSrsDatabase, now = Date.now()): Promise<CurriculumReviewPackage> {
  const reviewPackage = await loadCurriculumReviewPackage();
  const sourceMeta = await db.appMeta.get("sourceFingerprint");
  if (sourceMeta?.value === "fixture:not-production-curriculum") {
    await db.transaction("rw", [db.appMeta, db.units, db.concepts, db.sessions, db.sessionQuestions], async () => {
      await Promise.all([db.units.clear(), db.sessions.clear(), db.sessionQuestions.clear()]);
      await db.concepts.toCollection().modify({ retired: true });
      await db.appMeta.delete("curriculumVersion");
      await db.appMeta.delete("sourceFingerprint");
    });
  }
  const approvedUnits = new Map((await db.curriculumReviewUnits.toArray()).map((unit) => [unit.unitId, unit]));
  const staleActiveUnitIds = reviewPackage.units
    .filter((unit) => approvedUnits.has(unit.id) && approvedUnits.get(unit.id)!.reviewFingerprint !== unit.reviewFingerprint)
    .map((unit) => unit.id);
  if (staleActiveUnitIds.length) {
    await db.transaction("rw", [db.units, db.concepts], async () => {
      await db.units.where("id").anyOf(staleActiveUnitIds).modify({ state: "inactive" });
      await db.concepts.where("unitId").anyOf(staleActiveUnitIds).modify({ retired: true });
    });
  }
  await db.appMeta.put({ key: "reviewPackageVersion", value: reviewPackage.curriculumVersion, updatedAt: now });
  return reviewPackage;
}

export async function loadReviewUnits(db: EnglishSrsDatabase): Promise<ReviewUnitSnapshot[]> {
  const reviewPackage = await initializeCurriculumReview(db);
  const [decisions, approvals] = await Promise.all([db.curriculumReviewDecisions.toArray(), db.curriculumReviewUnits.toArray()]);
  const decisionById = new Map(decisions.map((decision) => [decision.conceptId, decision]));
  const approvalByUnit = new Map(approvals.map((approval) => [approval.unitId, approval]));
  const proposalById = new Map(reviewPackage.proposals.map((proposal) => [proposal.conceptId, proposal]));
  return reviewPackage.units.map((unit) => {
    const words = unit.conceptIds.flatMap((conceptId) => {
      const proposal = proposalById.get(conceptId);
      return proposal ? [effectiveWord(proposal, decisionById.get(conceptId))] : [];
    });
    const unresolvedCount = words.filter(({ status, staleDecision }) => !resolvedStatuses.has(status) || staleDecision).length;
    return {
      unit,
      words,
      approvedAt: approvalByUnit.get(unit.id)?.reviewFingerprint === unit.reviewFingerprint ? approvalByUnit.get(unit.id)!.approvedAt : null,
      unresolvedCount,
      attentionCount: words.filter(({ proposal, status, staleDecision }) => staleDecision || status === "needs_human_review" || status === "deferred" || proposal.reviewDecision !== "accept").length,
      cleanCount: words.filter(({ status }) => status === "auto_reviewed").length,
    };
  });
}

export async function saveReviewDecision(
  db: EnglishSrsDatabase,
  conceptId: string,
  status: CurriculumReviewDecision["status"],
  values?: { ru: string; acceptedEn: string[]; acceptedRu: string[] },
  now = Date.now(),
): Promise<void> {
  const reviewPackage = await initializeCurriculumReview(db, now);
  const proposal = reviewPackage.proposals.find((candidate) => candidate.conceptId === conceptId);
  if (!proposal) throw new Error(`Unknown review proposal: ${conceptId}`);
  const decision: CurriculumReviewDecision = {
    conceptId,
    proposalFingerprint: proposal.proposalFingerprint,
    status,
    ru: values?.ru.trim() || proposal.ru,
    acceptedEn: values?.acceptedEn ?? proposal.acceptedEn,
    acceptedRu: values?.acceptedRu ?? proposal.acceptedRu,
    updatedAt: now,
  };
  await db.transaction("rw", [db.curriculumReviewDecisions, db.concepts, db.conceptProgress], async () => {
    await db.curriculumReviewDecisions.put(decision);
    const active = await db.concepts.get(conceptId);
    if (active) {
      const retired = status === "excluded";
      if (retired) await db.concepts.put({ ...active, retired: true });
      else await db.concepts.put({
        ...active,
        ru: decision.ru,
        acceptedEn: uniqueAliases(active.en, decision.acceptedEn, "en"),
        acceptedRu: uniqueAliases(decision.ru, decision.acceptedRu, "ru"),
        retired: false,
      });
      const progress = await db.conceptProgress.get(conceptId);
      if (progress) await db.conceptProgress.put({ ...progress, retired });
    }
  });
}

export async function approveCleanWords(db: EnglishSrsDatabase, unitId: string, now = Date.now()): Promise<void> {
  const units = await loadReviewUnits(db);
  const unit = units.find((candidate) => candidate.unit.id === unitId);
  if (!unit) throw new Error(`Unknown review unit: ${unitId}`);
  const decisions = unit.words.filter(({ status }) => status === "auto_reviewed").map(({ proposal, ru, acceptedEn, acceptedRu }) => ({
    conceptId: proposal.conceptId,
    proposalFingerprint: proposal.proposalFingerprint,
    status: "approved" as const,
    ru,
    acceptedEn,
    acceptedRu,
    updatedAt: now,
  }));
  if (decisions.length) await db.curriculumReviewDecisions.bulkPut(decisions);
}

function uniqueAliases(primary: string, values: string[], language: "en" | "ru"): string[] {
  const seen = new Set([normalizeAnswer(primary, language)]);
  return values.filter((value) => {
    const normalized = normalizeAnswer(value, language);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function toConcept(word: ReviewWord): ConceptDefinition {
  const concept: ConceptDefinition = {
    id: word.proposal.conceptId,
    unitId: word.proposal.unitId,
    order: word.proposal.order,
    en: word.proposal.en,
    ru: word.ru,
    acceptedEn: uniqueAliases(word.proposal.en, word.acceptedEn, "en"),
    acceptedRu: uniqueAliases(word.ru, word.acceptedRu, "ru"),
  };
  if (word.proposal.partOfSpeech) concept.partOfSpeech = word.proposal.partOfSpeech;
  if (word.proposal.semanticCategory) concept.semanticCategory = word.proposal.semanticCategory;
  return concept;
}

export async function approveReviewUnit(db: EnglishSrsDatabase, unitId: string, now = Date.now()): Promise<void> {
  const reviewPackage = await initializeCurriculumReview(db, now);
  const unit = (await loadReviewUnits(db)).find((candidate) => candidate.unit.id === unitId);
  if (!unit) throw new Error(`Unknown review unit: ${unitId}`);
  if (unit.unresolvedCount) throw new Error(`Осталось проверить слов: ${unit.unresolvedCount}`);
  const concepts = unit.words.filter(({ status, proposal }) => status !== "excluded" && !proposal.unsuitableReason).map(toConcept);
  if (!concepts.length) throw new Error("В блоке не осталось учебных слов");
  const activeUnit: UnitDefinition = { id: unit.unit.id, number: unit.unit.number, titleRu: unit.unit.titleRu, conceptIds: concepts.map(({ id }) => id) };
  const approval: CurriculumReviewUnit = { unitId, reviewFingerprint: unit.unit.reviewFingerprint, approvedAt: now };
  await db.transaction("rw", [db.units, db.concepts, db.conceptProgress, db.curriculumReviewUnits, db.appMeta], async () => {
    const previous = await db.units.get(unitId);
    const nextConceptIds = new Set(activeUnit.conceptIds);
    const removedConceptIds = previous?.conceptIds.filter((conceptId) => !nextConceptIds.has(conceptId)) ?? [];
    await db.units.put({ ...activeUnit, state: previous?.state ?? "inactive" });
    await db.concepts.bulkPut(concepts.map((concept) => ({ ...concept, retired: false })));
    if (activeUnit.conceptIds.length) await db.conceptProgress.where("conceptId").anyOf(activeUnit.conceptIds).modify({ retired: false });
    if (removedConceptIds.length) {
      await db.concepts.where("id").anyOf(removedConceptIds).modify({ retired: true });
      await db.conceptProgress.where("conceptId").anyOf(removedConceptIds).modify({ retired: true });
    }
    await db.curriculumReviewUnits.put(approval);
    await db.appMeta.put({ key: "curriculumVersion", value: reviewPackage.curriculumVersion, updatedAt: now });
    await db.appMeta.put({ key: "sourceFingerprint", value: reviewPackage.sourceFingerprint, updatedAt: now });
  });
}

export async function exportReviewApprovals(db: EnglishSrsDatabase): Promise<unknown> {
  const reviewPackage = await initializeCurriculumReview(db);
  const decisions = new Map((await db.curriculumReviewDecisions.toArray()).map((decision) => [decision.conceptId, decision]));
  const records = Object.fromEntries(reviewPackage.proposals.map((proposal) => {
    const word = effectiveWord(proposal, decisions.get(proposal.conceptId));
    const explicitlyApproved = resolvedStatuses.has(word.status);
    return [proposal.conceptId, {
      sourceFingerprint: reviewPackage.sourceFingerprint,
      en: proposal.en,
      ru: word.ru,
      acceptedEn: word.acceptedEn,
      acceptedRu: word.acceptedRu,
      semanticCategory: proposal.semanticCategory,
      unsuitableReason: word.status === "excluded" ? (proposal.unsuitableReason ?? "Excluded during parent review") : proposal.unsuitableReason,
      reviewStatus: explicitlyApproved ? "approved" : proposal.initialReviewStatus,
      generationConfidence: proposal.generationConfidence,
      reviewConfidence: proposal.reviewConfidence,
      reviewDecision: proposal.reviewDecision,
      reviewNotes: proposal.reviewNotes,
    }];
  }));
  return { schemaVersion: 1, records };
}
