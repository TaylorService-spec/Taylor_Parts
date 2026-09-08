// The five reorder transitions — an EXECUTED parity matrix against the retired Rules predicates.
//
// For each: the positive case, the wrong status, the wrong assignee, a spoofed actor field, and a
// malformed payload. "Wrong Role" is not exercised here because it is not this layer's decision --
// the capability gate lives in the callable and is asserted by construction (one capability per
// command, named in the matrix below); what these prove is that HOLDING the capability is not
// sufficient where Rules also required a record predicate.
//
// ┌──────────────────┬─────────────────────────────────────┬──────────────────────────────┬──────────────────┐
// │ action           │ retired Rules predicate             │ capability                   │ record predicate │
// ├──────────────────┼─────────────────────────────────────┼──────────────────────────────┼──────────────────┤
// │ approve          │ isAdminOrDispatcher                 │ reorder.request.approve      │ status only      │
// │                  │ + PENDING_REVIEW -> READY_FOR_PM    │                              │                  │
// │ reject           │ isAdminOrDispatcher                 │ reorder.request.reject       │ status only      │
// │                  │ + PENDING_REVIEW -> REJECTED        │                              │ + notes required │
// │                  │ + reviewNotes non-empty             │                              │                  │
// │ assign           │ isAdminOrDispatcher OR PARTS_MANAGER│ reorder.request.assign       │ status only      │
// │                  │ + READY_FOR_PM -> ASSIGNED          │                              │ assignedBy=actor │
// │                  │ + assignedBy == request.auth.uid    │                              │                  │
// │ startPurchasing  │ (isAdminOrDispatcher OR PARTS_ASSOC)│ reorder.request              │ ASSIGNEE         │
// │                  │ + ASSIGNED -> PURCHASING            │   .startPurchasing           │                  │
// │                  │ + auth.uid == assignedToUserId      │                              │                  │
// │ postUpdate       │ (isAdminOrDispatcher OR PARTS_ASSOC)│ reorder.request              │ ASSIGNEE         │
// │                  │ + PURCHASING (unchanged)            │   .postPurchasingUpdate      │                  │
// │                  │ + auth.uid == assignedToUserId      │                              │                  │
// │ markReceived     │ (isAdminOrDispatcher OR PARTS_ASSOC)│ reorder.request.markReceived │ ASSIGNEE         │
// │                  │ + ORDERED -> RECEIVED               │                              │                  │
// │                  │ + auth.uid == assignedToUserId      │                              │                  │
// └──────────────────┴─────────────────────────────────────┴──────────────────────────────┴──────────────────┘
//
// THE ASSIGNEE CLAUSE SAT OUTSIDE THE ROLE DISJUNCTION in Rules, so it bound an ADMIN too. That is
// the single most important row here: holding the capability is necessary and not sufficient.
import test from "node:test";
import assert from "node:assert/strict";
import {
  OWNER,
  STATUS,
  buildApprove,
  buildAssign,
  buildMarkReceived,
  buildPurchasingProgress,
  buildReject,
  buildStartPurchasing,
} from "../lib/reorderRequest/reorderTransitionCommands.js";

const ACTOR = "uid-actor";
const OTHER = "uid-someone-else";
const CTX = { actorUid: ACTOR, nowMillis: 1_700_000_000_000 };

// ════════════════════ APPROVE ════════════════════

test("approve: positive case hands the request to the Parts Manager", () => {
  const patch = buildApprove({ status: STATUS.PENDING_REVIEW }, { ...CTX, notes: " looks fine " });
  assert.equal(patch.status, STATUS.READY_FOR_PARTS_MANAGER);
  assert.equal(patch.reviewDecision, STATUS.APPROVED);
  assert.equal(patch.currentOwner, OWNER.PARTS_MANAGER);
  assert.equal(patch.reviewedBy, ACTOR);
  assert.equal(patch.reviewedAt, CTX.nowMillis);
  assert.equal(patch.reviewNotes, "looks fine");
});

test("approve: wrong status is refused", () => {
  for (const status of [STATUS.READY_FOR_PARTS_MANAGER, STATUS.ORDERED, STATUS.RECEIVED, undefined]) {
    assert.throws(() => buildApprove({ status }, CTX), (e) => e.code === "STATE_INVALID", String(status));
  }
});

test("approve: a spoofed reviewedBy cannot survive", () => {
  const patch = buildApprove({ status: STATUS.PENDING_REVIEW }, { ...CTX, reviewedBy: OTHER, reviewedAt: 1 });
  assert.equal(patch.reviewedBy, ACTOR);
  assert.equal(patch.reviewedAt, CTX.nowMillis);
});

test("approve: notes are OPTIONAL -- only a rejection requires them", () => {
  assert.equal(buildApprove({ status: STATUS.PENDING_REVIEW }, CTX).reviewNotes, null);
});

