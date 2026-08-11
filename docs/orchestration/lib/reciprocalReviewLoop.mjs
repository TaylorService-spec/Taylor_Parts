// Reciprocal review LOOP orchestrator — pure (no I/O, no live calls). This is the missing GLUE that
// chains the already-merged contracts into ONE automatic cycle so the Owner never relays between Claude
// and GPT. It creates NO second queue, ledger, selector, wake mechanism, or context system — it composes:
//   reviewTrigger (eligibility/consume/select) · openaiReviewProvider (injected runner) · aiExchange
//   (injected persist) · selectNextWork (via selectNextWorkWithReviews) · wakeSupervisor (assessReadiness).
//
// Everything with a side effect is INJECTED (providerRunner, persistExchange, lease, clock), so the whole
// chain is unit-tested with a fake provider and NO OpenAI/Claude invocation. The live wiring supplies the
// real runOpenAIReview transport + a durable aiExchange store + the atomic wake lease — outside this module.

import { assessTriggerEligibility, consumeReviewResult, selectNextWorkWithReviews } from "./reviewTrigger.mjs";
import { assessReadiness } from "./wakeSupervisor.mjs";

// Per-exchange lifecycle (the durable/injected idempotency states the directive asks for).
export const EXCHANGE_LIFECYCLE = Object.freeze(["NOT_TRIGGERED", "TRIGGERED", "IN_FLIGHT", "COMPLETED", "CONSUMED"]);

/**
 * Deterministic, TOKEN-FREE eligibility. A GPT call may occur ONLY for a review that is OPEN +
 * INDEPENDENT_AI + authorized-for-review + context SUFFICIENT + provenance CURRENT + not duplicate.
 * Reuses assessTriggerEligibility for the dedupe/context/freshness gate. No AI here.
 */
export function selectEligibleReviews(reviews = [], { store, sufficiencyOf = () => "SUFFICIENT", freshnessOf = () => "CURRENT", protectedOf = () => false } = {}) {
  const eligible = [];
  const skipped = [];
  for (const r of reviews || []) {
    if (r.status !== "OPEN") { skipped.push({ requestId: r.requestId, reason: "not OPEN" }); continue; }
    if (r.reviewClass !== "INDEPENDENT_AI") { skipped.push({ requestId: r.requestId, reason: "not INDEPENDENT_AI" }); continue; }
    if (r.authorizedForReview !== true) { skipped.push({ requestId: r.requestId, reason: "not authorized for review (READY ≠ authorization; EVENT ≠ authorization)" }); continue; }
    // A review that targets a PROTECTED action never reaches a GPT call — a reviewer can't authorize it.
    if (protectedOf(r) === true) { skipped.push({ requestId: r.requestId, reason: "targets a protected action — not eligible for automated review" }); continue; }
    const gate = assessTriggerEligibility({ request: r, store, contextSufficiency: sufficiencyOf(r), sourceFreshness: freshnessOf(r) });
    if (!gate.eligible) { skipped.push({ requestId: r.requestId, reason: gate.reason, failureKind: gate.failureKind }); continue; }
    eligible.push(r);
  }
  return { eligible, skipped };
}

/** Adapter: a selector work item (`.state`) → a wake item (`.status/.authorized`) for assessReadiness. */
export function mapToWakeItem(item = {}) {
  return { id: item.id, status: item.state === "READY" ? "READY" : item.state, authorized: true, protectedBoundary: false, workstream: item.workstream || null, source: "REVIEW_CONSUMPTION", sha: item.sha || null };
}

/**
 * The COMPACT GPT result a woken Claude needs in its C-7 package — verdict/conclusion/corrections/
 * evidence + provenance + review id. Deliberately EXCLUDES API transcript, model internals, and other
 * exchanges.
 */
export function reviewReturnContext(result = {}, contextPackageRef = null, provenance = null) {
  return {
    reviewId: result.exchangeId || null,
    verdict: result.verdict || null,
    conclusion: result.conclusion ?? null,
    corrections: result.corrections ?? [],
    evidenceRequired: result.verdict === "EVIDENCE_REQUIRED" || result.evidenceRequired === true,
    evidenceRefs: result.evidenceRefs ?? [],
    provenance: provenance ?? result.provenance ?? null,
    contextPackageRef: contextPackageRef ?? result.contextPackageRef ?? null,
  };
}

