import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCollaborationRequest, validateCollaborationRequest, advance, disposeCollaboration,
  responsibilityOwner, isOverdue, escalateOnSilence, isDuplicateDelivery, idempotencyKey,
  REQUEST_TYPES,
} from "./collaborationContract.mjs";

const base = (over = {}) => createCollaborationRequest({
  requestId: "C-1", projectId: "taylor-parts", source: "CLAUDE", target: "CHATGPT",
  requestType: "AI_REVIEW", authorityClass: "RECOMMEND", subject: "review the Rule scope", ...over,
});

test("one envelope carries all three request types; validation passes for each", () => {
  for (const t of REQUEST_TYPES) {
    const r = base({ requestType: t, target: t === "OWNER_DECISION" ? "OWNER" : "CHATGPT" });
    assert.deepEqual(validateCollaborationRequest(r), []);
  }
});

test("idempotencyKey is deterministic and set on create", () => {
  const a = base();
  const b = base();
  assert.equal(a.idempotencyKey, b.idempotencyKey);
  assert.equal(a.idempotencyKey, idempotencyKey({ requestType: "AI_REVIEW", source: "CLAUDE", target: "CHATGPT", subject: "review the Rule scope" }));
});

test("lifecycle only advances one legal hop forward — no silent jumps", () => {
  let r = base();
  assert.equal(r.status, "REQUESTED");
  r = advance(r, "DELIVERED");
  r = advance(r, "ACKNOWLEDGED");
  r = advance(r, "RESPONDED", { reviewVerdict: "CONCUR_WITH_CORRECTION" });
  r = advance(r, "CONSUMED");
  r = advance(r, "CLOSED");
  assert.equal(r.status, "CLOSED");
  assert.equal(r.reviewVerdict, "CONCUR_WITH_CORRECTION");
  assert.throws(() => advance(base(), "RESPONDED"), /illegal transition/); // REQUESTED can't jump to RESPONDED
});

test("§11: every state names exactly one current responsibility owner + a silence rule", () => {
  const states = ["REQUESTED", "DELIVERED", "ACKNOWLEDGED", "IN_PROGRESS", "RESPONDED", "CONSUMED", "CLOSED"];
  let r = base();
  for (const st of states) {
    r = Object.freeze({ ...r, status: st });
    const ro = responsibilityOwner(r);
    if (st === "CLOSED") { assert.equal(ro.owner, null); continue; }
    assert.ok(ro.owner, `${st} must name an owner`);
    if (st !== "REQUESTED") assert.ok(ro.onSilence, `${st} must define what happens on silence`);
  }
  // The responder owns the reply; once RESPONDED, responsibility flips to the requester to consume.
  assert.equal(responsibilityOwner(Object.freeze({ ...base(), status: "DELIVERED" })).owner, "CHATGPT");
  assert.equal(responsibilityOwner(Object.freeze({ ...base(), status: "RESPONDED" })).owner, "CLAUDE");
  // OWNER_DECISION requests are owned by the OWNER while awaiting.
  assert.equal(responsibilityOwner(Object.freeze({ ...base({ requestType: "OWNER_DECISION" }), status: "DELIVERED" })).owner, "OWNER");
});

test("escalation surfaces overdue requests as NEEDS_OWNER — silence never becomes approval", () => {
  const overdue = base({ escalateAfter: 1000, status: "ACKNOWLEDGED" });
  assert.equal(isOverdue(overdue, 2000), true);
  const escalated = escalateOnSilence(overdue, 2000);
  assert.equal(escalated.disposition, "NEEDS_OWNER");
  // A responded request is NOT overdue — the wait is now on the requester to consume, not approval.
  assert.equal(isOverdue(base({ escalateAfter: 1000, status: "RESPONDED" }), 999999), false);
  // Not yet due → unchanged.
  assert.equal(escalateOnSilence(base({ escalateAfter: 5000, status: "DELIVERED" }), 1000).disposition, null);
});

test("duplicate / replayed delivery is recognised, not double-acted", () => {
  const seen = new Set([base().idempotencyKey]);
  assert.equal(isDuplicateDelivery(base(), seen), true);
  assert.equal(isDuplicateDelivery(base({ subject: "a different question" }), seen), false);
});

test("disposeCollaboration rejects an unknown disposition", () => {
  assert.throws(() => disposeCollaboration(base(), "WHATEVER"), /unknown disposition/);
});
