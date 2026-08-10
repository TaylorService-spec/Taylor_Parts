// Reciprocal AI-review TRIGGER / RESULT contract — provider-neutral, EVENT-FIRST, pure (no I/O).
//
// EOS owns timing and routing; an AI reviewer (OpenAI, Anthropic, or a manual Owner relay) is a
// WORKER EOS invokes when reasoning is required — not the heartbeat. This module composes the EXISTING
// contracts into one reviewer lifecycle. It adds NO second queue, ledger, context mechanism, or
// selector:
//   • request/lifecycle/dedupe/dispositions → collaborationContract.mjs
//   • result record + verdicts + governance projection → aiExchange.mjs
//   • trigger state / mechanism → wakeState.mjs (+ wakeSupervisor mechanism names)
//   • source freshness / stale disposition → reviewProvenance.mjs
//   • selected model → modelPolicy.mjs
//   • consumed-result → eligible worker → resultConsumption.mjs + selectNextWork.mjs
//
// TRANSPORT NEUTRALITY (architecture correction): a review exchange is RUNTIME state, NOT institutional
// authority. Nothing here writes git, and nothing REQUIRES a commit per exchange. All persistence is an
// injected `store` adapter (a future runtime control-plane store; a repo aiExchange artifact is one
// valid backing today — chosen/deployed LATER, not here). Only ACCEPTED durable findings/decisions/
// evidence are PROMOTED into repository authority when governance requires it (`promoteToDurable`).
//
// FAIL CLOSED: silence ≠ approval; a review verdict ≠ execution authorization; a reviewer can never
// authorize a protected action. Every off-happy-path state is explicit and non-actionable.

import { EXCHANGE_VERDICTS, createAiExchange } from "./aiExchange.mjs";
import { idempotencyKey } from "./collaborationContract.mjs";
import { resolveDispatchModel } from "./modelPolicy.mjs";
import { isAuthoritativeSource, suggestedStaleDisposition, SOURCE_FRESHNESS } from "./reviewProvenance.mjs";
import { selectNextWork } from "./selectNextWork.mjs";

// ── Taxonomies ───────────────────────────────────────────────────────────────

// WHERE a review request originates. EVENT-FIRST: the first four are event/automatic; MANUAL is the
// Owner-relay backstop. SCHEDULED exists only as the periodic RECONCILIATION backstop — never the
// primary heartbeat.
export const REVIEW_TRIGGER_SOURCES = Object.freeze([
  "GITHUB_EVENT",          // a connected repository change (PR/push/label)
  "CONTROL_PLANE_EVENT",   // an EOS internal event (assignment completed, checkpoint, drift)
  "TASK_TRIGGER",          // a supported external task/automation trigger
  "SCHEDULED",             // periodic reconciliation BACKSTOP only (recovery), not the heartbeat
  "MANUAL",                // Owner relay / explicit runtime request
]);

// Provider-neutral reviewer surface. No provider is invoked here.
export const REVIEW_PROVIDERS = Object.freeze(["OPENAI", "ANTHROPIC", "MANUAL_RELAY"]);

// Reviewer verdicts — REUSED from aiExchange (CONCUR / CONCUR_WITH_CORRECTION / NONCONCUR_ESCALATE /
// EVIDENCE_REQUIRED / NEEDS_OWNER / AUTO_RESOLVED). No new verdict enum.
export const REVIEW_VERDICTS = EXCHANGE_VERDICTS;

// FAIL-CLOSED taxonomy. NONE of these is ever approval or authorization.
export const REVIEW_FAILURE_KINDS = Object.freeze([
  "RESULT_MISSING",        // triggered, but no result arrived
  "RESULT_STALE",          // result produced against a non-CURRENT source
  "RESULT_UNVERIFIABLE",   // provenance/context ref cannot be established
  "PROVIDER_FAILED",       // the reviewer provider errored
  "TRIGGER_FAILED",        // the trigger attempt itself failed
  "CONTEXT_INSUFFICIENT",  // C-7 package was not SUFFICIENT — retrieve-don't-guess
  "MALFORMED_RESULT",      // result did not satisfy the result shape
  "DUPLICATE_RESULT",      // a result for an already-handled exchange (dedupe)
]);

