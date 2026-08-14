// Sales Opportunity Cycle 3 — OFFLINE tests for the PURE write core (lifecycle transition authority +
// command builders), imported from the compiled lib. No emulator, no Firebase, no network. Proves the
// ratified invariants: pre-commitment product-level lines (serialized asset forbidden), owner is required,
// the minimal transition graph (forward-by-one / LOST-any-open / WON-only-from-DECISION / closed-is-final).
import test from "node:test";
import assert from "node:assert/strict";
import {
  OPPORTUNITY_STAGES,
  nextStage,
  checkTransition,
} from "../lib/opportunity/opportunityLifecycle.js";
import {
  buildCreateOpportunity,
  buildTransitionPatch,
  OpportunityCommandError,
} from "../lib/opportunity/opportunityCommands.js";

const CTX = { actorUid: "uid-1", nowMillis: 1_754_600_000_000 };

test("lifecycle is the ratified ordered set; nextStage is forward-by-one and null past DECISION", () => {
  assert.deepEqual([...OPPORTUNITY_STAGES], ["IDENTIFIED", "QUALIFYING", "SOLUTION", "QUOTING", "CUSTOMER_REVIEW", "DECISION"]);
  assert.equal(nextStage("IDENTIFIED"), "QUALIFYING");
  assert.equal(nextStage("CUSTOMER_REVIEW"), "DECISION");
  assert.equal(nextStage("DECISION"), null);
});

test("checkTransition: forward-by-one only; skips/backwards illegal", () => {
  assert.deepEqual(checkTransition({ stage: "IDENTIFIED" }, { kind: "ADVANCE", toStage: "QUALIFYING" }), { ok: true });
  assert.equal(checkTransition({ stage: "IDENTIFIED" }, { kind: "ADVANCE", toStage: "SOLUTION" }).code, "ILLEGAL_TRANSITION");
  assert.equal(checkTransition({ stage: "QUALIFYING" }, { kind: "ADVANCE", toStage: "IDENTIFIED" }).code, "ILLEGAL_TRANSITION");
});

test("checkTransition: LOST from any open stage; WON only from DECISION", () => {
  assert.deepEqual(checkTransition({ stage: "QUALIFYING" }, { kind: "OUTCOME", outcome: "LOST" }), { ok: true });
  assert.deepEqual(checkTransition({ stage: "DECISION" }, { kind: "OUTCOME", outcome: "WON" }), { ok: true });
  assert.equal(checkTransition({ stage: "QUOTING" }, { kind: "OUTCOME", outcome: "WON" }).code, "OUTCOME_REQUIRES_DECISION");
});

test("checkTransition: a closed opportunity accepts no further transition", () => {
  assert.equal(checkTransition({ stage: "DECISION", outcome: "WON" }, { kind: "ADVANCE", toStage: "DECISION" }).code, "ALREADY_CLOSED");
  assert.equal(checkTransition({ stage: "DECISION", outcome: "LOST" }, { kind: "OUTCOME", outcome: "WON" }).code, "ALREADY_CLOSED");
});

test("buildCreateOpportunity: starts IDENTIFIED/open with canonical owner + product lines", () => {
  const built = buildCreateOpportunity(
    {
      accountId: "ACCT-1",
      ownerEmployeeId: "EMP-9",
      salesChannel: "RETAIL",
      need: "New line",
      expectedValue: 1000,
      lines: [{ kind: "EQUIPMENT_MODEL", ref: "C713", qty: 5 }, { kind: "PART", ref: "PRT-1", qty: 2 }],
    },
    CTX
  );
  assert.equal(built.stage, "IDENTIFIED");
  assert.equal(built.outcome, null);
  assert.equal(built.ownerEmployeeId, "EMP-9");
  assert.equal(built.lines.length, 2);
  assert.equal(built.createdByUid, "uid-1");
});

test("buildCreateOpportunity: fails closed on missing account/owner/invalid channel", () => {
  assert.throws(() => buildCreateOpportunity({ ownerEmployeeId: "E", salesChannel: "RETAIL" }, CTX), (e) => e instanceof OpportunityCommandError && e.code === "ACCOUNT_REQUIRED");
  assert.throws(() => buildCreateOpportunity({ accountId: "A", salesChannel: "RETAIL" }, CTX), (e) => e.code === "OWNER_REQUIRED");
  assert.throws(() => buildCreateOpportunity({ accountId: "A", ownerEmployeeId: "E", salesChannel: "BOGUS" }, CTX), (e) => e.code === "CHANNEL_INVALID");
});

test("buildCreateOpportunity: accepts the ratified STRATEGIC_ACCOUNTS channel (#15)", () => {
  const built = buildCreateOpportunity({ accountId: "A", ownerEmployeeId: "E", salesChannel: "STRATEGIC_ACCOUNTS", lines: [{ kind: "PART", ref: "p", qty: 1 }] }, CTX);
  assert.equal(built.salesChannel, "STRATEGIC_ACCOUNTS");
});

test("buildCreateOpportunity: a serialized-asset line is FORBIDDEN (pre-commitment boundary)", () => {
  for (const bad of [
    { kind: "EQUIPMENT_MODEL", ref: "C713", serial: "SN-1" },
    { kind: "EQUIPMENT_MODEL", ref: "C713", serializedAssetId: "SA-1" },
    { kind: "EQUIPMENT_MODEL", ref: "C713", equipmentId: "EQ-1" },
  ]) {
    assert.throws(
      () => buildCreateOpportunity({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [bad] }, CTX),
      (e) => e instanceof OpportunityCommandError && e.code === "SERIALIZED_LINE_FORBIDDEN"
    );
  }
});

