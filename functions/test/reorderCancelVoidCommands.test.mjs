// The two Class C reorder commands — Cancel and Void — as pure decisions.
//
// These builders carry the conditions that used to live in a browser transaction and in
// firestore.rules. Tested here directly, with no emulator and no Firestore: the point of splitting
// the decision out of the callable is that it can be proven offline, and a condition nobody can
// exercise without standing up a database is a condition that stops being exercised.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCancelReorderRequest,
  buildVoidPurchaseOrder,
  CANCELLABLE_REORDER_REQUEST_STATUSES,
} from "../lib/reorderRequest/reorderCommands.js";

const CTX = { actorUid: "uid-actor", nowMillis: 1_700_000_000_000 };
const cancelInput = { reorderRequestId: "req-1", reason: "  supplier discontinued  " };

// ============================ CANCEL ============================

test("a cancel is allowed from exactly the three pre-ORDERED active statuses, and no others", () => {
  // The allowlist verbatim, so a status added to it later must be added to this list too rather
  // than inheriting permission from a loop that reads the same constant it is checking.
  assert.deepEqual([...CANCELLABLE_REORDER_REQUEST_STATUSES], [
    "READY_FOR_PARTS_MANAGER",
    "ASSIGNED_TO_PARTS_ASSOCIATE",
    "PURCHASING_IN_PROGRESS",
  ]);

  for (const status of CANCELLABLE_REORDER_REQUEST_STATUSES) {
    const { requestPatch } = buildCancelReorderRequest(cancelInput, { status }, CTX);
    assert.equal(requestPatch.status, "CANCELLED", `${status} should be cancellable`);
  }
});

test("a cancel is REFUSED from every other status, including unrecognized and missing ones", () => {
  // PENDING_REVIEW is not yet handed off; ORDERED is past the cancel window; the rest are terminal.
  // The last two cases are the ones that matter most: an allowlist that failed OPEN on an unknown
  // status would cancel records nobody meant to expose to it.
  for (const status of ["PENDING_REVIEW", "ORDERED", "RECEIVED", "CANCELLED", "VOIDED", "REJECTED", "NONSENSE", undefined]) {
    assert.throws(
      () => buildCancelReorderRequest(cancelInput, { status }, CTX),
      (e) => e.code === "REQUEST_STATE_INVALID",
      `${String(status)} must not be cancellable`,
    );
  }
});

test("a cancel records the resolved actor and the trimmed reason, never a caller-supplied identity", () => {
  const { requestPatch } = buildCancelReorderRequest(
    // A payload trying to name the actor. It is ignored because the builder reads ctx, not input --
    // there is no field it could read even if one were sent.
    { ...cancelInput, cancelledBy: "uid-someone-else" },
    { status: "PURCHASING_IN_PROGRESS" },
    CTX,
  );
  assert.equal(requestPatch.cancelledBy, "uid-actor");
  assert.equal(requestPatch.cancelledAt, CTX.nowMillis);
  assert.equal(requestPatch.cancellationReason, "supplier discontinued");
});

test("a cancel requires a genuinely non-blank reason", () => {
  for (const reason of ["", "   ", null, undefined, 42]) {
    assert.throws(
      () => buildCancelReorderRequest({ reorderRequestId: "req-1", reason }, { status: "ORDERED" }, CTX),
      (e) => e.code === "CANCEL_REASON_REQUIRED",
      `reason ${JSON.stringify(reason)} must be refused`,
    );
  }
});

test("a cancel of a request that does not exist says so, rather than inventing one", () => {
  assert.throws(
    () => buildCancelReorderRequest(cancelInput, null, CTX),
    (e) => e.code === "REQUEST_NOT_FOUND",
  );
});

// ============================ VOID ============================

const voidInput = { reorderRequestId: "req-1", reason: " wrong supplier " };
const orderedRequest = { status: "ORDERED", assignedToUserId: "uid-actor" };
const orderedPo = { status: "ORDERED", partId: "part-9" };
const voidCtx = { ...CTX, alreadyVoided: false };

test("a void writes both halves from one clock, which is the cross-document invariant", () => {
  // The retired Rules branch required reorder_requests.voidedAt to EQUAL
  // reorder_purchase_order_voids.createdAt. It holds here because the value is taken once, by the
  // caller, and written into both -- not because two Date.now() calls happened to agree.
  const { voidRecord, requestPatch } = buildVoidPurchaseOrder(voidInput, orderedRequest, orderedPo, voidCtx);
  assert.equal(voidRecord.createdAt, requestPatch.voidedAt);
  assert.equal(voidRecord.createdAt, CTX.nowMillis);
  assert.equal(requestPatch.status, "VOIDED");
  assert.equal(voidRecord.voidedBy, "uid-actor");
  assert.equal(requestPatch.voidReason, "wrong supplier");
});

test("the void names the part the PURCHASE ORDER was placed against, not one the caller supplied", () => {
  const { voidRecord } = buildVoidPurchaseOrder(
    { ...voidInput, partId: "part-attacker-chose" },
    orderedRequest,
    orderedPo,
    voidCtx,
  );
  assert.equal(voidRecord.partId, "part-9");
});

test("a void is refused unless BOTH the request and the purchase order are currently ORDERED", () => {
  assert.throws(
    () => buildVoidPurchaseOrder(voidInput, { ...orderedRequest, status: "RECEIVED" }, orderedPo, voidCtx),
    (e) => e.code === "REQUEST_STATE_INVALID",
  );
  assert.throws(
    () => buildVoidPurchaseOrder(voidInput, orderedRequest, { ...orderedPo, status: "VOIDED" }, voidCtx),
    (e) => e.code === "PO_STATE_INVALID",
  );
});

test("an already-voided purchase order reports THAT, not a vaguer state complaint", () => {
  // Checked before the ORDERED conditions on purpose: a voided pair fails those too, and reporting
  // "not currently ORDERED" would send someone looking for the wrong problem.
  assert.throws(
    () => buildVoidPurchaseOrder(voidInput, { ...orderedRequest, status: "VOIDED" }, orderedPo, { ...voidCtx, alreadyVoided: true }),
    (e) => e.code === "PO_ALREADY_VOIDED",
  );
});

test("a void distinguishes a missing request from a missing purchase order", () => {
  assert.throws(
    () => buildVoidPurchaseOrder(voidInput, null, orderedPo, voidCtx),
    (e) => e.code === "REQUEST_NOT_FOUND",
  );
  assert.throws(
    () => buildVoidPurchaseOrder(voidInput, orderedRequest, null, voidCtx),
    (e) => e.code === "PO_NOT_FOUND",
  );
});

test("the assignee scope is NOT decided here", () => {
  // Deliberate: the callable resolves it against the request document and answers permission-denied.
  // A builder whose other refusals are all about state must not also produce an authorization
  // answer, or a scope failure reaches the caller dressed as a bad payload. This proves the builder
  // accepts a request assigned to someone else -- the check lives one layer up, on purpose.
  const { requestPatch } = buildVoidPurchaseOrder(
    voidInput,
    { ...orderedRequest, assignedToUserId: "uid-someone-else" },
    orderedPo,
    voidCtx,
  );
  assert.equal(requestPatch.voidedBy, "uid-actor");
});

test("a void requires a genuinely non-blank reason", () => {
  for (const reason of ["", "   ", null, undefined]) {
    assert.throws(
      () => buildVoidPurchaseOrder({ reorderRequestId: "req-1", reason }, orderedRequest, orderedPo, voidCtx),
      (e) => e.code === "VOID_REASON_REQUIRED",
    );
  }
});
