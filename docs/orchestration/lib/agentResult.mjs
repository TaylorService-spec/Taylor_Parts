// Shared Agent Manager — durable Agent Result contract.
//
// A bounded worker's result, routed back DURABLY to the requesting workstream —
// not relayed by the Owner. Results live as JSON in docs/orchestration/agent-requests/.
//
// AGENT OUTPUT != PRODUCT AUTHORITY. A result carries findings/evidence; the
// requesting Design/UX workstream remains responsible for interpretation. Nothing
// here sets product status, roadmap state, or an Owner decision.
//
// Pure: schema + constructor + validation. Timestamps are supplied (no clock) so
// records are deterministic and diff-stable.

export const RESULT_STATUS = Object.freeze(["COMPLETE", "FAILED"]);
export const VERDICTS = Object.freeze(["PASS", "FAIL", "NOT_APPLICABLE"]); // REVIEW/VERIFICATION only

// Consumption/disposition lifecycle (§23). A COMPLETE result routed to a workstream
// is not finished work — the workstream must still INTERPRET it. Until then it is
// AWAITING_INTERPRETATION and is actionable continuation work (surfaced to the SAME
// selector, never a second queue). A workstream then durably disposes of it:
//   CONSUMED     — interpreted; produced the resulting work/routing/closure
//   REJECTED     — interpreted and deliberately not acted on
//   STALE        — superseded by newer repo/evidence state before interpretation
//   CONTAMINATED — evidence is untrustworthy (see also the `contaminated` flag)
// A completed agent run != completed parent work.
export const RESULT_DISPOSITIONS = Object.freeze([
  "AWAITING_INTERPRETATION", "CONSUMED", "REJECTED", "STALE", "CONTAMINATED",
]);
// Terminal dispositions clear a result from the actionable set.
const TERMINAL_DISPOSITIONS = Object.freeze(new Set(["CONSUMED", "REJECTED", "STALE", "CONTAMINATED"]));

const DEFAULTS = Object.freeze({
  status: "COMPLETE", verdict: "NOT_APPLICABLE", disposition: "AWAITING_INTERPRETATION",
  findings: [], evidence: [],
  questionsRaised: [], scenariosDiscovered: [], retries: 0, contextExpanded: false,
  contaminated: false, retracted: false, metrics: {},
});

export function createAgentResult(input = {}) {
  const r = { ...DEFAULTS, ...input };
  r.findings = [...(r.findings || [])];
  r.evidence = [...(r.evidence || [])];
  r.questionsRaised = [...(r.questionsRaised || [])];
  r.scenariosDiscovered = [...(r.scenariosDiscovered || [])];
  r.metrics = { ...(r.metrics || {}) };
  return Object.freeze(r);
}

export function validateAgentResult(r) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(!!r.resultId, "resultId is required");
  need(!!r.requestId, "requestId is required (result must reference its request)");
  need(!!r.routedBackTo, "routedBackTo is required (the requesting workstream)");
  need(RESULT_STATUS.includes(r.status), "status must be COMPLETE or FAILED");
  need(VERDICTS.includes(r.verdict), `verdict must be one of ${VERDICTS.join("/")}`);
  need(Array.isArray(r.findings), "findings must be an array");
  need(Array.isArray(r.evidence), "evidence must be an array");
  need(Array.isArray(r.questionsRaised), "questionsRaised must be an array");
  need(Array.isArray(r.scenariosDiscovered), "scenariosDiscovered must be an array");
  need(Number.isInteger(r.retries) && r.retries >= 0, "retries must be a non-negative integer");
  need(typeof r.contaminated === "boolean", "contaminated must be boolean");
  need(typeof r.retracted === "boolean", "retracted must be boolean");
  // disposition is optional for backward compatibility: results predating the lifecycle
  // (no field) are historical and treated as already CONSUMED — never resurrected (§23).
  if (r.disposition != null) need(RESULT_DISPOSITIONS.includes(r.disposition), `disposition, when present, must be one of ${RESULT_DISPOSITIONS.join("/")}`);
  // Metrics are recorded WHERE AVAILABLE; runtime may not expose exact tokens — never fabricated.
  if (r.metrics && r.metrics.tokens != null) need(typeof r.metrics.tokens === "number", "metrics.tokens, when present, must be a number");
  return errors;
}

// A result is reusable for dedupe only if it actually concluded and is not
// contaminated or retracted (agentManager.findEquivalentResult).
export function isReusableResult(r) {
  return r && r.status === "COMPLETE" && r.contaminated !== true && r.retracted !== true;
}

// A result is awaiting interpretation (§23) — actionable continuation work — only if it
// concluded cleanly AND carries the EXPLICIT AWAITING_INTERPRETATION disposition. A missing
// disposition (historical result) is NOT awaiting: those were already acted on, and the
// selector must not resurrect them into a false-positive work item.
export function isAwaitingInterpretation(r) {
  return !!r
    && r.status === "COMPLETE"
    && r.contaminated !== true
    && r.retracted !== true
    && r.disposition === "AWAITING_INTERPRETATION";
}

export function isTerminalDisposition(disposition) {
  return TERMINAL_DISPOSITIONS.has(disposition);
}

// Pure disposition transition: a workstream durably records what it did with a result.
// Returns a new frozen result; throws on an unknown disposition.
export function disposeResult(r, disposition) {
  if (!RESULT_DISPOSITIONS.includes(disposition)) {
    throw new Error(`disposeResult: unknown disposition ${JSON.stringify(disposition)}`);
  }
  return Object.freeze({ ...r, disposition });
}