test("buildCreateOpportunity: invalid line kind or qty fails closed", () => {
  assert.throws(() => buildCreateOpportunity({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [{ kind: "MYSTERY", ref: "x" }] }, CTX), (e) => e.code === "LINE_INVALID");
  assert.throws(() => buildCreateOpportunity({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "x", qty: 0 }] }, CTX), (e) => e.code === "LINE_INVALID");
});

test("buildCreateOpportunity: qty is REQUIRED on every line (closes the qty-less WON dead-end at its source)", () => {
  assert.throws(
    () => buildCreateOpportunity({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "PRT-1" }] }, CTX),
    (e) => e instanceof OpportunityCommandError && e.code === "LINE_INVALID"
  );
  assert.throws(
    () => buildCreateOpportunity({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "PRT-1", qty: -1 }] }, CTX),
    (e) => e.code === "LINE_INVALID"
  );
});

test("buildCreateOpportunity: fractional line qty fails closed (mirrors salesOrderCommands posInt — a non-integer qty can never seed a Sales Order)", () => {
  assert.throws(
    () => buildCreateOpportunity({ accountId: "A", ownerEmployeeId: "E", salesChannel: "RETAIL", lines: [{ kind: "PART", ref: "PRT-1", qty: 2.5 }] }, CTX),
    (e) => e instanceof OpportunityCommandError && e.code === "LINE_INVALID"
  );
});

test("buildTransitionPatch: advance sets the next stage and keeps it open", () => {
  const patch = buildTransitionPatch({ stage: "IDENTIFIED" }, { kind: "ADVANCE", toStage: "QUALIFYING" }, CTX);
  assert.equal(patch.stage, "QUALIFYING");
  assert.equal(patch.outcome, null);
  assert.equal(patch.updatedByUid, "uid-1");
});

test("buildTransitionPatch: WON from DECISION closes; illegal transitions throw fail-closed", () => {
  const won = buildTransitionPatch({ stage: "DECISION", lines: [{ kind: "PART", ref: "P-1", qty: 1 }] }, { kind: "OUTCOME", outcome: "WON" }, CTX);
  assert.equal(won.outcome, "WON");
  assert.equal(won.stage, "DECISION");
  assert.equal(won.closedAtMillis, CTX.nowMillis);
  assert.throws(() => buildTransitionPatch({ stage: "QUOTING", lines: [{ kind: "PART", ref: "P-1", qty: 1 }] }, { kind: "OUTCOME", outcome: "WON" }, CTX), (e) => e.code === "OUTCOME_REQUIRES_DECISION");
  assert.throws(() => buildTransitionPatch({ stage: "DECISION", outcome: "LOST" }, { kind: "ADVANCE", toStage: "DECISION" }, CTX), (e) => e.code === "ALREADY_CLOSED");
});

test("buildTransitionPatch: WON with zero lines is rejected", () => {
  assert.throws(() => buildTransitionPatch({ stage: "DECISION", lines: [] }, { kind: "OUTCOME", outcome: "WON" }, CTX), (e) => e.code === "NO_LINES");
});

test("buildTransitionPatch: WON with a qty-less line is rejected (closes the permanent Sales Order dead-end)", () => {
  assert.throws(
    () => buildTransitionPatch({ stage: "DECISION", lines: [{ kind: "PART", ref: "P-1" }] }, { kind: "OUTCOME", outcome: "WON" }, CTX),
    (e) => e instanceof OpportunityCommandError && e.code === "LINE_QTY_REQUIRED_FOR_WON"
  );
  assert.throws(
    () => buildTransitionPatch({ stage: "DECISION", lines: [{ kind: "PART", ref: "P-1", qty: 3 }, { kind: "PART", ref: "P-2", qty: 0 }] }, { kind: "OUTCOME", outcome: "WON" }, CTX),
    (e) => e.code === "LINE_QTY_REQUIRED_FOR_WON"
  );
});

test("buildTransitionPatch: WON with a fractional-qty line is rejected (defends legacy opps persisted before integer qty was enforced at create)", () => {
  assert.throws(
    () => buildTransitionPatch({ stage: "DECISION", lines: [{ kind: "PART", ref: "P-1", qty: 2.5 }] }, { kind: "OUTCOME", outcome: "WON" }, CTX),
    (e) => e instanceof OpportunityCommandError && e.code === "LINE_QTY_REQUIRED_FOR_WON"
  );
});

test("buildTransitionPatch: WON with every line carrying a valid qty is allowed", () => {
  const won = buildTransitionPatch(
    { stage: "DECISION", lines: [{ kind: "PART", ref: "P-1", qty: 3 }, { kind: "EQUIPMENT_MODEL", ref: "C713", qty: 1 }] },
    { kind: "OUTCOME", outcome: "WON" },
    CTX
  );
  assert.equal(won.outcome, "WON");
});

test("buildTransitionPatch: LOST is reachable regardless of line qty (an open opp can always be lost)", () => {
  const lost = buildTransitionPatch({ stage: "QUALIFYING", lines: [{ kind: "PART", ref: "P-1" }] }, { kind: "OUTCOME", outcome: "LOST" }, CTX);
  assert.equal(lost.outcome, "LOST");
});
