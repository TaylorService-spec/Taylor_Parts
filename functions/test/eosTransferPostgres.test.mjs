// EOS TRANSFER over PostgreSQL: the EXISTING Transfer lifecycle (create / dispatch / receive / cancel) on the EOS
// transport, HELD behind its activation gate, with the DQ-024 per-act warehouse scope enforced by the server.
// Proves:
//   * NOT_ACTIVATED by default (the governed constant), before anything is read or written;
//   * DQ-024: create / cancel / dispatch need the ORIGIN's scope, receive the DESTINATION's; a truck end only
//     through its explicit binding;
//   * the same business rules as the Firestore command: LOT refused, same location, SAME_CUSTODY_PARENT (a move
//     inside one Warehouse is a relocation), inactive endpoint, exact-origin sufficiency, serial availability;
//   * TO-YYYY-###### numbering, the TRANSFER_OUT / TRANSFER_IN legs with the per-leg company, the serial unit
//     IN_TRANSIT at dispatch and moved only at receive, one audit per applied act;
//   * idempotency: create by key (replay / conflict), a repeated transition replays against its own rows.
// Set POLICY_TEST_DATABASE_URL to run (a dedicated database: this suite resets the schemas it declares).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import { createBin } from "../lib/eosOps/warehouseBinRepository.js";
import { handleOperationsRequest, TRANSFER_ROUTE } from "../lib/eosOps/eosOpsHttp.js";
import { TRANSFER_WRITER_AUTHORITY } from "../lib/inventoryTransfer/transferWriterState.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-l3-tr";
const COMPANY_ID = "sample-co";
const COMPANY_KEY = "sample-co-synthetic";
const WH_A = "WH-A";
const WH_B = "WH-B";
const ACTOR = "uid-l3-tr-fixture";
const PART = "PRT-RL-1";
const PART_SER = "PRT-RL-SER";
const PART_LOT = "PRT-RL-LOT";
const PART_OFF = "PRT-RL-OFF";

let pool = null;
let roleCounter = 0;
const repoPool = () => (pool ??= new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 6 })));
const repo = () => new PostgresPolicyRepository(repoPool());
const q = (text, values = []) => repoPool().query(text, values);
const count = async (sql, v = []) => Number((await q(sql, v)).rows[0].n);

let BIN_A1 = null, BIN_A2 = null, BIN_A_RETIRED = null, BIN_B = null;

async function reset() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  for (const schema of declaredSchemas()) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query("DROP TABLE IF EXISTS pgmigrations");
  await client.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
  await q("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1)", [TENANT]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ($1, $2, 'ACTIVE', 'l3-test', $3, $3)`, [TENANT, COMPANY_ID, ACTOR]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ($1, $2, $3, 'ACTIVE', 'NATIVE', 'l3-test', $4, $4)`, [TENANT, COMPANY_ID, COMPANY_KEY, ACTOR]);
  for (const wh of [WH_A, WH_B]) {
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
             VALUES ($1, $2, $3, $1, 'Synthetic', 'ACTIVE', 'NATIVE', $4, $4)`, [wh, TENANT, COMPANY_KEY, ACTOR]);
  }
  const bin = async (wh, aisle, key) => (await createBin(repoPool(), TENANT, ACTOR, { warehouseId: wh, area: "MAIN", aisle, bay: 1, position: 1, idempotencyKey: key })).id;
  BIN_A1 = await bin(WH_A, "A", "b-a1");
  BIN_A2 = await bin(WH_A, "B", "b-a2");
  BIN_A_RETIRED = await bin(WH_A, "C", "b-a3");
  BIN_B = await bin(WH_B, "A", "b-b1");
  await q(`UPDATE eos_ops.bins SET status = 'INACTIVE' WHERE id = $1`, [BIN_A_RETIRED]);
  for (const [truck, bound] of [["truck-a", WH_A], ["truck-unbound", null]]) {
    await q(`INSERT INTO eos_ops.mobile_locations (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by)
             VALUES ($1, 'MOBILE', $2, $3, $2, true, $4, $4)`, [TENANT, truck, COMPANY_KEY, ACTOR]);
    if (bound) {
      await q(`INSERT INTO eos_ops.mobile_location_scope_bindings (id, tenant_id, location_type, location_id, warehouse_id, established_by, reason)
               VALUES ($1, $2, 'MOBILE', $3, $4, $5, 'fixture')`, [`msb-${truck}`, TENANT, truck, bound, ACTOR]);
    }
  }
  for (const [id, status, control] of [[PART, "ACTIVE", "STANDARD"], [PART_SER, "ACTIVE", "SERIALIZED"], [PART_LOT, "ACTIVE", "LOT"], [PART_OFF, "INACTIVE", "STANDARD"]]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($2, $1, 'seed', $2, 'rl proof part', $3, 'EACH', $4, 'STOCKED', false, false, false, false, 1, 'seed')`, [TENANT, id, status, control]);
  }
}

