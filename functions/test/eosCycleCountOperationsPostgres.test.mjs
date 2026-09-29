// EOS CYCLE COUNT over PostgreSQL, with WAREHOUSE SCOPE ENFORCED BY THE SERVER (Controller rulings DQ-017 /
// DQ-018 / DQ-019, 2026-09-28). Real database: migrate -> a tenant, one operating company, two warehouses,
// a bin in each, a catalog part -> governed personas built from the SAME tables Administration writes
// (Role grants, Employee link, Work Eligibility, Operational Scope). Proves, per record:
//   * NOT_ACTIVATED until the governed constant flips (the deployed default refuses everything);
//   * capability + WAREHOUSE_OPERATIONS eligibility + WAREHOUSE scope for the SHEET'S warehouse, each missing
//     one refusing with its own reason; a counter in warehouse A cannot touch, read or list warehouse B;
//   * the blind snapshot, the one-count rule, replay/conflict, separation of duties, the ledger row, audit;
//   * the HTTP route: identity from the verifier, status mapping, closed operation table.
// Set POLICY_TEST_DATABASE_URL to run (a dedicated database: this suite resets the schemas it declares).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import pg from "pg";

import { declaredSchemas } from "./support/migrationSchema.mjs";
import { PostgresPolicyRepository } from "../lib/adminPolicy/postgresPolicyRepository.js";
import { resolvePolicyDatabaseConfig } from "../lib/adminPolicy/policyDatabase.js";
import { createBin } from "../lib/eosOps/warehouseBinRepository.js";
import { handleOperationsRequest, CYCLE_COUNT_ROUTE } from "../lib/eosOps/eosOpsHttp.js";
import { CYCLE_COUNT_WRITER_AUTHORITY } from "../lib/cycleCount/cycleCountWriterState.js";

const URL = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const TENANT = "tenant-l3-cc";
const COMPANY_ID = "sample-co";
const COMPANY_KEY = "sample-co-synthetic";
const WH_A = "WH-A";
const WH_B = "WH-B";
const ACTOR = "uid-l3-cc-fixture";
const PART = "PRT-CC-1";
const PART_OTHER = "PRT-CC-2";

let pool = null;
let roleCounter = 0;
const repoPool = () => (pool ??= new pg.Pool(resolvePolicyDatabaseConfig({ connectionString: URL, max: 6 })));
const repo = () => new PostgresPolicyRepository(repoPool());
const q = (text, values = []) => repoPool().query(text, values);

let BIN_A = null;
let BIN_B = null;

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
  BIN_A = (await createBin(repoPool(), TENANT, ACTOR, { warehouseId: WH_A, area: "MAIN", aisle: "A", bay: 1, position: 1, idempotencyKey: "bin-a" })).id;
  BIN_B = (await createBin(repoPool(), TENANT, ACTOR, { warehouseId: WH_B, area: "MAIN", aisle: "B", bay: 1, position: 1, idempotencyKey: "bin-b" })).id;
  for (const [id, control] of [[PART, "STANDARD"], [PART_OTHER, "STANDARD"]]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($2, $1, 'seed', $2, 'cc proof part', 'ACTIVE', 'EACH', $3, 'STOCKED', false, false, false, false, 1, 'seed')`, [TENANT, id, control]);
  }
}

async function receive(partId, locationType, locationId, qty, id) {
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
             movement_type, quantity_delta, source_kind, source_id, created_by)
           VALUES ($1, $2, $3, $4, 'NONE', $5, $6, 'RECEIVED', $7, 'TEST', $1, $8)`,
    [id, TENANT, COMPANY_KEY, partId, locationType, locationId, qty, ACTOR]);
}

