import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOwnerDecisionRequest, validateOwnerDecisionRequest, triage, requiresReconfirmAtExecution,
} from "./ownerDecision.mjs";

test("Owner Decision Request validates its required durable fields", () => {
  const d = createOwnerDecisionRequest({
    decisionId: "D-1", projectId: "taylor-parts", originatingWorkstream: "Design",
    question: "?", reason: "policy cannot determine",
  });
  assert.deepEqual(validateOwnerDecisionRequest(d), []);
  assert.ok(validateOwnerDecisionRequest({ decisionId: "D-2" }).length > 0);
});

test("triage precedence: protected boundary wins even when the direction is obvious", () => {
  const r = triage({ crossesProtectedBoundary: true, determinedByExistingAuthority: true });
  assert.equal(r.triageClass, "OWNER_AUTHORIZATION");
  assert.equal(r.reachesOwner, true);
  assert.equal(r.requiresReconfirmAtExecution, true);
});

test("triage: determined by standing authority + no new policy → AUTO_RESOLVED (does not reach Owner)", () => {
  const r = triage({ determinedByExistingAuthority: true, establishesNewPolicy: false });
  assert.equal(r.triageClass, "AUTO_RESOLVED");
  assert.equal(r.reachesOwner, false);
});

test("triage: establishes new business/product policy → RECOMMEND_OWNER", () => {
  const r = triage({ determinedByExistingAuthority: true, establishesNewPolicy: true, hasRecommendation: true });
  assert.equal(r.triageClass, "RECOMMEND_OWNER");
  assert.equal(r.reachesOwner, true);
  assert.equal(r.requiresReconfirmAtExecution, false);
});

test("triage: undetermined → NEEDS_OWNER", () => {
  assert.equal(triage({}).triageClass, "NEEDS_OWNER");
});

// ---- §11 triage regression cases (must never interrupt the Owner in future) ----

test("CASE 1 — Firestore-gated vs Function vs App Hosting → AUTO_RESOLVED", () => {
  // Standing architecture determines it (read-only v1 → Firestore-gated sanitized envelope);
  // no new Owner policy; not itself a protected execution.
  const r = triage({ determinedByExistingAuthority: true, establishesNewPolicy: false, crossesProtectedBoundary: false });
  assert.equal(r.triageClass, "AUTO_RESOLVED");
  assert.equal(r.reachesOwner, false);
});

test("CASE 2 — may repo-safe Hosting/Rules PREPARATION proceed while deploy stays operator-executed → AUTO_RESOLVED", () => {
  // prepare != deploy; determined by standing principle; preparation is repo-safe (not protected).
  const r = triage({ determinedByExistingAuthority: true, establishesNewPolicy: false, crossesProtectedBoundary: false });
  assert.equal(r.triageClass, "AUTO_RESOLVED");
});

test("CASE 3 — does the launcher need a dedicated auth-check endpoint → AUTO_RESOLVED (NO for v1)", () => {
  const r = triage({ determinedByExistingAuthority: true, establishesNewPolicy: false });
  assert.equal(r.triageClass, "AUTO_RESOLVED");
});

test("the actual DEPLOY of those Rules (not the prep question) → OWNER_AUTHORIZATION, re-confirm at execution", () => {
  const r = triage({ crossesProtectedBoundary: true, determinedByExistingAuthority: true });
  assert.equal(r.triageClass, "OWNER_AUTHORIZATION");
  assert.equal(requiresReconfirmAtExecution(r.triageClass), true);
});
