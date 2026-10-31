// The access map and its ONE gate (access/operationAccess.generated.js, access/operationGate.js). Offline: node:test.
// Run: node --test test/operationGate.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPERATION_ACCESS } from "../src/access/operationAccess.generated.js";
import { operationAllowed, operationDecision, operationRequirement, operationsDecision } from "../src/access/operationGate.js";
import { partsReadGates, supplierTermsReadable } from "../src/access/partsReadGates.js";
import { NO_SESSION_ACCESS, SESSION_GATE_KEYS, SESSION_GATE_SURFACES } from "../src/access/sessionAccess.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.resolve(here, "../src", rel), "utf8").replace(/\r\n/g, "\n");

const session = ({ held = [], surfaces = [], settled = true } = {}) => ({
  eosSource: true, settled, holds: (k) => held.includes(k), grantsSurface: (k) => surfaces.includes(k), reload: () => {},
});

test("the map is frozen and every row is { allOf: string[], anyOf?: string[], surface?: string }", () => {
  assert.ok(Object.isFrozen(OPERATION_ACCESS));
  for (const [operation, row] of Object.entries(OPERATION_ACCESS)) {
    assert.ok(Object.isFrozen(row), operation);
    assert.ok(Array.isArray(row.allOf) && row.allOf.every((k) => typeof k === "string" && k.includes(".")), `${operation}.allOf`);
    if (row.anyOf !== undefined) assert.ok(Array.isArray(row.anyOf) && row.anyOf.length > 0, `${operation}.anyOf`);
    if (row.surface !== undefined) assert.equal(typeof row.surface, "string", `${operation}.surface`);
    assert.deepEqual(Object.keys(row).filter((k) => !["allOf", "anyOf", "surface"].includes(k)), [], `${operation} has an unknown field`);
  }
});

test("the four reads UAT found refused are stated as the server states them", () => {
  assert.deepEqual([...operationRequirement("listPartAliases").allOf].sort(), ["inventory.catalog.manage", "inventory.catalog.read"], "catalog.read AND catalog.manage; alias.read is resolve-only");
  assert.deepEqual(operationRequirement("listEmployees").allOf, ["employee.record.read"]);
  assert.deepEqual(operationRequirement("listWorkOrders").allOf, ["workOrder.record.read"]);
  assert.deepEqual(operationRequirement("listLegacyInventoryActionNotes").allOf, ["inventory.action.read"]);
});

test("an operation that is not in the map is a programming error, never 'allowed'", () => {
  assert.throws(() => operationDecision(session(), "listEverything"), /not in the access map/);
  assert.throws(() => operationAllowed(NO_SESSION_ACCESS, "listEverything"), /not in the access map/);
});

test("where EOS is not the session source every answer is true (the legacy behaviour is unchanged)", () => {
  for (const operation of Object.keys(OPERATION_ACCESS)) {
    assert.equal(operationDecision(NO_SESSION_ACCESS, operation), true, operation);
    assert.equal(operationDecision(undefined, operation), true, operation);
  }
});

test("allOf: every capability is required; the session answer decides between false (settled) and null (not yet)", () => {
  const both = ["inventory.catalog.read", "inventory.catalog.manage"];
  assert.equal(operationDecision(session({ held: both }), "listPartAliases"), true);
  assert.equal(operationDecision(session({ held: ["inventory.catalog.read"] }), "listPartAliases"), false, "read WITHOUT manage is refused by the server");
  assert.equal(operationDecision(session({ held: ["inventory.catalog.manage"] }), "listPartAliases"), false);
  assert.equal(operationDecision(session({ held: [], settled: false }), "listPartAliases"), null, "not answered yet: loading, not denied");
  assert.equal(operationDecision(session({ held: both, settled: false }), "listPartAliases"), true, "a positive answer is honoured at once");
});

