import test from "node:test";
import assert from "node:assert/strict";

import { deriveScanActions, enabledScanActions, SCAN_ACTIONS } from "../src/domain/scanActions.js";
import { resolveScannedIdentity, SCAN_RESOLUTION } from "../src/domain/scannedIdentity.js";

const TECH = "tech-1";
const WO = {
  id: "wo-1", woNumber: "WO-2026-000001", status: "WORK_IN_PROGRESS", assignedTechId: TECH,
  inventorySnapshot: [{ partId: "PRT-1001", sku: "PRT-1001", qtyPlanned: 2 }],
};
const CANDIDATES = { parts: [{ partId: "PRT-1001", sku: "PRT-1001" }], workOrders: [WO] };
const FULL = { role: "technician", technicianId: TECH, workOrders: [WO], activeWorkOrder: WO };

const partScan = () => resolveScannedIdentity("PRT-1001", CANDIDATES);
const woScan = () => resolveScannedIdentity("WO-2026-000001", CANDIDATES);

// ------------------------------------------------- nothing without identity

test("an unresolved scan yields NO actions at all", () => {
  for (const raw of ["", "NOPE-999"]) {
    const id = resolveScannedIdentity(raw, CANDIDATES);
    assert.notEqual(id.resolutionState, SCAN_RESOLUTION.RESOLVED);
    assert.deepEqual(deriveScanActions(id, FULL), []);
  }
  assert.deepEqual(deriveScanActions(null, FULL), []);
});

test("an AMBIGUOUS scan yields no actions -- the scanner never picks a winner", () => {
  const amb = resolveScannedIdentity("DUP", {
    parts: [{ partId: "DUP", sku: "DUP" }],
    equipment: [{ equipmentId: "DUP", serialNumber: "x" }],
  });
  assert.equal(amb.resolutionState, SCAN_RESOLUTION.AMBIGUOUS);
  assert.deepEqual(deriveScanActions(amb, FULL), []);
});

// ------------------------------------------------------------- capability

test("a non-technician caller is offered the action but disabled, with a reason", () => {
  // Mirrors the server: updateWorkOrderExecutionData rejects any role but
  // technician. No invented capability id is consulted.
  const acts = deriveScanActions(partScan(), { ...FULL, role: "dispatcher" });
  const rec = acts.find((a) => a.id === SCAN_ACTIONS.RECORD_PART_USAGE);
  assert.equal(rec.enabled, false);
  assert.match(rec.reason, /assigned technician/i);
  // Disabled, NOT hidden: "you may not" and "does not exist" are different facts.
  assert.ok(acts.length > 0);
});

test("as the assigned technician with a planned part, usage is permitted", () => {
  const rec = deriveScanActions(partScan(), FULL).find((a) => a.id === SCAN_ACTIONS.RECORD_PART_USAGE);
  assert.equal(rec.enabled, true);
  assert.equal(rec.reason, null);
  // The payload carries what a MEANINGFUL confirmation needs -- the human
  // label and the WO number -- not just internal ids.
  assert.equal(rec.payload.partId, "PRT-1001");
  assert.equal(rec.payload.sku, "PRT-1001");
  assert.equal(rec.payload.workOrderId, "wo-1");
  assert.equal(rec.payload.woNumber, "WO-2026-000001");
  assert.ok(rec.payload.label, "the action must carry a human label for its confirmation");
});

// -------------------------------------------------- ownership and planning

test("another technician's work order blocks usage, mirroring the server check", () => {
  const ctx = { ...FULL, activeWorkOrder: { ...WO, assignedTechId: "someone-else" } };
  const rec = deriveScanActions(partScan(), ctx).find((a) => a.id === SCAN_ACTIONS.RECORD_PART_USAGE);
  assert.equal(rec.enabled, false);
  assert.match(rec.reason, /not assigned to you/i);
});

