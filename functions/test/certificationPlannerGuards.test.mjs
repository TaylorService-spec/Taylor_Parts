// THE PLANNER'S FAIL-CLOSED GUARDS — proven against the real core, with the real usage contract.
//
// ============================ WHY THIS GATES THE RECEIPT LIFECYCLE ============================
//
// The Golden inbound-recovery scenario turns on one claim: RECEIVING CHANGES AVAILABILITY, NOT
// DEMAND. The Work Order plans twelve units before any goods arrive, and it still plans twelve
// after. Only what the warehouse can supply moves.
//
// If the lifecycle needed the plan rewritten between receipts, the scenario would be testing
// something else -- and it would collide with the planner's own removal guard, which refuses to
// un-plan a part that already has recorded usage. Proving the guard first, and then leaving the
// plan untouched, is what makes the lifecycle evidence mean anything.
//
// USAGE IS `qtyUsed` ON THE SNAPSHOT ROW. That is the shape execution capture actually writes, and
// the shape the guard actually reads. Faking usage in some other field would produce a guard that
// passes without ever being consulted -- a test of nothing, shaped like a test of something.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = path.resolve(import.meta.dirname, "../..");
const L = (p) => pathToFileURL(path.resolve(REPO, p)).href;
const { applyPartsPlan, PartsPlanError } =
  await import(L("functions/lib/workOrderPartsPlan/setWorkOrderPartsPlan.js"));

/** Part Master, as the planner sees it: found + a canonical internalPartNumber. */
const RESOLVER = (partId) => {
  const known = {
    "CW-P-0000": "CW-P-0000",
    "CW-P-0003": "CW-P-0003",
    "CW-P-0501": "CW-P-0501",
    "CW-P-NOSKU": null,           // exists, but carries no valid internalPartNumber
  };
  if (!(partId in known)) return { found: false, sku: null };
  return { found: true, sku: known[partId] };
};

/**
 * Capture the thrown error.
 *
 * `assert.throws` returns undefined -- it asserts that something threw, not WHAT. These guards
 * are only meaningful by their code: PART_NOT_FOUND and SKU_UNRESOLVED are different failures with
 * different fixes, and a test that merely proves 'it threw' would pass for either.
 */
function thrownBy(fn) {
  try { fn(); } catch (err) { return err; }
  return null;
}
const plan = (partId, qtyPlanned) => [{ partId, qtyPlanned }];

test("a plan line whose Part does not exist is refused", () => {
  // Never fabricated as sku = partId. A plan that invents identity produces demand against a part
  // no warehouse can pick.
  const err = thrownBy(() => applyPartsPlan(undefined, plan("CW-P-GHOST", 3), RESOLVER));
  assert.ok(err instanceof PartsPlanError, "expected a PartsPlanError");
  assert.equal(err.code, "PART_NOT_FOUND");
});

test("a Part with no resolvable internalPartNumber is refused", () => {
  // The subtler one: the Part record EXISTS, so a presence check would pass. Execution capture
  // matches on sku, so a row with no sku is demand that can never be reconciled against usage.
  const err = thrownBy(() => applyPartsPlan(undefined, plan("CW-P-NOSKU", 2), RESOLVER));
  assert.ok(err instanceof PartsPlanError, "expected a PartsPlanError");
  assert.equal(err.code, "SKU_UNRESOLVED");
});

test("REMOVAL GUARD: a planned Part with recorded usage cannot be un-planned", () => {
  // The guard the Golden lifecycle must never need to defeat.
  const afterFirstPlan = applyPartsPlan(undefined, plan("CW-P-0000", 12), RESOLVER);
  assert.equal(afterFirstPlan.length, 1);

  // Usage as execution capture records it: qtyUsed on the snapshot row.
  const withUsage = afterFirstPlan.map((row) => ({ ...row, qtyUsed: 4 }));

  // A later plan that drops the used part entirely.
  const err = thrownBy(() => applyPartsPlan(withUsage, plan("CW-P-0501", 1), RESOLVER));
  assert.ok(err instanceof PartsPlanError, "removing a used line must throw a PartsPlanError");
  assert.equal(err.code, "USED_PART_REMOVAL");
});

test("a planned Part with NO recorded usage may still be removed", () => {
  // The guard protects history, not the plan. Demand that never became consumption is still a
  // plan, and a plan is allowed to change.
  const planned = applyPartsPlan(undefined, plan("CW-P-0000", 12), RESOLVER);
  const replaced = applyPartsPlan(planned, plan("CW-P-0501", 1), RESOLVER);
  assert.deepEqual(replaced.map((r) => r.partId), ["CW-P-0501"]);
});

test("re-planning the SAME part with usage is permitted -- only removal is guarded", () => {
  // This is what the receipt lifecycle must be able to do if it ever touches the plan at all:
  // change a quantity, never drop a used line.
  const planned = applyPartsPlan(undefined, plan("CW-P-0000", 12), RESOLVER);
  const used = planned.map((row) => ({ ...row, qtyUsed: 4 }));
  const repeated = applyPartsPlan(used, plan("CW-P-0000", 16), RESOLVER);
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].partId, "CW-P-0000");
  assert.equal(repeated[0].qtyUsed, 4, "recorded usage must survive a re-plan");
});

test("the snapshot carries BOTH partId and sku, and sku is never the partId by fabrication", () => {
  // Execution capture matches on sku; the projection matches on partId. A row missing either is
  // demand one half of the system cannot see.
  const [row] = applyPartsPlan(undefined, plan("CW-P-0003", 15), RESOLVER);
  assert.equal(row.partId, "CW-P-0003");
  assert.equal(row.sku, "CW-P-0003", "sku comes from internalPartNumber, which happens to match here");
  assert.equal(row.qtyPlanned, 15);
});

test("MUTATION: usage recorded in the WRONG field does not trigger the guard", () => {
  // Proves the guard reads `qtyUsed` specifically -- and that a test faking usage elsewhere would
  // pass while asserting nothing. This is the shape of a guard that never fires.
  const planned = applyPartsPlan(undefined, plan("CW-P-0000", 12), RESOLVER);
  const wrongField = planned.map((row) => ({ ...row, usedQuantity: 4 }));   // not the contract
  const removed = applyPartsPlan(wrongField, plan("CW-P-0501", 1), RESOLVER);
  assert.deepEqual(removed.map((r) => r.partId), ["CW-P-0501"],
    "usage in a field the planner does not read cannot protect the line -- qtyUsed is the contract");
});