// Terminal dispositions for the runtime exchange (aligned with aiExchange EXCHANGE_DISPOSITIONS +
// the fail-closed HOLD/BLOCKED). Held ≠ resolved.
export const REVIEW_DISPOSITIONS = Object.freeze(["OPEN", "CONSUMED", "HELD", "REJECTED", "SUPERSEDED", "NEEDS_OWNER"]);

const AUTOMATIC_SOURCES = new Set(["GITHUB_EVENT", "CONTROL_PLANE_EVENT", "TASK_TRIGGER", "SCHEDULED"]);

/** Map a trigger SOURCE to the existing wake TRIGGER_KIND (who is asking). */
export function triggerKindForSource(source) {
  if (source === "MANUAL") return "MANUAL_RUNTIME_TRIGGER";
  if (AUTOMATIC_SOURCES.has(source)) return "AUTOMATIC_TRIGGER";
  return "AUTOMATIC_TRIGGER";
}

// ── Injected runtime store (transport-neutral) ───────────────────────────────
// The runtime control-plane store. The contract NEVER assumes git. A minimal in-memory reference
// implementation is provided for tests; a durable runtime store is a FUTURE activation seam.
export function makeInMemoryReviewStore() {
  const byExchange = new Map();
  const handledKeys = new Set(); // dedupe by idempotency key
  return {
    has: (key) => handledKeys.has(key),
    markHandled: (key) => { handledKeys.add(key); },
    put: (rec) => { byExchange.set(rec.exchangeId, rec); return rec; },
    get: (exchangeId) => byExchange.get(exchangeId) || null,
    all: () => [...byExchange.values()],
  };
}

// ── Request + trigger eligibility ────────────────────────────────────────────

/**
 * Build a provider-neutral AI_REVIEW request record (runtime, not a git artifact). `subject` drives
 * the deterministic idempotency key so a redelivered event does not create a second review.
 */
export function buildReviewRequest({ requestId, subject, reviewerRole = "architecture-review", provider = "OPENAI", source = "CONTROL_PLANE_EVENT", target = "CHATGPT", requestedAt = null, modelTier = "standard" } = {}) {
  const req = { requestType: "AI_REVIEW", requestId, subject, reviewerRole, provider, source, target, requestedAt };
  const selection = resolveDispatchModel({ modelTier, delegated: true }); // reviewer = delegated worker → SONNET-class
  return Object.freeze({ ...req, idempotencyKey: idempotencyKey({ requestType: "AI_REVIEW", source, target, subject }), selectedModel: selection.selectedModel, modelTier: selection.modelTier });
}

/**
 * TRIGGER ELIGIBILITY — the same gate regardless of source (event/scheduled/manual). Fail-closed:
 *   • duplicate (already handled) → not eligible (DUPLICATE_RESULT), no second review
 *   • C-7 package not SUFFICIENT → not eligible (CONTEXT_INSUFFICIENT)
 *   • source not CURRENT → not eligible (RESULT_STALE — hold, do not review stale)
 * @returns {{ eligible, reason, triggerKind, failureKind? }}
 */
export function assessTriggerEligibility({ request, store = makeInMemoryReviewStore(), contextSufficiency = "SUFFICIENT", sourceFreshness = "UNKNOWN" } = {}) {
  const triggerKind = triggerKindForSource(request && request.source);
  if (!request || !request.requestId) return { eligible: false, reason: "no request", triggerKind, failureKind: "TRIGGER_FAILED" };
  if (store.has(request.idempotencyKey)) return { eligible: false, reason: "already handled (dedupe)", triggerKind, failureKind: "DUPLICATE_RESULT" };
  if (contextSufficiency !== "SUFFICIENT") return { eligible: false, reason: "C-7 package not SUFFICIENT", triggerKind, failureKind: "CONTEXT_INSUFFICIENT" };
  if (!SOURCE_FRESHNESS.includes(sourceFreshness) || !isAuthoritativeSource(sourceFreshness)) {
    return { eligible: false, reason: `source ${sourceFreshness} is not CURRENT`, triggerKind, failureKind: "RESULT_STALE" };
  }
  return { eligible: true, reason: "eligible", triggerKind };
}

/**
 * TRIGGER the review EXACTLY ONCE. Returns a runtime exchange record in the TRIGGERED wake state, or
 * a fail-closed HELD record. Marks the idempotency key handled so a duplicate event is a no-op.
 * Does NOT invoke any provider — it records intent + provenance for the reviewer worker to fulfil.
 */