test("a part not planned on the job cannot be recorded against it", () => {
  const ctx = { ...FULL, activeWorkOrder: { ...WO, inventorySnapshot: [{ partId: "OTHER", sku: "OTHER", qtyPlanned: 1 }] } };
  const rec = deriveScanActions(partScan(), ctx).find((a) => a.id === SCAN_ACTIONS.RECORD_PART_USAGE);
  assert.equal(rec.enabled, false);
  assert.match(rec.reason, /not planned/i);
});

test("with no active job, a part offers only its read context", () => {
  const acts = deriveScanActions(partScan(), { ...FULL, activeWorkOrder: null });
  assert.deepEqual(acts.map((a) => a.id), [SCAN_ACTIONS.VIEW_CONTEXT]);
});

// ------------------------------------------------------------ work orders

test("a scanned own work order offers its governed next step, from the permission matrix", () => {
  const acts = deriveScanActions(woScan(), FULL);
  const adv = acts.find((a) => a.id === SCAN_ACTIONS.ADVANCE_WORK_ORDER);
  assert.equal(adv.enabled, true);
  // WORK_IN_PROGRESS -> Complete, per the governed matrix. Not a literal here.
  assert.equal(adv.payload.action, "Complete");
  assert.equal(adv.label, "Complete job");
});

test("a work order not assigned to the caller offers no lifecycle action", () => {
  const ctx = { ...FULL, technicianId: "other" };
  const acts = deriveScanActions(woScan(), ctx);
  assert.equal(acts.find((a) => a.id === SCAN_ACTIONS.ADVANCE_WORK_ORDER), undefined);
});

test("a work order outside the caller's own work is not actionable", () => {
  const id = resolveScannedIdentity("WO-2026-000001", CANDIDATES);
  const acts = deriveScanActions(id, { ...FULL, workOrders: [] });
  assert.equal(acts[0].enabled, false);
  assert.match(acts[0].reason, /not among your assigned work/i);
});

// ------------------------------------------- the F2 separation guarantee

test("entities with no governed write path get a READ action, never an invented movement", () => {
  const cands = {
    serializedAssets: [{ serialNo: "SN-1", partId: "PRT-1001" }],
    locations: [{ locationId: "truck-14", type: "MOBILE" }],
    equipment: [{ equipmentId: "eq-1", serialNumber: "S9" }],
  };
  for (const token of ["SN-1", "truck-14", "S9"]) {
    const acts = deriveScanActions(resolveScannedIdentity(token, cands), FULL);
    assert.deepEqual(acts.map((a) => a.id), [SCAN_ACTIONS.VIEW_CONTEXT], token);
  }
});

test("the action set is DERIVED, not a fixed menu -- it changes with authority and context", () => {
  const withCap = deriveScanActions(partScan(), FULL).filter((a) => a.enabled).map((a) => a.id);
  const without = deriveScanActions(partScan(), { ...FULL, role: "dispatcher" }).filter((a) => a.enabled).map((a) => a.id);
  assert.notDeepEqual(withCap, without);
  // The legacy literal menu (receive / load truck / cycle count / add to PO)
  // must never reappear from a scan.
  const all = deriveScanActions(partScan(), FULL).map((a) => a.id);
  for (const legacy of ["receive", "transfer", "count", "purchase-order"]) {
    assert.ok(!all.includes(legacy), `legacy scanner action "${legacy}" resurfaced`);
  }
});

test("enabledScanActions returns only what the caller may actually invoke now", () => {
  const enabled = enabledScanActions(partScan(), { ...FULL, role: "dispatcher" });
  assert.ok(!enabled.some((a) => a.id === SCAN_ACTIONS.RECORD_PART_USAGE));
  assert.ok(enabled.every((a) => a.enabled));
});

test("no action carries an authority decision of its own", () => {
  for (const a of deriveScanActions(partScan(), FULL)) {
    for (const forbidden of ["persona", "capabilities", "grant", "device"]) {
      assert.ok(!(forbidden in a), `action must not carry "${forbidden}"`);
    }
  }
});
