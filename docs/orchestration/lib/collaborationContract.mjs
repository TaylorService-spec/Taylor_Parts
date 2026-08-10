// Governed collaboration contract — one durable request envelope for all three request
// types (§13), with a single reciprocal lifecycle, idempotency, acknowledgement,
// escalation, and the §11 single-responsibility-owner invariant.
//
// SCOPE (Owner-ratified "contracts-only now", §4): this is the repo-safe substrate for the
// eventual Claude ↔ ChatGPT bridge — contracts, lifecycle, dispositions, dedupe, replay,
// escalation, authority classes, and the Claude-side consumption seam. It procures NO paid
// credential, deploys NO Function, creates NO service identity, and claims NO live
// integration. Transport is injected (see bridgeTransport.mjs / mock); nothing here calls
// out to any network.
//
// AUTHORITY: a request/response is EVIDENCE and workflow, never authority. A ChatGPT CONCUR
// or a recorded Owner decision authorizes the DECISION, not a protected action's execution
// gate (Owner policy: re-confirm at execution). Pure: schema + transitions + invariants;
// timestamps are supplied (no clock) so records are deterministic.

// The three request types share this envelope but keep distinct authority semantics (§13).
export const REQUEST_TYPES = Object.freeze(["WORK", "AI_REVIEW", "OWNER_DECISION"]);

// Who is allowed to close the request's question. ROUTINE work self-closes on consumption;
// DECISION/AUTHORIZATION close only via the Owner path (see ownerDecision.triage).
export const AUTHORITY_CLASSES = Object.freeze(["ROUTINE", "RECOMMEND", "DECISION", "AUTHORIZATION"]);

// Reciprocal lifecycle (§14). Every material request walks these; silence never advances it.
export const COLLAB_STATUS = Object.freeze([
  "REQUESTED", "DELIVERED", "ACKNOWLEDGED", "IN_PROGRESS", "RESPONDED", "CONSUMED", "CLOSED",
]);
const STATUS_INDEX = Object.freeze(Object.fromEntries(COLLAB_STATUS.map((s, i) => [s, i])));

// Off-happy-path dispositions. NEEDS_OWNER is the escalation backstop — silence ≠ approval.
export const COLLAB_DISPOSITIONS = Object.freeze(["BLOCKED", "REJECTED", "STALE", "CONTAMINATED", "NEEDS_OWNER"]);

// AI review responses (§15/§17). AUTO_RESOLVED only where delegated authority clearly applies.
export const REVIEW_VERDICTS = Object.freeze([
  "CONCUR", "CONCUR_WITH_CORRECTION", "NONCONCUR_ESCALATE", "NEEDS_OWNER", "AUTO_RESOLVED",
]);

// Delivery is separate from lifecycle: a message can be written but undelivered/unacked.
export const DELIVERY_STATUS = Object.freeze(["PENDING", "DELIVERED", "ACKNOWLEDGED", "FAILED"]);

const DEFAULTS = Object.freeze({
  requestType: "WORK", authorityClass: "ROUTINE", status: "REQUESTED",
  deliveryStatus: "PENDING", disposition: null, evidence: [], attempts: 0,
  respondBy: null, escalateAfter: null,
});

// Deterministic idempotency key — same (type, source, target, subject) → same key, so a
// redelivered or replayed request is recognised and not double-acted.
export function idempotencyKey(req = {}) {
  const subject = String(req.subject || req.question || req.action || "").trim().toLowerCase().replace(/\s+/g, " ");
  return [req.requestType || "WORK", req.source || "?", req.target || "?", subject].join("::");
}

export function createCollaborationRequest(input = {}) {
  const r = { ...DEFAULTS, ...input };
  r.evidence = [...(r.evidence || [])];
  if (!r.idempotencyKey) r.idempotencyKey = idempotencyKey(r);
  return Object.freeze(r);
}

export function validateCollaborationRequest(r) {
  const errors = [];
  const need = (c, m) => { if (!c) errors.push(m); };
  need(!!r.requestId, "requestId is required");
  need(!!r.projectId, "projectId is required");
  need(!!r.source, "source is required");
  need(!!r.target, "target is required");
  need(REQUEST_TYPES.includes(r.requestType), `requestType must be one of ${REQUEST_TYPES.join("/")}`);
  need(AUTHORITY_CLASSES.includes(r.authorityClass), `authorityClass must be one of ${AUTHORITY_CLASSES.join("/")}`);
  need(COLLAB_STATUS.includes(r.status), `status must be a known COLLAB_STATUS`);
  need(DELIVERY_STATUS.includes(r.deliveryStatus), `deliveryStatus must be a known DELIVERY_STATUS`);
  need(r.disposition == null || COLLAB_DISPOSITIONS.includes(r.disposition), `disposition, when present, must be a known COLLAB_DISPOSITION`);
  need(!!r.idempotencyKey, "idempotencyKey is required (dedupe/replay)");
  if (r.reviewVerdict != null) need(REVIEW_VERDICTS.includes(r.reviewVerdict), `reviewVerdict, when present, must be one of ${REVIEW_VERDICTS.join("/")}`);
  return errors;
}

