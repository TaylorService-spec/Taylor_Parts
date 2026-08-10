import { test } from "node:test";
import assert from "node:assert/strict";
import { projectCockpit } from "./roadmapProjection.mjs";

const model = (caps) => ({ domains: [{ id: "d", name: "D", capabilities: caps }] });
const cap = (over) => ({
  id: "c", name: "C", status: "READY",
  implementationState: "NOT_APPLICABLE", activationState: "NOT_APPLICABLE", backendState: "NOT_APPLICABLE",
  userOperable: "NOT_APPLICABLE", uxState: "NOT_APPLICABLE", deployState: "NOT_APPLICABLE",
  milestones: [], ...over,
});

test("systemHealth is ACTION_REQUIRED only on a pending OWNER_DECISION (governed conditions, no %)", () => {
  const c = projectCockpit(model([cap({ id: "x", status: "OWNER_DECISION", ownerDecision: "decide" })]));
  assert.equal(c.systemHealth.state, "ACTION_REQUIRED");
  assert.ok(c.systemHealth.reasons.some((r) => r.code === "OWNER_DECISION"));
  assert.equal(typeof c.systemHealth.percent, "undefined"); // never a completion %
});

test("systemHealth is ATTENTION on network pressure / stale, HEALTHY otherwise", () => {
  assert.equal(projectCockpit(model([cap()]), { networkHealth: { state: "NETWORK_PRESSURE" } }).systemHealth.state, "ATTENTION");
  assert.equal(projectCockpit(model([cap()]), { freshness: "STALE" }).systemHealth.state, "ATTENTION");
  assert.equal(projectCockpit(model([cap()])).systemHealth.state, "HEALTHY");
});

test("a PROTECTED_ACTION is an OWNER_AUTHORIZATION in NEEDS YOU (re-confirm at execution), not a health alarm", () => {
  const c = projectCockpit(model([cap({ id: "p", status: "PROTECTED_ACTION", protectedBoundary: "deploy" })]));
  assert.equal(c.systemHealth.state, "HEALTHY"); // a resting gate, not an alarm
  const item = c.needsYou.items.find((i) => i.capabilityId === "p");
  assert.equal(item.triageClass, "OWNER_AUTHORIZATION");
  assert.equal(item.requiresReconfirmAtExecution, true);
  assert.equal(c.needsYou.proxy, true); // honest: triageClass not yet a durable field
});

test("workSupply reports DRAINED as legitimate, never an error", () => {
  const c = projectCockpit(model([cap({ status: "DONE" })]));
  assert.equal(c.workSupply.state, "DRAINED");
  assert.equal(c.workSupply.terminalCheckpoint, true);
  assert.match(c.workSupply.note, /legitimate/);
});

test("operability is a 6-lane distribution (never one %), excluding process capabilities", () => {
  const c = projectCockpit(model([
    cap({ id: "op", status: "DELIVERED", implementationState: "IMPLEMENTED", deployState: "DEPLOYED", userOperable: true }),
    cap({ id: "inert", status: "AT_REST", implementationState: "IMPLEMENTED", activationState: "INERT", userOperable: false, deployState: "NOT_DEPLOYED" }),
    cap({ id: "proc" }), // all NOT_APPLICABLE -> excluded
  ]));
  assert.equal(c.operability.distribution.USER_OPERABLE, 1);
  assert.equal(c.operability.distribution.INERT, 1);
  assert.equal(c.operability.processExcluded, 1);
  assert.equal(typeof c.operability.percent, "undefined");
});

test("autonomy asserts the authority-expansion invariant with a basis; overnight not authorized", () => {
  const c = projectCockpit(model([cap({ id: "unattended-readiness", status: "DONE" })]));
  assert.equal(c.autonomy.authorityExpansions, 0);
  assert.ok(c.autonomy.authorityExpansionsBasis);
  assert.equal(c.autonomy.overnightAuthorized, false);
  assert.equal(c.autonomy.governingCapability, "unattended-readiness");
});

test("aiGovernance is an HONEST gap; customerOutcome is durable but UNKNOWN for legacy caps (no fabrication)", () => {
  const c = projectCockpit(model([cap()]), { ownerRelayCount: 0 });
  assert.equal(c.aiGovernance.available, false);
  assert.equal(c.aiGovernance.ownerRelayCount, 0);
  // customerOutcome is now a durable field: available, but legacy capabilities are UNKNOWN, not invented.
  assert.equal(c.customerOutcome.available, true);
  assert.equal(c.customerOutcome.distribution.UNKNOWN, 1);
  assert.equal(c.customerOutcome.established.length, 0);
});

test("sinceLastVisit is PR-sequence based (not wall-clock) and client diffs the marker", () => {
  const c = projectCockpit(model([cap({
    milestones: [{ workItems: [{ name: "w", status: "DONE", prEvidence: ["#700"] }] }],
  })]));
  assert.equal(c.sinceLastVisit.markerBasis, "PR_SEQUENCE");
  assert.equal(c.sinceLastVisit.latestPr, 700);
});
