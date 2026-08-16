// CRM Activity / Notes — OFFLINE tests for the PURE write core (buildCreateCrmActivity). No emulator/
// Firebase/network. Mirrors salesOrderCommands.test.mjs's own conventions.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateCrmActivity,
  CrmActivityCommandError,
  CRM_ACTIVITY_TYPES,
  MAX_BODY_LENGTH,
  OCCURRED_AT_FUTURE_TOLERANCE_MILLIS,
} from "../lib/crmActivity/crmActivityCommands.js";

const CTX = { actorUid: "actor-1", nowMillis: 1_700_000_000_000 };
const baseInput = (over = {}) => ({
  accountId: "ACCT-1",
  type: "SALES_NOTE",
  body: "Talked pricing on the new order.",
  ...over,
});

test("buildCreateCrmActivity builds a complete record for a minimal valid input", () => {
  const built = buildCreateCrmActivity(baseInput(), CTX);
  assert.deepEqual(built, {
    accountId: "ACCT-1",
    contactId: null,
    opportunityId: null,
    salesOrderId: null,
    type: "SALES_NOTE",
    body: "Talked pricing on the new order.",
    occurredAtMillis: CTX.nowMillis,
    createdByUid: "actor-1",
    createdAtMillis: CTX.nowMillis,
  });
});

test("buildCreateCrmActivity trims accountId/body and optional refs", () => {
  const built = buildCreateCrmActivity(
    baseInput({ accountId: "  ACCT-2  ", body: "  hello  ", contactId: " C-1 ", opportunityId: " O-1 ", salesOrderId: " SO-1 " }),
    CTX,
  );
  assert.equal(built.accountId, "ACCT-2");
  assert.equal(built.body, "hello");
  assert.equal(built.contactId, "C-1");
  assert.equal(built.opportunityId, "O-1");
  assert.equal(built.salesOrderId, "SO-1");
});

test("buildCreateCrmActivity accepts every governed activity type", () => {
  for (const type of CRM_ACTIVITY_TYPES) {
    const built = buildCreateCrmActivity(baseInput({ type }), CTX);
    assert.equal(built.type, type);
  }
});

test("buildCreateCrmActivity rejects a missing/empty accountId", () => {
  assert.throws(() => buildCreateCrmActivity(baseInput({ accountId: "" }), CTX), (err) => {
    assert.ok(err instanceof CrmActivityCommandError);
    assert.equal(err.code, "ACCOUNT_REQUIRED");
    return true;
  });
  assert.throws(() => buildCreateCrmActivity(baseInput({ accountId: undefined }), CTX), CrmActivityCommandError);
});

test("buildCreateCrmActivity rejects an invalid/unrecognized type -- never guesses one", () => {
  assert.throws(() => buildCreateCrmActivity(baseInput({ type: "FOLLOW_UP" }), CTX), (err) => {
    assert.ok(err instanceof CrmActivityCommandError);
    assert.equal(err.code, "TYPE_INVALID");
    return true;
  });
  assert.throws(() => buildCreateCrmActivity(baseInput({ type: "TASK" }), CTX), CrmActivityCommandError);
});

test("buildCreateCrmActivity rejects a missing/empty body", () => {
  assert.throws(() => buildCreateCrmActivity(baseInput({ body: "" }), CTX), (err) => {
    assert.ok(err instanceof CrmActivityCommandError);
    assert.equal(err.code, "BODY_REQUIRED");
    return true;
  });
  assert.throws(() => buildCreateCrmActivity(baseInput({ body: "   " }), CTX), CrmActivityCommandError);
});

test("buildCreateCrmActivity rejects a body over MAX_BODY_LENGTH", () => {
  assert.throws(() => buildCreateCrmActivity(baseInput({ body: "x".repeat(MAX_BODY_LENGTH + 1) }), CTX), (err) => {
    assert.ok(err instanceof CrmActivityCommandError);
    assert.equal(err.code, "BODY_TOO_LONG");
    return true;
  });
});

