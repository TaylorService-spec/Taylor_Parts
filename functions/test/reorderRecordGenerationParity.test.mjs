// REORDER — the record-shape contracts the retired Rules used to hold.
//
// functions/test/reorderRequestsRules.test.js proved these against `firestore.rules`, where the
// client wrote the record directly and an `affectedKeys().hasOnly(...)` allowlist plus an explicit
// unchanged-fields diff was the only thing standing between a lifecycle transition and a
// general-purpose write on a record in flight.
//
// The client-direct write is retired, so those assertions are now denials. The CONTRACTS they
// carried are not retired, and this file is where they moved BEFORE the Rules proofs were flipped:
//
//   1. EXACT ADDED KEYS. A transition adds precisely the fields it owns and nothing else. The
//      builders return a PATCH rather than a document, which makes that structural -- but
//      structural is not proven, and the day somebody spreads `...record` into a return value the
//      only thing that notices should be a test.
//
//   2. RECORD-GENERATION PARITY. Two generations of reorder request exist: LEGACY records with no
//      warehouseId / operatingCompanyId, and current ones that carry both. Every transition must
//      work identically on either, and must never emit those keys -- a transition that quietly
//      added a warehouse to a legacy record would be inventing business data mid-lifecycle, and one
//      that required a warehouse would strand every legacy record permanently.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssign,
  buildMarkReceived,
  buildPurchasingProgress,
  buildStartPurchasing,
} from "../lib/reorderRequest/reorderTransitionCommands.js";
import { buildCancelReorderRequest } from "../lib/reorderRequest/reorderCommands.js";

const ACTOR = "uid-actor";
const ASSIGNEE = "uid-assignee";
const NOW = 1_700_000_000_000;

/** The two generations, identical except for the warehouse keys. */
const legacy = (over = {}) => ({ id: "req-1", partId: "PART-1", ...over });
const current = (over = {}) => ({
  id: "req-1",
  partId: "PART-1",
  warehouseId: "wh-1",
  operatingCompanyId: "oc-1",
  ...over,
});

const GENERATIONS = [
  ["legacy (no warehouse keys)", legacy],
  ["current generation (warehouse + operating company)", current],
];

// ============================ exact added keys ============================

test("assign adds exactly the assignment fields, on either generation", () => {
  for (const [label, make] of GENERATIONS) {
    const patch = buildAssign(make({ status: "READY_FOR_PARTS_MANAGER" }), {
      actorUid: ACTOR,
      nowMillis: NOW,
      assignedToUserId: ASSIGNEE,
    });
    assert.deepEqual(
      Object.keys(patch).sort(),
      ["assignedAt", "assignedBy", "assignedToUserId", "currentOwner", "status"],
      label,
    );
  }
});

test("start purchasing adds exactly three fields, on either generation", () => {
  for (const [label, make] of GENERATIONS) {
    const patch = buildStartPurchasing(
      make({ status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedToUserId: ACTOR }),
      { actorUid: ACTOR, nowMillis: NOW },
    );
    assert.deepEqual(
      Object.keys(patch).sort(),
      ["purchasingStartedAt", "purchasingStartedBy", "status"],
      label,
    );
  }
});

test("a purchasing update writes ONLY its closed editable set, on either generation", () => {
  // The retired rule's hasOnly() allowlist. This is the transition most at risk of becoming a
  // general-purpose write, because it is the one that runs repeatedly on a record in flight.
  for (const [label, make] of GENERATIONS) {
    const patch = buildPurchasingProgress(
      make({ status: "PURCHASING_IN_PROGRESS", assignedToUserId: ACTOR }),
      { actorUid: ACTOR, nowMillis: NOW, purchasingNotes: "called the vendor", vendorContacted: true },
    );
    assert.deepEqual(
      Object.keys(patch).sort(),
      [
        "expectedAvailabilityDate",
        "lastPurchasingUpdateAt",
        "lastPurchasingUpdateBy",
        "purchasingNotes",
        "vendorContacted",
      ],
      label,
    );
  }
});

test("a cancel adds exactly status + the three cancellation fields, and nothing else", () => {
  // The Rules assertion this replaces spelled it out: the post-transition key set equals the
  // pre-transition key set plus exactly cancelledBy / cancelledAt / cancellationReason, with the
  // void trio still genuinely absent.
  for (const [label, make] of GENERATIONS) {
    const { requestPatch } = buildCancelReorderRequest(
      { reorderRequestId: "req-1", reason: "  no longer needed  " },
      make({ status: "READY_FOR_PARTS_MANAGER" }),
      { actorUid: ACTOR, nowMillis: NOW },
    );
    assert.deepEqual(
      Object.keys(requestPatch).sort(),
      ["cancellationReason", "cancelledAt", "cancelledBy", "status"],
      label,
    );
    for (const voidKey of ["voidedBy", "voidedAt", "voidReason"]) {
      assert.ok(!(voidKey in requestPatch), `${label}: a cancel must not touch ${voidKey}`);
    }
    assert.equal(requestPatch.cancellationReason, "no longer needed", "the reason is trimmed");
    assert.equal(requestPatch.cancelledBy, ACTOR, "the actor is resolved, never supplied");
  }
});

