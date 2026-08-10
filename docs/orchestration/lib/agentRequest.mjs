// Shared Agent Manager — durable Agent Request contract.
//
// A structured, durable request record so a workstream (Design / UX / …) can ask
// for a bounded worker WITHOUT the Owner copy/pasting prompts between sessions.
// Chat text is never the authoritative request — this record is. Requests live
// as JSON in docs/orchestration/agent-requests/ and are consumed by the Agent
// Manager (agentManager.mjs). This module is pure: schema + constructor +
// validation, no I/O and no clock (timestamps are supplied so records are
// deterministic and diff-stable).

export const AGENT_MODES = Object.freeze(["DISCOVERY", "VERIFICATION", "REVIEW", "PERSONA", "GENERAL"]);
export const MODEL_TIERS = Object.freeze(["economy", "standard", "advanced"]); // logical tiers; Taylor runtime = SONNET for every delegated agent
export const BUDGET_CLASSES = Object.freeze(["TINY", "SMALL", "MEDIUM", "LARGE"]);
export const EXECUTION = Object.freeze(["REMOTE", "LOCAL"]); // LOCAL never consumes a REMOTE_AI slot (§4)
export const REQUEST_STATUS = Object.freeze([
  "PENDING", "VALIDATED", "DEDUPED", "READY_BUT_WAITING_RESOURCE", "WAITING_NETWORK",
  "DISPATCHED", "RUNNING", "COMPLETE", "FAILED", "REJECTED", "RETRACTED",
]);

const DEFAULTS = Object.freeze({
  mode: "VERIFICATION", modelTier: "standard", execution: "REMOTE", budgetClass: "SMALL",
  priority: 5, blocking: false, requiresBrowser: false, mutating: false, retryAllowance: 1,
  status: "PENDING", allowedSurfaces: [], contextPacket: "", outputContract: "", evidence: [],
  scope: [], // C-7 context-map domain scope; the dispatcher builds the reproducible context package from it
});

// A stable fingerprint used to dedupe equivalent requests (agentManager.findEquivalentResult).
// Deliberately excludes requestId/priority/timestamps — two requests for the same bounded
// question over the same surfaces are equivalent regardless of who asked when.
export function requestFingerprint(req) {
  const surfaces = [...(req.allowedSurfaces || [])].sort().join("|");
  return [req.mode, (req.purpose || "").trim().toLowerCase(), surfaces, req.mutating ? "MUT" : "RO", req.requiresBrowser ? "BROWSER" : "NOBROWSER"].join("::");
}

export function createAgentRequest(input = {}) {
  const req = { ...DEFAULTS, ...input };
  req.allowedSurfaces = [...(req.allowedSurfaces || [])];
  req.evidence = [...(req.evidence || [])];
  req.scope = [...(req.scope || [])];
  req.fingerprint = requestFingerprint(req);
  return Object.freeze(req);
}

export function validateAgentRequest(req) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(!!req.requestId, "requestId is required");
  need(!!req.requestedByWorkstream, "requestedByWorkstream is required");
  need(!!req.purpose, "purpose is required");
  need(AGENT_MODES.includes(req.mode), `mode must be one of ${AGENT_MODES.join("/")}`);
  need(MODEL_TIERS.includes(req.modelTier), `modelTier must be one of ${MODEL_TIERS.join("/")}`);
  need(EXECUTION.includes(req.execution), `execution must be REMOTE or LOCAL`);
  need(BUDGET_CLASSES.includes(req.budgetClass), `budgetClass must be one of ${BUDGET_CLASSES.join("/")}`);
  need(REQUEST_STATUS.includes(req.status), `status must be a known REQUEST_STATUS`);
  need(typeof req.priority === "number", "priority must be a number");
  need(typeof req.blocking === "boolean", "blocking must be boolean");
  need(typeof req.requiresBrowser === "boolean", "requiresBrowser must be boolean");
  need(typeof req.mutating === "boolean", "mutating must be boolean");
  need(Number.isInteger(req.retryAllowance) && req.retryAllowance >= 0, "retryAllowance must be a non-negative integer");
  need(Array.isArray(req.allowedSurfaces), "allowedSurfaces must be an array (smallest sufficient set)");
  need(!!req.outputContract, "outputContract is required (what the requester will consume)");
  // A browser requirement implies REMOTE execution semantics for capacity purposes.
  if (req.requiresBrowser) need(req.execution === "REMOTE", "requiresBrowser implies execution: REMOTE");
  return errors;
}
