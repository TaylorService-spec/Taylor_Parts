// DQ-024: inventory location -> warehouse scope resolution and the per-act Transfer scope rule, plus the
// governed MOBILE scope-binding table's invariants (same company, one current, append-only, no seed).
// Real PostgreSQL; set POLICY_TEST_DATABASE_URL (a dedicated database: the schemas are reset).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { declaredSchemas } from "./support/migrationSchema.mjs";
import { createBin } from "../lib/eosOps/warehouseBinRepository.js";
import {
  resolveScopeLocation, requiredTransferScope, TRANSFER_ACT_SCOPE_END, InventoryScopeError,
} from "../lib/eosOps/inventoryScopeAuthority.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set";
const T = "tenant-l3-scope";
const ACTOR = "uid-l3-scope";
let pool = null;
const q = (text, v = []) => (pool ??= new pg.Pool({ connectionString: URL, max: 3 })).query(text, v);
let BIN_A = null;

test("world", { skip: SKIP }, async () => {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  for (const schema of declaredSchemas()) await c.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await c.query("DROP TABLE IF EXISTS pgmigrations");
  await c.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });
  await q("INSERT INTO eos_policy.tenants (id, key, name) VALUES ($1, $1, $1)", [T]);
  for (const [co, key] of [["co-a", "key-a"], ["co-b", "key-b"]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
             VALUES ($1, $2, 'ACTIVE', 't', $3, $3)`, [T, co, ACTOR]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ($1, $2, $3, 'ACTIVE', 'NATIVE', 't', $4, $4)`, [T, co, key, ACTOR]);
  }
  for (const [wh, key] of [["WH-A", "key-a"], ["WH-A2", "key-a"], ["WH-B", "key-b"]]) {
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
             VALUES ($1, $2, $3, $1, 's', 'ACTIVE', 'NATIVE', $4, $4)`, [wh, T, key, ACTOR]);
  }
  BIN_A = (await createBin(pool, T, ACTOR, { warehouseId: "WH-A", area: "MAIN", aisle: "A", bay: 1, position: 1, idempotencyKey: "b" })).id;
  for (const [id, key] of [["truck-a", "key-a"], ["truck-b", "key-b"], ["truck-unbound", "key-a"]]) {
    await q(`INSERT INTO eos_ops.mobile_locations (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by)
             VALUES ($1, 'MOBILE', $2, $3, $2, true, $4, $4)`, [T, id, key, ACTOR]);
  }
  assert.equal(Number((await q("SELECT count(*) AS n FROM eos_ops.mobile_location_scope_bindings")).rows[0].n), 0, "the migration seeds nothing");
});

test("WAREHOUSE -> itself; BIN -> its parent; MOBILE -> ONLY its explicit binding, else fail closed", { skip: SKIP }, async () => {
  assert.equal((await resolveScopeLocation(pool, T, { type: "WAREHOUSE", locationId: "WH-A" })).scopeWarehouseId, "WH-A");
  assert.equal((await resolveScopeLocation(pool, T, { type: "BIN", locationId: BIN_A })).scopeWarehouseId, "WH-A");
  await assert.rejects(resolveScopeLocation(pool, T, { type: "MOBILE", locationId: "truck-unbound" }),
    (e) => e instanceof InventoryScopeError && e.code === "MOBILE_SCOPE_BINDING_MISSING");
  await assert.rejects(resolveScopeLocation(pool, T, { type: "MOBILE", locationId: "nope" }), (e) => e.code === "LOCATION_NOT_FOUND");
  await assert.rejects(resolveScopeLocation(pool, T, { type: "CUSTOMER", locationId: "x" }), (e) => e.code === "LOCATION_TYPE_INVALID");
  await q(`INSERT INTO eos_ops.mobile_location_scope_bindings (id, tenant_id, location_type, location_id, warehouse_id, established_by, reason)
           VALUES ('b1', $1, 'MOBILE', 'truck-a', 'WH-A', $2, 'based at A')`, [T, ACTOR]);
  const r = await resolveScopeLocation(pool, T, { type: "MOBILE", locationId: "truck-a" });
  assert.equal(r.scopeWarehouseId, "WH-A");
  assert.equal(r.operatingCompanyKey, "key-a", "the truck location's own authored company, not the warehouse's");
});

test("binding invariants: same company only, one current, end-only history, never deleted", { skip: SKIP }, async () => {
  await assert.rejects(q(`INSERT INTO eos_ops.mobile_location_scope_bindings (id, tenant_id, location_type, location_id, warehouse_id, established_by, reason)
    VALUES ('x1', $1, 'MOBILE', 'truck-b', 'WH-A', $2, 'cross company')`, [T, ACTOR]), /MOBILE_SCOPE_BINDING_COMPANY_MISMATCH/);
  await assert.rejects(q(`INSERT INTO eos_ops.mobile_location_scope_bindings (id, tenant_id, location_type, location_id, warehouse_id, established_by, reason)
    VALUES ('x2', $1, 'MOBILE', 'truck-a', 'WH-A2', $2, 'second current')`, [T, ACTOR]), /mobile_scope_binding_one_current/);
  await assert.rejects(q(`INSERT INTO eos_ops.mobile_location_scope_bindings (id, tenant_id, location_type, location_id, warehouse_id, established_by, reason)
    VALUES ('x3', $1, 'MOBILE', 'truck-unbound', 'WH-A', $2, '  ')`, [T, ACTOR]), /mobile_scope_binding_reason_present/);
  await assert.rejects(q(`UPDATE eos_ops.mobile_location_scope_bindings SET warehouse_id = 'WH-A2' WHERE id = 'b1'`), /APPEND_ONLY/);
  await assert.rejects(q(`DELETE FROM eos_ops.mobile_location_scope_bindings WHERE id = 'b1'`), /APPEND_ONLY/);
  // Re-pointing = end the current row, then bind anew.
  await q(`UPDATE eos_ops.mobile_location_scope_bindings SET effective_to = now(), ended_by = $1, end_reason = 'moved to A2' WHERE id = 'b1'`, [ACTOR]);
  await assert.rejects(q(`UPDATE eos_ops.mobile_location_scope_bindings SET end_reason = 'again' WHERE id = 'b1'`), /APPEND_ONLY/);
  await assert.rejects(resolveScopeLocation(pool, T, { type: "MOBILE", locationId: "truck-a" }), (e) => e.code === "MOBILE_SCOPE_BINDING_MISSING");
  await q(`INSERT INTO eos_ops.mobile_location_scope_bindings (id, tenant_id, location_type, location_id, warehouse_id, established_by, reason)
           VALUES ('b2', $1, 'MOBILE', 'truck-a', 'WH-A2', $2, 'now at A2')`, [T, ACTOR]);
  assert.equal((await resolveScopeLocation(pool, T, { type: "MOBILE", locationId: "truck-a" })).scopeWarehouseId, "WH-A2");
});

test("DQ-024 per-act rule: origin for create/cancel/dispatch, destination for receive/put-away -- the other end is not even resolved", { skip: SKIP }, async () => {
  assert.deepEqual({ ...TRANSFER_ACT_SCOPE_END }, { create: "ORIGIN", cancel: "ORIGIN", dispatch: "ORIGIN", receive: "DESTINATION", putAway: "DESTINATION" });
  const t = { origin: { type: "WAREHOUSE", locationId: "WH-A" }, destination: { type: "MOBILE", locationId: "truck-unbound" } };
  // The destination truck has no binding: that neither blocks nor grants the ORIGIN-scoped acts...
  for (const act of ["create", "cancel", "dispatch"]) assert.equal((await requiredTransferScope(pool, T, act, t)).scopeWarehouseId, "WH-A");
  // ...but receiving AT that truck fails closed.
  await assert.rejects(requiredTransferScope(pool, T, "receive", t), (e) => e.code === "MOBILE_SCOPE_BINDING_MISSING");
  const back = { origin: { type: "MOBILE", locationId: "truck-a" }, destination: { type: "BIN", locationId: BIN_A } };
  assert.equal((await requiredTransferScope(pool, T, "dispatch", back)).scopeWarehouseId, "WH-A2");
  assert.equal((await requiredTransferScope(pool, T, "putAway", back)).scopeWarehouseId, "WH-A");
  await assert.rejects(requiredTransferScope(pool, T, "steal", back), InventoryScopeError);
});

test("the down migration refuses while a binding exists", { skip: SKIP }, async () => {
  const sql = (await import("node:fs")).readFileSync("migrations/1764115200000_mobile-location-scope-binding.sql", "utf8").split("-- Down Migration")[1];
  await assert.rejects(q(sql), /refusing to drop mobile_location_scope_bindings/);
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