// Legal forward transitions. A request only advances one hop at a time, and only forward —
// there is no silent jump from REQUESTED to RESPONDED.
const LEGAL_NEXT = Object.freeze({
  REQUESTED: ["DELIVERED"],
  DELIVERED: ["ACKNOWLEDGED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "RESPONDED"],
  IN_PROGRESS: ["RESPONDED"],
  RESPONDED: ["CONSUMED"],
  CONSUMED: ["CLOSED"],
  CLOSED: [],
});

export function advance(req, toStatus, patch = {}) {
  if (!(LEGAL_NEXT[req.status] || []).includes(toStatus)) {
    throw new Error(`advance: illegal transition ${req.status} -> ${toStatus}`);
  }
  return Object.freeze({ ...req, ...patch, status: toStatus });
}

export function disposeCollaboration(req, disposition, patch = {}) {
  if (!COLLAB_DISPOSITIONS.includes(disposition)) {
    throw new Error(`disposeCollaboration: unknown disposition ${JSON.stringify(disposition)}`);
  }
  return Object.freeze({ ...req, ...patch, disposition });
}

// §11 INVARIANT — every durable request has EXACTLY ONE current responsibility owner.
// This is workflow responsibility, not business authority. At every lifecycle state we can
// name who must act next, the event that discharges it, and what happens on silence. Neither
// side may assume "the other one has it."
//   * source  = the requester (e.g. Claude when Claude→ChatGPT)
//   * target  = the responder (e.g. ChatGPT), or "OWNER" for OWNER_DECISION requests
export function responsibilityOwner(req) {
  const target = req.requestType === "OWNER_DECISION" ? "OWNER" : req.target;
  switch (req.status) {
    case "REQUESTED":   return { owner: "TRANSPORT", awaitingEvent: "deliver", onSilence: "redeliver; then NEEDS_OWNER" };
    case "DELIVERED":   return { owner: target, awaitingEvent: "acknowledge", onSilence: "escalate → NEEDS_OWNER" };
    case "ACKNOWLEDGED":
    case "IN_PROGRESS": return { owner: target, awaitingEvent: "respond", onSilence: "escalate → NEEDS_OWNER" };
    case "RESPONDED":   return { owner: req.source, awaitingEvent: "consume", onSilence: "requester must consume; no auto-approve" };
    case "CONSUMED":    return { owner: req.source, awaitingEvent: "close", onSilence: "requester closes" };
    case "CLOSED":      return { owner: null, awaitingEvent: null, onSilence: null };
    default:            return { owner: "UNKNOWN", awaitingEvent: null, onSilence: "treat as NEEDS_OWNER" };
  }
}

// Escalation — silence NEVER becomes approval. A request that is past its escalateAfter and
// is still waiting on the responder (not yet RESPONDED/CONSUMED/CLOSED) must be surfaced to
// the Owner as NEEDS_OWNER. `nowMs`/`escalateAfter` are ISO strings or epoch ms (caller-supplied).
export function isOverdue(req, nowMs) {
  if (req.escalateAfter == null) return false;
  const due = typeof req.escalateAfter === "number" ? req.escalateAfter : Date.parse(req.escalateAfter);
  const now = typeof nowMs === "number" ? nowMs : Date.parse(nowMs);
  if (Number.isNaN(due) || Number.isNaN(now)) return false;
  const stillWaiting = STATUS_INDEX[req.status] < STATUS_INDEX.RESPONDED;
  return stillWaiting && now >= due;
}

export function escalateOnSilence(req, nowMs) {
  return isOverdue(req, nowMs) ? disposeCollaboration(req, "NEEDS_OWNER", { escalatedAt: nowMs }) : req;
}

// Replay/duplicate delivery guard: a request whose idempotencyKey was already seen (and is
// not itself) is a duplicate — reuse the prior, do not act twice.
export function isDuplicateDelivery(req, seenKeys = new Set()) {
  return seenKeys.has(req.idempotencyKey);
}
