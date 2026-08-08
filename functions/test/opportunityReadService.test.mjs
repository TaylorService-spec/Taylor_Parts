// Sales Opportunity Cycle 3c — OFFLINE tests for the PURE read-projection core, imported from compiled lib.
// No emulator/Firebase/network. Proves the minimal projection (no raw UID, no Customer PII copy; accountId
// only), invalid-field dropping, and the degraded/empty summary semantics.
import test from "node:test";
import assert from "node:assert/strict";
import { projectOpportunity, summarizeReadResult } from "../lib/opportunity/opportunityReadService.js";

test("projectOpportunity returns only the minimal Sales-workspace fields", () => {
  const p = projectOpportunity("O1", {
    accountId: "ACCT-1",
    salesChannel: "RETAIL",
    ownerEmployeeId: "EMP-9",
    stage: "QUOTING",
    outcome: null,
    need: "New line",
    expectedValue: 1000,
    expectedCloseAt: 123,
    nextAction: "call",
    lines: [{ kind: "PART", ref: "PRT-1", qty: 2 }],
    // fields that must NOT leak into the projection:
    createdByUid: "uid-abc",
    customerName: "Should Not Copy Co",
    internalNotes: "secret",
  });
  assert.deepEqual(Object.keys(p).sort(), [
    "accountId", "expectedCloseAt", "expectedValue", "id", "lines", "need", "nextAction", "outcome", "ownerEmployeeId", "salesChannel", "stage",
  ]);
  assert.equal(p.accountId, "ACCT-1");
  // no raw UID, no copied Customer name
  assert.equal("createdByUid" in p, false);
  assert.equal("customerName" in p, false);
});

test("projectOpportunity drops invalid stage/outcome and malformed lines rather than trusting them", () => {
  const p = projectOpportunity("O2", {
    stage: "BOGUS",
    outcome: "MAYBE",
    expectedValue: "lots",
    lines: [{ kind: "PART", ref: "ok" }, { kind: "PART" }, "nope", { ref: "noKind" }],
  });
  assert.equal(p.stage, null);
  assert.equal(p.outcome, null);
  assert.equal(p.expectedValue, null);
  assert.deepEqual(p.lines, [{ kind: "PART", ref: "ok" }]);
});

test("projectOpportunity fails to null on missing id or data (counted as a degraded skip)", () => {
  assert.equal(projectOpportunity("", { stage: "QUOTING" }), null);
  assert.equal(projectOpportunity("O3", undefined), null);
});

test("summarizeReadResult: clean set is ready; any skip makes it degraded; empty is ready+[]", () => {
  const ready = summarizeReadResult([
    { id: "A", data: { stage: "QUOTING" } },
    { id: "B", data: { stage: "DECISION" } },
  ]);
  assert.equal(ready.status, "ready");
  assert.equal(ready.opportunities.length, 2);
  assert.equal(ready.skipped, 0);

  const degraded = summarizeReadResult([
    { id: "A", data: { stage: "QUOTING" } },
    { id: "", data: { stage: "DECISION" } }, // unprojectable → skipped
  ]);
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.opportunities.length, 1);
  assert.equal(degraded.skipped, 1);

  const empty = summarizeReadResult([]);
  assert.equal(empty.status, "ready");
  assert.deepEqual(empty.opportunities, []);
});