// ════════════════════ REJECT ════════════════════

test("reject: positive case terminates the request and LEAVES currentOwner unchanged", () => {
  const patch = buildReject({ status: STATUS.PENDING_REVIEW, currentOwner: OWNER.INVENTORY }, { ...CTX, notes: "no budget" });
  assert.equal(patch.status, STATUS.REJECTED);
  assert.equal(patch.reviewDecision, STATUS.REJECTED);
  // The rule pinned currentOwner to its prior value on reject -- a rejected request does not change
  // hands. Setting it to PARTS_MANAGER here would hand a dead request to someone.
  assert.equal(patch.currentOwner, OWNER.INVENTORY);
});

test("reject: notes are REQUIRED", () => {
  for (const notes of [undefined, null, "", "   ", 42]) {
    assert.throws(
      () => buildReject({ status: STATUS.PENDING_REVIEW }, { ...CTX, notes }),
      (e) => e.code === "NOTES_REQUIRED",
      JSON.stringify(notes),
    );
  }
});

test("reject: wrong status is refused", () => {
  assert.throws(
    () => buildReject({ status: STATUS.ASSIGNED_TO_PARTS_ASSOCIATE }, { ...CTX, notes: "x" }),
    (e) => e.code === "STATE_INVALID",
  );
});

// ════════════════════ ASSIGN ════════════════════

test("assign: positive case, and assignedBy is the ACTOR not the payload", () => {
  const patch = buildAssign(
    { status: STATUS.READY_FOR_PARTS_MANAGER },
    { ...CTX, assignedToUserId: " uid-associate ", assignedBy: OTHER, assignedAt: 1 },
  );
  assert.equal(patch.status, STATUS.ASSIGNED_TO_PARTS_ASSOCIATE);
  assert.equal(patch.currentOwner, OWNER.PARTS_ASSOCIATE);
  assert.equal(patch.assignedToUserId, "uid-associate");
  assert.equal(patch.assignedBy, ACTOR, "the rule pinned assignedBy to request.auth.uid");
  assert.equal(patch.assignedAt, CTX.nowMillis);
});

test("assign: a missing or blank assignee is refused, and wrong status is refused", () => {
  for (const assignedToUserId of [undefined, "", "   ", 42]) {
    assert.throws(
      () => buildAssign({ status: STATUS.READY_FOR_PARTS_MANAGER }, { ...CTX, assignedToUserId }),
      (e) => e.code === "ASSIGNEE_REQUIRED",
    );
  }
  assert.throws(
    () => buildAssign({ status: STATUS.PENDING_REVIEW }, { ...CTX, assignedToUserId: "u" }),
    (e) => e.code === "STATE_INVALID",
  );
});

// ════════════════════ START PURCHASING — the assignee scope ════════════════════

test("startPurchasing: the ASSIGNEE may, and NOBODY ELSE may -- including a capability holder", () => {
  const assigned = { status: STATUS.ASSIGNED_TO_PARTS_ASSOCIATE, assignedToUserId: ACTOR };
  const patch = buildStartPurchasing(assigned, CTX);
  assert.equal(patch.status, STATUS.PURCHASING_IN_PROGRESS);
  assert.equal(patch.purchasingStartedBy, ACTOR);

  // THE ROW THAT MATTERS. In Rules this clause sat OUTSIDE the role disjunction, so it bound an
  // administrator too: holding reorder.request.startPurchasing is necessary and not sufficient.
  assert.throws(
    () => buildStartPurchasing({ ...assigned, assignedToUserId: OTHER }, CTX),
    (e) => e.code === "NOT_ASSIGNEE",
  );
  // An UNASSIGNED request is likewise not startable by anyone.
  assert.throws(
    () => buildStartPurchasing({ status: STATUS.ASSIGNED_TO_PARTS_ASSOCIATE }, CTX),
    (e) => e.code === "NOT_ASSIGNEE",
  );
});

test("startPurchasing: wrong status is refused", () => {
  assert.throws(
    () => buildStartPurchasing({ status: STATUS.PURCHASING_IN_PROGRESS, assignedToUserId: ACTOR }, CTX),
    (e) => e.code === "STATE_INVALID",
  );
});

// ════════════════════ POST PURCHASING UPDATE — assignee scope + closed field set ════════════════════

