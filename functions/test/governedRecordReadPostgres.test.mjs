// GOVERNED RECORD READ, PROVED AGAINST A REAL POSTGRESQL (Pass 11 Fix Wave 1).
//
// `readGovernedRecords` replaces the client-direct, Rules-gated Firestore list reads. Every row is admitted through the
// governed chain -- capability, condition, scope, record relationship -- from PostgreSQL Administration. The world
// (support/governedRuntimeHarness.mjs) gives every caller a legacy Firestore admin role the governed path must ignore.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SKIP, buildGovernedWorld } from "./support/governedRuntimeHarness.mjs";

const require = createRequire(import.meta.url);
const { readGovernedRecords, GovernedReadRefusal } = require("../lib/access/governedRecordRead.js");

test("governed record read: rows are admitted by PostgreSQL Administration, per record", { skip: SKIP, concurrency: 1 }, async (t) => {
  const { db, governed, admin, subjectOf, prnOf } = await buildGovernedWorld(t);
  const read = (k, surface, limit = 50) => readGovernedRecords({ db, governed, active: true }, subjectOf(k), { surface, limit });
  const refusedWith = (p, code) => assert.rejects(p, (e) => e instanceof GovernedReadRefusal && e.code === code, `expected ${code}`);

  await t.test("SALES READ: Retail and National Accounts read Customers", async () => {
    for (const k of ["retail-sales-a", "national-accounts-sales"]) assert.equal((await read(k, "accounts")).rows.length, 2, k);
  });

  await t.test("NEGATIVE: Sales reads no Work Orders or Warehouses despite a legacy admin role", async () => {
    await refusedWith(read("retail-sales-a", "workOrders"), "permission-denied");
    await refusedWith(read("retail-sales-a", "warehouses"), "permission-denied");
  });

  await t.test("NEGATIVE: General Employee is refused every surface", async () => {
    for (const s of ["workOrders", "accounts", "warehouses", "transferOrders", "purchaseOrders", "reorderRequests", "parts", "inventoryTransactions"]) {
      await refusedWith(read("restricted-user", s), "permission-denied");
    }
  });

  await t.test("PARTS / WAREHOUSE READ: exactly what each Role grants", async () => {
    assert.equal((await read("warehouse-manager", "warehouses")).rows.length, 1);
    assert.equal((await read("warehouse-manager", "transferOrders")).rows.length, 1);
    assert.equal((await read("warehouse-associate", "warehouses")).rows.length, 1);
    assert.equal((await read("parts-manager", "purchaseOrders")).rows.length, 1);
    assert.equal((await read("parts-associate", "parts")).rows.length, 1);
    await refusedWith(read("parts-associate", "purchaseOrders"), "permission-denied");
    await refusedWith(read("parts-associate", "warehouses"), "permission-denied");
  });

  await t.test("WORK ORDER READ: Owner, GM, Service Manager, Dispatcher read the board; Office Manager is refused (no governed read)", async () => {
    for (const k of ["owner-executive", "general-manager", "service-manager", "dispatcher"]) {
      const r = await read(k, "workOrders");
      assert.deepEqual([r.admission, r.rows.length], ["FLAT", 5], k);
    }
    await refusedWith(read("office-manager", "workOrders"), "permission-denied");
  });

  await t.test("TECHNICIAN, deployed (unconditioned) grant: flat -- which is why RECORD_ASSIGNMENT must precede deploy", async () => {
    assert.equal((await read("service-technician-a", "workOrders")).admission, "FLAT");
  });

  await t.test("TECHNICIAN with RECORD_ASSIGNMENT: own work only; B never sees A's; unresolved identity fails closed", async () => {
    const set = await admin("setGrantCondition", { objectKey: "workOrder", actionKey: "read", roleKey: "technician",
      reason: "TEST: assignment-limited technician read",
      condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } });
    assert.equal(set.ok, true, JSON.stringify(set));
    const a = await read("service-technician-a", "workOrders");
    assert.equal(a.admission, "CONDITIONED");
    assert.deepEqual(a.rows.map((r) => r.id).sort(), ["wo-1", "wo-5"]);
    assert.deepEqual((await read("service-technician-b", "workOrders")).rows.map((r) => r.id), ["wo-2"],
      "Technician B cannot read Technician A's assigned Work Orders");
    const c = await read("contract-technician", "workOrders");
    assert.deepEqual([c.rows, c.withheld], [[], 5], "no tenant-wide fallback for an unresolved assignment identity");
    assert.equal((await read("service-manager", "workOrders")).rows.length, 5, "managers untouched by the technician's condition");
  });

  await t.test("DIRECT EXCEPTION opens the governed read through the same resolver", async () => {
    await refusedWith(read("records-clerk", "accounts"), "permission-denied");
    const g = await admin("grantObjectActionToPrincipal", { objectKey: "account", actionKey: "read",
      principalId: prnOf("records-clerk"), reason: "TEST: direct exception" });
    assert.equal(g.ok, true, JSON.stringify(g));
    assert.equal((await read("records-clerk", "accounts")).rows.length, 2);
  });

  await t.test("rows keep the document id and stored data apart", async () => {
    const r = await read("dispatcher", "accounts");
    assert.deepEqual(r.rows.find((x) => x.id === "acct-1"), { id: "acct-1", data: { name: "Harbor Grill" } });
  });

  await t.test("INACTIVE ENVIRONMENT and FAIL CLOSED", async () => {
    await refusedWith(readGovernedRecords({ db, governed, active: false }, subjectOf("administrator"), { surface: "accounts", limit: 5 }), "failed-precondition");
    await refusedWith(readGovernedRecords({ db, governed: async () => ({ status: "UNAVAILABLE", detail: "down" }), active: true },
      subjectOf("administrator"), { surface: "accounts", limit: 5 }), "unavailable");
    await refusedWith(readGovernedRecords({ db, governed, active: true }, "uid-nobody", { surface: "accounts", limit: 5 }), "permission-denied");
  });
});