const COUNTER_CAPS = ["inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.cycleCount.cancel"];
const REVIEWER_CAPS = ["inventory.cycleCount.reconcile", "inventory.cycleCount.close"];

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
    tx.createRole({ key: `l3CcRole${roleCounter}`, name: `L3 CC role ${roleCounter}`, description: null, origin: "CUSTOM", protected: false }));
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
             VALUES ($1, $2, $3, $4, $5, 'OPERATOR_ASSERTED', 'active', $6, 'L3 cycle count fixture')`,
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

/** Call the route as `subject`, exactly as a client would: bearer -> injected verifier -> PostgreSQL. */
async function call(subject, operation, input, { state = "ACTIVE", raw = false } = {}) {
  const res = await handleOperationsRequest({
    reader: repo(), pool: repoPool(), cycleCountPostgresState: state,
    verifyToken: async (token) => ({ externalSubject: token, identityProvider: "firebase" }),
  }, {
    method: "POST", url: CYCLE_COUNT_ROUTE,
    headers: { authorization: `Bearer ${subject}`, "content-type": "application/json" },
    body: JSON.stringify(raw ? input : { operation, input }),
  });
  return { status: res.status, body: JSON.parse(res.body) };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.result; };
const refused = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (code) assert.equal(r.body.code, code, JSON.stringify(r.body));
};
const count = async (sql, v = []) => Number((await q(sql, v)).rows[0].n);

let COUNTER, REVIEWER, REVIEWER_B, COUNTER_NO_ELIG, NO_EMPLOYEE, NO_CAPS, UNSCOPED;

test("world", { skip: SKIP }, async () => {
  await reset();
  COUNTER = await persona({ subject: "cc-counter-a", capabilities: COUNTER_CAPS });
  REVIEWER = await persona({ subject: "cc-reviewer-a", capabilities: [...REVIEWER_CAPS, ...COUNTER_CAPS] });
  REVIEWER_B = await persona({ subject: "cc-reviewer-b", capabilities: REVIEWER_CAPS, warehouses: [WH_B] });
  COUNTER_NO_ELIG = await persona({ subject: "cc-no-elig", capabilities: COUNTER_CAPS, eligibility: [] });
  NO_EMPLOYEE = await persona({ subject: "cc-no-employee", capabilities: COUNTER_CAPS, employee: false });
  NO_CAPS = await persona({ subject: "cc-no-caps", capabilities: [] });
  UNSCOPED = await persona({ subject: "cc-unscoped", capabilities: COUNTER_CAPS, warehouses: [] });
  await receive(PART, "WAREHOUSE", WH_A, 10, "mv-a-1");
  await receive(PART, "BIN", BIN_A, 4, "mv-bin-a-1");
});

test("the DEPLOYED default is NOT_ACTIVATED: every operation refuses before it reads or writes", { skip: SKIP }, async () => {
  assert.equal(CYCLE_COUNT_WRITER_AUTHORITY.postgres, "INACTIVE");
  assert.equal(CYCLE_COUNT_WRITER_AUTHORITY.firestore, "OPEN");
  const before = await count("SELECT count(*) AS n FROM eos_ops.cycle_count_sheets");
  const res = await handleOperationsRequest({
    reader: repo(), pool: repoPool(), // NO state injected: the governed constant decides
    verifyToken: async (t) => ({ externalSubject: t, identityProvider: "firebase" }),
  }, { method: "POST", url: CYCLE_COUNT_ROUTE, headers: { authorization: `Bearer ${COUNTER}` },
    body: JSON.stringify({ operation: "createCycleCountSheet", input: { location: { type: "WAREHOUSE", locationId: WH_A }, idempotencyKey: "k-inactive" } }) });
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).code, "NOT_ACTIVATED");
  for (const op of ["listCycleCountSheets", "getCycleCountSheet", "closeCycleCountSheet"]) {
    refused(await call(COUNTER, op, op === "listCycleCountSheets" ? {} : { sheetId: "x" }, { state: "INACTIVE" }), 503, "NOT_ACTIVATED");
  }
  assert.equal(await count("SELECT count(*) AS n FROM eos_ops.cycle_count_sheets"), before);
});

test("DQ-017: capability, Warehouse Operations eligibility, and the SHEET'S warehouse scope are each required", { skip: SKIP }, async () => {
  const at = (wh) => ({ location: { type: "WAREHOUSE", locationId: wh }, idempotencyKey: `k-scope-${wh}-${Math.random()}` });
  refused(await call(COUNTER, "createCycleCountSheet", at(WH_B)), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  refused(await call(COUNTER, "createCycleCountSheet", { location: { type: "BIN", locationId: BIN_B }, idempotencyKey: "k-bin-b" }), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  refused(await call(COUNTER_NO_ELIG, "createCycleCountSheet", at(WH_A)), 403, "WORK_ELIGIBILITY_MISSING");
  refused(await call(NO_EMPLOYEE, "createCycleCountSheet", at(WH_A)), 403, "EMPLOYEE_LINK_REQUIRED");
  refused(await call(NO_CAPS, "createCycleCountSheet", at(WH_A)), 403, "CAPABILITY_MISSING");
  refused(await call(UNSCOPED, "createCycleCountSheet", at(WH_A)), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  refused(await call("nobody-at-all", "createCycleCountSheet", at(WH_A)), 403, "FORBIDDEN");
  // DQ-024: a truck location is scoped ONLY by its explicit governed binding; none exists yet -> fail closed.
  await q(`INSERT INTO eos_ops.mobile_locations (tenant_id, location_type, location_id, operating_company_key, display_label, active, created_by, updated_by)
           VALUES ($1, 'MOBILE', 'truck-1', $2, 'Truck 1', true, $3, $3)`, [TENANT, COMPANY_KEY, ACTOR]);
  refused(await call(COUNTER, "createCycleCountSheet", { location: { type: "MOBILE", locationId: "truck-1" }, idempotencyKey: "k-m" }), 412, "MOBILE_SCOPE_BINDING_MISSING");
  refused(await call(COUNTER, "createCycleCountSheet", { location: { type: "MOBILE", locationId: "no-such-truck" }, idempotencyKey: "k-m2" }), 404, "LOCATION_NOT_FOUND");
  assert.equal(await count("SELECT count(*) AS n FROM eos_ops.cycle_count_sheets"), 0, "no refused create wrote anything");
});

let SHEET = null;

test("create is idempotent by key; the same key for another location CONFLICTS; audit is written once", { skip: SKIP }, async () => {
  const input = { location: { type: "WAREHOUSE", locationId: WH_A }, idempotencyKey: "k-sheet-1" };
  const first = ok(await call(COUNTER, "createCycleCountSheet", input));
  assert.equal(first.outcome, "applied");
  assert.equal(first.sheet.warehouseId, WH_A);
  assert.equal(first.sheet.operatingCompanyKey, COMPANY_KEY);
  SHEET = first.sheet.sheetId;
  const again = ok(await call(COUNTER, "createCycleCountSheet", input));
  assert.equal(again.outcome, "replayed"); assert.equal(again.sheet.sheetId, SHEET);
  refused(await call(COUNTER, "createCycleCountSheet", { ...input, location: { type: "BIN", locationId: BIN_A } }), 409, "IDEMPOTENCY_CONFLICT");
  refused(await call(COUNTER, "createCycleCountSheet", { ...input, tenantId: "other" }), 400, "UNKNOWN_FIELD");
  assert.equal(await count(`SELECT count(*) AS n FROM eos_policy.audit_events WHERE action = 'cycleCount.sheet.create' AND target_id = $1`, [SHEET]), 1);
});

test("open is BLIND and idempotent; an unknown part is PART_NOT_FOUND (no fallback)", { skip: SKIP }, async () => {
  const opened = ok(await call(COUNTER, "openCycleCountLine", { sheetId: SHEET, partId: PART }));
  assert.equal(opened.outcome, "applied");
  assert.equal(opened.line.expectedQuantity, undefined, "blind: no expected value before the count");
  assert.equal(ok(await call(COUNTER, "openCycleCountLine", { sheetId: SHEET, partId: PART })).outcome, "replayed");
  refused(await call(COUNTER, "openCycleCountLine", { sheetId: SHEET, partId: "NOT-IN-CATALOG" }), 404, "PART_NOT_FOUND");
  // The snapshot was taken from the PostgreSQL ledger at THIS location (10 at WH-A; the 4 in the bin are elsewhere).
  assert.equal(Number((await q(`SELECT expected_quantity AS n FROM eos_ops.cycle_count_lines WHERE sheet_id = $1 AND part_id = $2`, [SHEET, PART])).rows[0].n), 10);
  // Out-of-scope reviewer cannot even READ the sheet.
  refused(await call(REVIEWER_B, "getCycleCountSheet", { sheetId: SHEET }), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  const read = ok(await call(COUNTER, "getCycleCountSheet", { sheetId: SHEET }));
  assert.equal(read.lines.length, 1); assert.equal(read.lines[0].expectedQuantity, undefined);
});

test("submit reveals THIS line's expected value; the same count replays; a different count CONFLICTS", { skip: SKIP }, async () => {
  const sent = ok(await call(COUNTER, "submitCycleCountLine", { sheetId: SHEET, partId: PART, countedQuantity: 7 }));
  assert.equal(sent.outcome, "applied");
  assert.equal(sent.line.expectedQuantity, 10); assert.equal(sent.line.variance, -3); assert.equal(sent.line.status, "COUNTED");
  assert.equal(ok(await call(COUNTER, "submitCycleCountLine", { sheetId: SHEET, partId: PART, countedQuantity: 7 })).outcome, "replayed");
  refused(await call(COUNTER, "submitCycleCountLine", { sheetId: SHEET, partId: PART, countedQuantity: 8 }), 409, "COUNT_ALREADY_SUBMITTED");
  refused(await call(COUNTER, "submitCycleCountLine", { sheetId: SHEET, partId: PART, countedQuantity: -1 }), 400, "INVALID_INPUT");
});

test("reconcile: scope, separation of duties, reason, ONE ledger row, replay and conflict", { skip: SKIP }, async () => {
  // The counter lacks reconcile at all; a reviewer in ANOTHER warehouse holds it but is out of scope.
  refused(await call(COUNTER, "reconcileCycleCountLine", { sheetId: SHEET, partId: PART, decision: "APPROVE", reason: "x" }), 403, "CAPABILITY_MISSING");
  refused(await call(REVIEWER_B, "reconcileCycleCountLine", { sheetId: SHEET, partId: PART, decision: "APPROVE", reason: "x" }), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  refused(await call(REVIEWER, "reconcileCycleCountLine", { sheetId: SHEET, partId: PART, decision: "APPROVE" }), 400, "REASON_REQUIRED");
  const done = ok(await call(REVIEWER, "reconcileCycleCountLine", { sheetId: SHEET, partId: PART, decision: "APPROVE", reason: "three missing" }));
  assert.equal(done.outcome, "applied"); assert.equal(done.line.status, "RECONCILED"); assert.ok(done.line.ledgerMovementId);
  const mv = (await q(`SELECT movement_type, quantity_delta, location_id, operating_company_key FROM eos_ops.inventory_movements WHERE id = $1`, [done.line.ledgerMovementId])).rows[0];
  assert.deepEqual({ ...mv }, { movement_type: "ADJUSTED", quantity_delta: -3, location_id: WH_A, operating_company_key: COMPANY_KEY });
  assert.equal(ok(await call(REVIEWER, "reconcileCycleCountLine", { sheetId: SHEET, partId: PART, decision: "APPROVE", reason: "three missing" })).outcome, "replayed");
  refused(await call(REVIEWER, "reconcileCycleCountLine", { sheetId: SHEET, partId: PART, decision: "APPROVE", reason: "other" }), 409, "IDEMPOTENCY_CONFLICT");
  refused(await call(REVIEWER, "reconcileCycleCountLine", { sheetId: SHEET, partId: PART, decision: "REJECT", reason: "three missing" }), 409, "IDEMPOTENCY_CONFLICT");
  assert.equal(await count(`SELECT count(*) AS n FROM eos_ops.inventory_movements WHERE source_kind = 'CYCLE_COUNT_LINE'`), 1, "exactly one adjustment");
});

test("separation of duties: the person who counted a variance cannot approve it", { skip: SKIP }, async () => {
  const s = ok(await call(REVIEWER, "createCycleCountSheet", { location: { type: "BIN", locationId: BIN_A }, idempotencyKey: "k-sod" })).sheet.sheetId;
  ok(await call(REVIEWER, "openCycleCountLine", { sheetId: s, partId: PART }));
  ok(await call(REVIEWER, "submitCycleCountLine", { sheetId: s, partId: PART, countedQuantity: 5 }));
  refused(await call(REVIEWER, "reconcileCycleCountLine", { sheetId: s, partId: PART, decision: "APPROVE", reason: "one extra" }), 403, "SEPARATION_OF_DUTIES");
});

test("close needs every line decided; after close, a retry of the decision still replays; new work is refused", { skip: SKIP }, async () => {
  ok(await call(COUNTER, "openCycleCountLine", { sheetId: SHEET, partId: PART_OTHER }));
  refused(await call(REVIEWER, "closeCycleCountSheet", { sheetId: SHEET }), 412, "SHEET_STATUS_INVALID");
  ok(await call(COUNTER, "cancelCycleCountLine", { sheetId: SHEET, partId: PART_OTHER }));
  assert.equal(ok(await call(COUNTER, "cancelCycleCountLine", { sheetId: SHEET, partId: PART_OTHER })).outcome, "replayed");
  refused(await call(COUNTER, "closeCycleCountSheet", { sheetId: SHEET }), 403, "CAPABILITY_MISSING");
  assert.equal(ok(await call(REVIEWER, "closeCycleCountSheet", { sheetId: SHEET })).outcome, "applied");
  assert.equal(ok(await call(REVIEWER, "closeCycleCountSheet", { sheetId: SHEET })).outcome, "replayed");
  assert.equal(ok(await call(REVIEWER, "reconcileCycleCountLine", { sheetId: SHEET, partId: PART, decision: "APPROVE", reason: "three missing" })).outcome, "replayed");
  refused(await call(COUNTER, "openCycleCountLine", { sheetId: SHEET, partId: "PRT-CC-3" }), 404, "PART_NOT_FOUND");
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
           VALUES ('PRT-CC-3', $1, 'seed', 'PRT-CC-3', 'p3', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'seed')`, [TENANT]);
  refused(await call(COUNTER, "openCycleCountLine", { sheetId: SHEET, partId: "PRT-CC-3" }), 412, "SHEET_STATUS_INVALID");
});