test("postUpdate: the assignee may, others may not, and the editable set is CLOSED", () => {
  const inProgress = { status: STATUS.PURCHASING_IN_PROGRESS, assignedToUserId: ACTOR };
  const patch = buildPurchasingProgress(inProgress, {
    ...CTX,
    purchasingNotes: "  called supplier  ",
    vendorContacted: "yes",
    expectedAvailabilityDate: "2026-10-01",
    // None of these may reach the document: the rule's hasOnly() allowlist is what kept this from
    // being a general-purpose write on a record in flight.
    status: STATUS.RECEIVED,
    assignedToUserId: OTHER,
    lastPurchasingUpdateBy: OTHER,
  });
  assert.deepEqual(Object.keys(patch).sort(), [
    "expectedAvailabilityDate",
    "lastPurchasingUpdateAt",
    "lastPurchasingUpdateBy",
    "purchasingNotes",
    "vendorContacted",
  ]);
  assert.equal(patch.purchasingNotes, "called supplier");
  assert.equal(patch.vendorContacted, true);
  assert.equal(patch.lastPurchasingUpdateBy, ACTOR);
  assert.equal(patch.lastPurchasingUpdateAt, CTX.nowMillis);

  assert.throws(
    () => buildPurchasingProgress({ ...inProgress, assignedToUserId: OTHER }, CTX),
    (e) => e.code === "NOT_ASSIGNEE",
  );
});

test("postUpdate: blank notes become null, and the status must ALREADY be PURCHASING_IN_PROGRESS", () => {
  const inProgress = { status: STATUS.PURCHASING_IN_PROGRESS, assignedToUserId: ACTOR };
  assert.equal(buildPurchasingProgress(inProgress, { ...CTX, purchasingNotes: "   " }).purchasingNotes, null);
  assert.throws(
    () => buildPurchasingProgress({ status: STATUS.ORDERED, assignedToUserId: ACTOR }, CTX),
    (e) => e.code === "STATE_INVALID",
  );
});

// ════════════════════ MARK RECEIVED — assignee scope, and ORDERED not PURCHASING ════════════════════

test("markReceived: ORDERED -> RECEIVED, assignee only, server-derived receivedBy/receivedAt", () => {
  const ordered = { status: STATUS.ORDERED, assignedToUserId: ACTOR };
  const patch = buildMarkReceived(ordered, { ...CTX, receivedBy: OTHER, receivedAt: 1 });
  assert.deepEqual(Object.keys(patch).sort(), ["receivedAt", "receivedBy", "status"]);
  assert.equal(patch.status, STATUS.RECEIVED);
  assert.equal(patch.receivedBy, ACTOR);
  assert.equal(patch.receivedAt, CTX.nowMillis);

  assert.throws(
    () => buildMarkReceived({ ...ordered, assignedToUserId: OTHER }, CTX),
    (e) => e.code === "NOT_ASSIGNEE",
  );
});

test("markReceived: a request that was never ORDERED cannot be received", () => {
  // The prerequisite that carries the linked-PO semantics: a request becomes ORDERED only when a
  // purchase order is recorded against it, so this check is what stops something never ordered from
  // being marked received -- not anything downstream.
  for (const status of [STATUS.PURCHASING_IN_PROGRESS, STATUS.ASSIGNED_TO_PARTS_ASSOCIATE, STATUS.RECEIVED]) {
    assert.throws(
      () => buildMarkReceived({ status, assignedToUserId: ACTOR }, CTX),
      (e) => e.code === "STATE_INVALID",
      status,
    );
  }
});

// ════════════════════ MALFORMED AND MISSING ════════════════════

test("every transition refuses a record that does not exist, rather than creating one", () => {
  const builders = [
    () => buildApprove(null, CTX),
    () => buildReject(null, { ...CTX, notes: "x" }),
    () => buildAssign(null, { ...CTX, assignedToUserId: "u" }),
    () => buildStartPurchasing(null, CTX),
    () => buildPurchasingProgress(null, CTX),
    () => buildMarkReceived(null, CTX),
  ];
  for (const build of builders) {
    assert.throws(build, (e) => e.code === "NOT_FOUND");
  }
});

test("no transition returns a patch containing a status the caller supplied", () => {
  // A generic patch endpoint is the largest widening available here, so this pins that none of the
  // six will echo a caller's `status` back into the document.
  const hostile = { ...CTX, status: "ANYTHING_I_LIKE", notes: "x", assignedToUserId: "u" };
  const cases = [
    buildApprove({ status: STATUS.PENDING_REVIEW }, hostile),
    buildReject({ status: STATUS.PENDING_REVIEW, currentOwner: OWNER.INVENTORY }, hostile),
    buildAssign({ status: STATUS.READY_FOR_PARTS_MANAGER }, hostile),
    buildStartPurchasing({ status: STATUS.ASSIGNED_TO_PARTS_ASSOCIATE, assignedToUserId: ACTOR }, hostile),
    buildMarkReceived({ status: STATUS.ORDERED, assignedToUserId: ACTOR }, hostile),
  ];
  for (const patch of cases) {
    assert.notEqual(patch.status, "ANYTHING_I_LIKE");
  }
});
