// EOS SIGNAL SUPERVISOR — pure (no I/O), TOKEN-FREE. Generalizes the Wake Supervisor's "inspect
// durable/event state frequently WITHOUT invoking AI" into one provider-neutral signal intake.
//
// EOS owns events and timing. A signal is FIRST classified deterministically; an AI worker is invoked
// ONLY when reasoning is genuinely required (REVIEW_REQUIRED). Duplicates, already-resolved events,
// unchanged state, known-expected activity, and mechanical validation NEVER cost an AI call.
//
// This phase establishes the routing CONTRACT only — no external social/business collectors are built.
// The same Signal → Router → Worker path is reused later for market/social/operational discovery, with
// a hard boundary: discovery ≠ permission to act.

import { LATENCY_CLASSES } from "./reviewRouter.mjs";

// Provider-neutral signal SOURCES. The last three are recorded seams for a future phase.
export const SIGNAL_SOURCES = Object.freeze([
  "GITHUB_EVENT", "CONTROL_PLANE_EVENT", "TIMER", "MANUAL",
  "BUSINESS_SIGNAL", "SOCIAL_SIGNAL", "OPERATIONAL_SIGNAL",
]);

// Deterministic classification — closest fit to existing EOS vocabulary. Only REVIEW_REQUIRED (and an
// URGENT that needs reasoning) may lead to an AI call; the rest are token-free.
export const SIGNAL_CLASSIFICATIONS = Object.freeze(["IGNORE", "RECORD", "QUEUE", "REVIEW_REQUIRED", "OWNER_ATTENTION", "URGENT"]);

// Discovery seam sources that must NEVER auto-act (future phase). Classified, recorded, never contacted.
const DISCOVERY_SOURCES = new Set(["BUSINESS_SIGNAL", "SOCIAL_SIGNAL"]);

// Hard boundary for the future business/social phase — recorded now so the seam is unambiguous.
export const DISCOVERY_BOUNDARIES = Object.freeze({
  "signal discovery": "≠ permission to contact",
  "lead score": "≠ authorization to market",
  "content draft": "≠ authorization to publish",
  "opportunity": "≠ authority to spend",
});
const OWNER_AUTHORIZED_ACTIONS = Object.freeze(["CONTACT", "MARKET", "PUBLISH", "SPEND"]);
/** Any outward/spending action from a discovered signal requires explicit Owner authorization. */
export function requiresOwnerAuthorization(actionKind) {
  return OWNER_AUTHORIZED_ACTIONS.includes(String(actionKind || "").toUpperCase());
}

/**
 * Classify a signal deterministically (token-free). No AI is consulted here.
 *
 * @param {object} signal  { source, key?, resolved?, stateHash?, priorStateHash?, expected?,
 *                           mechanicalOnly?, needsReview?, reviewClassHint?, ownerAttention?,
 *                           urgent?, latencyExpectation? }
 * @param {object} ctx     { seenKeys?: Set|Array, now? }
 * @returns {{ classification, aiNeeded, reason, source, latencyExpectation, evidence: string[],
 *             discoveryBoundary?: object }}
 */
export function classifySignal(signal = {}, ctx = {}) {
  const evidence = [];
  const source = signal.source || "CONTROL_PLANE_EVENT";
  const latencyExpectation = LATENCY_CLASSES.includes(signal.latencyExpectation) ? signal.latencyExpectation : defaultLatencyFor(source, signal);
  const seen = ctx.seenKeys instanceof Set ? ctx.seenKeys : new Set(ctx.seenKeys || []);
  const out = (classification, aiNeeded, reason, extra = {}) => ({ classification, aiNeeded, reason, source, latencyExpectation, evidence, ...extra });

  if (!SIGNAL_SOURCES.includes(source)) return out("RECORD", false, `unknown source ${source} — recorded, no AI`);

  // Deterministic no-AI short-circuits (cheapest first).
  if (signal.key && seen.has(signal.key)) { evidence.push("duplicate signal key"); return out("IGNORE", false, "duplicate — already handled"); }
  if (signal.resolved === true) { evidence.push("already-resolved event"); return out("IGNORE", false, "already resolved"); }
  if (signal.stateHash != null && signal.priorStateHash != null && signal.stateHash === signal.priorStateHash) {
    evidence.push("state unchanged"); return out("IGNORE", false, "unchanged state — nothing to do");
  }
  if (signal.expected === true) { evidence.push("known-expected activity"); return out("RECORD", false, "expected activity — record, no AI"); }
  if (signal.mechanicalOnly === true) { evidence.push("mechanical/validation-only"); return out("QUEUE", false, "mechanical — deterministic handling, no AI"); }

  // Business/social discovery: classify + RECORD only. NEVER auto-outreach in this phase.
  if (DISCOVERY_SOURCES.has(source)) {
    evidence.push("discovery signal — classified + recorded; outreach/spend requires Owner authorization");
    return out("RECORD", false, "discovery recorded; no unauthorized outreach", { discoveryBoundary: DISCOVERY_BOUNDARIES });
  }

  // Escalations.
  if (signal.urgent === true) { evidence.push("urgent flag"); return out("URGENT", signal.needsReview === true, "urgent — surface immediately"); }
  if (signal.ownerAttention === true) { evidence.push("owner-attention flag"); return out("OWNER_ATTENTION", false, "owner attention — never routed around the Owner"); }

  // Genuine reasoning need → REVIEW_REQUIRED (the only routine path to an AI worker).
  if (signal.needsReview === true) { evidence.push(`review needed (${signal.reviewClassHint || "unspecified class"})`); return out("REVIEW_REQUIRED", true, "reasoning required — route to a review worker", { reviewClassHint: signal.reviewClassHint || null }); }

  evidence.push("no reasoning trigger");
  return out("RECORD", false, "recorded; no AI needed");
}

function defaultLatencyFor(source, signal) {
  if (signal.urgent === true) return "IMMEDIATE";
  if (source === "GITHUB_EVENT" || source === "CONTROL_PLANE_EVENT") return "MINUTES";
  if (source === "TIMER") return "HOURLY";
  if (source === "BUSINESS_SIGNAL" || source === "SOCIAL_SIGNAL") return "DAILY";
  return "MINUTES";
}

/** Control Center: compact signal-supply board — how many signals became AI work vs stayed token-free. */
export function projectSignalBoard(classifications = []) {
  const byClass = {}; for (const c of SIGNAL_CLASSIFICATIONS) byClass[c] = 0;
  let aiNeeded = 0, tokenFree = 0;
  for (const r of classifications || []) {
    if (r.classification && byClass[r.classification] != null) byClass[r.classification]++;
    if (r.aiNeeded) aiNeeded++; else tokenFree++;
  }
  return { total: (classifications || []).length, byClass, aiNeeded, tokenFree, note: "Signals are classified token-free; AI is invoked only for REVIEW_REQUIRED. EOS owns timing, not the AI." };
}