test("buildCreateCrmActivity accepts a body at exactly MAX_BODY_LENGTH", () => {
  const built = buildCreateCrmActivity(baseInput({ body: "x".repeat(MAX_BODY_LENGTH) }), CTX);
  assert.equal(built.body.length, MAX_BODY_LENGTH);
});

test("buildCreateCrmActivity defaults occurredAtMillis to nowMillis when omitted", () => {
  const built = buildCreateCrmActivity(baseInput(), CTX);
  assert.equal(built.occurredAtMillis, CTX.nowMillis);
});

test("buildCreateCrmActivity accepts a caller-supplied BACKDATED occurredAtMillis, preserved distinct from createdAtMillis", () => {
  const past = CTX.nowMillis - 1000 * 60 * 60 * 24 * 3; // 3 days ago
  const built = buildCreateCrmActivity(baseInput({ occurredAtMillis: past }), CTX);
  assert.equal(built.occurredAtMillis, past);
  assert.equal(built.createdAtMillis, CTX.nowMillis);
  assert.notEqual(built.occurredAtMillis, built.createdAtMillis);
});

test("buildCreateCrmActivity accepts occurredAtMillis within the clock-skew tolerance", () => {
  const withinTolerance = CTX.nowMillis + OCCURRED_AT_FUTURE_TOLERANCE_MILLIS - 1;
  const built = buildCreateCrmActivity(baseInput({ occurredAtMillis: withinTolerance }), CTX);
  assert.equal(built.occurredAtMillis, withinTolerance);
});

test("buildCreateCrmActivity rejects occurredAtMillis materially in the future", () => {
  const future = CTX.nowMillis + OCCURRED_AT_FUTURE_TOLERANCE_MILLIS + 1000 * 60 * 60; // well past tolerance
  assert.throws(() => buildCreateCrmActivity(baseInput({ occurredAtMillis: future }), CTX), (err) => {
    assert.ok(err instanceof CrmActivityCommandError);
    assert.equal(err.code, "OCCURRED_AT_FUTURE");
    return true;
  });
});

test("buildCreateCrmActivity rejects a non-finite occurredAtMillis", () => {
  assert.throws(() => buildCreateCrmActivity(baseInput({ occurredAtMillis: NaN }), CTX), (err) => {
    assert.ok(err instanceof CrmActivityCommandError);
    assert.equal(err.code, "OCCURRED_AT_INVALID");
    return true;
  });
  assert.throws(() => buildCreateCrmActivity(baseInput({ occurredAtMillis: "yesterday" }), CTX), CrmActivityCommandError);
});

test("buildCreateCrmActivity treats omitted optional refs as null, not empty string", () => {
  const built = buildCreateCrmActivity(baseInput({ contactId: "", opportunityId: undefined, salesOrderId: "   " }), CTX);
  assert.equal(built.contactId, null);
  assert.equal(built.opportunityId, null);
  assert.equal(built.salesOrderId, null);
});

// PART 1.5 SEAM: this record structurally cannot carry assignee/due-date/completion/status-workflow
// fields -- proven here by asserting the built object's own key set never grows to include them, even
// when an over-eager caller tries to smuggle one in via the input.
test("buildCreateCrmActivity NEVER carries an assignee/due date/completion/status field -- the PART 1.5 seam", () => {
  const built = buildCreateCrmActivity(
    baseInput({ assigneeUid: "someone", dueDate: 123, status: "OPEN", completedAt: 456, followUpAt: 789 }),
    CTX,
  );
  const keys = Object.keys(built).sort();
  assert.deepEqual(keys, [
    "accountId", "body", "contactId", "createdAtMillis", "createdByUid",
    "occurredAtMillis", "opportunityId", "salesOrderId", "type",
  ].sort());
  for (const forbidden of ["assigneeUid", "dueDate", "status", "completedAt", "followUpAt", "assignee", "dueAt"]) {
    assert.equal(forbidden in built, false, `built record must never carry "${forbidden}"`);
  }
});

test("buildCreateCrmActivity rejects missing input", () => {
  assert.throws(() => buildCreateCrmActivity(undefined, CTX), CrmActivityCommandError);
  assert.throws(() => buildCreateCrmActivity(null, CTX), CrmActivityCommandError);
});