/**
 * Run ONE reciprocal review cycle over durable AI_REVIEWs. For each ELIGIBLE review, at most ONE provider
 * invocation occurs (lease-guarded), the structured result is persisted to aiExchange, consumed, and — if a
 * responsible assignment becomes eligible — a wake decision (WOULD_TRIGGER) is produced with the compact
 * GPT return context. No live provider/Claude call: providerRunner + persistExchange + lease + clock are
 * injected. Fail-closed throughout; a verdict never authorizes a protected action; silence ≠ approval.
 *
 * @param {object} p
 * @param {Array}  p.reviews               durable AI_REVIEW requests (buildReviewRequest-shaped)
 * @param {Array}  p.backlogItems          the current selector backlog
 * @param {object} p.store                 review store (get/put/has/markHandled) — reviewTrigger's store
 * @param {(review)=>Promise<{ok,result?,usage?,failureKind?}>} p.providerRunner  INJECTED (fake in tests)
 * @param {(exchange)=>void} [p.persistExchange]     INJECTED aiExchange writer
 * @param {(id)=>boolean} [p.acquireLease] / {(id)=>void} [p.releaseLease]  at-most-once lease (injected)
 * @param {(review)=>string} [p.sufficiencyOf] / [p.freshnessOf]  context/provenance per review
 * @param {(review)=>boolean} [p.targetsProtectedActionOf]  the reviewed work is a protected action
 * @param {(result)=>object} [p.contextPackageRefOf] / [p.provenanceOf]
 * @param {()=>any} [p.clock]              injected timestamp source (null in tests)
 * @param {object} [p.wakeCtx]             ctx for assessReadiness (governor/network/budget)
 */
