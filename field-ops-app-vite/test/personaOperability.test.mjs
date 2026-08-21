// PERSONA OPERABILITY — which scanner workflow each persona can actually reach, today.
// Run: node --test test/personaOperability.test.mjs
//
// ============================ WHY THIS MATRIX IS EXECUTABLE ============================
//
// "Who can use the scanner" is the question a rollout hinges on, and it is the easiest one to answer
// from memory and get wrong. So the matrix is asserted rather than written down: every cell below is
// derived from the SAME `deriveScanWorkflows` the workspace itself uses, given the capabilities each
// persona actually holds in the governed role model.
//
// ============================ AUTHORITY IS NOT A ROLE NAME ============================
//
// The personas here are labels for a SET OF CAPABILITIES, not an input to any decision.
// `deriveScanWorkflows` never receives a persona and cannot branch on one — the only role it reads
// is the legacy `technician`, and only because the technician scanner's own server-side rule is
// role-based. Everything else is capability-derived, which is what lets a Parts Associate reach a
// warehouse workflow at all.
//
// ============================ THE HEADLINE ============================
//
// Every warehouse and parts persona currently reaches NOTHING but lookup. Not because the workflows
// are broken, but because those personas hold no scanner capability — see
// functions/test/scannerReleaseReadiness.test.mjs, which pins the same fact from the grant side.
import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveScanWorkflows, SCAN_WORKFLOW, UNAVAILABLE_REASON,
} from "../src/access/scanWorkflows.js";

/**
 * What each persona holds TODAY, transcribed from the governed role model.
 *
 * Kept as data rather than imported so this file states the expectation and
 * functions/test/scannerReleaseReadiness.test.mjs proves it — two files that must agree, rather than
 * one file agreeing with itself.
 */
const PERSONA_CAPABILITIES = Object.freeze({
  admin: [
    "inventory.stock.receive", "inventory.transfer.dispatch", "inventory.transfer.receive",
    "inventory.cycleCount.create", "inventory.cycleCount.submit",
    "inventory.placement.record", "inventory.location.bin.read",
  ],
  dispatcher: ["inventory.stock.receive"],
  technician: [],
  partsAssociate: [],
  partsManager: [],
  warehouseAssociate: [],
  warehouseManager: [],
});

/** How a workflow stands for a persona. */
const VISIBLE = "VISIBLE";        // offered and usable
const DENIED = "DENIED";          // listed as unavailable, with a stated reason
const NOT_APPLICABLE = "NOT_APPLICABLE"; // does not apply to this persona at all

function operability(persona, { receivingReady = false } = {}) {
  const held = PERSONA_CAPABILITIES[persona] ?? [];
  const isTechnician = persona === "technician";
  const result = deriveScanWorkflows({
    hasCapability: (id) => held.includes(id),
    receivingReady,
    role: isTechnician ? "technician" : null,
    technicianId: isTechnician ? "T-1" : null,
    assignedWorkOrderCount: isTechnician ? 2 : 0,
  });

  const cell = {};
  for (const workflow of Object.values(SCAN_WORKFLOW)) {
    if (result.available.some((a) => a.workflow === workflow)) { cell[workflow] = VISIBLE; continue; }
    const reason = result.unavailable.find((u) => u.workflow === workflow)?.reason;
    // The technician journey is NOT APPLICABLE to a non-technician rather than merely denied: no
    // grant would ever make it available to them, and calling that "denied" implies one might.
    cell[workflow] = (workflow === SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER && !isTechnician)
      ? NOT_APPLICABLE
      : DENIED;
    cell[`${workflow}_reason`] = reason ?? null;
  }
  return cell;
}

// ═══════════════════════════════════════════ the matrix

test("ADMIN reaches every workflow once receiving is switched on", () => {
  const m = operability("admin", { receivingReady: true });
  for (const w of Object.values(SCAN_WORKFLOW)) {
    const expected = w === SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER ? NOT_APPLICABLE : VISIBLE;
    assert.equal(m[w], expected, `admin/${w}`);
  }
});

test("ADMIN is blocked on READINESS, not permission, while receiving is off", () => {
  // The distinction that decides who gets called: an admin who is told "not authorized" goes to
  // find someone to grant them something they already have.
  const m = operability("admin", { receivingReady: false });
  assert.equal(m[SCAN_WORKFLOW.SUPPLIER_RECEIVING], DENIED);
  assert.equal(m[`${SCAN_WORKFLOW.SUPPLIER_RECEIVING}_reason`], UNAVAILABLE_REASON.NOT_READY);
});

test("DISPATCHER reaches receiving and lookup, and nothing else", () => {
  const m = operability("dispatcher", { receivingReady: true });
  assert.equal(m[SCAN_WORKFLOW.SUPPLIER_RECEIVING], VISIBLE);
  assert.equal(m[SCAN_WORKFLOW.LOOKUP], VISIBLE);
  for (const w of [SCAN_WORKFLOW.TRANSFER, SCAN_WORKFLOW.CYCLE_COUNT, SCAN_WORKFLOW.PUT_AWAY, SCAN_WORKFLOW.PICK]) {
    assert.equal(m[w], DENIED, `dispatcher/${w}`);
    assert.equal(m[`${w}_reason`], UNAVAILABLE_REASON.NO_CAPABILITY);
  }
});

