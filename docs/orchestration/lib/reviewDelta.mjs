// Delta / correction review — "DO NOT RE-REVIEW WHEN THE REVIEWED HASH HAS NOT CHANGED." When a prior
// independent review returned findings and the author then corrected the implementation, we do NOT resend
// the original request. We compare content hashes (implementation, authority) and, per still-open finding,
// ask ONE narrow question — "Is finding F-XX resolved?" — carrying only the finding reference and the
// changed material. Unchanged findings are never re-litigated; an unchanged reviewed subject is not
// re-reviewed at all (the prior verdict stands).
//
// Pure, zero-dependency ESM. Composes reviewFacts (feed) + reviewQuestion (narrow contract) + reviewArtifacts
// (content hashes). Does NOT touch selector / Wake Supervisor / authority model / aiExchange lifecycle /
// provider routing / review semantics.

import { makeFact, buildFactFeed } from "./reviewFacts.mjs";
import { makeNarrowQuestion, verdictDisposition } from "./reviewQuestion.mjs";

/** Reasons a delta review is or is not warranted. */
export const DELTA_DISPOSITIONS = Object.freeze([
  "NO_MATERIAL_CHANGE", // nothing the review depends on changed → prior verdict stands, no paid call
  "DELTA_REVIEW",       // implementation and/or authority changed → re-ask only the open findings
]);

const hashOf = (ref) => (ref && typeof ref === "object" ? ref.sha256 ?? null : ref ?? null);

/**
 * Decide whether a correction warrants any re-review, purely by comparing content hashes. A review depends
 * on the implementation it reviewed and the authority it applied; if NEITHER hash moved, the prior verdict
 * is still valid and no provider call is justified.
 * @returns {{ disposition, implChanged, authorityChanged, warrantsReview }}
 */
export function assessDelta({ priorImplRef, newImplRef, priorAuthorityRef = null, newAuthorityRef = null } = {}) {
  const implChanged = hashOf(priorImplRef) !== hashOf(newImplRef);
  const authorityChanged = hashOf(priorAuthorityRef) !== hashOf(newAuthorityRef);
  const warrantsReview = implChanged || authorityChanged;
  return {
    disposition: warrantsReview ? "DELTA_REVIEW" : "NO_MATERIAL_CHANGE",
    implChanged,
    authorityChanged,
    warrantsReview,
  };
}

/**
 * Build the delta review for a single still-open finding. The feed carries ONLY: the finding reference
 * (the substance stays in its durable artifact), the changed-material references, and the unchanged
 * authority as a reference — never the original request, the resolved findings, or the whole diff.
 * @returns {{ question, feed, breakdown }}
 */
export function buildFindingDeltaFeed({ finding, newImplRef, authorityRefs = [], changedRefs = [], protocolVersion } = {}) {
  if (!finding || !finding.findingId) throw new Error("buildFindingDeltaFeed: finding.findingId required");
  const question = makeNarrowQuestion({
    questionId: `delta:${finding.findingId}`,
    ask: `Is finding ${finding.findingId} resolved by the corrected implementation?`,
  });
  const facts = [
    makeFact({
      kind: "SOURCE_FACT",
      statement: `Prior finding ${finding.findingId}: ${finding.summary || "(see reference)"}`,
      materialDecision: `resolve:${finding.findingId}`,
      ref: finding.ref || null,
    }),
    makeFact({
      kind: "SOURCE_FACT",
      statement: "Corrected implementation under review",
      materialDecision: `resolve:${finding.findingId}`,
      ref: newImplRef || null,
    }),
    ...changedRefs.map((ref, i) =>
      makeFact({
        kind: "SOURCE_FACT",
        statement: `Changed material #${i + 1} since prior review`,
        materialDecision: `resolve:${finding.findingId}`,
        ref,
      })
    ),
  ];
  const { feed, breakdown } = buildFactFeed({
    questionId: question.questionId,
    ask: question.ask,
    verdictVocab: question.verdictVocab,
    facts,
    authorityRefs,
    provenance: { deltaOf: finding.findingId, newImpl: hashOf(newImplRef) },
    protocolVersion,
  });
  return { question, feed, breakdown };
}

/**
 * Given per-finding delta verdicts (from structureCompactResult), decide the overall correction outcome.
 * A YES resolves that finding; anything else keeps it open; an OWNER_REQUIRED on any finding escalates.
 * @returns {{ allResolved, resolved, unresolved, escalate }}
 */
export function resolveDeltaOutcome(findingVerdicts = []) {
  const resolved = [];
  const unresolved = [];
  let escalate = false;
  for (const { findingId, verdict } of findingVerdicts) {
    const d = verdictDisposition(verdict);
    if (d.ownerGate) escalate = true;
    if (d.pass) resolved.push(findingId);
    else unresolved.push(findingId);
  }
  return { allResolved: unresolved.length === 0, resolved, unresolved, escalate };
}