test("anyOf: one alternative is enough, none is not", () => {
  assert.equal(operationDecision(session({ held: ["warehouse.record.read"] }), "listInventoryWarehouses"), true);
  assert.equal(operationDecision(session({ held: ["inventory.transaction.read"] }), "listInventoryWarehouses"), true);
  assert.equal(operationDecision(session({ held: ["inventory.catalog.read"] }), "listInventoryWarehouses"), false);
});

test("a surface row is decided by the SURFACE alone (it embeds the capability and the Operational Scope)", () => {
  const queue = OPERATION_ACCESS.readReorderQueue.surface;
  assert.equal(queue, "inventory.reorderQueue");
  assert.equal(SESSION_GATE_SURFACES.reorderQueue, queue, "the bell and the page read the same surface");
  assert.equal(operationDecision(session({ surfaces: [queue] }), "readReorderQueue"), true);
  assert.equal(operationDecision(session({ held: ["reorder.request.read"] }), "readReorderQueue"), false, "MUTATION PROOF: the capability alone is refused by the server (OUTSIDE_OPERATIONAL_SCOPE)");
  assert.equal(operationDecision({ eosSource: true, settled: true, holds: () => true }, "readReorderQueue"), false, "no surface reader: denied");
});

test("self reads need no capability", () => {
  for (const operation of ["resolveMyCapabilities", "readMyEmployeeProfile", "readMyWorkOrderCapabilities", "readMyWork", "listWorkflowWork", "resolveEmployeeDisplayNames"]) {
    assert.equal(operationDecision(session(), operation), true, operation);
  }
});

test("operationsDecision: false beats null beats true", () => {
  const s = session({ held: ["inventory.transaction.read"], settled: false });
  assert.equal(operationsDecision(s, ["readInventoryOnHand", "readInventoryMovements"]), true);
  assert.equal(operationsDecision(s, ["readInventoryOnHand", "listPartAliases"]), null);
  assert.equal(operationsDecision({ ...s, settled: true }, ["readInventoryOnHand", "listPartAliases"]), false);
});

test("partsReadGates and supplierTermsReadable answer through the map and keep their shape", () => {
  const partsManager = session({
    held: ["inventory.catalog.read", "inventory.manufacturer.read", "reorder.request.read", "reorder.request.create.manual", "inventory.supplierTerms.read"],
    surfaces: ["inventory.reorderQueue"],
  });
  assert.deepEqual(partsReadGates(partsManager), { queue: true, myAssigned: true, settled: true, warehouseOptions: true, manufacturers: true, suppliers: false });
  assert.equal(supplierTermsReadable(partsManager), true);
  assert.equal(supplierTermsReadable(session()), false);
  assert.equal(partsReadGates(session({ held: ["inventory.manufacturer.read"] })).manufacturers, false, "listManufacturers needs catalog.read AND manufacturer.read");
});

test("the browser keeps NO hand-written list of what a read needs: the gate files name no capability, and the retired read-gate keys stay retired", () => {
  const CAPABILITY_LITERAL = /["'](?:inventory|reorder|supplier|employee|workOrder|receivingOrder|warehouse)\.[A-Za-z.]+["']/g;
  for (const file of ["access/partsReadGates.js", "access/operationGate.js"]) {
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.deepEqual(code.match(CAPABILITY_LITERAL) ?? [], [], `${file} must not retype a capability the server's map already states`);
  }
  for (const retired of ["manufacturerRead", "reorderRead", "supplierRead", "supplierTermsRead"]) {
    assert.equal(SESSION_GATE_KEYS[retired], undefined, `SESSION_GATE_KEYS.${retired} is the hand copy this map replaced`);
  }
});

test("the generated file carries its banner and is a plain data module", () => {
  const code = read("access/operationAccess.generated.js");
  assert.match(code, /^\/\/ GENERATED FILE -- DO NOT EDIT\./);
  assert.match(code, /generated from functions\/src\/eosOps\/operationAccessMap\.ts/i);
  assert.doesNotMatch(code, /^import /m);
});
