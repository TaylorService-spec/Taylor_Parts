// Pure unit tests for the updateWorkOrderExecutionData idempotency + merge helpers. Firebase-free, so they
// run locally with `node --experimental-strip-types --test` (no emulator, no firebase-admin). The full
// transactional replay-guard (retry -> no double-count / one log entry) is proven by the sibling emulator
// integration test that runs in CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { executionDataAuditId, mergeQtyUsed } from "../src/workOrderExecutionMath.ts";

test("executionDataAuditId is deterministic and namespaced (same inputs -> same marker id)", () => {
  const a = executionDataAuditId("uid-1", "WO-1", "key-abc");
  const b = executionDataAuditId("uid-1", "WO-1", "key-abc");
  assert.equal(a, b, "same (actor, workOrder, key) must collide -> that collision IS the replay guard");
  assert.match(a, /^updateWorkOrderExecutionData_[0-9a-f]{40}$/);
});

test("executionDataAuditId separates distinct keys / work orders / actors", () => {
  const base = executionDataAuditId("uid-1", "WO-1", "key-abc");
  assert.notEqual(base, executionDataAuditId("uid-1", "WO-1", "key-xyz"), "different key -> different marker");
  assert.notEqual(base, executionDataAuditId("uid-1", "WO-2", "key-abc"), "different WO -> different marker");
  assert.notEqual(base, executionDataAuditId("uid-2", "WO-1", "key-abc"), "different actor -> different marker");
});

test("mergeQtyUsed applies an additive delta once, floors at 0, and never mutates the input", () => {
  const snap = [{ sku: "A", qtyUsed: 2 }, { sku: "B", qtyUsed: 0 }];
  const r = mergeQtyUsed(snap, [{ sku: "A", delta: 3 }]);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot[0].qtyUsed, 5);
  assert.equal(snap[0].qtyUsed, 2, "input array/object must be untouched");
  const floored = mergeQtyUsed([{ sku: "A", qtyUsed: 1 }], [{ sku: "A", delta: -5 }]);
  assert.equal(floored.ok && floored.snapshot[0].qtyUsed, 0, "never goes negative");
});

test("mergeQtyUsed surfaces an unknown sku instead of throwing", () => {
  const r = mergeQtyUsed([{ sku: "A", qtyUsed: 0 }], [{ sku: "NOPE", delta: 1 }]);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.unknownSku, "NOPE");
});

test("mergeQtyUsed ignores a non-finite delta (NaN) instead of poisoning qtyUsed", () => {
  const r = mergeQtyUsed([{ sku: "A", qtyUsed: 2 }], [{ sku: "A", delta: NaN }]);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot[0].qtyUsed, 2, "non-finite delta must not change qtyUsed (defense in depth vs assertValidInput)");
});

test("mergeQtyUsed ignores a non-finite delta (Infinity) instead of poisoning qtyUsed", () => {
  const r = mergeQtyUsed([{ sku: "A", qtyUsed: 2 }], [{ sku: "A", delta: Infinity }]);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot[0].qtyUsed, 2, "non-finite delta must not change qtyUsed");

  const r2 = mergeQtyUsed([{ sku: "A", qtyUsed: 2 }], [{ sku: "A", delta: -Infinity }]);
  assert.equal(r2.ok, true);
  assert.equal(r2.snapshot[0].qtyUsed, 2, "negative-infinity delta must not change qtyUsed");
});

test("mergeQtyUsed caps qtyUsed at the item's qtyPlanned instead of going unbounded", () => {
  const r = mergeQtyUsed([{ sku: "A", qtyUsed: 8, qtyPlanned: 10 }], [{ sku: "A", delta: 1000 }]);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot[0].qtyUsed, 10, "qtyUsed must clamp at qtyPlanned, never exceed it");
});

test("mergeQtyUsed with no qtyPlanned on the item still floors at 0 but has no upper cap", () => {
  const r = mergeQtyUsed([{ sku: "A", qtyUsed: 2 }], [{ sku: "A", delta: 1000 }]);
  assert.equal(r.ok, true);
  assert.equal(r.snapshot[0].qtyUsed, 1002, "no qtyPlanned known -> unbounded above (unchanged legacy behavior), still floored below at 0");
});

test("THE INVARIANT the replay guard protects: merge is additive, so applying the same delta twice DOUBLE-COUNTS", () => {
  // This is exactly why an idempotency key is required: without the transactional replay guard, a retried
  // call re-runs mergeQtyUsed and the additive delta is applied again.
  const once = mergeQtyUsed([{ sku: "A", qtyUsed: 0 }], [{ sku: "A", delta: 1 }]);
  const twice = mergeQtyUsed(once.ok ? once.snapshot : [], [{ sku: "A", delta: 1 }]);
  assert.equal(twice.ok && twice.snapshot[0].qtyUsed, 2, "two applications = 2 (the bug a stable key + replay guard prevents)");
});
