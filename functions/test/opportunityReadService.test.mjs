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
    salesOrderId: "SO-1",
    salesAgreementId: "SA-1",
    // fields that must NOT leak into the projection:
    createdByUid: "uid-abc",
    customerName: "Should Not Copy Co",
    internalNotes: "secret",
  });
  // The allow-list has grown twice, each time deliberately (#1099, then the version token). This assertion failing on a
  // new field is the guard WORKING: the projection is minimal by design, so every addition
  // has to be argued for here rather than sliding in unnoticed.
  //
  // name and opportunityNumber are the record's HUMAN IDENTITY, and they are the opposite
  // of the leak this test guards against. Their absence is what forced every reader to fall
  // back to the Firestore document id -- which is how 95kFz8WWgiSn2nU2O3Ml became a
  // user-facing label. Identity is the minimum a caller needs in order NOT to expose an
  // internal key.
  //
  // createdAtMillis and updatedAtMillis are the NEXT two, and the argument for them is
  // narrower still: updatedAtMillis is the optimistic-concurrency token updateOpportunity
  // REQUIRES. Without it in the projection no client can prove which version it loaded, so
  // the governed edit command is unreachable from every read surface in the product -- built,
  // correct, and callable by nothing. createdAtMillis comes with it because the Record section
  // rendered "not recorded" for every Opportunity ever displayed, not because the data was
  // missing but because it was never projected.
  //
  // Neither is customer data, neither is an internal key, and both are already visible to any
  // caller authorized to read the record at all. This is the same allow-list discipline, not
  // an exception to it.
  assert.deepEqual(Object.keys(p).sort(), [
    "accountId", "createdAtMillis", "expectedCloseAt", "expectedValue", "id", "lines", "name",
    "need", "nextAction", "opportunityNumber", "outcome", "ownerEmployeeId", "salesAgreementId", "salesChannel",
    "salesOrderId", "stage", "updatedAtMillis",
  ]);
  assert.equal(p.accountId, "ACCT-1");
  assert.equal(p.salesOrderId, "SO-1");
  assert.equal(p.salesAgreementId, "SA-1");
  // no raw UID, no copied Customer name
  assert.equal("createdByUid" in p, false);
  assert.equal("customerName" in p, false);
  assert.equal("internalNotes" in p, false);
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

test("projectOpportunity defaults salesOrderId to null (a WON Opportunity with no Sales Order created yet)", () => {
  const p = projectOpportunity("O4", { stage: "DECISION", outcome: "WON" });
  assert.equal(p.salesOrderId, null);
});

test("projectOpportunity projects salesAgreementId, the link a salesperson opens the record to follow", () => {
  // Found live during the sandbox Sales Agreement activation: the field was written atomically by
  // createSalesAgreement and projected by nothing, so the Opportunity could not reach the agreement
  // that governs its price. Identical in shape to the salesOrderId omission this file already
  // records -- which is why it is asserted here rather than only noticed again later.
  assert.equal(projectOpportunity("O5", { salesAgreementId: "SA-2026-000003" }).salesAgreementId, "SA-2026-000003");
  assert.equal(projectOpportunity("O6", { stage: "QUOTING" }).salesAgreementId, null, "absent until an agreement exists");
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

// ─────────────────────────────────────────────────────────────────────────────
// THE VERSION TOKEN — the omission that made the governed edit command unreachable.
//
// updateOpportunity REQUIRES expectedUpdatedAtMillis: it rejects any caller that cannot prove
// which version it loaded. This projection never returned that value, so no client could supply
// it, so the command could not be called from any read surface in the product. The command was
// built, correct, and tested; nothing on earth could reach it.
// ─────────────────────────────────────────────────────────────────────────────

test("the optimistic-concurrency token is projected", () => {
  const p = projectOpportunity("o1", {
    stage: "SOLUTION",
    accountId: "acct-1",
    updatedAtMillis: 1_755_000_000_000,
    createdAtMillis: 1_754_000_000_000,
  });
  assert.equal(p.updatedAtMillis, 1_755_000_000_000, "without this the edit command cannot be called at all");
  assert.equal(p.createdAtMillis, 1_754_000_000_000);
});

test("a record with no version projects null, not a fabricated one", () => {
  // The command reads a missing current version AS 0, so a client echoing null-then-0 is making
  // a true statement about the copy it loaded. Inventing a plausible timestamp here would make
  // that statement false and the concurrency check meaningless.
  const p = projectOpportunity("o1", { stage: "SOLUTION", accountId: "acct-1" });
  assert.equal(p.updatedAtMillis, null);
  assert.equal(p.createdAtMillis, null);
});

test("a non-numeric version is dropped rather than passed through", () => {
  const p = projectOpportunity("o1", {
    stage: "SOLUTION",
    accountId: "acct-1",
    updatedAtMillis: "2026-08-20T00:00:00Z",
  });
  assert.equal(p.updatedAtMillis, null, "a Timestamp or string version would fail the numeric comparison silently");
});
