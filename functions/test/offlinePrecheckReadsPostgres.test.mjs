// THE OFFLINE PRECHECKS, FED BY THE REAL SERVER (Firebase exit B3-x; DECISIONS #B3-x).
//
// The warehouse offline queue's prechecks (field-ops-app-vite/src/offline/warehousePrechecks.js) re-read current state before a queued request is
// sent: a cancelled transfer is spared a dispatch, a receive that reconnects before its dispatch WAITS, a retired bin is a conflict, a count that
// was already reconciled is not argued with. Before B3-x the app injected NONE of the three reads, so none of that ran. This drives the REAL read
// adapters (offline/warehousePrecheckReads.js) against the REAL operations over a real postgres:16 -- the HTTP handler, the verified-bearer path, the
// capability + WAREHOUSE-scope checks -- and feeds the answers to the REAL precheck decisions. A shape the client assumed and the server does not
// send would fail here, not in a warehouse.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { createWarehousePrecheckReads } from "../../field-ops-app-vite/src/offline/warehousePrecheckReads.js";
import { buildWarehousePrechecks } from "../../field-ops-app-vite/src/offline/warehousePrechecks.js";
import { WAREHOUSE_INTENT } from "../../field-ops-app-vite/src/offline/warehouseIntent.js";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { handleOperationsRequest } = require("../lib/eosOps/eosOpsHttp.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const BIN_ACTIVE = `bin_${"a".repeat(40)}`;
const BIN_RETIRED = `bin_${"b".repeat(40)}`;

test("Offline prechecks over the real server: transfers, bins and counts", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `opr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  await certifyInventoryBaselineFixture(q, "t1");
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ('t1','taylor','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sample-co','ACTIVE','NATIVE','fixture','f','f')`);
  for (const wh of ["wh-1", "wh-2", "wh-3"]) {
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
             VALUES ($1,'t1','sample-co',$1,'Sampleton','ACTIVE','NATIVE','fixture','fixture')`, [wh]);
  }
  await q(`INSERT INTO eos_ops.bins (id, tenant_id, warehouse_id, area, aisle, bay, position, code, status, idempotency_key, created_by, updated_by)
           VALUES ($1,'t1','wh-1','MAIN','A',1,1,'MAIN-A-1-1','ACTIVE','bin-fixture-a','fixture','fixture'),
                  ($2,'t1','wh-1','MAIN','A',1,2,'MAIN-A-1-2','INACTIVE','bin-fixture-b','fixture','fixture')`, [BIN_ACTIVE, BIN_RETIRED]);
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class, expiry_tracked,
             consumable, returnable_core, whole_unit, version, updated_by)
           VALUES ('P','t1','fixture','P','P','ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`);
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta, source_kind, source_id, created_by)
           VALUES ('mv-1','t1','sample-co','P','NONE','WAREHOUSE','wh-1','RECEIVED',10,'FIXTURE','fixture','fixture')`);

  // A worker in wh-1 only: reads transfers and locations, counts, and holds Warehouse Operations eligibility.
  const principal = await repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: "uid-worker", identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const role = await repo.transact({ tenantId: "t1", uid: "uid-fixture" }, (tx) =>
    tx.createRole({ key: "offlinePrecheckWorker", name: "Offline precheck worker", description: null, origin: "CUSTOM", protected: false }));
  for (const key of ["warehouse.transferOrder.read", "inventory.transaction.read", "inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.cycleCount.cancel"]) {
    const { rowCount } = await q(
      `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       SELECT $1, 't1', $2, c.id, 'fixture', 'fixture', 'fixture' FROM eos_policy.capabilities c WHERE c.key = $3`, [`rc_${role.id}_${key}`, role.id, key]);
    assert.equal(rowCount, 1, `no capability named ${key}`);
  }
  await repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
    const av = await tx.bumpAccessVersion(principal);
    return tx.createAssignment({ principalId: principal, roleId: role.id, scopeType: "global", scopeValue: null, status: "active", grantedBy: "fixture",
      grantedAt: new Date().toISOString(), accessVersionAtGrant: av });
  });
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ('e-w','t1','ACTIVE','taylor','2020-01-01T00:00:00Z')`);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason)
           VALUES ('epl-w','t1',$1,'e-w','taylor','OPERATOR_ASSERTED','active','fixture','test')`, [principal]);
  await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
           VALUES ('we-w','t1','e-w','WAREHOUSE_OPERATIONS', now(), 'fixture')`);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-w','t1','e-w','WAREHOUSE','wh-1', now(),'fixture')`);

  let n = 0;
  const transfer = (id, status, from, to) => q(
    `INSERT INTO eos_ops.transfer_orders (id, tenant_id, source_operating_company_key, destination_operating_company_key, part_id, tracking_mode, quantity,
       origin_location_type, origin_location_id, destination_location_type, destination_location_id, status, idempotency_key, created_by, updated_by)
     VALUES ($1,'t1','sample-co','sample-co','P','NONE',2,'WAREHOUSE',$3,'WAREHOUSE',$4,$2,$5,'fixture','fixture')`, [id, status, from, to, `idem-tr-${++n}`]);
  await transfer("tr-requested", "REQUESTED", "wh-1", "wh-2");
  await transfer("tr-transit", "IN_TRANSIT", "wh-1", "wh-2");
  await transfer("tr-done", "COMPLETED", "wh-1", "wh-2");
  await transfer("tr-cancelled", "CANCELLED", "wh-1", "wh-2");
  await transfer("tr-foreign", "REQUESTED", "wh-2", "wh-3");  // neither end in the worker's scope

  /** The injected transport: the REAL handler, a bearer for the worker, the route and the operation -- and a refusal throws, exactly as the client does. */
  const callOp = async (route, operation, input) => {
    const res = await handleOperationsRequest({
      reader: repo, pool, cycleCountPostgresState: "ACTIVE",
      verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }),
    }, { method: "POST", url: route, headers: { authorization: "Bearer uid-worker", "content-type": "application/json" }, body: JSON.stringify({ operation, input }) });
    const body = JSON.parse(res.body);
    if (res.status !== 200 || body.ok !== true) throw Object.assign(new Error(body.message ?? "refused"), { status: res.status, code: body.code });
    return body.result;
  };
  const reads = createWarehousePrecheckReads(callOp);
  const prechecks = buildWarehousePrechecks(reads);
  const at = (type, payload) => prechecks[type]({ payload });

  await t.test("the transfer read returns the id and status the precheck keys on; a transfer outside the scope is simply not there", async () => {
    assert.deepEqual(await reads.readTransfer("tr-cancelled"), { id: "tr-cancelled", status: "CANCELLED" });
    assert.deepEqual(await reads.readTransfer("tr-transit"), { id: "tr-transit", status: "IN_TRANSIT" });
    assert.equal(await reads.readTransfer("tr-foreign"), null, "outside the caller's warehouse scope: not disclosed");
    assert.equal(await reads.readTransfer("tr-nonexistent"), null);
  });

  await t.test("DISPATCH: a cancelled transfer is spared, an already-dispatched one reconciles, a requested one proceeds, an unreadable one lets the command answer", async () => {
    assert.deepEqual(await at(WAREHOUSE_INTENT.TRANSFER_DISPATCH, { transferOrderId: "tr-cancelled" }), { proceed: false, code: "failed-precondition", details: "TRANSFER_CANCELLED" });
    const done = await at(WAREHOUSE_INTENT.TRANSFER_DISPATCH, { transferOrderId: "tr-transit" });
    assert.deepEqual([done.alreadySatisfied, done.reconciled, done.serverIds.status], [true, true, "IN_TRANSIT"]);
    assert.deepEqual(await at(WAREHOUSE_INTENT.TRANSFER_DISPATCH, { transferOrderId: "tr-requested" }), { proceed: true });
    assert.deepEqual(await at(WAREHOUSE_INTENT.TRANSFER_DISPATCH, { transferOrderId: "tr-foreign" }), { proceed: true });
  });

  await t.test("RECEIVE: reconnecting before the dispatch WAITS (retryable), a completed transfer reconciles, one in transit proceeds", async () => {
    assert.deepEqual(await at(WAREHOUSE_INTENT.TRANSFER_RECEIVE, { transferOrderId: "tr-requested" }), { proceed: false, code: "unavailable", details: "AWAITING_DISPATCH", retryable: true });
    const done = await at(WAREHOUSE_INTENT.TRANSFER_RECEIVE, { transferOrderId: "tr-done" });
    assert.deepEqual([done.alreadySatisfied, done.serverIds.status], [true, "COMPLETED"]);
    assert.deepEqual(await at(WAREHOUSE_INTENT.TRANSFER_RECEIVE, { transferOrderId: "tr-transit" }), { proceed: true });
    assert.equal((await at(WAREHOUSE_INTENT.TRANSFER_RECEIVE, { transferOrderId: "tr-cancelled" })).details, "TRANSFER_CANCELLED");
  });

  await t.test("PUT-AWAY: a retired bin is a conflict (nothing substituted), an active or unknown bin proceeds; a staged pick inherits the check", async () => {
    assert.deepEqual(await reads.readBin(BIN_ACTIVE), { id: BIN_ACTIVE, status: "ACTIVE" });
    assert.deepEqual(await reads.readBin(BIN_RETIRED), { id: BIN_RETIRED, status: "INACTIVE" });
    assert.deepEqual(await at(WAREHOUSE_INTENT.PUT_AWAY, { destinationBinId: BIN_RETIRED }), { proceed: false, code: "failed-precondition", details: "BIN_NOT_ACTIVE" });
    assert.deepEqual(await at(WAREHOUSE_INTENT.PICK_STAGE, { destinationBinId: BIN_RETIRED }), { proceed: false, code: "failed-precondition", details: "BIN_NOT_ACTIVE" });
    assert.deepEqual(await at(WAREHOUSE_INTENT.PUT_AWAY, { destinationBinId: BIN_ACTIVE }), { proceed: true });
    assert.deepEqual(await at(WAREHOUSE_INTENT.PUT_AWAY, { destinationBinId: `bin_${"c".repeat(40)}` }), { proceed: true });
  });

  await t.test("COUNT: an open line proceeds; a cancelled line is refused; the line is found by its part, an unknown sheet answers null", async () => {
    const created = await callOp("/operations/cycle-count", "createCycleCountSheet", { location: { type: "WAREHOUSE", locationId: "wh-1" }, idempotencyKey: "opr-sheet" });
    const sheetId = created.sheet.sheetId;
    await callOp("/operations/cycle-count", "openCycleCountLine", { sheetId, partId: "P" });
    assert.deepEqual(await reads.readCycleCount({ sheetId, partId: "P" }), { status: "OPEN" });
    assert.deepEqual(await at(WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT, { sheetId, partId: "P", countedQuantity: 10 }), { proceed: true });
    assert.equal(await reads.readCycleCount({ sheetId, partId: "NO-SUCH-LINE" }), null, "no such line: the command answers");
    await callOp("/operations/cycle-count", "cancelCycleCountLine", { sheetId, partId: "P" });
    assert.deepEqual(await at(WAREHOUSE_INTENT.CYCLE_COUNT_SUBMIT, { sheetId, partId: "P", countedQuantity: 10 }), { proceed: false, code: "failed-precondition", details: "CYCLE_COUNT_CANCELLED" });
    assert.equal(await reads.readCycleCount({ sheetId: "ccs_does_not_exist", partId: "P" }), null);
  });

  await t.test("a read the caller may not make answers null -- the precheck then lets the command decide, it never invents a state", async () => {
    const denied = createWarehousePrecheckReads(async () => { throw Object.assign(new Error("no"), { status: 403, code: "FORBIDDEN" }); });
    assert.equal(await denied.readTransfer("tr-cancelled"), null);
    assert.equal(await denied.readBin(BIN_RETIRED), null);
    assert.equal(await denied.readCycleCount({ sheetId: "x", partId: "P" }), null);
  });
});
