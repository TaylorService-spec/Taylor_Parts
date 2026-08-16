// CRM Activity / Notes — OFFLINE tests for the PURE read-projection core, imported from compiled lib. No
// emulator/Firebase/network. Mirrors salesOrderReadService.test.mjs's own conventions: proves the minimal
// projection (exact field allowlist), invalid-type/missing-field handling, and the occurredAt-vs-createdAt
// distinction.
import test from "node:test";
import assert from "node:assert/strict";
import { projectCrmActivity } from "../lib/crmActivity/crmActivityReadService.js";

function fakeTimestamp(millis) {
  return { toMillis: () => millis };
}

function baseDoc(overrides = {}) {
  return {
    accountId: "ACCT-1",
    contactId: "CONTACT-1",
    opportunityId: "OPP-1",
    salesOrderId: "SO-1",
    type: "CALL",
    body: "Discussed renewal timing.",
    occurredAtMillis: 1000,
    createdAt: fakeTimestamp(2000),
    createdByUid: "uid-abc",
    ...overrides,
  };
}

test("projectCrmActivity returns only the minimal CRM-Activity-UX fields (exact allowlist)", () => {
  const p = projectCrmActivity("ACT-1", baseDoc({
    // fields that must NOT leak into the projection:
    internalRiskScore: 99,
    accountName: "Should Not Copy Co",
  }));
  assert.deepEqual(Object.keys(p).sort(), [
    "accountId", "body", "contactId", "createdAtMillis", "createdByUid",
    "id", "occurredAtMillis", "opportunityId", "salesOrderId", "type",
  ].sort());
  assert.equal("internalRiskScore" in p, false);
  assert.equal("accountName" in p, false);
});

test("projectCrmActivity projects the identity + linkage fields verbatim", () => {
  const p = projectCrmActivity("ACT-1", baseDoc());
  assert.equal(p.id, "ACT-1");
  assert.equal(p.accountId, "ACCT-1");
  assert.equal(p.contactId, "CONTACT-1");
  assert.equal(p.opportunityId, "OPP-1");
  assert.equal(p.salesOrderId, "SO-1");
  assert.equal(p.type, "CALL");
  assert.equal(p.body, "Discussed renewal timing.");
  assert.equal(p.createdByUid, "uid-abc");
});

test("projectCrmActivity keeps occurredAtMillis and createdAtMillis as two DISTINCT fields, never collapsed", () => {
  const p = projectCrmActivity("ACT-1", baseDoc({ occurredAtMillis: 1000, createdAt: fakeTimestamp(5000) }));
  assert.equal(p.occurredAtMillis, 1000);
  assert.equal(p.createdAtMillis, 5000);
  assert.notEqual(p.occurredAtMillis, p.createdAtMillis);
});

test("projectCrmActivity converts createdAt from a Firestore Timestamp via toMillis(), not a raw field", () => {
  const p = projectCrmActivity("ACT-1", baseDoc({ createdAt: fakeTimestamp(42) }));
  assert.equal(p.createdAtMillis, 42);
});

test("projectCrmActivity returns createdAtMillis: null when createdAt is missing/malformed, never fabricated", () => {
  assert.equal(projectCrmActivity("ACT-1", baseDoc({ createdAt: undefined })).createdAtMillis, null);
  assert.equal(projectCrmActivity("ACT-1", baseDoc({ createdAt: "not-a-timestamp" })).createdAtMillis, null);
});

test("projectCrmActivity returns null for an unrecognized/missing type rather than trusting it", () => {
  assert.equal(projectCrmActivity("ACT-2", baseDoc({ type: "FOLLOW_UP" })), null);
  assert.equal(projectCrmActivity("ACT-3", baseDoc({ type: undefined })), null);
  assert.equal(projectCrmActivity("ACT-4", baseDoc({ type: "TASK" })), null);
});

test("projectCrmActivity returns null when accountId is missing/empty", () => {
  assert.equal(projectCrmActivity("ACT-5", baseDoc({ accountId: undefined })), null);
  assert.equal(projectCrmActivity("ACT-6", baseDoc({ accountId: "" })), null);
});

test("projectCrmActivity returns null when body is missing", () => {
  assert.equal(projectCrmActivity("ACT-7", baseDoc({ body: undefined })), null);
});

test("projectCrmActivity returns null when occurredAtMillis is missing/non-numeric", () => {
  assert.equal(projectCrmActivity("ACT-8", baseDoc({ occurredAtMillis: undefined })), null);
  assert.equal(projectCrmActivity("ACT-9", baseDoc({ occurredAtMillis: "yesterday" })), null);
  assert.equal(projectCrmActivity("ACT-10", baseDoc({ occurredAtMillis: NaN })), null);
});

test("projectCrmActivity projects null for missing optional refs (contact/opportunity/salesOrder), never fabricated", () => {
  const p = projectCrmActivity("ACT-11", baseDoc({ contactId: undefined, opportunityId: undefined, salesOrderId: undefined }));
  assert.equal(p.contactId, null);
  assert.equal(p.opportunityId, null);
  assert.equal(p.salesOrderId, null);
});

test("projectCrmActivity fails to null on missing id or data", () => {
  assert.equal(projectCrmActivity("", baseDoc()), null);
  assert.equal(projectCrmActivity("ACT-12", undefined), null);
});

// PART 1.5 SEAM: the read projection structurally cannot expose assignee/due-date/completion/status
// fields -- even if a legacy/corrupted doc somehow carried one, the exact allowlist above already proves
// it never leaks; this test pins the same guarantee against a doc that actively tries to smuggle one in.
test("projectCrmActivity never leaks an assignee/due-date/completion/status field even if present on the raw doc", () => {
  const p = projectCrmActivity("ACT-13", baseDoc({ assigneeUid: "someone", dueDate: 123, status: "OPEN", completedAt: 456 }));
  for (const forbidden of ["assigneeUid", "dueDate", "status", "completedAt", "assignee", "dueAt"]) {
    assert.equal(forbidden in p, false, `projection must never carry "${forbidden}"`);
  }
});