export function triggerReview({ request, store = makeInMemoryReviewStore(), contextSufficiency = "SUFFICIENT", sourceFreshness = "UNKNOWN", contextPackageRef = null, triggeredAt = null } = {}) {
  const gate = assessTriggerEligibility({ request, store, contextSufficiency, sourceFreshness });
  const base = {
    exchangeId: `rev:${request && request.requestId}`,
    requestId: request && request.requestId,
    reviewerRole: request && request.reviewerRole,
    provider: request && request.provider,
    selectedModel: request && request.selectedModel,
    triggerKind: gate.triggerKind,
    triggerSource: request && request.source,
    contextPackageRef,
    sourceFreshness,
    requestedAt: request && request.requestedAt,
    triggeredAt: null,
    completedAt: null,
    consumedAt: null,
  };
  if (!gate.eligible) {
    // Held — never triggered, never approved. Duplicate is a benign no-op (not a new failure record).
    const held = Object.freeze({ ...base, wakeState: gate.failureKind === "DUPLICATE_RESULT" ? "CONSUMED" : "AUTHORIZED", triggerMechanism: "NO_WAKE_MECHANISM", disposition: gate.failureKind === "DUPLICATE_RESULT" ? "SUPERSEDED" : "HELD", failureKind: gate.failureKind, reason: gate.reason });
    return { triggered: false, record: held, failureKind: gate.failureKind };
  }
  store.markHandled(request.idempotencyKey);
  const rec = Object.freeze({ ...base, triggeredAt, wakeState: "TRIGGERED", triggerMechanism: gate.triggerKind === "MANUAL_RUNTIME_TRIGGER" ? "MANUAL_RUNTIME_TRIGGER" : "AUTOMATIC_TRIGGER", disposition: "OPEN", failureKind: null });
  store.put(rec);
  return { triggered: true, record: rec };
}

// ── Structured result ────────────────────────────────────────────────────────

const RESULT_REQUIRED = ["exchangeId", "requestId", "reviewerRole", "provider", "verdict"];

/**
 * Normalize a reviewer's raw output into the compact structured result shape. Malformed input (missing
 * required field or unknown verdict) yields `{ ok:false, failureKind:"MALFORMED_RESULT" }` — never a
 * default-approve. Field names reuse aiExchange/reviewProvenance wherever they already exist.
 */
export function structureReviewResult(raw = {}) {
  for (const k of RESULT_REQUIRED) if (raw[k] == null || raw[k] === "") return { ok: false, failureKind: "MALFORMED_RESULT", detail: `missing ${k}` };
  if (!REVIEW_VERDICTS.includes(raw.verdict)) return { ok: false, failureKind: "MALFORMED_RESULT", detail: `unknown verdict ${raw.verdict}` };
  const result = Object.freeze({
    exchangeId: raw.exchangeId,
    requestId: raw.requestId,
    reviewerRole: raw.reviewerRole,
    provider: raw.provider,
    selectedModel: raw.selectedModel ?? null,
    triggerKind: raw.triggerKind ?? null,
    verdict: raw.verdict,
    conclusion: raw.conclusion ?? null,
    corrections: Array.isArray(raw.corrections) ? [...raw.corrections] : [],
    evidenceRequired: raw.verdict === "EVIDENCE_REQUIRED" || raw.evidenceRequired === true,
    ownerDecisionRequired: raw.verdict === "NEEDS_OWNER" || raw.ownerDecisionRequired === true,
    evidenceRefs: Array.isArray(raw.evidenceRefs) ? [...raw.evidenceRefs] : [],
    contextPackageRef: raw.contextPackageRef ?? null,
    provenance: raw.provenance ?? null,
    sourceFreshness: raw.sourceFreshness ?? "UNKNOWN",
    requestedAt: raw.requestedAt ?? null,
    triggeredAt: raw.triggeredAt ?? null,
    completedAt: raw.completedAt ?? null,
    consumedAt: null,
    disposition: "OPEN",
    routedBackTo: raw.routedBackTo ?? null, // the responsible workstream (for consumption → eligibility)
  });
  return { ok: true, result };
}