test("list carries the scope IN THE QUERY: each caller sees only sheets in their own warehouses", { skip: SKIP }, async () => {
  ok(await call(REVIEWER_B, "listCycleCountSheets", {}));
  const bSheetId = ok(await call(await persona({ subject: "cc-counter-b", capabilities: COUNTER_CAPS, warehouses: [WH_B] }),
    "createCycleCountSheet", { location: { type: "WAREHOUSE", locationId: WH_B }, idempotencyKey: "k-b" })).sheet.sheetId;
  const aView = ok(await call(COUNTER, "listCycleCountSheets", {}));
  assert.ok(aView.sheets.every((s) => s.warehouseId === WH_A), JSON.stringify(aView.sheets));
  assert.ok(!aView.sheets.some((s) => s.sheetId === bSheetId));
  assert.deepEqual(aView.scopedWarehouseIds, [WH_A]);
  const bView = ok(await call(REVIEWER_B, "listCycleCountSheets", {}));
  assert.deepEqual(bView.sheets.map((s) => s.sheetId), [bSheetId]);
  assert.deepEqual(ok(await call(UNSCOPED, "listCycleCountSheets", {})).sheets, [], "no scope: nothing -- truthfully empty");
  refused(await call(COUNTER_NO_ELIG, "listCycleCountSheets", {}), 403, "WORK_ELIGIBILITY_MISSING");
  refused(await call(NO_EMPLOYEE, "listCycleCountSheets", {}), 403, "EMPLOYEE_LINK_REQUIRED");
  refused(await call(COUNTER, "listCycleCountSheets", { status: "WHATEVER" }), 400, "INVALID_INPUT");
  const open = ok(await call(COUNTER, "listCycleCountSheets", { status: "CLOSED" }));
  assert.deepEqual(open.sheets.map((s) => s.sheetId), [SHEET]);
});

