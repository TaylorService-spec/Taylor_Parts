// Committed Customer Obligation ATTENTION — pure unit tests (node:test). Proves the projection derives the
// honest reason vocabulary (BLOCKED / WAITING_ON_MATERIAL / PARTIAL / REMAINING_WORK / UNKNOWN) from EXISTING
// facts only, and never invents severity/SLA/ETA. Facts come from the coordinatedVisit (+ optional mission).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCoordinatedVisit } from "../src/domain/coordinatedVisit.js";
import { buildCoordinatedFieldMission } from "../src/domain/coordinatedFieldMission.js";
import { deriveObligationAttention, summarizeObligationAttention } from "../src/domain/obligationAttention.js";

const wo = (id, status) => ({ id, woNumber: id, status, salesOrderId: "SO1", customerId: "C1", locationId: "L1" });
const visitOf = (...wos) => buildCoordinatedVisit("SO1", wos);

test("all complete ⇒ satisfied, no reasons, no intervention", () => {
  const a = deriveObligationAttention(visitOf(wo("a", "COMPLETED"), wo("b", "CLOSED")));
  assert.equal(a.satisfied, true);
  assert.equal(a.incomplete, false);
  assert.deepEqual(a.reasons, []);
  assert.equal(a.needsIntervention, false);
  assert.equal(a.tone, "positive");
});

// NOTE on the fixtures below: these previously used a status literal "BLOCKED", which is NOT a
// member of the canonical WorkOrderStatus set -- the projection matched it only because
// BLOCKED_STATUSES itself contained the same non-canonical value. Both were fixed together, so
// these fixtures now use CANCELLED, the one genuinely canonical blocking status. The EXPECTED
// BEHAVIOUR of the projection is unchanged; only the fixture status is corrected to a real one.

test("blocked WO with no material evidence ⇒ BLOCKED, intervention", () => {
  const a = deriveObligationAttention(visitOf(wo("a", "COMPLETED"), wo("b", "CANCELLED")));
  assert.equal(a.primaryReason, "BLOCKED");
  assert.equal(a.needsIntervention, true);
  assert.equal(a.tone, "attention");
});

test("blocked WO whose blocker is material ⇒ WAITING_ON_MATERIAL (specialized), intervention", () => {
  const visit = visitOf(wo("a", "COMPLETED"), wo("b", "CANCELLED"));
  const mission = buildCoordinatedFieldMission(visit, {
    b: { partsReadiness: "ATTENTION", loadVerified: false, materialBlocker: { partRef: "PRT-X", replenishmentConnected: false } },
  });
  const a = deriveObligationAttention(visit, mission);
  assert.equal(a.primaryReason, "WAITING_ON_MATERIAL");
  assert.equal(a.needsIntervention, true);
});

test("parts-short unit without a blocked status ⇒ WAITING_ON_MATERIAL", () => {
  const visit = visitOf(wo("a", "COMPLETED"), wo("b", "IN_PROGRESS"));
  const mission = buildCoordinatedFieldMission(visit, { b: { partsReadiness: "ATTENTION", loadVerified: true } });
  const a = deriveObligationAttention(visit, mission);
  assert.equal(a.reasons.includes("WAITING_ON_MATERIAL"), true);
  assert.equal(a.needsIntervention, true);
});

test("some done, none blocked, no material ⇒ PARTIAL (watch, not intervention)", () => {
  const a = deriveObligationAttention(visitOf(wo("a", "COMPLETED"), wo("b", "IN_PROGRESS")));
  assert.equal(a.primaryReason, "PARTIAL");
  assert.equal(a.needsIntervention, false);
  assert.equal(a.watch, true);
  assert.equal(a.tone, "info");
});

test("none done, in progress, no blocker ⇒ REMAINING_WORK (watch)", () => {
  const a = deriveObligationAttention(visitOf(wo("a", "IN_PROGRESS"), wo("b", "SCHEDULED")));
  assert.equal(a.primaryReason, "REMAINING_WORK");
  assert.equal(a.watch, true);
});

test("inconsistent context ⇒ UNKNOWN appended, needsReview", () => {
  const visit = buildCoordinatedVisit("SO1", [
    { id: "a", status: "COMPLETED", salesOrderId: "SO1", customerId: "C1", locationId: "L1" },
    { id: "b", status: "IN_PROGRESS", salesOrderId: "SO1", customerId: "C2", locationId: "L1" },
  ]);
  const a = deriveObligationAttention(visit);
  assert.equal(a.reasons.includes("UNKNOWN"), true);
  assert.equal(a.needsReview, true);
});

test("no visit / zero units ⇒ cannot assert commitment; UNKNOWN + needsReview", () => {
  const a = deriveObligationAttention(null);
  assert.equal(a.commitmentExists, false);
  assert.deepEqual(a.reasons, ["UNKNOWN"]);
  assert.equal(a.needsReview, true);
});

test("commitment/execution are read from the visit fact, not invented", () => {
  const a = deriveObligationAttention(visitOf(wo("a", "IN_PROGRESS")));
  assert.equal(a.commitmentExists, true);
  assert.equal(a.executionBegun, true);
});

test("does NOT invent severity/SLA/ETA fields", () => {
  const a = deriveObligationAttention(visitOf(wo("a", "BLOCKED")));
  for (const forbidden of ["severity", "risk", "riskScore", "sla", "eta", "promise", "dueBy"]) {
    assert.equal(forbidden in a, false, `must not expose ${forbidden}`);
  }
});

test("summarizeObligationAttention counts honestly across obligations", () => {
  const attns = [
    deriveObligationAttention(visitOf(wo("a", "COMPLETED"))),                     // satisfied
    deriveObligationAttention(visitOf(wo("a", "COMPLETED"), wo("b", "CANCELLED"))), // intervention
    deriveObligationAttention(visitOf(wo("a", "COMPLETED"), wo("b", "IN_PROGRESS"))), // watch (partial)
  ];
  const s = summarizeObligationAttention(attns);
  assert.equal(s.total, 3);
  assert.equal(s.needsIntervention, 1);
  assert.equal(s.watch, 1);
  assert.equal(s.satisfied, 1);
});