/** Map a structured result into an aiExchange record (REUSE — not a second ledger). */
export function toAiExchange(result) {
  return createAiExchange({
    exchangeId: result.exchangeId,
    direction: "CHATGPT_TO_CLAUDE",
    question: result.reviewerRole,
    verdict: result.verdict,
    conclusion: result.conclusion,
    evidenceRefs: result.evidenceRefs,
    ownerRequirement: result.ownerDecisionRequired ? "OWNER_DECISION" : null,
    disposition: result.disposition === "CONSUMED" ? "RESOLVED" : "OPEN",
    provenance: result.provenance,
  });
}

// ── Consumption (fail-closed) ────────────────────────────────────────────────

/**
 * CONSUME a review result — the ONLY path from reviewer output to Claude eligibility. Fail-closed:
 * every failure kind and every non-CURRENT source yields `consumable:false` with no continuation and
 * no approval. A reviewer NEVER authorizes a protected action: CONCUR on protected work still routes
 * to the Owner, because a verdict is not execution authorization.
 *
 * @param {object} p
 * @param {object|null} p.result            structured result (null ⇒ RESULT_MISSING)
 * @param {string} [p.failureKind]          a pre-known failure (PROVIDER_FAILED/TRIGGER_FAILED/…)
 * @param {boolean} [p.targetsProtectedAction]  the reviewed work is a protected action
 * @param {number|null} [p.consumedAt]
 * @returns {{ consumable, disposition, failureKind?, workItem?, ownerSurface?, blockedReason?, exchange? }}
 */
export function consumeReviewResult({ result = null, failureKind = null, targetsProtectedAction = false, consumedAt = null } = {}) {
  const closed = (kind, reason) => ({ consumable: false, disposition: kind === "DUPLICATE_RESULT" ? "SUPERSEDED" : "HELD", failureKind: kind, blockedReason: reason });

  if (failureKind) return closed(failureKind, `provider/trigger failure: ${failureKind}`);
  if (!result) return closed("RESULT_MISSING", "no result arrived — silence is not approval");
  if (!REVIEW_VERDICTS.includes(result.verdict)) return closed("MALFORMED_RESULT", `unknown verdict ${result.verdict}`);
  if (!isAuthoritativeSource(result.sourceFreshness)) {
    return { ...closed("RESULT_STALE", `source ${result.sourceFreshness} not CURRENT`), suggestedDisposition: suggestedStaleDisposition(result.sourceFreshness) };
  }

  // A verdict is never execution authorization; a reviewer cannot authorize a protected action.
  if (targetsProtectedAction) {
    return {
      consumable: false, disposition: "NEEDS_OWNER", failureKind: null,
      ownerSurface: { requestId: result.requestId, reason: "protected action — reviewer verdict is not authorization; Owner must authorize", verdict: result.verdict },
      blockedReason: "protected action cannot be authorized by a reviewer",
    };
  }

  const consumed = { ...result, disposition: "CONSUMED", consumedAt };
  switch (result.verdict) {
    case "NEEDS_OWNER":
      return { consumable: true, disposition: "NEEDS_OWNER", ownerSurface: { requestId: result.requestId, reason: result.conclusion || "reviewer escalated to Owner", verdict: result.verdict }, exchange: toAiExchange(consumed) };
    case "EVIDENCE_REQUIRED":
      // A work/gate item — retrieve-don't-guess. Not approval; makes evidence work eligible.
      return { consumable: true, disposition: "CONSUMED", workItem: reviewResultToWorkItem(consumed, "EVIDENCE"), exchange: toAiExchange(consumed) };
    case "NONCONCUR_ESCALATE":
      return { consumable: true, disposition: "NEEDS_OWNER", ownerSurface: { requestId: result.requestId, reason: result.conclusion || "reviewer non-concurred", verdict: result.verdict }, exchange: toAiExchange(consumed) };
    case "CONCUR":
    case "CONCUR_WITH_CORRECTION":
    case "AUTO_RESOLVED":
      // Consumable: the responsible worker becomes eligible. A CONCUR_WITH_CORRECTION carries its
      // corrections THROUGH consumption (they must survive, not be dropped).
      return { consumable: true, disposition: "CONSUMED", workItem: reviewResultToWorkItem(consumed, "INTERPRET"), exchange: toAiExchange(consumed) };
    default:
      return closed("MALFORMED_RESULT", `unhandled verdict ${result.verdict}`);
  }
}

