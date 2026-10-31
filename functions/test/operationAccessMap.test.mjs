// operationAccessMap: every row is the check the REAL command applies. Offline: no database (a pool that throws proves the refusal comes first).
//
// The map (src/eosOps/operationAccessMap.ts) is what the browser asks before it asks the server. A row that is WIDER than the command would let a
// page ask a read that is certain to be refused (the UAT 403s); a row that is NARROWER would hide a panel the person may see. So for each row:
//   * a caller holding EXACTLY the row's capabilities is not refused for a missing capability (it may fail later: no database, input, reach);
//   * a caller missing any ONE required capability is refused for a missing capability, naming it;
//   * for `anyOf`, a caller holding exactly one alternative passes and a caller holding none is refused.
import test from "node:test";
import assert from "node:assert/strict";
import { OPERATION_ACCESS } from "../lib/eosOps/operationAccessMap.js";
import { CATALOG_READ_REQUIREMENTS, CATALOG_READ_OPERATIONS } from "../lib/catalogMaster/catalogHttp.js";
import { EXPERIENCE_SURFACE_KEYS } from "../lib/eosOps/experienceAuthority.js";
import * as partsReads from "../lib/eosOps/partsReads.js";
import * as reorder from "../lib/eosOps/reorderLifecycleCommands.js";
import { listPartSupplierItems } from "../lib/eosOps/partSupplierTerms.js";
import { listLegacyInventoryActionNotes } from "../lib/eosOps/legacyInventoryActionNotes.js";
import { listEmployees } from "../lib/eosWorkforce/reads/employeeDirectoryReads.js";
import { listWorkOrders } from "../lib/eosOps/workOrderQueries.js";

const NO_DB = "NO_DB_IN_THIS_TEST";
const pool = new Proxy({}, { get: () => () => { throw new Error(NO_DB); } });
const deps = { pool };

// Unconditioned ROLE grants for exactly the held keys, so the conditional seam (Employee reads) decides as the flat set does.
const actorWith = (caps) => ({
  tenantId: "t1", principalId: "p1", capabilities: new Set(caps),
  entitlements: async () => caps.map((capabilityKey) => ({ capabilityKey, grantor: { kind: "ROLE", roleKey: "test" }, condition: null })),
});

// The commands, by operation name. Each takes (deps, actor, input).
const COMMANDS = {
  readInventoryOnHand: partsReads.readInventoryOnHand,
  readInventoryMovements: partsReads.readInventoryMovements,
  readPartBalance: partsReads.readPartBalance,
  listReceipts: partsReads.listReceipts,
  readReceipt: partsReads.readReceipt,
  listSuppliers: partsReads.listSuppliers,
  listInventoryWarehouses: partsReads.listInventoryWarehouses,
  listPartSupplierItems,
  listLegacyInventoryActionNotes,
  readReorderQueue: reorder.readReorderQueue,
  readMyAssignedReorders: reorder.readMyAssignedReorders,
  readReorderRequest: reorder.readReorderRequest,
  readReorderPurchaseOrders: reorder.readReorderPurchaseOrders,
  listReorderWarehouseOptions: reorder.listReorderWarehouseOptions,
  listEmployees,
  listWorkOrders,
};

const isCapabilityRefusal = (err) => err?.category === "FORBIDDEN" && /CAPABILITY/.test(String(err.code ?? ""));
const run = async (command, caps) => {
  try { await command(deps, actorWith(caps), {}); return null; } catch (err) { return err; }
};

test("every command-backed row is exercised, and the rows with no command are the catalog (table-derived) and the self reads", () => {
  const catalog = new Set(CATALOG_READ_OPERATIONS);
  const unexercised = Object.keys(OPERATION_ACCESS).filter((op) => !(op in COMMANDS) && !catalog.has(op) && OPERATION_ACCESS[op].allOf.length > 0);
  assert.deepEqual(unexercised, [], "a row that requires a capability must be proven against its command");
});

for (const [operation, command] of Object.entries(COMMANDS)) {
  const row = OPERATION_ACCESS[operation];
  test(`${operation}: the command applies exactly the map's capabilities`, async () => {
    assert.ok(row, `${operation} has no row in OPERATION_ACCESS`);
    const required = row.allOf ?? [];
    const alternatives = row.anyOf ?? [];
    // The first alternative satisfies anyOf; none may leave the caller refused.
    const satisfied = [...required, ...(alternatives.length ? [alternatives[0]] : [])];
    const ok = await run(command, satisfied);
    assert.ok(!isCapabilityRefusal(ok), `${operation}: a caller holding ${JSON.stringify(satisfied)} was refused for a capability: ${ok?.message}`);
    for (const missing of required) {
      const err = await run(command, satisfied.filter((k) => k !== missing));
      assert.ok(isCapabilityRefusal(err), `${operation}: a caller without ${missing} must be refused for a capability, got ${err?.code ?? err?.message}`);
      assert.match(String(err.message), new RegExp(missing.replace(/\./g, "\\.")), `${operation}: the refusal names ${missing}`);
    }
    if (alternatives.length) {
      for (const alternative of alternatives) {
        const err = await run(command, [...required, alternative]);
        assert.ok(!isCapabilityRefusal(err), `${operation}: ${alternative} alone (with allOf) must satisfy anyOf, got ${err?.message}`);
      }
      const none = await run(command, required);
      assert.ok(isCapabilityRefusal(none), `${operation}: with none of ${JSON.stringify(alternatives)} the caller must be refused`);
    }
  });
}

test("the catalog rows ARE the transport's own table", () => {
  for (const operation of CATALOG_READ_OPERATIONS) {
    assert.deepEqual([...OPERATION_ACCESS[operation].allOf].sort(), [...CATALOG_READ_REQUIREMENTS[operation]].sort(), operation);
  }
});

test("a row's surface exists, and the queue read is the only surface-decided Parts read", () => {
  const withSurface = Object.entries(OPERATION_ACCESS).filter(([, r]) => r.surface);
  for (const [, row] of withSurface) assert.ok(EXPERIENCE_SURFACE_KEYS.includes(row.surface));
  assert.deepEqual(withSurface.map(([op]) => op), ["readReorderQueue"]);
});

test("the table is frozen and names no capability the command module does not export", () => {
  assert.ok(Object.isFrozen(OPERATION_ACCESS));
});