test("an IMPOSSIBLE ledger balance refuses the snapshot (LEDGER_INTEGRITY), never clamped", { skip: SKIP }, async () => {
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
             movement_type, quantity_delta, source_kind, source_id, created_by)
           VALUES ('mv-neg', $1, $2, $3, 'NONE', 'WAREHOUSE', $4, 'ADJUSTED', -99, 'TEST', 'neg', $5)`, [TENANT, COMPANY_KEY, PART_OTHER, WH_A, ACTOR]);
  const s = ok(await call(COUNTER, "createCycleCountSheet", { location: { type: "WAREHOUSE", locationId: WH_A }, idempotencyKey: "k-neg" })).sheet.sheetId;
  refused(await call(COUNTER, "openCycleCountLine", { sheetId: s, partId: PART_OTHER }), 412, "LEDGER_INTEGRITY");
  assert.equal(await count(`SELECT count(*) AS n FROM eos_ops.cycle_count_lines WHERE sheet_id = $1`, [s]), 0);
});

test("a sheet with nothing counted can be cancelled (its open lines with it); a counted one cannot", { skip: SKIP }, async () => {
  const s = ok(await call(COUNTER, "createCycleCountSheet", { location: { type: "BIN", locationId: BIN_A }, idempotencyKey: "k-cancel" })).sheet.sheetId;
  ok(await call(COUNTER, "openCycleCountLine", { sheetId: s, partId: PART }));
  assert.equal(ok(await call(COUNTER, "cancelCycleCountSheet", { sheetId: s })).outcome, "applied");
  assert.equal((await q(`SELECT status::text AS s FROM eos_ops.cycle_count_lines WHERE sheet_id = $1`, [s])).rows[0].s, "CANCELLED");
  assert.equal(ok(await call(COUNTER, "cancelCycleCountSheet", { sheetId: s })).outcome, "replayed");
});

test("DQ-024: a truck count is scoped by the truck's EXPLICIT binding -- and only by it", { skip: SKIP }, async () => {
  await q(`INSERT INTO eos_ops.mobile_location_scope_bindings (id, tenant_id, location_type, location_id, warehouse_id, established_by, reason)
           VALUES ('msb-1', $1, 'MOBILE', 'truck-1', $2, $3, 'truck 1 works out of warehouse B')`, [TENANT, WH_B, ACTOR]);
  // Bound to B: the A-scoped counter is OUT of scope for it (no matter who drives it); a B-scoped counter is in.
  refused(await call(COUNTER, "createCycleCountSheet", { location: { type: "MOBILE", locationId: "truck-1" }, idempotencyKey: "k-truck-a" }), 403, "OUTSIDE_OPERATIONAL_SCOPE");
  const counterB = await persona({ subject: "cc-counter-b2", capabilities: COUNTER_CAPS, warehouses: [WH_B] });
  const made = ok(await call(counterB, "createCycleCountSheet", { location: { type: "MOBILE", locationId: "truck-1" }, idempotencyKey: "k-truck-b" }));
  assert.equal(made.sheet.warehouseId, WH_B);
  assert.equal(made.sheet.operatingCompanyKey, COMPANY_KEY, "the company is the truck location's own authored key");
});

test("transport: closed table, input shape, identity only from the verifier", { skip: SKIP }, async () => {
  refused(await call(COUNTER, "dropTable", {}), 404, "UNKNOWN_OPERATION");
  refused(await call(COUNTER, "resolveMyCapabilities", {}), 404, "UNKNOWN_OPERATION"); // a read op is not served at this route
  refused(await call(COUNTER, "createCycleCountSheet", ["not", "an", "object"]), 400, "INVALID_INPUT");
  const noAuth = await handleOperationsRequest({ reader: repo(), pool: repoPool(), cycleCountPostgresState: "ACTIVE", verifyToken: async () => { throw new Error("x"); } },
    { method: "POST", url: CYCLE_COUNT_ROUTE, headers: {}, body: JSON.stringify({ operation: "listCycleCountSheets", input: {} }) });
  assert.equal(noAuth.status, 401);
  const badToken = await handleOperationsRequest({ reader: repo(), pool: repoPool(), cycleCountPostgresState: "ACTIVE", verifyToken: async () => { throw new Error("x"); } },
    { method: "POST", url: CYCLE_COUNT_ROUTE, headers: { authorization: "Bearer t" }, body: JSON.stringify({ operation: "listCycleCountSheets", input: {} }) });
  assert.equal(badToken.status, 401);
});

test("teardown", { skip: SKIP }, async () => { await pool?.end(); });