/**
 * A consumed result → a READY interpretation work item for the responsible workstream, shaped exactly
 * like resultConsumption.interpretationWorkItems so it feeds the SAME selector. Corrections ride along.
 */
export function reviewResultToWorkItem(result, kind = "INTERPRET") {
  return {
    id: `interpret:${result.exchangeId}`,
    state: "READY",
    workstream: result.routedBackTo || null,
    resultId: result.exchangeId,
    requestId: result.requestId,
    verdict: result.verdict,
    corrections: result.corrections || [],
    label: `${kind === "EVIDENCE" ? "Gather evidence for" : "Interpret"} review ${result.exchangeId} (${result.verdict}${(result.corrections || []).length ? `, ${result.corrections.length} correction(s)` : ""})`,
  };
}

/**
 * Fold consumed review work items into the backlog and run the ordinary selector — a consumed result
 * cannot yield a false terminal CHECKPOINT, and it makes the responsible Claude worker eligible.
 * REUSES selectNextWork — no second selector.
 */
export function selectNextWorkWithReviews(backlogItems = [], consumedWorkItems = []) {
  return selectNextWork([...(backlogItems || []), ...(consumedWorkItems || [])]);
}

// ── Repository-vs-runtime authority boundary ─────────────────────────────────

/**
 * PROMOTION candidate — the ONLY subset of a runtime exchange that may become durable REPOSITORY
 * authority when governance requires it: an ACCEPTED, CURRENT-source, non-failed finding/decision/
 * evidence. This function computes the candidate; it does NOT write. Runtime exchange stays in the
 * injected store; institutional knowledge stays repository-sourced.
 * @returns {{ promotable: boolean, reason: string, durableCandidate?: object }}
 */
export function promoteToDurable(result) {
  if (!result) return { promotable: false, reason: "no result" };
  if (!isAuthoritativeSource(result.sourceFreshness)) return { promotable: false, reason: "source not CURRENT — never promote stale to authority" };
  if (result.disposition !== "CONSUMED") return { promotable: false, reason: "only a CONSUMED result may be promoted" };
  const ACCEPTED = new Set(["CONCUR", "CONCUR_WITH_CORRECTION", "AUTO_RESOLVED"]);
  if (!ACCEPTED.has(result.verdict)) return { promotable: false, reason: `verdict ${result.verdict} is not an accepted finding` };
  return {
    promotable: true,
    reason: "accepted + CURRENT + consumed — eligible for durable promotion when governance requires",
    durableCandidate: { kind: result.corrections && result.corrections.length ? "decision" : "finding", authority: result.reviewerRole, conclusion: result.conclusion, corrections: result.corrections || [], evidenceRefs: result.evidenceRefs || [], provenance: result.provenance },
  };
}

// ── Control Center projection ────────────────────────────────────────────────

/** Compact board for the Control Center: counts by trigger source, verdict, disposition, and the
 *  fail-closed backlog — plus the honest "authorized but WAITING_FOR_TRIGGER" surface. */
export function projectReviewTriggerBoard(records = []) {
  const bySource = {}; for (const s of REVIEW_TRIGGER_SOURCES) bySource[s] = 0;
  const byVerdict = {}; for (const v of REVIEW_VERDICTS) byVerdict[v] = 0;
  const byFailure = {}; for (const f of REVIEW_FAILURE_KINDS) byFailure[f] = 0;
  let open = 0, consumed = 0, held = 0, ownerSurfaced = 0;
  for (const r of records || []) {
    if (r.triggerSource && bySource[r.triggerSource] != null) bySource[r.triggerSource]++;
    if (r.verdict && byVerdict[r.verdict] != null) byVerdict[r.verdict]++;
    if (r.failureKind && byFailure[r.failureKind] != null) byFailure[r.failureKind]++;
    if (r.disposition === "OPEN") open++;
    else if (r.disposition === "CONSUMED") consumed++;
    else if (r.disposition === "HELD") held++;
    if (r.disposition === "NEEDS_OWNER") ownerSurfaced++;
  }
  return { total: (records || []).length, bySource, byVerdict, byFailure, open, consumed, held, ownerSurfaced, note: "AI reviewer is a worker EOS invokes; verdict ≠ authorization; silence ≠ approval." };
}
