import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRoadmapModel as validateModel, CUSTOMER_OUTCOME_EVIDENCE_STATES } from "./roadmapModel.mjs";
import { projectCockpit } from "./roadmapProjection.mjs";
import { createOwnerDecisionRequest, validateOwnerDecisionRequest, triage, acceptTriage } from "./ownerDecision.mjs";

// ---- durable customerOutcome (model field) ----
const modelWith = (cap) => ({ id: "EOS", domains: [{ id: "d", name: "D", kind: "PROCESS", capabilities: [{
  id: "c", name: "C", workstreamOwner: "Product/Design", status: "READY",
  implementationState: "NOT_APPLICABLE", activationState: "NOT_APPLICABLE", backendState: "NOT_APPLICABLE",
  userOperable: "NOT_APPLICABLE", uxState: "NOT_APPLICABLE", deployState: "NOT_APPLICABLE",
  milestones: [], ...cap,
}] }] });

test("customerOutcome validates evidenceState + intendedOutcome when present; absent is allowed (legacy)", () => {
  assert.deepEqual(validateModel(modelWith({})), []); // no customerOutcome -> fine (legacy UNKNOWN)
  assert.deepEqual(validateModel(modelWith({ customerOutcome: { intendedOutcome: "reduce dispatch time", evidenceState: "HYPOTHESIS", evidence: [] } })), []);
  assert.ok(validateModel(modelWith({ customerOutcome: { intendedOutcome: "x", evidenceState: "MADE_UP" } })).some((e) => /evidenceState/.test(e)));
  assert.ok(validateModel(modelWith({ customerOutcome: { evidenceState: "HYPOTHESIS" } })).some((e) => /intendedOutcome/.test(e)));
  assert.ok(CUSTOMER_OUTCOME_EVIDENCE_STATES.includes("VALIDATED"));
});

test("cockpit projects customerOutcome — legacy capabilities are UNKNOWN, never fabricated", () => {
  const c = projectCockpit(modelWith({}));
  assert.equal(c.customerOutcome.available, true);
  assert.equal(c.customerOutcome.distribution.UNKNOWN, 1);
  assert.equal(c.customerOutcome.established.length, 0);
  assert.match(c.customerOutcome.note, /never fabricated/);
});

test("cockpit surfaces an established customer outcome with its evidenceState", () => {
  const c = projectCockpit(modelWith({ customerOutcome: { intendedOutcome: "cut reorder latency", evidenceState: "EVIDENCED", evidence: [{ ref: "usage-log" }] } }));
  assert.equal(c.customerOutcome.distribution.EVIDENCED, 1);
  assert.equal(c.customerOutcome.established[0].intendedOutcome, "cut reorder latency");
  assert.equal(c.customerOutcome.established[0].evidenceState, "EVIDENCED");
});

// ---- durable triageClass (persisted on the decision lifecycle) ----
const decision = (over = {}) => createOwnerDecisionRequest({
  decisionId: "D-1", projectId: "taylor-parts", originatingWorkstream: "Design",
  question: "?", reason: "needs a call", ...over,
});

test("a fresh decision request carries no triageClass until one is accepted", () => {
  const d = decision();
  assert.equal(d.triageClass, null);
  assert.deepEqual(validateOwnerDecisionRequest(d), []);
});

test("acceptTriage persists the accepted class + reason + evidence durably", () => {
  const t = triage({ crossesProtectedBoundary: true });
  const d = acceptTriage(decision(), t, [{ ref: "hosting-runbook" }]);
  assert.equal(d.triageClass, "OWNER_AUTHORIZATION");
  assert.match(d.triageReason, /protected execution/);
  assert.equal(d.triageEvidence.length, 1);
  assert.deepEqual(validateOwnerDecisionRequest(d), []);
});

test("acceptTriage rejects a non-triage result — the adapter can never invent a class", () => {
  assert.throws(() => acceptTriage(decision(), { triageClass: "NONSENSE" }), /must be a TRIAGE_CLASS/);
});

test("persisting a triageClass does not itself authorize execution (decision != protected execution)", () => {
  const d = acceptTriage(decision(), triage({ crossesProtectedBoundary: true }));
  // OWNER_AUTHORIZATION persisted, but it only records that authorization is REQUIRED at
  // execution — it carries no execute flag and no protected-action side effect.
  assert.equal(d.triageClass, "OWNER_AUTHORIZATION");
  assert.equal(d.status, "OPEN"); // still open; nothing executed
});