async function receive(partId, locationType, locationId, qty, id) {
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
             movement_type, quantity_delta, source_kind, source_id, created_by)
           VALUES ($1, $2, $3, $4, 'NONE', $5, $6, 'RECEIVED', $7, 'TEST', $1, $8)`,
    [id, TENANT, COMPANY_KEY, partId, locationType, locationId, qty, ACTOR]);
}
async function receiveSerial(serial, locationType, locationId, { ledger = true } = {}) {
  if (ledger) {
    await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
               movement_type, quantity_delta, serial_number, source_kind, source_id, created_by)
             VALUES ($1, $2, $3, $4, 'SERIAL', $5, $6, 'RECEIVED', 1, $7, 'TEST', $1, $8)`,
      [`mv-${serial}`, TENANT, COMPANY_KEY, PART_SER, locationType, locationId, serial, ACTOR]);
  }
  await q(`INSERT INTO eos_ops.serialized_custody (id, tenant_id, operating_company_key, part_id, serial_number, status, location_type, location_id, updated_by)
           VALUES ($1, $2, $3, $4, $5, 'AVAILABLE', $6, $7, $8)`, [`ser-${serial}`, TENANT, COMPANY_KEY, PART_SER, serial, locationType, locationId, ACTOR]);
}

async function persona({ subject, capabilities = [], employee = true, eligibility = ["WAREHOUSE_OPERATIONS"], warehouses = [WH_A] }) {
  const r = repo();
  const actorFor = { tenantId: TENANT, uid: ACTOR };
  const principalId = await r.transact(actorFor, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  roleCounter += 1;
  const role = await r.transact(actorFor, (tx) =>
    tx.createRole({ key: `l3TrRole${roleCounter}`, name: `L3 TR role ${roleCounter}`, description: null, origin: "CUSTOM", protected: false }));
  for (const key of capabilities) {
    const { rowCount } = await q(
      `INSERT INTO eos_policy.role_capabilities (id, tenant_id, role_id, capability_id, granted_by, created_by, updated_by)
       SELECT $1, $2, $3, c.id, $4, $4, $4 FROM eos_policy.capabilities c WHERE c.key = $5`,
      [`rc_${role.id}_${key}`, TENANT, role.id, ACTOR, key]);
    assert.equal(rowCount, 1, `no capability named "${key}"`);
  }
  await r.transact(actorFor, async (tx) => {
    const av = await tx.bumpAccessVersion(principalId);
    return tx.createAssignment({ principalId, roleId: role.id, scopeType: "global", scopeValue: null, status: "active",
      grantedBy: ACTOR, grantedAt: new Date().toISOString(), accessVersionAtGrant: av });
  });
  if (employee) {
    const employeeId = `emp-${subject}`;
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1, $2, 'ACTIVE', $3)`,
      [employeeId, TENANT, COMPANY_ID]);
    await q(`INSERT INTO eos_policy.employee_principal_links
               (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason)
             VALUES ($1, $2, $3, $4, $5, 'OPERATOR_ASSERTED', 'active', $6, 'L3 relocation fixture')`,
      [`epl_${subject}`, TENANT, principalId, employeeId, COMPANY_ID, ACTOR]);
    for (const code of eligibility) {
      await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
               VALUES ($1, $2, $3, $4, now(), $5)`, [`we_${subject}_${code}`, TENANT, employeeId, code, ACTOR]);
    }
    for (const wh of warehouses) {
      await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
               VALUES ($1, $2, $3, 'WAREHOUSE', $4, now(), $5)`, [`os_${subject}_${wh}`, TENANT, employeeId, wh, ACTOR]);
    }
  }
  return subject;
}

async function call(subject, operation, input, { state = "ACTIVE" } = {}) {
  const res = await handleOperationsRequest({
    reader: repo(), pool: repoPool(), ...(state === null ? {} : { transferPostgresState: state }),
    verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }),
  }, {
    method: "POST", url: TRANSFER_ROUTE,
    headers: { authorization: `Bearer ${subject}`, "content-type": "application/json" },
    body: JSON.stringify({ operation, input }),
  });
  return { status: res.status, body: JSON.parse(res.body) };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
const refused = (r, status, code, message) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (code) assert.equal(r.body.code, code, JSON.stringify(r.body));
  if (message) assert.match(r.body.message, message);
};
const onHand = async (partId, type, id) => Number((await q(
  `SELECT COALESCE(SUM(quantity_delta),0)::int AS n FROM eos_ops.inventory_movements WHERE tenant_id=$1 AND part_id=$2 AND location_type=$3 AND location_id=$4`,
  [TENANT, partId, type, id])).rows[0].n);
const W = (id) => ({ type: "WAREHOUSE", locationId: id });
const B = (id) => ({ type: "BIN", locationId: id });
const M = (id) => ({ type: "MOBILE", locationId: id });
const req = (qty, key, over = {}) => ({ partId: PART, origin: W(WH_A), destination: W(WH_B), quantity: qty, idempotencyKey: key, ...over });

const ALL = ["inventory.transfer.create", "inventory.transfer.dispatch", "inventory.transfer.receive", "inventory.transfer.cancel"];
let OP_A, OP_B, OP_AB, NO_ELIG, NO_CAPS;

test("world", { skip: SKIP }, async () => {
  await reset();
  OP_A = await persona({ subject: "tr-op-a", capabilities: ALL });
  OP_B = await persona({ subject: "tr-op-b", capabilities: ALL, warehouses: [WH_B] });
  OP_AB = await persona({ subject: "tr-op-ab", capabilities: ALL, warehouses: [WH_A, WH_B] });
  NO_ELIG = await persona({ subject: "tr-no-elig", capabilities: ALL, eligibility: [] });
  NO_CAPS = await persona({ subject: "tr-no-caps", capabilities: [] });
  await receive(PART, "WAREHOUSE", WH_A, 10, "mv-a-1");
  await receiveSerial("SN-1", "WAREHOUSE", WH_A);
  await receiveSerial("SN-2", "WAREHOUSE", WH_A);
});

test("the DEPLOYED default is NOT_ACTIVATED (HELD): refused before anything is read or written", { skip: SKIP }, async () => {
  assert.deepEqual({ ...TRANSFER_WRITER_AUTHORITY }, { firestore: "OPEN", postgres: "INACTIVE" });
  for (const op of ["createTransfer", "dispatchTransfer", "receiveTransfer", "cancelTransfer"]) {
    refused(await call(OP_A, op, {}, { state: null }), 503, "NOT_ACTIVATED");
  }
  assert.equal(await count("SELECT count(*) AS n FROM eos_ops.transfer_orders"), 0);
});

test("create: capability, eligibility, ORIGIN scope; the same input refusals as the Firestore command", { skip: SKIP }, async () => {
  refused(await call(NO_CAPS, "createTransfer", req(1, "k-c1")), 403, "CAPABILITY_MISSING");
  refused(await call(NO_ELIG, "createTransfer", req(1, "k-c2")), 403, "WORK_ELIGIBILITY_MISSING");
  refused(await call(OP_B, "createTransfer", req(1, "k-c3")), 403, "OUTSIDE_OPERATIONAL_SCOPE", /outside your operational scope/);
  refused(await call(OP_A, "createTransfer", req(1, "k-c4", { partId: PART_LOT })), 400, "PART_INVALID", /LOT/);
  refused(await call(OP_A, "createTransfer", req(1, "k-c5", { partId: PART_OFF })), 400, "PART_INVALID", /not active/);
  refused(await call(OP_A, "createTransfer", req(1, "k-c6", { destination: W(WH_A) })), 400, "SAME_LOCATION");
  refused(await call(OP_A, "createTransfer", req(1, "k-c7", { destination: B(BIN_A1) })), 412, "SAME_CUSTODY_PARENT");
  refused(await call(OP_A, "createTransfer", req(1, "k-c8", { destination: B(BIN_A_RETIRED) })), 400, "DESTINATION_INVALID");
  refused(await call(OP_A, "createTransfer", req(11, "k-c9")), 412, "INSUFFICIENT_STOCK");
  refused(await call(OP_A, "createTransfer", req(1, "k-c10", { origin: M("truck-unbound"), destination: W(WH_A) })), 412, "MOBILE_SCOPE_BINDING_MISSING");
  refused(await call(OP_A, "createTransfer", req(1, "k-c11", { partId: PART_SER })), 400, "SERIAL_INVALID");
  assert.equal(await count("SELECT count(*) AS n FROM eos_ops.transfer_orders"), 0);
});

let T1 = null;
test("the NONE lifecycle: create (numbered) -> dispatch (OUT at origin) -> receive (IN at destination); replay and conflict", { skip: SKIP }, async () => {
  const c = ok(await call(OP_A, "createTransfer", req(4, "k-t1")));
  assert.equal(c.outcome, "applied");
  assert.match(c.transferOrderNumber, /^TO-\d{4}-000001$/);
  T1 = c.transferOrderId;
  assert.equal(ok(await call(OP_A, "createTransfer", req(4, "k-t1"))).outcome, "replayed");
  refused(await call(OP_A, "createTransfer", req(3, "k-t1")), 409, "IDEMPOTENCY_CONFLICT");
  // DQ-024: receive is the DESTINATION's act -- the origin's operator may not; dispatch is the ORIGIN's.
  refused(await call(OP_B, "dispatchTransfer", { transferOrderId: T1 }), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  refused(await call(OP_A, "receiveTransfer", { transferOrderId: T1 }), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  refused(await call(OP_B, "receiveTransfer", { transferOrderId: T1 }), 412, "STATUS_INVALID");
  const d = ok(await call(OP_A, "dispatchTransfer", { transferOrderId: T1 }));
  assert.equal(d.ledgerEventIds.length, 1);
  assert.equal(await onHand(PART, "WAREHOUSE", WH_A), 6);
  assert.deepEqual(ok(await call(OP_A, "dispatchTransfer", { transferOrderId: T1 })), { outcome: "replayed", transferOrderId: T1, ledgerEventIds: d.ledgerEventIds });
  refused(await call(OP_A, "cancelTransfer", { transferOrderId: T1 }), 412, "STATUS_INVALID", /before dispatch/);
  const r = ok(await call(OP_B, "receiveTransfer", { transferOrderId: T1 }));
  assert.equal(await onHand(PART, "WAREHOUSE", WH_B), 4);
  assert.equal(ok(await call(OP_B, "receiveTransfer", { transferOrderId: T1 })).outcome, "replayed");
  assert.deepEqual((await q(`SELECT status::text AS s FROM eos_ops.transfer_orders WHERE id = $1`, [T1])).rows[0].s, "COMPLETED");
  const legs = (await q(`SELECT movement_type::text AS t, quantity_delta AS d, location_id, operating_company_key FROM eos_ops.inventory_movements
                          WHERE source_kind = 'TRANSFER_ORDER' AND source_id = $1 ORDER BY movement_type`, [T1])).rows;
  assert.deepEqual(legs.map((l) => [l.t, l.d, l.location_id]), [["TRANSFER_OUT", -4, WH_A], ["TRANSFER_IN", 4, WH_B]]);
  assert.equal(r.ledgerEventIds.length, 1);
  assert.equal(await count(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE target_kind = 'transferOrder' AND target_id = $1`, [T1]), 3,
    "create + dispatch + receive, each once; replays write nothing");
});