test("mark received adds exactly the receipt fields, on either generation", () => {
  for (const [label, make] of GENERATIONS) {
    const patch = buildMarkReceived(make({ status: "ORDERED", assignedToUserId: ACTOR }), {
      actorUid: ACTOR,
      nowMillis: NOW,
    });
    assert.ok(patch.status === "RECEIVED", label);
    for (const key of Object.keys(patch)) {
      assert.ok(
        ["status", "receivedAt", "receivedBy", "currentOwner"].includes(key),
        `${label}: unexpected key "${key}" in the receipt patch`,
      );
    }
  }
});

// ============================ generation parity ============================

test("NO transition ever emits a warehouse or operating-company key", () => {
  // Both directions of the failure: inventing a warehouse on a legacy record, and rewriting one on
  // a current record. Neither is a lifecycle transition's business.
  const patches = [];
  for (const make of [legacy, current]) {
    patches.push(
      buildAssign(make({ status: "READY_FOR_PARTS_MANAGER" }), { actorUid: ACTOR, nowMillis: NOW, assignedToUserId: ASSIGNEE }),
      buildStartPurchasing(make({ status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedToUserId: ACTOR }), { actorUid: ACTOR, nowMillis: NOW }),
      buildPurchasingProgress(make({ status: "PURCHASING_IN_PROGRESS", assignedToUserId: ACTOR }), { actorUid: ACTOR, nowMillis: NOW }),
      buildMarkReceived(make({ status: "ORDERED", assignedToUserId: ACTOR }), { actorUid: ACTOR, nowMillis: NOW }),
      buildCancelReorderRequest({ reorderRequestId: "req-1", reason: "x" }, make({ status: "READY_FOR_PARTS_MANAGER" }), { actorUid: ACTOR, nowMillis: NOW }).requestPatch,
    );
  }
  for (const patch of patches) {
    assert.ok(!("warehouseId" in patch), "a transition must not write warehouseId");
    assert.ok(!("operatingCompanyId" in patch), "a transition must not write operatingCompanyId");
  }
});

test("a legacy record and a current one produce the SAME patch for the same transition", () => {
  // Byte-for-byte, because the only difference between the two inputs is data the transition has no
  // business reading. If a patch ever differed by generation, some transition would be branching on
  // the warehouse keys.
  const pairs = [
    [
      buildAssign(legacy({ status: "READY_FOR_PARTS_MANAGER" }), { actorUid: ACTOR, nowMillis: NOW, assignedToUserId: ASSIGNEE }),
      buildAssign(current({ status: "READY_FOR_PARTS_MANAGER" }), { actorUid: ACTOR, nowMillis: NOW, assignedToUserId: ASSIGNEE }),
    ],
    [
      buildStartPurchasing(legacy({ status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedToUserId: ACTOR }), { actorUid: ACTOR, nowMillis: NOW }),
      buildStartPurchasing(current({ status: "ASSIGNED_TO_PARTS_ASSOCIATE", assignedToUserId: ACTOR }), { actorUid: ACTOR, nowMillis: NOW }),
    ],
    [
      buildPurchasingProgress(legacy({ status: "PURCHASING_IN_PROGRESS", assignedToUserId: ACTOR }), { actorUid: ACTOR, nowMillis: NOW }),
      buildPurchasingProgress(current({ status: "PURCHASING_IN_PROGRESS", assignedToUserId: ACTOR }), { actorUid: ACTOR, nowMillis: NOW }),
    ],
    [
      buildMarkReceived(legacy({ status: "ORDERED", assignedToUserId: ACTOR }), { actorUid: ACTOR, nowMillis: NOW }),
      buildMarkReceived(current({ status: "ORDERED", assignedToUserId: ACTOR }), { actorUid: ACTOR, nowMillis: NOW }),
    ],
  ];
  for (const [a, b] of pairs) assert.deepEqual(a, b);
});

test("the ASSIGNEE scope survives on every transition that had it", () => {
  // `isAdminOrDispatcher() AND assignedToUserId == request.auth.uid` -- the record scope the retired
  // rule enforced on the in-flight transitions. Holding the capability is not enough; being the
  // assignee is the other half, and it is checked against the STORED record.
  const notTheAssignee = { actorUid: "uid-somebody-else", nowMillis: NOW };
  for (const [label, build, status] of [
    ["startPurchasing", buildStartPurchasing, "ASSIGNED_TO_PARTS_ASSOCIATE"],
    ["postUpdate", buildPurchasingProgress, "PURCHASING_IN_PROGRESS"],
    ["markReceived", buildMarkReceived, "ORDERED"],
  ]) {
    assert.throws(
      () => build(current({ status, assignedToUserId: ASSIGNEE }), notTheAssignee),
      /assign/i,
      `${label} must refuse a caller who is not the assignee`,
    );
  }
});
