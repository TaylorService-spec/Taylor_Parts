// EOS STOCK RELOCATION over PostgreSQL (Controller ruling DQ-036, 2026-09-28): the EXISTING relocation on the EOS
// transport, INACTIVE behind its activation gate, with governed warehouse scope enforced by the server.
// Real database: migrate -> a tenant, one operating company, two warehouses, bins, catalog parts, ledger evidence
// -> governed personas from the SAME tables Administration writes. Proves:
//   * NOT_ACTIVATED by default (the governed constant), before anything is read or written;
//   * capability + WAREHOUSE_OPERATIONS eligibility + WAREHOUSE scope for the custody warehouse;
//   * the same business rules as the Firestore command: exact-source sufficiency, CROSS_WAREHOUSE, LOT refused,
//     serial required/forbidden, serial must be AVAILABLE at the source, retired bin, inactive part;
//   * the RELOCATION_OUT/IN pair (one per serial), the custody pointer moving in the same transaction, one audit;
//   * replay by intent (same -> replayed, nothing written; different -> IDEMPOTENCY_CONFLICT; partial -> INTEGRITY);
//   * DQ-019: an impossible ledger or custody/ledger disagreement fails closed;
//   * put-away placement is refused on EOS (no PostgreSQL placement authority yet), never silently dropped.
// Set POLICY_TEST_DATABASE_URL to run (a dedicated database: this suite resets the schemas it declares).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import { createBin } from "../lib/eosOps/warehouseBinRepository.js";
import { handleOperationsRequest, RELOCATION_ROUTE } from "../lib/eosOps/eosOpsHttp.js";
import { RELOCATION_WRITER_AUTHORITY } from "../lib/inventoryLocation/stockRelocationWriterState.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-l3-rl";
const COMPANY_ID = "sample-co";
const COMPANY_KEY = "sample-co-synthetic";
const WH_A = "WH-A";
const WH_B = "WH-B";
const ACTOR = "uid-l3-rl-fixture";
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
    tx.createRole({ key: `l3RlRole${roleCounter}`, name: `L3 RL role ${roleCounter}`, description: null, origin: "CUSTOM", protected: false }));
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