export async function runReciprocalReviewCycle({
  reviews = [], backlogItems = [], store,
  providerRunner, persistExchange = () => {},
  acquireLease = () => true, releaseLease = () => {},
  sufficiencyOf = () => "SUFFICIENT", freshnessOf = () => "CURRENT",
  targetsProtectedActionOf = () => false, contextPackageRefOf = () => null, provenanceOf = () => null,
  clock = () => null, wakeCtx = {},
} = {}) {
  if (typeof providerRunner !== "function") throw new Error("runReciprocalReviewCycle: providerRunner must be injected");
  const { eligible, skipped } = selectEligibleReviews(reviews, { store, sufficiencyOf, freshnessOf });

  const perReview = [];
  const consumed = []; // { workItem, result }
  const ownerSurfaces = [];
  let providerInvocations = 0;

  for (const review of eligible) {
    const exchangeId = `rev:${review.requestId}`;
    // At-most-once: the lease guards against duplicated events, workflow retry, concurrent runners,
    // process retry, and result replay. A held lease → skip (no second provider call).
    if (!acquireLease(exchangeId)) { perReview.push({ exchangeId, lifecycle: "IN_FLIGHT", skipped: true, reason: "lease held (duplicate/retry/concurrent)" }); continue; }
    // Also skip if the store already advanced this exchange past NOT_TRIGGERED (replay protection).
    const prior = store.get && store.get(exchangeId);
    if (prior && EXCHANGE_LIFECYCLE.indexOf(prior.lifecycle) >= EXCHANGE_LIFECYCLE.indexOf("TRIGGERED")) {
      releaseLease(exchangeId);
      perReview.push({ exchangeId, lifecycle: prior.lifecycle, skipped: true, reason: "already handled (replay)" });
      continue;
    }
    try {
      const triggeredAt = clock();
      store.put({ exchangeId, requestId: review.requestId, lifecycle: "TRIGGERED", triggeredAt });
      store.put({ exchangeId, requestId: review.requestId, lifecycle: "IN_FLIGHT", triggeredAt });
      providerInvocations++;
      let prov;
      try { prov = await providerRunner(review); }
      catch (e) { prov = { ok: false, failureKind: "PROVIDER_FAILED", reason: e && e.message }; }

      if (!prov || prov.ok === false || !prov.result) {
        store.put({ exchangeId, requestId: review.requestId, lifecycle: "COMPLETED", failed: true });
        const c = consumeReviewResult({ failureKind: (prov && prov.failureKind) || "PROVIDER_FAILED" });
        perReview.push({ exchangeId, lifecycle: "FAILED", failureKind: c.failureKind, consumable: c.consumable, verdict: null });
        continue;
      }

      const result = prov.result;
      store.put({ exchangeId, requestId: review.requestId, lifecycle: "COMPLETED", result, usage: prov.usage || null });

      // AUTOMATIC consumption (fail-closed; protected-action check inside).
      const cr = consumeReviewResult({ result, targetsProtectedAction: targetsProtectedActionOf(review), consumedAt: clock() });
      if (cr.exchange) persistExchange(cr.exchange); // AUTOMATIC persistence into aiExchange
      store.put({ exchangeId, requestId: review.requestId, lifecycle: "CONSUMED", disposition: cr.disposition });
      if (cr.ownerSurface) ownerSurfaces.push({ ...cr.ownerSurface, exchangeId });
      if (cr.consumable && cr.workItem) consumed.push({ workItem: cr.workItem, result });
      // Carry the COMPACT semantic result (verdict/conclusion/corrections/evidence flags) so the operator
      // can see WHAT the reviewer concluded — never the transcript, model internals, or system metadata.
      perReview.push({
        exchangeId, lifecycle: "CONSUMED", disposition: cr.disposition, consumable: cr.consumable, usage: prov.usage || null,
        verdict: result.verdict, conclusion: result.conclusion ?? null, corrections: result.corrections ?? [],
        evidenceRefs: result.evidenceRefs ?? [], evidenceRequired: result.verdict === "EVIDENCE_REQUIRED" || result.evidenceRequired === true,
        ownerDecisionRequired: result.verdict === "NEEDS_OWNER" || result.ownerDecisionRequired === true,
      });
    } finally {
      releaseLease(exchangeId);
    }
  }

  // Selector recalculation — consumed review work items fold into the SAME selector (no second selector).
  const workItems = consumed.map((c) => c.workItem);
  const selection = selectNextWorkWithReviews(backlogItems, workItems);

  // If a responsible assignment is the next-eligible pick → produce a wake decision (WOULD_TRIGGER only).
  let wake = { wouldTrigger: false, decision: selection.decision, reason: "no actionable review-derived work" };
  let returnContext = null;
  if (selection.decision === "RUN" && selection.item) {
    const wakeItem = mapToWakeItem(selection.item);
    const readiness = assessReadiness(wakeItem, { triggerKind: "AUTOMATIC_TRIGGER", ...wakeCtx });
    wake = { wouldTrigger: readiness.decision === "TRIGGER", decision: readiness.decision, reason: readiness.reason, item: wakeItem, triggerKind: readiness.triggerKind, guardrails: readiness.guardrails || null };
    const match = consumed.find((c) => c.workItem.id === selection.item.id);
    if (match) returnContext = reviewReturnContext(match.result, contextPackageRefOf(match.result), provenanceOf(match.result));
  }

  // Owner-relay metric: this loop requires ZERO Claude↔GPT relay and ZERO "continue". A NEEDS_OWNER is a
  // genuine governed gate, tracked SEPARATELY — it is not relay friction.
  const relayMetric = { claudeToGptRelay: 0, gptToClaudeRelay: 0, ownerContinue: 0, genuineOwnerGates: ownerSurfaces.length };

  return {
    eligibleCount: eligible.length, skipped, perReview, providerInvocations,
    ownerSurfaces, selection: { decision: selection.decision }, wake, returnContext, relayMetric,
    board: projectReciprocalLoopBoard({ perReview, wake, ownerSurfaces, providerInvocations }),
  };
}

/** Control Center: compact loop truth (AI review lifecycle · responsible Claude · relay · calls). */
export function projectReciprocalLoopBoard({ perReview = [], wake = {}, ownerSurfaces = [], providerInvocations = 0 } = {}) {
  const review = { OPEN: 0, TRIGGERED: 0, IN_FLIGHT: 0, COMPLETED: 0, CONSUMED: 0, FAILED: 0 };
  let lastVerdict = null, lastProvenance = null;
  for (const r of perReview) {
    if (review[r.lifecycle] != null) review[r.lifecycle]++;
    if (r.verdict) lastVerdict = r.verdict;
  }
  const claude = wake.wouldTrigger ? "READY" : (wake.decision === "RUN" ? "WAITING" : "WAITING");
  return {
    aiReview: review,
    responsibleClaude: claude,            // WAITING | READY | (TRIGGERED/ACTIVE happen at live wake)
    gptCalls: providerInvocations,
    ownerRelayCount: 0,                   // this loop needs no relay
    genuineOwnerGates: ownerSurfaces.length,
    lastVerdict, lastProvenance,
    note: "AI reviewer is invoked by EOS; verdict ≠ authorization; silence ≠ approval; a NEEDS_OWNER is a governed gate, not relay friction.",
  };
}
