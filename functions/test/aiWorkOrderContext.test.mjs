import test from "node:test";
import assert from "node:assert/strict";
import { AIError } from "../lib/ai/types.js";
import {
  assertWorkOrderContextReadable,
  resolveWorkOrderContextAccess,
  sanitizeWorkOrderFacts,
} from "../lib/ai/workOrderContext.js";
import { INVENTORY_BALANCE_READ_CAPABILITY } from "../lib/inventory/partBalanceReadService.js";

const workOrder = (over = {}) => ({
  assignedTechId: "tech-1",
  ...over,
});

const actor = (over = {}) => ({
  authenticated: true,
  role: "dispatcher",
  technicianId: null,
  ...over,
});

function denied(fn) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof AIError);
    assert.equal(err.code, "AI_CAPABILITY_DENIED");
    return true;
  });
}

test("admin and dispatcher mirror firestore.rules and may read any Work Order", () => {
  assert.doesNotThrow(() => assertWorkOrderContextReadable(actor({ role: "admin" }), workOrder()));
  assert.doesNotThrow(() => assertWorkOrderContextReadable(actor({ role: "dispatcher" }), workOrder()));
});

test("technician may read only their own assigned Work Order", () => {
  assert.doesNotThrow(() => assertWorkOrderContextReadable(
    actor({ role: "technician", technicianId: "tech-1" }),
    workOrder({ assignedTechId: "tech-1" }),
  ));

  denied(() => assertWorkOrderContextReadable(
    actor({ role: "technician", technicianId: "tech-1" }),
    workOrder({ assignedTechId: "tech-2" }),
  ));
  denied(() => assertWorkOrderContextReadable(
    actor({ role: "technician", technicianId: null }),
    workOrder({ assignedTechId: "tech-1" }),
  ));
  denied(() => assertWorkOrderContextReadable(
    actor({ role: "technician", technicianId: "tech-1" }),
    workOrder({ assignedTechId: null }),
  ));
});

test("unauthenticated and unrecognized roles fail closed", () => {
  denied(() => assertWorkOrderContextReadable(actor({ authenticated: false }), workOrder()));
  denied(() => assertWorkOrderContextReadable(actor({ role: "partsManager" }), workOrder()));
  denied(() => assertWorkOrderContextReadable(actor({ role: null }), workOrder()));
});

test("Work Order visibility never grants inventory balance authority", () => {
  const access = resolveWorkOrderContextAccess({
    actor: actor({ role: "dispatcher" }),
    workOrder: workOrder(),
    capabilityDecisions: {},
  });
  assert.equal(access.workOrderReadable, true);
  assert.equal(access.inventoryBalanceReadable, false);
  assert.deepEqual(access.limitations, ["INVENTORY_BALANCE_NOT_AUTHORIZED"]);
});

test("inventory enrichment appears only after the existing inventory.balance.read decision is true", () => {
  const access = resolveWorkOrderContextAccess({
    actor: actor({ role: "technician", technicianId: "tech-1" }),
    workOrder: workOrder({ assignedTechId: "tech-1" }),
    capabilityDecisions: { [INVENTORY_BALANCE_READ_CAPABILITY]: true },
  });
  assert.equal(access.workOrderReadable, true);
  assert.equal(access.inventoryBalanceReadable, true);
  assert.deepEqual(access.limitations, []);
});

test("a technician who may read their Work Order still gets no inventory facts when balance capability denies", () => {
  const access = resolveWorkOrderContextAccess({
    actor: actor({ role: "technician", technicianId: "tech-1" }),
    workOrder: workOrder({ assignedTechId: "tech-1" }),
    capabilityDecisions: { [INVENTORY_BALANCE_READ_CAPABILITY]: false },
  });
  assert.equal(access.workOrderReadable, true);
  assert.equal(access.inventoryBalanceReadable, false);
});

test("sanitized Work Order facts contain human references and plan facts but no raw join keys", () => {
  const facts = sanitizeWorkOrderFacts({
    id: "cIk3hlPDTXH5IB3VHdLy",
    woNumber: " WO-2026-000873 ",
    status: "DISPATCHED",
    type: "REPAIR",
    priority: "P2",
    customerId: "aBcDeFgHiJkLmNoPqRsT",
    locationId: "bBcDeFgHiJkLmNoPqRsU",
    assignedTechId: "cBcDeFgHiJkLmNoPqRsV",
    inventorySnapshot: [
      { partId: "V4otE0s7EAp7ABCZEjam", name: "Scraper Blade Kit", sku: "X49463-3", qtyPlanned: 2 },
      { partId: "Z9otE0s7EAp7ABCZEjaQ", name: "Seal Kit", sku: "S-100", qtyPlanned: 1 },
      { partId: "ignore", name: "Not planned", qtyPlanned: 0 },
    ],
  });

  assert.equal(facts.subject.reference, "WO-2026-000873");
  assert.equal(facts.partsPlan.length, 2);
  assert.deepEqual(facts.partsPlan[0], { name: "Scraper Blade Kit", sku: "X49463-3", qtyPlanned: 2 });

  const encoded = JSON.stringify(facts);
  for (const rawId of [
    "cIk3hlPDTXH5IB3VHdLy",
    "aBcDeFgHiJkLmNoPqRsT",
    "bBcDeFgHiJkLmNoPqRsU",
    "cBcDeFgHiJkLmNoPqRsV",
    "V4otE0s7EAp7ABCZEjam",
    "Z9otE0s7EAp7ABCZEjaQ",
  ]) assert.doesNotMatch(encoded, new RegExp(rawId));
});