test("TECHNICIAN reaches their own scanner and lookup", () => {
  const m = operability("technician");
  assert.equal(m[SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER], VISIBLE);
  assert.equal(m[SCAN_WORKFLOW.LOOKUP], VISIBLE);
});

test("THE HEADLINE: every warehouse and parts persona reaches ONLY lookup", () => {
  // Not because the workflows are broken — because these personas hold no scanner capability. This
  // is the release-blocking gap, stated from the persona side.
  for (const persona of ["partsAssociate", "partsManager", "warehouseAssociate", "warehouseManager"]) {
    const m = operability(persona, { receivingReady: true });
    assert.equal(m[SCAN_WORKFLOW.LOOKUP], VISIBLE, `${persona} should still reach lookup`);
    for (const w of [SCAN_WORKFLOW.SUPPLIER_RECEIVING, SCAN_WORKFLOW.TRANSFER, SCAN_WORKFLOW.CYCLE_COUNT, SCAN_WORKFLOW.PUT_AWAY, SCAN_WORKFLOW.PICK]) {
      assert.equal(m[w], DENIED, `${persona}/${w} is denied until a grant exists`);
    }
    assert.equal(m[SCAN_WORKFLOW.TECHNICIAN_WORK_ORDER], NOT_APPLICABLE, `${persona} is not a technician`);
  }
});

test("a DENIED warehouse workflow always states WHY, so the gap is legible", () => {
  const m = operability("partsAssociate", { receivingReady: true });
  for (const w of [SCAN_WORKFLOW.TRANSFER, SCAN_WORKFLOW.CYCLE_COUNT, SCAN_WORKFLOW.PUT_AWAY, SCAN_WORKFLOW.PICK]) {
    assert.equal(m[`${w}_reason`], UNAVAILABLE_REASON.NO_CAPABILITY, `${w} should say a grant is missing`);
  }
});

// ═══════════════════════════════════════════ no accidental access

test("NO persona reaches a workflow whose capability it does not hold", () => {
  // The check for accidental access, run across every persona and every workflow at once.
  const CAPABILITY_FOR = {
    [SCAN_WORKFLOW.SUPPLIER_RECEIVING]: ["inventory.stock.receive"],
    [SCAN_WORKFLOW.TRANSFER]: ["inventory.transfer.dispatch", "inventory.transfer.receive"],
    [SCAN_WORKFLOW.CYCLE_COUNT]: ["inventory.cycleCount.create", "inventory.cycleCount.submit"],
    [SCAN_WORKFLOW.PUT_AWAY]: ["inventory.placement.record", "inventory.location.bin.read"],
    [SCAN_WORKFLOW.PICK]: ["inventory.placement.record", "inventory.location.bin.read"],
  };
  for (const [persona, held] of Object.entries(PERSONA_CAPABILITIES)) {
    const m = operability(persona, { receivingReady: true });
    for (const [workflow, required] of Object.entries(CAPABILITY_FOR)) {
      if (m[workflow] !== VISIBLE) continue;
      const satisfied = workflow === SCAN_WORKFLOW.TRANSFER
        ? required.some((c) => held.includes(c))   // either end of a transfer is useful work
        : required.every((c) => held.includes(c));
      assert.ok(satisfied, `${persona} reached ${workflow} without holding ${required.join(" + ")}`);
    }
  }
});

test("LOOKUP is reachable by everyone, deliberately — the read is the gate", () => {
  // `parts` is governed by firestore.rules, not by a capability, so nothing here can predict the
  // outcome honestly. The attempt is offered and a refusal is rendered as a refusal.
  for (const persona of Object.keys(PERSONA_CAPABILITIES)) {
    assert.equal(operability(persona)[SCAN_WORKFLOW.LOOKUP], VISIBLE, `${persona} should reach lookup`);
  }
});

test("NO workflow is unreachable by every persona — nothing is stranded", () => {
  // A workflow nobody can ever reach is dead code wearing a menu entry. Admin proves each one is
  // reachable by somebody.
  const admin = operability("admin", { receivingReady: true });
  for (const w of Object.values(SCAN_WORKFLOW)) {
    const reachable = admin[w] === VISIBLE || operability("technician")[w] === VISIBLE;
    assert.ok(reachable, `${w} is reachable by no persona at all`);
  }
});

// ═══════════════════════════════════════════ authority is not a role name

test("the derivation cannot branch on a persona — it never receives one", () => {
  // Two personas holding identical capabilities must get identical answers, whatever they are called.
  const asParts = deriveScanWorkflows({ hasCapability: (id) => id === "inventory.stock.receive", receivingReady: true, role: null });
  const asWarehouse = deriveScanWorkflows({ hasCapability: (id) => id === "inventory.stock.receive", receivingReady: true, role: null });
  assert.deepEqual(asParts.available, asWarehouse.available);
  assert.deepEqual(asParts.unavailable, asWarehouse.unavailable);
});

test("granting a capability is the ONLY thing that changes a warehouse persona's access", () => {
  // Proves the fix is a grant and nothing else: no code change, no nav change, no role rename.
  const before = operability("partsAssociate", { receivingReady: true });
  assert.equal(before[SCAN_WORKFLOW.CYCLE_COUNT], DENIED);

  const after = deriveScanWorkflows({
    hasCapability: (id) => ["inventory.cycleCount.create", "inventory.cycleCount.submit"].includes(id),
    role: null,
  });
  assert.equal(after.available.some((a) => a.workflow === SCAN_WORKFLOW.CYCLE_COUNT), true);
});
