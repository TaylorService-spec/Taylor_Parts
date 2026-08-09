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

const DEFAULTS = Object.freeze({
  status: "COMPLETE", verdict: "NOT_APPLICABLE", findings: [], evidence: [],
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
  // Metrics are recorded WHERE AVAILABLE; runtime may not expose exact tokens — never fabricated.
  if (r.metrics && r.metrics.tokens != null) need(typeof r.metrics.tokens === "number", "metrics.tokens, when present, must be a number");
  return errors;
}

// A result is reusable for dedupe only if it actually concluded and is not
// contaminated or retracted (agentManager.findEquivalentResult).
export function isReusableResult(r) {
  return r && r.status === "COMPLETE" && r.contaminated !== true && r.retracted !== true;
}
