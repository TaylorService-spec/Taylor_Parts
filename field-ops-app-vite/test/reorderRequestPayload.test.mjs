// Reorder request payload (WO Parts Planning Phase 3) -- OFFLINE tests for the pure create-payload builder.
// Proves: a WO-derived request carries workOrderId; a non-WO request OMITS it entirely (byte-for-byte
// unchanged shape, Rules-valid absent); the existing procurement fields are unchanged; NO parallel
// procurement object/field is introduced beyond the single additive back-link.
import assert from "node:assert/strict";
import { buildReorderRequestFields } from "../src/domain/reorderRequestPayload.js";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  ok - ${name}`); }
console.log("reorderRequestPayload.test.mjs");

// The 34 canonical domain fields (the store injects the 35th, createdAt).
const CANONICAL_KEYS = [
  "partId", "recommendationStatus", "urgency", "quantitySource", "recommendedQty", "requestedQty",
  "status", "currentOwner", "requestedBy",
  "reviewedBy", "reviewedAt", "reviewDecision", "reviewNotes",
  "assignedToUserId", "assignedBy", "assignedAt",
  "purchasingStartedAt", "purchasingStartedBy",
  "purchasingNotes", "vendorContacted", "expectedAvailabilityDate",
  "lastPurchasingUpdateAt", "lastPurchasingUpdateBy",
  "purchaseOrderId", "orderedBy", "orderedAt", "receivedBy", "receivedAt",
  "cancelledBy", "cancelledAt", "cancellationReason", "voidedBy", "voidedAt", "voidReason",
];

const READY = {
  partId: "P-1", recommendationStatus: "READY", urgency: "HIGH", quantitySource: "ANALYTICS",
  recommendedQty: 5, requestedQty: 5, requestedByUid: "uid-1",
};

check("non-WO request: OMITS workOrderId entirely (exactly the 34 canonical keys, no parallel field)", () => {
  const p = buildReorderRequestFields(READY);
  assert.deepEqual(Object.keys(p).sort(), [...CANONICAL_KEYS].sort());
  assert.equal("workOrderId" in p, false); // absent, not null -- the existing shape is byte-for-byte unchanged
});

check("WO-derived request: carries workOrderId (the 34 canonical keys + exactly one additive back-link)", () => {
  const p = buildReorderRequestFields({ ...READY, workOrderId: "WO-2026-000042" });
  assert.deepEqual(Object.keys(p).sort(), [...CANONICAL_KEYS, "workOrderId"].sort());
  assert.equal(p.workOrderId, "WO-2026-000042");
});

check("workOrderId omitted for null/undefined (only a real provenance id is written)", () => {
  assert.equal("workOrderId" in buildReorderRequestFields({ ...READY, workOrderId: null }), false);
  assert.equal("workOrderId" in buildReorderRequestFields({ ...READY, workOrderId: undefined }), false);
});

check("existing procurement/creation fields are unchanged (baseline nulls + status/owner)", () => {
  const p = buildReorderRequestFields({ ...READY, workOrderId: "WO-1" });
  assert.equal(p.status, "PENDING_REVIEW");
  assert.equal(p.currentOwner, "INVENTORY");
  assert.equal(p.requestedBy, "uid-1");
  // every workflow/lifecycle field is still null at creation (provenance back-link changes none of them)
  for (const k of ["reviewedBy", "assignedToUserId", "purchasingStartedAt", "purchaseOrderId", "orderedBy", "receivedBy", "cancelledBy", "voidedBy", "voidReason"]) {
    assert.equal(p[k], null, `${k} must be null at creation`);
  }
  // recommendation fields pass through verbatim
  assert.equal(p.recommendationStatus, "READY");
  assert.equal(p.requestedQty, 5);
});

check("requestedBy falls back to null when no uid (unchanged behavior)", () => {
  const p = buildReorderRequestFields({ ...READY, requestedByUid: undefined });
  assert.equal(p.requestedBy, null);
});

console.log(`\n${passed} passed, 0 failed`);