test("cancel: ORIGIN scope, REQUESTED only, a repeat is a replay; nothing moves", { skip: SKIP }, async () => {
  const c = ok(await call(OP_A, "createTransfer", req(1, "k-t2")));
  refused(await call(OP_B, "cancelTransfer", { transferOrderId: c.transferOrderId }), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  assert.equal(ok(await call(OP_A, "cancelTransfer", { transferOrderId: c.transferOrderId })).outcome, "applied");
  assert.equal(ok(await call(OP_A, "cancelTransfer", { transferOrderId: c.transferOrderId })).outcome, "replayed");
  refused(await call(OP_A, "dispatchTransfer", { transferOrderId: c.transferOrderId }), 412, "STATUS_INVALID");
  assert.equal(await count(`SELECT count(*) AS n FROM eos_ops.inventory_movements WHERE source_id = $1`, [c.transferOrderId]), 0);
  refused(await call(OP_A, "cancelTransfer", { transferOrderId: "trf_nope" }), 404, "TRANSFER_NOT_FOUND");
});

test("SERIAL: available at the origin; IN_TRANSIT at dispatch without moving; moved only at receive", { skip: SKIP }, async () => {
  const c = ok(await call(OP_A, "createTransfer", { partId: PART_SER, origin: W(WH_A), destination: M("truck-a"), quantity: 1, serialNumbers: ["SN-1"], idempotencyKey: "k-s1" }));
  // A second transfer of the same unit is fine to REQUEST; it can no longer be dispatched once the first has left.
  const c2 = ok(await call(OP_A, "createTransfer", { partId: PART_SER, origin: W(WH_A), destination: W(WH_B), quantity: 1, serialNumbers: ["SN-1"], idempotencyKey: "k-s2" }));
  ok(await call(OP_A, "dispatchTransfer", { transferOrderId: c.transferOrderId }));
  const unit = async () => (await q(`SELECT status::text AS s, location_type::text AS t, location_id FROM eos_ops.serialized_custody WHERE serial_number = 'SN-1'`)).rows[0];
  assert.deepEqual({ ...(await unit()) }, { s: "IN_TRANSIT", t: "WAREHOUSE", location_id: WH_A });
  refused(await call(OP_A, "dispatchTransfer", { transferOrderId: c2.transferOrderId }), 412, "INSUFFICIENT_STOCK", /not AVAILABLE/);
  refused(await call(OP_A, "createTransfer", { partId: PART_SER, origin: W(WH_A), destination: W(WH_B), quantity: 1, serialNumbers: ["SN-1"], idempotencyKey: "k-s3" }), 412, "INSUFFICIENT_STOCK");
  // The truck destination is scoped through its binding to WH_A: OP_A receives there.
  ok(await call(OP_A, "receiveTransfer", { transferOrderId: c.transferOrderId }));
  assert.deepEqual({ ...(await unit()) }, { s: "AVAILABLE", t: "MOBILE", location_id: "truck-a" });
  refused(await call(OP_A, "createTransfer", { partId: PART_SER, origin: W(WH_A), destination: W(WH_B), quantity: 2, serialNumbers: ["SN-1", "SN-1"], idempotencyKey: "k-s4" }), 400, "SERIAL_INVALID");
});

test("transfer numbers are sequential per tenant and year", { skip: SKIP }, async () => {
  const nums = (await q(`SELECT transfer_order_number AS n FROM eos_ops.transfer_orders WHERE tenant_id = $1 ORDER BY transfer_order_number`, [TENANT])).rows.map((r) => r.n);
  assert.equal(new Set(nums).size, nums.length);
  assert.deepEqual(nums.map((n) => Number(n.slice(-6))), nums.map((_, i) => i + 1));
});

test("the migration's down refuses while a Transfer number has been allocated", { skip: SKIP }, async () => {
  const sql = (await import("node:fs")).readFileSync("migrations/1764122400000_transfer-eos-lifecycle-support.sql", "utf8").split("-- Down Migration")[1];
  await assert.rejects(q(sql), /TRANSFER_EOS_LIFECYCLE_SUPPORT: refuses to reverse/);
});

test("teardown", { skip: SKIP }, async () => { await pool?.end(); });
