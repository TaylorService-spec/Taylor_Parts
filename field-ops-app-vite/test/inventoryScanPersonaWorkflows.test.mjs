// P1-2 WAREHOUSE SCAN -- which Scan workflows each canonical persona is offered from its EOS capabilities, and proof
// that a workflow is offered IFF the EOS command(s) behind it would admit the caller's capabilities.
// Run: node --test test/inventoryScanPersonaWorkflows.test.mjs
//
// THE FIXTURE IS KEYS ONLY. For each of the 16 canonical personas: the scan-relevant capability keys its EOS Principal
// resolves (resolveMyCapabilities), filtered to INVENTORY_SCAN_CAPABILITY_REQUEST plus the retired Firebase-only bin key
// (held by nobody in PostgreSQL). No principal id, no name, no tenant. Source: the nonprod persona capability census
// after #2067 (2026-10-13), the same set the P1-2 design probed live. A grant change is an Administration act; when one
// lands, this fixture is what moves -- never the derivation.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIN_LOOKUP_CAPABILITY_IDS, CYCLE_COUNT_CREATE_CAPABILITY, CYCLE_COUNT_SUBMIT_CAPABILITY, PLACEMENT_RECORD_CAPABILITY,
  RECEIVE_CAPABILITY, RETURNS_INTAKE_CAPABILITY, SCAN_WORKFLOW, SCAN_WORKFLOW_CAPABILITY_IDS, STOCK_RELOCATE_CAPABILITY,
  TRANSFER_DISPATCH_CAPABILITY, TRANSFER_RECEIVE_CAPABILITY, UNAVAILABLE_REASON, deriveScanWorkflows,
} from "../src/access/scanWorkflows.js";
import { INVENTORY_SCAN_CAPABILITY_REQUEST, inventoryScanCapabilitiesFrom } from "../src/access/inventoryScanCapabilityAccess.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.resolve(HERE, rel), "utf8");

const RETIRED_BIN_READ = "inventory.location.bin.read";

const PERSONA_SCAN_CAPABILITIES = Object.freeze({
  administrator: ["inventory.stock.receive", "inventory.transfer.create", "inventory.transfer.dispatch", "inventory.transfer.receive",
    "inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.placement.record", "inventory.stock.relocate",
    "warehouse.record.read", "inventory.transaction.read"],
  ownerExecutive: ["warehouse.record.read", "inventory.transaction.read"],
  generalManager: ["inventory.transaction.read"],
  serviceManager: ["inventory.transaction.read"],
  dispatcher: ["inventory.stock.receive", "warehouse.record.read", "inventory.transaction.read"],
  serviceTechnician: ["inventory.transfer.receive", "inventory.transaction.read"],
  partsManager: ["inventory.transaction.read"],
  partsAssociate: ["inventory.stock.receive", "inventory.transaction.read"],
  warehouseManager: ["inventory.transfer.receive", "warehouse.record.read", "inventory.transaction.read"],
  warehouseAssociate: ["inventory.transfer.create", "inventory.transfer.dispatch", "inventory.cycleCount.create",
    "inventory.cycleCount.submit", "inventory.placement.record", "inventory.stock.relocate", "warehouse.record.read",
    "inventory.transaction.read"],
  retailSales: [],
  nationalAccountsSales: [],
  officeManager: [],
  financeAccounting: ["inventory.transaction.read"],
  reportingAnalyst: [],
  generalEmployee: [],
});

const { LOOKUP, TRANSFER, CYCLE_COUNT, PUT_AWAY, PICK, MOVE_STOCK, SUPPLIER_RECEIVING, RETURN_INTAKE } = SCAN_WORKFLOW;
const FLOOR = [LOOKUP, TRANSFER, CYCLE_COUNT, PUT_AWAY, PICK, MOVE_STOCK];

