// EOS BIN PLACEMENT (put-away) over PostgreSQL (Controller ruling DQ-038): the EXISTING placement record on the EOS
// transport, INACTIVE behind its activation gate. Proves:
//   * NOT_ACTIVATED by default, before anything is read or written;
//   * inventory.placement.record + WAREHOUSE_OPERATIONS + the stated warehouse's scope; the warehouse must be governed;
//   * the placement -> warehouse relationship is the server's: a bin of another warehouse is WRONG_WAREHOUSE, and the
//     table refuses a mismatched row even if a writer tried;
//   * the same record as the Firestore command: one row per serial, one for a quantity; pick and note; bin by id or
//     by code (a SUPERSEDED code still reaches its bin); an INACTIVE bin refused; a serial must be a unit of this part;
//   * NOTHING else is written: no ledger row, no custody change; placements are append-only history;
//   * replay by key (all identical -> replayed; partial or different -> IDEMPOTENCY_CONFLICT); one audit per stow.
// Set POLICY_TEST_DATABASE_URL to run (a dedicated database: this suite resets the schemas it declares).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import { createBin } from "../lib/eosOps/warehouseBinRepository.js";
import { handleOperationsRequest, PLACEMENT_ROUTE } from "../lib/eosOps/eosOpsHttp.js";
import { PLACEMENT_WRITER_AUTHORITY } from "../lib/inventoryLocation/placementWriterState.js";
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-l3-pl";
const COMPANY_ID = "sample-co";
const COMPANY_KEY = "sample-co-synthetic";
const WH_A = "WH-A";
const WH_B = "WH-B";
const ACTOR = "uid-l3-pl-fixture";
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
  await certifyInventoryBaselineFixture(q, TENANT); // the writer gate (inventoryBaselineGate.ts) -- this suite proves the writer itself
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
    tx.createRole({ key: `l3PlRole${roleCounter}`, name: `L3 PL role ${roleCounter}`, description: null, origin: "CUSTOM", protected: false }));
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

async function call(subject, input, { state = "ACTIVE" } = {}) {
  const res = await handleOperationsRequest({
    reader: repo(), pool: repoPool(), ...(state === null ? {} : { placementPostgresState: state }),
    verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }),
  }, {
    method: "POST", url: PLACEMENT_ROUTE,
    headers: { authorization: `Bearer ${subject}`, "content-type": "application/json" },
    body: JSON.stringify({ operation: "recordPutAway", input }),
  });
  return { status: res.status, body: JSON.parse(res.body) };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
const refused = (r, status, code, message) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (code) assert.equal(r.body.code, code, JSON.stringify(r.body));
  if (message) assert.match(r.body.message, message);
};
const stow = (over = {}) => ({ warehouseId: WH_A, partId: PART, binId: BIN_A1, quantity: 3, idempotencyKey: "k-1", ...over });
const PLACE = ["inventory.placement.record"];
let STOWER, STOWER_B, NO_ELIG, NO_CAPS;

test("world", { skip: SKIP }, async () => {
  await reset();
  STOWER = await persona({ subject: "pl-stower-a", capabilities: PLACE });
  STOWER_B = await persona({ subject: "pl-stower-b", capabilities: PLACE, warehouses: [WH_B] });
  NO_ELIG = await persona({ subject: "pl-no-elig", capabilities: PLACE, eligibility: [] });
  NO_CAPS = await persona({ subject: "pl-no-caps", capabilities: [] });
  await receiveSerial("SN-1", "WAREHOUSE", WH_A);
  await receiveSerial("SN-2", "WAREHOUSE", WH_A);
});

test("the DEPLOYED constant is { FROZEN, ACTIVE }; an INACTIVE state still refuses NOT_ACTIVATED", { skip: SKIP }, async () => {
  // ACTIVATED (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01): the deployed constant is { FROZEN, ACTIVE };
  // the uncertified-tenant refusal (inventoryBaselineGate.ts) is proven by inventoryWarehouseJourneyPostgres. The switch
  // itself still holds: an INACTIVE state refuses before anything is read or written.
  assert.deepEqual({ ...PLACEMENT_WRITER_AUTHORITY }, { firestore: "FROZEN", postgres: "ACTIVE" });
  refused(await call(STOWER, stow(), { state: "INACTIVE" }), 503, "NOT_ACTIVATED");
  assert.equal(await count("SELECT count(*) AS n FROM eos_ops.bin_placements"), 0);
});

