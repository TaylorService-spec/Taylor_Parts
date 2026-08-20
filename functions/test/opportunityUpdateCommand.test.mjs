// Opportunity ordinary edit — PURE command core. No emulator.
//
// WHY THIS COMMAND EXISTS. The Opportunity workspace showed "The governed save command is
// not wired in this build" on every Edit control, and that message was accurate: only
// createOpportunity and transitionOpportunity existed, so an Opportunity could be created
// and advanced but never corrected. This is the missing third write path.
//
// The invariant these assertions exist to protect is that an ORDINARY edit can never move
// an Opportunity through its LIFECYCLE. That separation is structural — buildUpdateOpportunity
// never reads `stage` or `outcome` from its input — and the tests below try to break it
// anyway, because a structural guarantee is only worth what its evidence is worth.
//
// Run: node --test test/opportunityUpdateCommand.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUpdateOpportunity,
  OpportunityCommandError,
  EDITABLE_OPPORTUNITY_FIELDS,
} from "../lib/opportunity/opportunityCommands.js";

const CTX = { actorUid: "user-1", nowMillis: 1_755_000_000_000 };

const current = (over = {}) => ({
  stage: "SOLUTION",
  outcome: null,
  accountId: "acct-1",
  ownerEmployeeId: "emp-1",
  salesChannel: "RETAIL",
  need: "walk-in cooler failing",
  expectedValue: 12_000,
  expectedCloseAt: 1_756_000_000_000,
  lines: [{ kind: "PART", ref: "PRT-1005", qty: 1 }],
  updatedAtMillis: 1_754_000_000_000,
  ...over,
});

const input = (over = {}) => ({
  opportunityId: "opp-1",
  expectedUpdatedAtMillis: 1_754_000_000_000,
  ...over,
});

const throwsCode = (fn, code) =>
  assert.throws(fn, (e) => e instanceof OpportunityCommandError && e.code === code, `expected ${code}`);

// ---------- every supported ordinary field ----------

test("every editable field can be changed, and each is reported as a before/after change", () => {
  const { patch, changes } = buildUpdateOpportunity(
    current(),
    input({
      accountId: "acct-2",
      ownerEmployeeId: "emp-2",
      salesChannel: "NATIONAL_ACCOUNTS",
      need: "replace condenser",
      expectedValue: 15_000,
      expectedCloseAt: 1_757_000_000_000,
      lines: [{ kind: "PART", ref: "PRT-2000", qty: 3 }],
    }),
    CTX,
  );
  for (const field of ["accountId", "ownerEmployeeId", "salesChannel", "need", "expectedValue", "expectedCloseAt", "lines"]) {
    assert.ok(field in patch, `${field} must be in the patch`);
    assert.ok(changes.some((c) => c.field === field), `${field} must be recorded as a change`);
  }
  const account = changes.find((c) => c.field === "accountId");
  assert.equal(account.before, "acct-1");
  assert.equal(account.after, "acct-2");
});

test("actor and timestamp are stamped from context, never from input", () => {
  const { patch } = buildUpdateOpportunity(current(), input({ need: "x" }), CTX);
  assert.equal(patch.updatedByUid, "user-1");
  assert.equal(patch.updatedAtMillis, CTX.nowMillis);
});

// ---------- lifecycle cannot move through an ordinary edit ----------

test("stage and outcome CANNOT be changed through an ordinary edit, even when sent explicitly", () => {
  const { patch } = buildUpdateOpportunity(
    current(),
    // Every shape an attacker or a confused client might try.
    { ...input({ need: "x" }), stage: "WON", outcome: "WON", closedAtMillis: 1 },
    CTX,
  );
  assert.equal("stage" in patch, false, "stage must never appear in an ordinary-edit patch");
  assert.equal("outcome" in patch, false, "outcome must never appear in an ordinary-edit patch");
  assert.equal("closedAtMillis" in patch, false);
});

test("an unknown field is ignored, not written — the persisted shape is decided here", () => {
  const { patch } = buildUpdateOpportunity(
    current(),
    { ...input({ need: "x" }), salesOrderId: "so-injected", opportunityNumber: "OPP-FAKE", createdByUid: "someone" },
    CTX,
  );
  for (const k of ["salesOrderId", "opportunityNumber", "createdByUid"]) {
    assert.equal(k in patch, false, `${k} must not be writable through an ordinary edit`);
  }
});

test("the editable-field list does not contain a lifecycle field", () => {
  for (const forbidden of ["stage", "outcome", "closedAtMillis", "salesOrderId", "opportunityNumber"]) {
    assert.equal(EDITABLE_OPPORTUNITY_FIELDS.includes(forbidden), false, `${forbidden} must not be editable`);
  }
});

// ---------- closed opportunities ----------

