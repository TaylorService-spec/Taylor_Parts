// The retirement gate's proof. The gate must not be openable by forgetting a transition, so the
// legacy transitions are extracted FROM firestore.rules and checked against the module.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEGACY_TRANSITIONS, RETIREMENT_GATES, readReorderRetirementGates, assigneeOnlyTransitions,
} from "../lib/eosOps/migration/reorderFirestoreRetirementGate.js";
import { assignmentCutoverReadiness } from "../lib/eosOps/migration/assignedToUserIdCensus.js";

/** The status transitions firestore.rules' reorder_requests block actually permits. */
function transitionsFromRules() {
  const src = readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  const start = src.indexOf("match /reorder_requests/{requestId}");
  assert.notEqual(start, -1, "firestore.rules no longer has a reorder_requests block");
  const block = src.slice(start, src.indexOf("match /reorder_purchase_orders", start));
  const found = new Set();
  // Single-source arms: resource.data.status == "X" ... request.resource.data.status == "Y"
  const single = /resource\.data\.status\s*==\s*"([A-Z_]+)"[\s\S]{0,600}?request\.resource\.data\.status\s*==\s*"([A-Z_]+)"/g;
  for (let m; (m = single.exec(block));) found.add(`${m[1]}->${m[2]}`);
  // The cancel arm names three sources before one target.
  const multi = /\(resource\.data\.status\s*==\s*"([A-Z_]+)"\s*\|\|\s*resource\.data\.status\s*==\s*"([A-Z_]+)"\s*\|\|\s*resource\.data\.status\s*==\s*"([A-Z_]+)"\)[\s\S]{0,300}?request\.resource\.data\.status\s*==\s*"([A-Z_]+)"/g;
  for (let m; (m = multi.exec(block));) { found.add(`${m[1]}->${m[4]}`); found.add(`${m[2]}->${m[4]}`); found.add(`${m[3]}->${m[4]}`); }
  return found;
}

test("every transition firestore.rules permits has a governed command", () => {
  const fromRules = transitionsFromRules();
  assert.ok(fromRules.size >= 7, "the extraction found suspiciously few transitions; it has probably broken");
  const covered = new Set(LEGACY_TRANSITIONS.filter((x) => x.from !== null).map((x) => `${x.from}->${x.to}`));
  const missing = [...fromRules].filter((x) => !covered.has(x));
  assert.deepEqual(missing, [],
    `these legacy transitions have no entry, so retiring Firestore would silently drop them: ${missing.join(", ")}`);
  for (const x of LEGACY_TRANSITIONS) {
    assert.ok(typeof x.governedBy === "string" && x.governedBy.length > 0,
      `${x.from ?? "(create)"}->${x.to} names no governed command`);
    assert.ok(x.note.trim().length > 0);
  }
});

test("the assignee-only restrictions are carried over, not quietly dropped", () => {
  // These are the three the legacy client enforced with a uid comparison, plus the void.
  const names = assigneeOnlyTransitions().map((x) => `${x.from}->${x.to}`).sort();
  assert.deepEqual(names, [
    "ASSIGNED_TO_PARTS_ASSOCIATE->PURCHASING_IN_PROGRESS",
    "ORDERED->RECEIVED",
    "ORDERED->VOIDED",
    "PURCHASING_IN_PROGRESS->PURCHASING_IN_PROGRESS",
  ]);
  // Cancellation is deliberately NOT assignee-scoped: the legacy did not restrict it either, and
  // inventing a restriction on the way across would narrow access as surely as dropping one widens it.
  const cancels = LEGACY_TRANSITIONS.filter((x) => x.to === "CANCELLED");
  assert.equal(cancels.length, 3);
  assert.ok(cancels.every((x) => x.assigneeOnly === false));
});

test("the gate is COMPUTED, and the two it cannot close are stated as such", () => {
  const reading = readReorderRetirementGates({
    blockingAssigneeConsumers: assignmentCutoverReadiness().blockedBy,
  });
  assert.equal(reading.mayRetire, false, "nothing in this repository may declare Firestore retired");

  const byGate = new Map(reading.gates.map((g) => [g.gate, g]));
  assert.deepEqual([...byGate.keys()].sort(), [...RETIREMENT_GATES].sort());

  // The two the code closed.
  assert.equal(byGate.get("TRANSITION_COVERAGE").state, "MET");
  // firestore.rules is the only remaining uid consumer, and its comparisons stop mattering exactly
  // when the Rules are retired -- which is the gate below, not this one.
  assert.equal(byGate.get("ASSIGNEE_IDENTITY").state, "MET");

  // The two only an operator can close, in a real environment.
  assert.equal(byGate.get("OBJECT_COPY_VERIFIED").state, "REQUIRES_OPERATOR");
  assert.equal(byGate.get("RULES_RETIRED").state, "REQUIRES_OPERATOR");
  assert.deepEqual([...reading.awaitingOperator].sort(), ["OBJECT_COPY_VERIFIED", "RULES_RETIRED"]);
});

test("a uid consumer other than the Rules holds the identity gate shut", () => {
  const withStray = readReorderRetirementGates({
    blockingAssigneeConsumers: ["firestore.rules", "field-ops-app-vite/src/somewhere.js"],
  });
  const gate = withStray.gates.find((g) => g.gate === "ASSIGNEE_IDENTITY");
  assert.equal(gate.state, "OPEN", "a client still deciding from a uid would survive the Rules retirement");
  assert.match(gate.detail, /somewhere\.js/);
});

test("an uncovered transition holds the coverage gate shut", () => {
  const reading = readReorderRetirementGates({
    blockingAssigneeConsumers: [],
    transitions: [...LEGACY_TRANSITIONS, { from: "ORDERED", to: "SOMETHING_NEW", governedBy: null, assigneeOnly: false, note: "x" }],
  });
  const gate = reading.gates.find((g) => g.gate === "TRANSITION_COVERAGE");
  assert.equal(gate.state, "OPEN");
  assert.match(gate.detail, /ORDERED->SOMETHING_NEW/);
});

test("all four gates MET is the only way to read mayRetire true", () => {
  const reading = readReorderRetirementGates({
    blockingAssigneeConsumers: [],
    copyVerifiedInEnvironment: true,
    rulesRetiredAndDeployed: true,
  });
  assert.equal(reading.mayRetire, true);
  assert.deepEqual(reading.awaitingOperator, []);
  // And removing any one of them closes it again.
  assert.equal(readReorderRetirementGates({
    blockingAssigneeConsumers: [], copyVerifiedInEnvironment: true,
  }).mayRetire, false);
});