// What each persona is OFFERED (receiving transport is not switched on in nonprod: RECEIVING_TRANSPORT_READY=false).
const EXPECTED_AVAILABLE = Object.freeze({
  administrator: FLOOR,
  ownerExecutive: [LOOKUP],
  generalManager: [LOOKUP],
  serviceManager: [LOOKUP],
  dispatcher: [LOOKUP],
  serviceTechnician: [LOOKUP, TRANSFER],
  partsManager: [LOOKUP],
  partsAssociate: [LOOKUP],
  warehouseManager: [LOOKUP, TRANSFER],
  warehouseAssociate: FLOOR,
  retailSales: [LOOKUP],
  nationalAccountsSales: [LOOKUP],
  officeManager: [LOOKUP],
  financeAccounting: [LOOKUP],
  reportingAnalyst: [LOOKUP],
  generalEmployee: [LOOKUP],
});

const gateFor = (held) => (id) => held.includes(id);
const workflowsFor = (held, receivingReady = false) => deriveScanWorkflows({ hasCapability: gateFor(held), receivingReady, role: null });
const available = (r) => r.available.map((a) => a.workflow);
const reasonOf = (r, w) => r.unavailable.find((u) => u.workflow === w)?.reason ?? null;

// ═══════════════════════════════ per persona (16) ═══════════════════════════════

test("the fixture is the 16 canonical personas, keys only, and every key is one the Scan workspace keeps", () => {
  assert.equal(Object.keys(PERSONA_SCAN_CAPABILITIES).length, 16);
  assert.deepEqual(Object.keys(EXPECTED_AVAILABLE), Object.keys(PERSONA_SCAN_CAPABILITIES));
  for (const [persona, keys] of Object.entries(PERSONA_SCAN_CAPABILITIES)) {
    for (const k of keys) assert.ok(INVENTORY_SCAN_CAPABILITY_REQUEST.includes(k), `${persona}: ${k} is not a scan key`);
    assert.ok(!keys.includes(RETIRED_BIN_READ), `${persona}: ${RETIRED_BIN_READ} is registered nowhere in PostgreSQL`);
  }
});

for (const [persona, held] of Object.entries(PERSONA_SCAN_CAPABILITIES)) {
  test(`${persona} is offered exactly ${EXPECTED_AVAILABLE[persona].join(", ")}`, () => {
    // Through the same projection the hook applies to a resolveMyCapabilities answer.
    const projected = inventoryScanCapabilitiesFrom({ capabilities: [...held, "some.other.capability"] });
    const r = deriveScanWorkflows({ hasCapability: (id) => projected.has(id), receivingReady: false, role: null });
    assert.deepEqual(available(r), EXPECTED_AVAILABLE[persona]);
  });
}

test("warehouseAssociate: the floor job, but receiving is refused as NO_CAPABILITY (not NOT_READY) and no return intake", () => {
  const r = workflowsFor(PERSONA_SCAN_CAPABILITIES.warehouseAssociate);
  assert.equal(reasonOf(r, SUPPLIER_RECEIVING), UNAVAILABLE_REASON.NO_CAPABILITY);
  assert.equal(reasonOf(r, RETURN_INTAKE), UNAVAILABLE_REASON.NO_CAPABILITY);
});

test("receivers (administrator, dispatcher, partsAssociate) see receiving as NOT_READY, never offered, while the transport is off", () => {
  for (const persona of ["administrator", "dispatcher", "partsAssociate"]) {
    const r = workflowsFor(PERSONA_SCAN_CAPABILITIES[persona]);
    assert.equal(reasonOf(r, SUPPLIER_RECEIVING), UNAVAILABLE_REASON.NOT_READY, persona);
  }
});

test("RETURN INTAKE is refused for every persona: inventory.returns.intake is held by nobody in PostgreSQL", () => {
  for (const [persona, held] of Object.entries(PERSONA_SCAN_CAPABILITIES)) {
    assert.equal(available(workflowsFor(held, true)).includes(RETURN_INTAKE), false, persona);
  }
});

test("warehouseManager reconciles, never counts, stows or picks (DECISIONS #111)", () => {
  const got = available(workflowsFor(PERSONA_SCAN_CAPABILITIES.warehouseManager, true));
  for (const w of [CYCLE_COUNT, PUT_AWAY, PICK, MOVE_STOCK]) assert.equal(got.includes(w), false, w);
});