test("authority: capability, eligibility, the stated warehouse's scope; the warehouse must be governed", { skip: SKIP }, async () => {
  refused(await call(NO_CAPS, stow()), 403, "CAPABILITY_MISSING");
  refused(await call(NO_ELIG, stow()), 403, "WORK_ELIGIBILITY_MISSING");
  refused(await call(STOWER_B, stow()), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  refused(await call(STOWER, stow({ warehouseId: "WH-NOPE" })), 404, "WAREHOUSE_NOT_FOUND");
  assert.equal(await count("SELECT count(*) AS n FROM eos_ops.bin_placements"), 0);
});

test("a quantity stow: ONE placement row, nothing else written; one audit; replay and conflict by key", { skip: SKIP }, async () => {
  const movementsBefore = await count("SELECT count(*) AS n FROM eos_ops.inventory_movements");
  const r = ok(await call(STOWER, stow({ pickedForWorkOrderId: "WO-1", note: " short shelf " })));
  assert.equal(r.outcome, "recorded");
  assert.deepEqual(r.placementIds, ["plc_k-1__PRT-RL-1"]);
  const row = (await q(`SELECT warehouse_id, bin_id, bin_code, quantity, serial_number, picked_for_work_order_id, note FROM eos_ops.bin_placements`)).rows[0];
  assert.deepEqual({ ...row }, { warehouse_id: WH_A, bin_id: BIN_A1, bin_code: r.binCode, quantity: 3, serial_number: null, picked_for_work_order_id: "WO-1", note: "short shelf" });
  assert.equal(await count("SELECT count(*) AS n FROM eos_ops.inventory_movements"), movementsBefore, "a placement moves no stock (Decision #116)");
  assert.equal(await count(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE action = 'binPlacement.record'`), 1);
  assert.equal(ok(await call(STOWER, stow({ pickedForWorkOrderId: "WO-1", note: "short shelf" }))).outcome, "replayed");
  refused(await call(STOWER, stow({ quantity: 4, pickedForWorkOrderId: "WO-1", note: "short shelf" })), 409, "IDEMPOTENCY_CONFLICT", /different_stow/);
  refused(await call(STOWER, stow({ binId: BIN_A2, pickedForWorkOrderId: "WO-1", note: "short shelf" })), 409, "IDEMPOTENCY_CONFLICT");
  assert.equal(await count(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE action = 'binPlacement.record'`), 1, "a replay is not audited");
});

test("serialized: one row per serial; a serial must be a unit of THIS part; a partial key reuse is a conflict", { skip: SKIP }, async () => {
  const s = (serials, key, over = {}) => ({ warehouseId: WH_A, partId: PART_SER, binId: BIN_A2, serialNumbers: serials, idempotencyKey: key, ...over });
  const r = ok(await call(STOWER, s(["SN-1", "SN-2"], "k-s1")));
  assert.deepEqual(r.placementIds, ["plc_k-s1__SN-1", "plc_k-s1__SN-2"]);
  assert.equal(r.quantity, null);
  // As in Firestore: the key's rows for the REQUESTED serials decide. Some present, some not -> a different serial set.
  refused(await call(STOWER, s(["SN-1", "SN-3"], "k-s1")), 409, "IDEMPOTENCY_CONFLICT", /partial_key_reuse/);
  refused(await call(STOWER, s(["SN-404"], "k-s2")), 400, "INVALID", /serial_unknown/);
  refused(await call(STOWER, s(["SN-1"], "k-s3", { partId: PART })), 400, "INVALID", /serial_wrong_part/);
  // Custody did not move: a placement is where it was put, not a custody transfer.
  assert.equal((await q(`SELECT location_type::text AS t FROM eos_ops.serialized_custody WHERE serial_number = 'SN-1'`)).rows[0].t, "WAREHOUSE");
});

test("the bin: by id (wrong warehouse, inactive refused) or by code (a superseded code still reaches its bin)", { skip: SKIP }, async () => {
  refused(await call(STOWER, stow({ binId: BIN_B, idempotencyKey: "k-b1" })), 412, "BIN_WRONG_WAREHOUSE");
  refused(await call(STOWER, stow({ binId: BIN_A_RETIRED, idempotencyKey: "k-b2" })), 412, "BIN_INACTIVE");
  refused(await call(STOWER, stow({ binId: "bin_nope", idempotencyKey: "k-b3" })), 404, "BIN_NOT_FOUND");
  const code = (await q(`SELECT code FROM eos_ops.bins WHERE id = $1`, [BIN_A1])).rows[0].code;
  const byCode = ok(await call(STOWER, { warehouseId: WH_A, partId: PART, binCode: code.toLowerCase(), quantity: 1, idempotencyKey: "k-b4" }));
  assert.equal(byCode.binCode, code);
  // A code claimed in WH_B does not resolve in WH_A: the lookup is scoped to the stated warehouse.
  const codeB = (await q(`SELECT code FROM eos_ops.bins WHERE id = $1`, [BIN_B])).rows[0].code;
  if (codeB !== code) refused(await call(STOWER, { warehouseId: WH_A, partId: PART, binCode: codeB, quantity: 1, idempotencyKey: "k-b5" }), 404, "BIN_NOT_FOUND");
  // Superseded: re-point the claim as SUPERSEDED and give the bin a new HELD code.
  await q(`UPDATE eos_ops.bin_code_claims SET claim_state = 'SUPERSEDED', superseded_at = now() WHERE bin_id = $1`, [BIN_A2]);
  const old = (await q(`SELECT code FROM eos_ops.bin_code_claims WHERE bin_id = $1`, [BIN_A2])).rows[0].code;
  const sup = ok(await call(STOWER, { warehouseId: WH_A, partId: PART, binCode: old, quantity: 1, idempotencyKey: "k-b6" }));
  assert.equal((await q(`SELECT bin_id FROM eos_ops.bin_placements WHERE id = $1`, [sup.placementIds[0]])).rows[0].bin_id, BIN_A2);
});

test("history is structural: a mismatched warehouse/bin row is refused by the table; placements are append-only", { skip: SKIP }, async () => {
  await assert.rejects(q(`INSERT INTO eos_ops.bin_placements (id, tenant_id, warehouse_id, bin_id, bin_code, part_id, quantity, idempotency_key, placed_by)
    VALUES ('plc_x__y', $1, $2, $3, 'X', $4, 1, 'x', 'u')`, [TENANT, WH_A, BIN_B, PART]), /BIN_PLACEMENT_WAREHOUSE_MISMATCH/);
  await assert.rejects(q(`UPDATE eos_ops.bin_placements SET quantity = 9`), /BIN_PLACEMENT_APPEND_ONLY/);
  await assert.rejects(q(`DELETE FROM eos_ops.bin_placements`), /BIN_PLACEMENT_APPEND_ONLY/);
  const sql = (await import("node:fs")).readFileSync("migrations/1764126000000_bin-placement-authority.sql", "utf8").split("-- Down Migration")[1];
  await assert.rejects(q(sql), /BIN_PLACEMENT_AUTHORITY: refuses to reverse/);
});

// THIS SUITE LEAVES THE DATABASE AS IT FOUND IT (integration, 2026-09-29). It begins by dropping the schemas it
// declares and migrating up, so everything it then seeds is its own: tenants, operating-company links and key
// bindings, operational scopes, truck scope bindings. Several of those are rows a migration's down REFUSES to drop
// while any exist, so on the shared CI database a surviving fixture made a later suite's migration peel fail
// (eosOpsCashApplicationPostgres, eosOpsEquipmentCustodyPostgres). It ends the way it began: the declared schemas
// reset and migrated up, empty.
test.after(async () => {
  if (!URL) return;
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  try {
    for (const schema of declaredSchemas()) await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await c.query("DROP TABLE IF EXISTS pgmigrations");
  } finally {
    await c.end();
  }
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
});

test("teardown", { skip: SKIP }, async () => { await pool?.end(); });