async function call(subject, input, { state = "ACTIVE", operation = "relocateStock" } = {}) {
  const res = await handleOperationsRequest({
    reader: repo(), pool: repoPool(), ...(state === null ? {} : { relocationPostgresState: state }),
    verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }),
  }, {
    method: "POST", url: RELOCATION_ROUTE,
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
const move = (qty, key, over = {}) => ({ partId: PART, source: { type: "WAREHOUSE", locationId: WH_A }, destination: { type: "BIN", locationId: BIN_A1 }, quantity: qty, idempotencyKey: key, ...over });

const RELOCATE = ["inventory.stock.relocate"];
let MOVER, MOVER_B, NO_ELIG, NO_CAPS, NO_EMPLOYEE;

test("world", { skip: SKIP }, async () => {
  await reset();
  MOVER = await persona({ subject: "rl-mover-a", capabilities: RELOCATE });
  MOVER_B = await persona({ subject: "rl-mover-b", capabilities: RELOCATE, warehouses: [WH_B] });
  NO_ELIG = await persona({ subject: "rl-no-elig", capabilities: RELOCATE, eligibility: [] });
  NO_CAPS = await persona({ subject: "rl-no-caps", capabilities: [] });
  NO_EMPLOYEE = await persona({ subject: "rl-no-employee", capabilities: RELOCATE, employee: false });
  await receive(PART, "WAREHOUSE", WH_A, 10, "mv-a-1");
  await receive(PART, "BIN", BIN_B, 5, "mv-b-1");
  await receiveSerial("SN-1", "BIN", BIN_A1);
  await receiveSerial("SN-2", "BIN", BIN_A1);
});

test("the DEPLOYED default is NOT_ACTIVATED: refused before anything is read or written", { skip: SKIP }, async () => {
  assert.deepEqual({ ...RELOCATION_WRITER_AUTHORITY }, { firestore: "OPEN", postgres: "INACTIVE" });
  const before = await count("SELECT count(*) AS n FROM eos_ops.inventory_movements");
  refused(await call(MOVER, move(1, "k-inactive"), { state: null }), 503, "NOT_ACTIVATED");
  refused(await call(MOVER, { nonsense: true }, { state: null }), 503, "NOT_ACTIVATED", /not activated/);
  assert.equal(await count("SELECT count(*) AS n FROM eos_ops.inventory_movements"), before);
});

test("authority: capability, work eligibility, Employee link and the CUSTODY warehouse's scope -- each its own refusal", { skip: SKIP }, async () => {
  refused(await call(NO_CAPS, move(1, "k-a1")), 403, "CAPABILITY_MISSING");
  refused(await call(NO_ELIG, move(1, "k-a2")), 403, "WORK_ELIGIBILITY_MISSING");
  refused(await call(NO_EMPLOYEE, move(1, "k-a3")), 403, "EMPLOYEE_LINK_REQUIRED");
  refused(await call(MOVER_B, move(1, "k-a4")), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  assert.equal(await count("SELECT count(*) AS n FROM eos_ops.inventory_movements WHERE source_kind = 'STOCK_RELOCATION'"), 0);
});

test("a quantity move: one OUT/IN pair, exact source, the aggregate unchanged, one audit", { skip: SKIP }, async () => {
  const r = ok(await call(MOVER, move(4, "k-q1")));
  assert.equal(r.outcome, "relocated");
  assert.match(r.relocationId, /^srl_[0-9a-f]{40}$/);
  assert.equal(r.movementIds.length, 2);
  assert.equal(await onHand(PART, "WAREHOUSE", WH_A), 6);
  assert.equal(await onHand(PART, "BIN", BIN_A1), 4);
  const rows = (await q(`SELECT movement_type::text AS t, quantity_delta AS d, idempotency_key AS k, source_id FROM eos_ops.inventory_movements
                          WHERE source_kind = 'STOCK_RELOCATION' ORDER BY movement_type`)).rows;
  assert.deepEqual(rows.map((x) => [x.t, x.d, x.k, x.source_id]), [
    ["RELOCATION_OUT", -4, "stockRelocation:k-q1:out", r.relocationId],
    ["RELOCATION_IN", 4, "stockRelocation:k-q1:in", r.relocationId],
  ], "ordered by the movement_type enum: OUT is declared before IN");
  assert.equal(await count(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE action = 'stockRelocation.relocate' AND target_id = $1`, [r.relocationId]), 1);
});

test("replay by intent: same -> replayed, nothing written; different intent -> IDEMPOTENCY_CONFLICT; partial -> INTEGRITY", { skip: SKIP }, async () => {
  const again = ok(await call(MOVER, move(4, "k-q1")));
  assert.equal(again.outcome, "replayed");
  assert.equal(await count(`SELECT count(*) AS n FROM eos_ops.inventory_movements WHERE source_kind = 'STOCK_RELOCATION'`), 2);
  assert.equal(await count(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE action = 'stockRelocation.relocate'`), 1, "a replay is not audited again");
  refused(await call(MOVER, move(3, "k-q1")), 409, "IDEMPOTENCY_CONFLICT");
  refused(await call(MOVER, move(4, "k-q1", { destination: { type: "BIN", locationId: BIN_A2 } })), 409, "IDEMPOTENCY_CONFLICT");
  // A half-written prior move (only the OUT row) is an integrity failure, never "finish the rest".
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
             movement_type, quantity_delta, source_kind, source_id, idempotency_key, created_by)
           VALUES ('mv-half', $1, $2, $3, 'NONE', 'WAREHOUSE', $4, 'RELOCATION_OUT', -1, 'STOCK_RELOCATION', 'srl_x', 'stockRelocation:k-half:out', $5)`,
    [TENANT, COMPANY_KEY, PART, WH_A, ACTOR]);
  refused(await call(MOVER, move(1, "k-half")), 409, "INTEGRITY", /partial_prior_relocation/);
});

test("the same business refusals as the Firestore command", { skip: SKIP }, async () => {
  refused(await call(MOVER, move(100, "k-r1")), 412, "INSUFFICIENT_STOCK");
  // Exact source only: the 4 in BIN_A1 do not help a move out of BIN_A2.
  refused(await call(MOVER, move(1, "k-r2", { source: { type: "BIN", locationId: BIN_A2 }, destination: { type: "WAREHOUSE", locationId: WH_A } })), 412, "INSUFFICIENT_STOCK");
  refused(await call(MOVER, move(1, "k-r3", { destination: { type: "BIN", locationId: BIN_B } })), 412, "CROSS_WAREHOUSE");
  refused(await call(MOVER, move(1, "k-r4", { destination: { type: "BIN", locationId: BIN_A_RETIRED } })), 412, "RETIRED_BIN");
  refused(await call(MOVER, move(1, "k-r5", { partId: PART_LOT })), 400, "INVALID", /lot_not_supported/);
  refused(await call(MOVER, move(1, "k-r6", { partId: PART_OFF })), 400, "INVALID", /part_not_active/);
  refused(await call(MOVER, move(1, "k-r7", { partId: "NOPE" })), 404, "NOT_FOUND", /part_not_found/);
  refused(await call(MOVER, move(1, "k-r8", { partId: PART_SER })), 400, "INVALID", /serial_numbers_required/);
  refused(await call(MOVER, { ...move(1, "k-r9"), quantity: undefined, serialNumbers: ["SN-1"] }), 400, "INVALID", /serial_numbers_not_allowed/);
  refused(await call(MOVER, move(1, "k-r10", { destination: { type: "WAREHOUSE", locationId: WH_A } })), 400, "INVALID", /same_location/);
  refused(await call(MOVER, move(1, "k-r11", { destination: { type: "BIN", locationId: "no-such-bin" } })), 404, "NOT_FOUND", /bin_not_found/);
  refused(await call(MOVER, { ...move(1, "k-r12"), tenantId: "other" }), 400, "INVALID", /unknown_field/);
  // Put-away placement: no PostgreSQL authority yet -- refused, never silently dropped.
  refused(await call(MOVER, move(1, "k-r13", { recordPlacement: true })), 412, "PLACEMENT_NOT_ON_EOS");
  assert.equal(await count(`SELECT count(*) AS n FROM eos_ops.inventory_movements WHERE idempotency_key LIKE 'stockRelocation:k-r%'`), 0);
});

test("serialized: one pair PER SERIAL, the custody pointer moves in the same transaction; a unit elsewhere is refused", { skip: SKIP }, async () => {
  const sm = (serials, key, over = {}) => ({ partId: PART_SER, source: { type: "BIN", locationId: BIN_A1 }, destination: { type: "BIN", locationId: BIN_A2 }, serialNumbers: serials, idempotencyKey: key, ...over });
  const r = ok(await call(MOVER, sm(["SN-1", "SN-2"], "k-s1")));
  assert.equal(r.movementIds.length, 4);
  assert.equal(r.quantity, null);
  const where = (await q(`SELECT serial_number, location_type::text AS t, location_id FROM eos_ops.serialized_custody WHERE part_id = $1 ORDER BY serial_number`, [PART_SER])).rows;
  assert.deepEqual(where.map((w) => [w.serial_number, w.t, w.location_id]), [["SN-1", "BIN", BIN_A2], ["SN-2", "BIN", BIN_A2]]);
  assert.equal(ok(await call(MOVER, sm(["SN-1", "SN-2"], "k-s1"))).outcome, "replayed");
  refused(await call(MOVER, sm(["SN-1"], "k-s2")), 412, "SERIAL_NOT_AT_SOURCE", /serial_elsewhere/);
  refused(await call(MOVER, sm(["SN-404"], "k-s3")), 404, "NOT_FOUND", /serial_not_found/);
  await q(`UPDATE eos_ops.serialized_custody SET status = 'RESERVED' WHERE serial_number = 'SN-2'`);
  refused(await call(MOVER, sm(["SN-2"], "k-s4", { source: { type: "BIN", locationId: BIN_A2 }, destination: { type: "BIN", locationId: BIN_A1 } })), 412, "SERIAL_NOT_AT_SOURCE", /serial_not_available/);
});

test("DQ-019: an impossible ledger or custody the ledger does not support fails closed", { skip: SKIP }, async () => {
  // A negative balance at the source is a ledger defect, never a quantity.
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
             movement_type, quantity_delta, source_kind, source_id, created_by)
           VALUES ('mv-neg', $1, $2, $3, 'NONE', 'BIN', $4, 'ADJUSTED', -9, 'TEST', 'mv-neg', $5)`, [TENANT, COMPANY_KEY, PART, BIN_A2, ACTOR]);
  refused(await call(MOVER, move(1, "k-d1", { source: { type: "BIN", locationId: BIN_A2 }, destination: { type: "WAREHOUSE", locationId: WH_A } })), 412, "LEDGER_INTEGRITY");
  // Custody says SN-3 is in BIN_A1, but the ledger never put it there.
  await receiveSerial("SN-3", "BIN", BIN_A1, { ledger: false });
  refused(await call(MOVER, { partId: PART_SER, source: { type: "BIN", locationId: BIN_A1 }, destination: { type: "BIN", locationId: BIN_A2 }, serialNumbers: ["SN-3"], idempotencyKey: "k-d2" }),
    412, "LEDGER_INTEGRITY", /ledger_disagrees_with_custody/);
});

test("transport: closed table, identity only from the verifier", { skip: SKIP }, async () => {
  refused(await call(MOVER, move(1, "k-t1"), { operation: "createCycleCountSheet" }), 404);
  const res = await handleOperationsRequest({ reader: repo(), pool: repoPool(), relocationPostgresState: "ACTIVE",
    verifyToken: async () => { throw new Error("bad token"); } },
  { method: "POST", url: RELOCATION_ROUTE, headers: { authorization: "Bearer x" }, body: JSON.stringify({ operation: "relocateStock", input: move(1, "k-t2") }) });
  assert.equal(res.status, 401);
});

test("teardown", { skip: SKIP }, async () => { await pool?.end(); });