// ═══════════════════════════════ server parity ═══════════════════════════════
//
// Each workflow's server requirement, read from the EOS command source rather than restated -- so a server change
// that moves a key breaks this file, not production.

function serverRequirements() {
  const relocation = read("../../functions/src/eosOps/stockRelocationOperations.ts");
  const placement = read("../../functions/src/eosOps/binPlacementOperations.ts");
  const cycleCount = read("../../functions/src/eosOps/cycleCountOperations.ts");
  const transfer = read("../../functions/src/eosOps/transferOperations.ts");
  const partsReads = read("../../functions/src/eosOps/partsReads.ts");
  const client = read("../src/services/placementClient.js");
  const pick = read("../src/modules/scan/PickScan.jsx");
  const putAway = read("../src/modules/scan/PutAwayScan.jsx");
  const constant = (src, name) => src.match(new RegExp(`export const ${name} = "([^"]+)"`))?.[1];
  const member = (src, obj, key) => src.match(new RegExp(`export const ${obj} = Object\\.freeze\\(\\{[^}]*?\\b${key}: "([^"]+)"`, "s"))?.[1];

  const relocate = constant(relocation, "EOS_STOCK_RELOCATE_CAPABILITY");
  const placementRecord = constant(placement, "EOS_PLACEMENT_RECORD_CAPABILITY");
  // relocateStock checks relocate, then placement when recordPlacement is set (put-away always sets it).
  assert.match(relocation, /if \(!actor\.capabilities\.has\(EOS_STOCK_RELOCATE_CAPABILITY\)\)/);
  assert.match(relocation, /if \(req\.recordPlacement && !actor\.capabilities\.has\(EOS_PLACEMENT_RECORD_CAPABILITY\)\)/);
  assert.match(placement, /if \(!actor\.capabilities\.has\(EOS_PLACEMENT_RECORD_CAPABILITY\)\)/);
  // Which command each screen calls.
  assert.match(client, /putAwayStock:[\s\S]*?EOS_OPERATIONS_ROUTES\.RELOCATION, "relocateStock", toPutAwayRelocation/);
  assert.match(client, /recordPutAway: \(request\) => eosOperationOrThrow\(EOS_OPERATIONS_ROUTES\.PLACEMENT, "recordPutAway"/);
  assert.match(putAway, /client\.putAwayStock\(/);
  assert.match(pick, /client\.recordPutAway\(/);
  // Bin lookup: listInventoryLocations admits ANY of WAREHOUSE_READ, INVENTORY_ON_HAND_READ.
  assert.match(partsReads, /export async function listInventoryLocations[\s\S]*?requireAnyCapability\(actor, \[WAREHOUSE_READ, INVENTORY_ON_HAND_READ\]\)/);
  const binLookup = [constant(partsReads, "WAREHOUSE_READ"), constant(partsReads, "INVENTORY_ON_HAND_READ")];

  return {
    relocate, placementRecord, binLookup,
    countCreate: member(cycleCount, "EOS_CYCLE_COUNT_CAPABILITY", "create"),
    countSubmit: member(cycleCount, "EOS_CYCLE_COUNT_CAPABILITY", "submit"),
    transferDispatch: member(transfer, "EOS_TRANSFER_CAPABILITY", "dispatch"),
    transferReceive: member(transfer, "EOS_TRANSFER_CAPABILITY", "receive"),
  };
}

test("the client's scan keys ARE the server's command keys (cited from the EOS sources)", () => {
  const s = serverRequirements();
  assert.equal(STOCK_RELOCATE_CAPABILITY, s.relocate);
  assert.equal(PLACEMENT_RECORD_CAPABILITY, s.placementRecord);
  assert.deepEqual([...BIN_LOOKUP_CAPABILITY_IDS], s.binLookup);
  assert.equal(CYCLE_COUNT_CREATE_CAPABILITY, s.countCreate);
  assert.equal(CYCLE_COUNT_SUBMIT_CAPABILITY, s.countSubmit);
  assert.equal(TRANSFER_DISPATCH_CAPABILITY, s.transferDispatch);
  assert.equal(TRANSFER_RECEIVE_CAPABILITY, s.transferReceive);
});

test("for EVERY subset of the scan keys, a workflow is offered IFF the server commands' capability checks would admit it", () => {
  const s = serverRequirements();
  const keys = [...new Set([...SCAN_WORKFLOW_CAPABILITY_IDS, RETIRED_BIN_READ])];
  assert.ok(keys.length <= 12, "keep the exhaustive sweep bounded");
  const admits = (held) => {
    const h = (k) => held.includes(k);
    const lookup = s.binLookup.some(h);
    return {
      [PUT_AWAY]: h(s.relocate) && h(s.placementRecord) && lookup, // relocateStock(recordPlacement) + bin lookup
      [PICK]: h(s.placementRecord) && lookup,                       // recordPutAway + bin lookup
      [MOVE_STOCK]: h(s.relocate) && lookup,                        // relocateStock + bin lookup
      [CYCLE_COUNT]: h(s.countCreate) && h(s.countSubmit),          // open + submit a count
      [TRANSFER]: h(s.transferDispatch) || h(s.transferReceive),    // either end is useful work
      [LOOKUP]: true,                                               // the governed read is the gate
    };
  };
  for (let mask = 0; mask < 1 << keys.length; mask += 1) {
    const held = keys.filter((_, i) => mask & (1 << i));
    const got = new Set(available(workflowsFor(held)));
    for (const [workflow, expected] of Object.entries(admits(held))) {
      assert.equal(got.has(workflow), expected, `${workflow} with [${held.join(", ")}]`);
    }
  }
});

// ═══════════════════════════════ negatives ═══════════════════════════════

test("inventory.placement.record alone is NOT Put away (nor Pick: no bin lookup)", () => {
  assert.deepEqual(available(workflowsFor([PLACEMENT_RECORD_CAPABILITY])), [LOOKUP]);
  const withLookup = available(workflowsFor([PLACEMENT_RECORD_CAPABILITY, "warehouse.record.read"]));
  assert.ok(withLookup.includes(PICK));
  assert.equal(withLookup.includes(PUT_AWAY), false, "Put away also needs inventory.stock.relocate");
});

test("relocate without any bin lookup read is NOT Move stock", () => {
  assert.deepEqual(available(workflowsFor([STOCK_RELOCATE_CAPABILITY])), [LOOKUP]);
});

test("inventory.location.bin.read alone, or alongside the command keys, confers nothing", () => {
  assert.deepEqual(available(workflowsFor([RETIRED_BIN_READ])), [LOOKUP]);
  assert.deepEqual(available(workflowsFor([RETIRED_BIN_READ, PLACEMENT_RECORD_CAPABILITY, STOCK_RELOCATE_CAPABILITY])), [LOOKUP]);
  assert.equal(SCAN_WORKFLOW_CAPABILITY_IDS.includes(RETIRED_BIN_READ), false);
  assert.equal(INVENTORY_SCAN_CAPABILITY_REQUEST.includes(RETIRED_BIN_READ), false);
  // and the projection drops it, like any non-scan key
  assert.deepEqual([...inventoryScanCapabilitiesFrom({ capabilities: [RETIRED_BIN_READ] })], []);
});

test("empty capabilities -> Lookup only; a throwing gate -> Lookup only", () => {
  assert.deepEqual(available(workflowsFor([])), [LOOKUP]);
  const thrown = deriveScanWorkflows({ hasCapability: () => { throw new Error("boom"); }, receivingReady: true });
  assert.deepEqual(available(thrown), [LOOKUP]);
});

test("rules left unchanged: receiving, return intake and the either-end transfer gate", () => {
  assert.ok(available(workflowsFor([RECEIVE_CAPABILITY], true)).includes(SUPPLIER_RECEIVING));
  assert.ok(available(workflowsFor([RETURNS_INTAKE_CAPABILITY])).includes(RETURN_INTAKE));
  assert.ok(available(workflowsFor([TRANSFER_RECEIVE_CAPABILITY])).includes(TRANSFER));
  assert.equal(available(workflowsFor([CYCLE_COUNT_CREATE_CAPABILITY])).includes(CYCLE_COUNT), false);
});