test("a WON or LOST Opportunity cannot be edited", () => {
  for (const outcome of ["WON", "LOST"]) {
    throwsCode(() => buildUpdateOpportunity(current({ outcome }), input({ need: "x" }), CTX), "CLOSED");
  }
});

// ---------- optimistic concurrency ----------

test("a stale expectedUpdatedAtMillis is a VERSION_CONFLICT, distinct from INVALID", () => {
  throwsCode(
    () => buildUpdateOpportunity(current(), input({ expectedUpdatedAtMillis: 1, need: "x" }), CTX),
    "VERSION_CONFLICT",
  );
});

test("a missing version is INVALID — a caller cannot opt out of the concurrency check", () => {
  const i = input({ need: "x" });
  delete i.expectedUpdatedAtMillis;
  throwsCode(() => buildUpdateOpportunity(current(), i, CTX), "INVALID");
});

test("the version check runs BEFORE field validation, so a stale caller is told the real reason", () => {
  // Both wrong: stale version AND an invalid channel. The conflict must win, or the user
  // fixes the channel, retries, and is then told about the conflict they already had.
  throwsCode(
    () => buildUpdateOpportunity(current(), input({ expectedUpdatedAtMillis: 1, salesChannel: "NOPE" }), CTX),
    "VERSION_CONFLICT",
  );
});

// ---------- reference and value validation ----------

test("empty account or owner is rejected with its own code", () => {
  throwsCode(() => buildUpdateOpportunity(current(), input({ accountId: "  " }), CTX), "ACCOUNT_REQUIRED");
  throwsCode(() => buildUpdateOpportunity(current(), input({ ownerEmployeeId: "" }), CTX), "OWNER_REQUIRED");
});

test("an unrecognized sales channel is rejected", () => {
  throwsCode(() => buildUpdateOpportunity(current(), input({ salesChannel: "MADE_UP" }), CTX), "CHANNEL_INVALID");
});

test("non-numeric expectedValue / expectedCloseAt are rejected", () => {
  throwsCode(() => buildUpdateOpportunity(current(), input({ expectedValue: "12000" }), CTX), "INVALID");
  throwsCode(() => buildUpdateOpportunity(current(), input({ expectedCloseAt: "soon" }), CTX), "INVALID");
});

test("null clears a nullable field; absent leaves it alone", () => {
  const { patch, changes } = buildUpdateOpportunity(current(), input({ expectedValue: null }), CTX);
  assert.equal(patch.expectedValue, null);
  assert.equal(changes.find((c) => c.field === "expectedValue").before, 12_000);
  // `need` was not sent, so it must not appear at all.
  assert.equal("need" in patch, false, "an absent key means leave alone, not clear");
});

// ---------- solution lines ----------

test("lines can be added, changed and removed as a whole-array replacement", () => {
  const two = buildUpdateOpportunity(
    current(),
    input({ lines: [{ kind: "PART", ref: "PRT-1005", qty: 2 }, { kind: "PART", ref: "PRT-9", qty: 1 }] }),
    CTX,
  );
  assert.equal(two.patch.lines.length, 2);
  const removed = buildUpdateOpportunity(current(), input({ lines: [] }), CTX);
  assert.deepEqual(removed.patch.lines, [], "an empty array removes every line");
});

test("a serialized-asset reference is rejected on EDIT, exactly as on create", () => {
  // The pre-commitment boundary: an Opportunity line is product-level. Editing must not be
  // a looser second door into the same array.
  for (const bad of [
    { kind: "PART", ref: "PRT-1", qty: 1, serial: "SN-1" },
    { kind: "PART", ref: "PRT-1", qty: 1, serializedAssetId: "sa-1" },
    { kind: "PART", ref: "PRT-1", qty: 1, equipmentId: "eq-1" },
  ]) {
    throwsCode(() => buildUpdateOpportunity(current(), input({ lines: [bad] }), CTX), "SERIALIZED_LINE_FORBIDDEN");
  }
});

test("invalid quantities are rejected", () => {
  for (const qty of [0, -1, 2.5, "2", null, undefined]) {
    assert.throws(
      () => buildUpdateOpportunity(current(), input({ lines: [{ kind: "PART", ref: "PRT-1", qty }] }), CTX),
      OpportunityCommandError,
      `qty=${String(qty)} must be rejected`,
    );
  }
});

test("lines must be an array", () => {
  throwsCode(() => buildUpdateOpportunity(current(), input({ lines: "PRT-1005" }), CTX), "LINE_INVALID");
});

// ---------- no-op ----------

test("sending identical values changes nothing and is reported as NO_CHANGES", () => {
  // Not silently succeeding: a write that changes nothing would still stamp updatedAtMillis,
  // bumping the version and invalidating every other open editor's optimistic token for no
  // reason.
  throwsCode(
    () => buildUpdateOpportunity(current(), input({ accountId: "acct-1", need: "walk-in cooler failing" }), CTX),
    "NO_CHANGES",
  );
});
