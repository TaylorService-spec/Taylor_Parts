// TECHNICIAN INVENTORY — what a technician can already reach, and what has no command. PURE.
// Run: node --test test/technicianInventory.test.mjs
//
// Phase P asked for: accept/load truck stock, issue to a Work Order, consume/install, return unused
// stock, serialized install/remove/RMA, truck count.
//
// Reconciliation found that MOST of that is already reachable, because eligibility is derived from
// CAPABILITIES rather than from role names — a technician who holds the transfer or cycle-count
// capability sees those workflows through the same shared Scan workspace as a warehouse operator.
// These tests prove that, so "the technician journey" is a verified property rather than an
// assumption. What genuinely has no command is recorded at the bottom.
import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveScanWorkflows, SCAN_WORKFLOW,
  TRANSFER_DISPATCH_CAPABILITY, TRANSFER_RECEIVE_CAPABILITY,
  CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY,
} from "../src/access/scanWorkflows.js";

const gate = (...held) => (id) => held.includes(id);
const has = (r, w) => r.available.some((a) => a.workflow === w);

/** A technician with a truck, assigned work, and the capabilities in question. */
const technician = (...capabilities) => deriveScanWorkflows({
  hasCapability: gate(...capabilities),
  role: "technician",
  technicianId: "T-1",
  assignedWorkOrderCount: 2,
});

// ─────────────────────────────────────────── what a technician already reaches

test("a technician ALWAYS reaches their own work-order scanner", () => {
  assert.equal(has(technician(), SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER), true);
});

test("a technician always reaches LOOKUP — knowing what a part is needs no grant", () => {
  assert.equal(has(technician(), SCAN_WORKFLOW.LOOKUP), true);
});

test("ACCEPTING a truck handoff is the transfer RECEIVE capability, not a role", () => {
  // Phase O: a handoff is a transfer whose destination is the truck. The technician accepting it
  // needs the same capability anyone receiving a transfer needs.
  const r = technician(TRANSFER_RECEIVE_CAPABILITY);
  assert.equal(has(r, SCAN_WORKFLOW.TRANSFER), true);
});

test("RETURNING unused stock to the warehouse is the same transfer workflow, dispatched", () => {
  // Truck -> warehouse is a transfer with a MOBILE origin. No separate "return to stock" journey
  // exists or is needed: the custody model already says it.
  const r = technician(TRANSFER_DISPATCH_CAPABILITY);
  assert.equal(has(r, SCAN_WORKFLOW.TRANSFER), true);
});

test("COUNTING THE TRUCK is the same cycle-count workflow — the command accepts MOBILE", () => {
  const r = technician(CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY);
  assert.equal(has(r, SCAN_WORKFLOW.CYCLE_COUNT), true);
});

test("a technician with everything sees every workflow their capabilities allow", () => {
  const r = technician(
    TRANSFER_DISPATCH_CAPABILITY, TRANSFER_RECEIVE_CAPABILITY,
    CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY,
  );
  for (const w of [SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER, SCAN_WORKFLOW.LOOKUP, SCAN_WORKFLOW.TRANSFER, SCAN_WORKFLOW.CYCLE_COUNT]) {
    assert.equal(has(r, w), true, `${w} should be reachable`);
  }
});

// ─────────────────────────────────────────── the technician journey is not privileged

test("being a technician grants NOTHING beyond the work-order scanner", () => {
  // The role is consulted for exactly one thing (the scanner's own server-side rule). It is not a
  // back door into warehouse authority.
  const bare = technician();
  assert.equal(has(bare, SCAN_WORKFLOW.TRANSFER), false);
  assert.equal(has(bare, SCAN_WORKFLOW.CYCLE_COUNT), false);
  assert.equal(has(bare, SCAN_WORKFLOW.PUT_AWAY), false);
  assert.equal(has(bare, SCAN_WORKFLOW.PICK), false);
  assert.equal(has(bare, SCAN_WORKFLOW.SUPPLIER_RECEIVING), false);
});

test("a warehouse operator does NOT get the technician scanner by holding warehouse capabilities", () => {
  const warehouse = deriveScanWorkflows({
    hasCapability: gate(TRANSFER_DISPATCH_CAPABILITY, CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY),
    role: null,
  });
  assert.equal(has(warehouse, SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER), false);
});

test("the SAME workflows serve both audiences — there is no technician-only duplicate", () => {
  // A parallel technician transfer or count surface could disagree with the warehouse one about
  // what happened, which is the duplicate authority this program exists to avoid.
  const tech = technician(TRANSFER_RECEIVE_CAPABILITY, CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY);
  const warehouse = deriveScanWorkflows({
    hasCapability: gate(TRANSFER_RECEIVE_CAPABILITY, CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY),
    role: null,
  });
  for (const w of [SCAN_WORKFLOW.TRANSFER, SCAN_WORKFLOW.CYCLE_COUNT]) {
    assert.equal(has(tech, w), has(warehouse, w), `${w} must be the same workflow for both`);
  }
});

// ─────────────────────────────────────────── what genuinely has no command

test("serialized INSTALL and REMOVE are not offered, because no command exists", () => {
  // The Serialized Asset <-> Equipment installation authority is specified (ADR-010) but not built:
  // functions/src/serializedAsset/ holds a read service and receipt registration only. Offering an
  // install action would be a button with nothing behind it.
  for (const absent of ["INSTALL", "REMOVE", "RMA", "CONSUME"]) {
    assert.equal(SCAN_WORKFLOW[absent], undefined, `${absent} must not exist as a workflow`);
  }
});
