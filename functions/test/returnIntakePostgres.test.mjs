// RETURNS INTAKE ON EOS CORE (Firebase exit F7a, DECISIONS #242), against a real PostgreSQL.
//
// Owner ruling 2026-10-17: the Firestore behaviour is kept (intake only, NO ledger movement #118, the closed vocabularies,
// quantity XOR serials, one key = one return), and the return now names a REQUIRED operating company (one of the caller's,
// the #237 check) and an OPTIONAL receiving warehouse (that company's, in the caller's reach). Every refusal precedes any
// write; a recorded return writes one row and one audit row; the Role created by the migration holds the capability and
// has no members.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { hash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const require = createRequire(import.meta.url);
const R = require("../lib/eosOps/returnIntake.js");
const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const T = "t-returns";
const INTAKE = new Set(["inventory.returns.intake"]);

test("validation is the Firestore command's, rule for rule, plus the company", () => {
  const base = { operatingCompanyId: "taylor", partId: "PRT-1", source: "CUSTOMER", condition: "OPENED", quantity: 1, idempotencyKey: "k1" };
  assert.equal(R.validateReturnIntake(base).quantity, 1);
  const code = (input) => { try { R.validateReturnIntake(input); return "OK"; } catch (e) { return e.code; } };
  assert.equal(code({ ...base, operatingCompanyId: undefined }), "OPERATING_COMPANY_REQUIRED");
  assert.equal(code({ ...base, source: "WAREHOUSE" }), "SOURCE_INVALID", "an unknown source is refused, never coerced to UNKNOWN");
  assert.equal(code({ ...base, condition: "GOOD" }), "CONDITION_INVALID");
  assert.equal(code({ ...base, serialNumbers: ["A"] }), "QUANTITY_OR_SERIALS_REQUIRED");
  assert.equal(code({ ...base, quantity: undefined, serialNumbers: ["A", "a"] }), "SERIALS_DUPLICATED");
  assert.equal(code({ ...base, quantity: 0 }), "QUANTITY_INVALID");
  assert.equal(code({ ...base, reason: "x".repeat(501) }), "REASON_TOO_LONG");
  assert.equal(code({ ...base, restock: true }), "FIELD_NOT_ACCEPTED", "no field can ask for a disposition");
  assert.equal(R.deriveReturnId("k1"), "ret_k1");
  assert.deepEqual([...R.RETURN_SOURCES], ["WORK_ORDER", "CUSTOMER", "TRUCK", "SUPPLIER", "UNKNOWN"]);
  assert.deepEqual([...R.RETURN_CONDITIONS], ["UNOPENED", "OPENED", "DAMAGED", "UNKNOWN"]);
});

test("returns intake, in PostgreSQL", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `returns_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const url = (() => { const u = new URL(URL_BASE); u.pathname = `/${name}`; return u.toString(); })();
  const admin = new pg.Client({ connectionString: URL_BASE });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"],
    { maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(async () => {
    await endPoolAndDrain(pool);
    const c = new pg.Client({ connectionString: URL_BASE });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.end();
  });
  const q = (sql, v = []) => pool.query(sql, v);

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  for (const c of ["taylor", "ventana"]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
             VALUES ($1,$2,'ACTIVE','fixture','fixture','fixture')`, [T, c]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
             VALUES ($1,$2,$2,'ACTIVE','NATIVE','fixture','fixture','fixture')`, [T, c]);
  }
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-t',$1,'taylor','Taylor Main','Main','ACTIVE','NATIVE','f','f'), ('wh-t2',$1,'taylor','Taylor Annex','Annex','ACTIVE','NATIVE','f','f'),
                  ('wh-v',$1,'ventana','Ventana Depot','Depot','ACTIVE','NATIVE','f','f')`, [T]);
  const employee = async (eid, company, warehouses) => {
    const pid = `prn-${eid}`;
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$1,'eos','active')`, [pid]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`m-${pid}`, T, pid]);
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name)
             VALUES ($1,$2,'ACTIVE',$3,$1,$4)`, [eid, T, company, `Person ${eid}`]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,$5,'OPERATOR_ASSERTED','active','f','f')`, [`l-${eid}`, T, pid, eid, company]);
    for (const wh of warehouses) {
      await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
               VALUES ($1,$2,$3,'WAREHOUSE',$4,now(),'f')`, [`os-${eid}-${wh}`, T, eid, wh]);
    }
    return { tenantId: T, principalId: pid, capabilities: INTAKE };
  };
  const clerk = await employee("e-clerk", "taylor", ["wh-t", "wh-v"]);
  await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ('prn-unlinked','prn-unlinked','eos','active')`);
  await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ('m-unlinked',$1,'prn-unlinked','active')`, [T]);
  const unlinked = { tenantId: T, principalId: "prn-unlinked", capabilities: INTAKE };

  const deps = { pool };
  const base = { operatingCompanyId: "taylor", partId: "PRT-1001", source: "WORK_ORDER", sourceReference: "WO-1", condition: "DAMAGED",
    reason: "crushed box", quantity: 2, idempotencyKey: "k-1" };
  const refusal = async (actor, input) => { try { await R.recordReturnIntake(deps, actor, input); return null; } catch (e) { return [e.code, e.category]; } };
  const snapshot = async () => (await q(`SELECT
      (SELECT count(*) FROM eos_ops.inventory_returns)::int AS returns,
      (SELECT count(*) FROM eos_policy.audit_events WHERE target_kind = 'inventory_return')::int AS audits,
      (SELECT count(*) FROM eos_ops.inventory_movements)::int AS movements`)).rows[0];

  await t.test("the migration registers the key and grants it to one memberless Role", async () => {
    const cap = await q(`SELECT object_key, action_key, action_kind FROM eos_policy.capabilities WHERE key = 'inventory.returns.intake'`);
    assert.deepEqual(cap.rows, [{ object_key: "inventoryReturn", action_key: "intake", action_kind: "BUSINESS_ACTION" }]);
    const assigned = await q(`SELECT count(*)::int AS n FROM eos_policy.user_role_assignments a JOIN eos_policy.roles r ON r.id = a.role_id
                               WHERE r.key = 'inventoryReturnsIntakeClerk'`);
    assert.equal(assigned.rows[0].n, 0, "nobody is assigned anything by the migration");
  });

  await t.test("REFUSALS, each before any write: capability, company authority, company, warehouse", async () => {
    const before = await snapshot();
    assert.deepEqual(await refusal({ ...clerk, capabilities: new Set() }, base), ["CAPABILITY_MISSING", "FORBIDDEN"]);
    assert.deepEqual(await refusal(unlinked, base), ["COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN"]);
    // Out of the caller's companies answers exactly like an unknown company.
    const outside = await refusal(clerk, { ...base, operatingCompanyId: "ventana" });
    const unknown = await refusal(clerk, { ...base, operatingCompanyId: "nope" });
    assert.deepEqual(outside, ["OPERATING_COMPANY_NOT_GOVERNED", "INVALID_INPUT"]);
    assert.deepEqual(unknown, outside);
    // A warehouse of ANOTHER company (even one in reach), or out of reach, answers exactly like an unknown one.
    const otherCompany = await refusal(clerk, { ...base, warehouseId: "wh-v" });
    const outOfReach = await refusal(clerk, { ...base, warehouseId: "wh-t2" });
    const missing = await refusal(clerk, { ...base, warehouseId: "wh-zz" });
    assert.deepEqual(otherCompany, ["WAREHOUSE_NOT_FOUND", "NOT_FOUND"]);
    assert.deepEqual(outOfReach, otherCompany);
    assert.deepEqual(missing, otherCompany);
    assert.deepEqual(await snapshot(), before, "no refusal wrote anything");
  });

  await t.test("RECORDED: one row, one audit row, NO ledger movement (#118); a replay writes nothing", async () => {
    const before = await snapshot();
    const r = await R.recordReturnIntake(deps, clerk, { ...base, warehouseId: "wh-t" });
    assert.deepEqual({ ...r, serialNumbers: [...r.serialNumbers] }, { outcome: "recorded", returnId: "ret_k-1", operatingCompanyId: "taylor",
      warehouseId: "wh-t", partId: "PRT-1001", state: "AWAITING_DISPOSITION", quantity: 2, serialNumbers: [] });
    const after = await snapshot();
    assert.deepEqual(after, { returns: before.returns + 1, audits: before.audits + 1, movements: before.movements });
    const row = (await q(`SELECT provenance, received_by, created_by, state FROM eos_ops.inventory_returns WHERE id = 'ret_k-1'`)).rows[0];
    assert.deepEqual(row, { provenance: "NATIVE", received_by: clerk.principalId, created_by: clerk.principalId, state: "AWAITING_DISPOSITION" });
    const replay = await R.recordReturnIntake(deps, clerk, { ...base, warehouseId: "wh-t" });
    assert.equal(replay.outcome, "replayed");
    assert.deepEqual(await snapshot(), after, "a replay writes nothing, not even an audit row");
    assert.deepEqual(await refusal(clerk, { ...base, warehouseId: "wh-t", quantity: 3 }), ["IDEMPOTENCY_CONFLICT", "CONFLICT"],
      "a different return under a used key is refused, never reported as a replay");
  });

  await t.test("serials, no warehouse; the options read offers only the caller's companies and in-reach warehouses of them", async () => {
    const r = await R.recordReturnIntake(deps, clerk, { operatingCompanyId: "taylor", partId: "EQ-9", source: "CUSTOMER", condition: "UNKNOWN",
      serialNumbers: ["SN-1", "SN-2"], idempotencyKey: "k-2" });
    assert.deepEqual([r.quantity, [...r.serialNumbers], r.warehouseId], [null, ["SN-1", "SN-2"], null]);
    const options = await R.listReturnIntakeOptions(deps, clerk, {});
    assert.deepEqual(options.companies.map((c) => c.operatingCompanyId), ["taylor"]);
    assert.deepEqual(options.warehouses.map((w) => w.warehouseId), ["wh-t"], "wh-v is in reach but another company's; wh-t2 is out of reach");
    await assert.rejects(() => R.listReturnIntakeOptions(deps, unlinked, {}), (e) => e.code === "COMPANY_AUTHORITY_REQUIRED");
  });

  await t.test("the table itself refuses what the command refuses: a second state, a MIGRATED-free anonymous row, an unknown condition", async () => {
    const insert = (over) => q(`INSERT INTO eos_ops.inventory_returns (tenant_id, id, idempotency_key, operating_company_id, part_id, source, condition,
        quantity, state, provenance, received_at, received_by, created_by)
      VALUES ($1, 'ret_' || $2, $2, 'taylor', 'P', 'UNKNOWN', $3, 1, $4, $5, now(), $6, 'f')`,
    [T, over.key, over.condition ?? "OPENED", over.state ?? "AWAITING_DISPOSITION", over.provenance ?? "NATIVE", over.receivedBy === undefined ? "p" : over.receivedBy]);
    await assert.rejects(() => insert({ key: "x1", state: "RESTOCKED" }), /inventory_returns_awaiting_disposition/);
    await assert.rejects(() => insert({ key: "x2", receivedBy: null }), /inventory_returns_native_actor/);
    await assert.rejects(() => insert({ key: "x3", condition: "GOOD" }), /inventory_returns_condition_known/);
    await insert({ key: "x4", provenance: "MIGRATED", receivedBy: null });
    await q(`DELETE FROM eos_ops.inventory_returns WHERE id = 'ret_x4'`);
  });

  // ════════════ the Owner-gated copy (scripts/returnIntakeCopy.js), run as on Render ════════════
  await t.test("COPY CLI: census by default (read-only, gaps named); copy needs the Owner's go-ahead; rerun no-op; verify", async () => {
    const dir = mkdtempSync(join(tmpdir(), "returns-copy-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const ts = { $timestamp: { seconds: 1760000000, nanoseconds: 123456000 } };
    const doc = (key, over = {}) => ({ id: `ret_${key}`, data: { idempotencyKey: key, partId: "PRT-9", source: "CUSTOMER", sourceReference: null,
      condition: "OPENED", reason: null, quantity: 1, serialNumbers: [], state: "AWAITING_DISPOSITION", receivedAt: ts, receivedBy: "firebase-uid-1", ...over } });
    const snapshot = { format: "EOS_RETURNS_SNAPSHOT", version: 1, source: { firebaseProjectId: "eos-platform-sandbox", exportedAt: "2026-10-17T00:00:00.000Z" },
      inventoryReturns: [doc("legacy-1"), doc("legacy-2", { quantity: null, serialNumbers: ["S-1"] })] };
    const file = (name, value) => { const f = join(dir, name); const text = JSON.stringify(value); writeFileSync(f, text); writeFileSync(`${f}.sha256`, `${hash("sha256", text)}  ${name}\n`); return f; };
    const snap = file("snap.json", snapshot);
    const mapping = (returns) => file(`map-${randomUUID()}.json`, { format: "EOS_RETURNS_COMPANY_MAPPING", version: 1, returns });
    const run = (extra) => {
      const res = spawnSync(process.execPath, ["scripts/returnIntakeCopy.js", "--environment", "platform-sandbox", "--databaseUrlEnv", "RET_TEST_DB",
        "--tenantKey", T, "--snapshot", snap, ...extra], { cwd: FUNCTIONS_DIR, encoding: "utf8", env: { ...process.env, EOS_ENVIRONMENT: "nonprod", RET_TEST_DB: url } });
      return { status: res.status, json: res.stdout ? JSON.parse(res.stdout) : null, err: res.stderr };
    };
    const count = async () => (await q(`SELECT count(*)::int AS n FROM eos_ops.inventory_returns WHERE provenance = 'MIGRATED'`)).rows[0].n;

    const gaps = run([]);
    assert.equal(gaps.status, 1, gaps.err);
    assert.equal(gaps.json.report.mappingGaps.unmapped, 2, "no mapping: every record is a named gap, never a guessed company");
    assert.deepEqual(gaps.json.report.legacyActorProvenance, { "firebase-uid-1": 2 });
    const bad = mapping({ "ret_legacy-1": { operatingCompanyId: "taylor", warehouseId: "wh-v" }, "ret_legacy-2": { operatingCompanyId: "nope" } });
    const badCensus = run(["--mapping", bad]);
    assert.deepEqual([badCensus.json.report.mappingGaps.warehouseCompanyMismatch, badCensus.json.report.mappingGaps.companyNotGoverned], [1, 1]);
    const good = mapping({ "ret_legacy-1": { operatingCompanyId: "taylor", warehouseId: "wh-t" }, "ret_legacy-2": { operatingCompanyId: "ventana" } });
    const census = run(["--mapping", good]);
    assert.equal(census.status, 0, census.err);
    assert.equal(census.json.readOnly, true);
    assert.equal(await count(), 0, "a census writes nothing");
    const checksum = census.json.report.checksum;
    const noOwner = run(["--mode", "copy", "--mapping", good, "--principalId", clerk.principalId, "--reviewedChecksum", checksum]);
    assert.equal(noOwner.status, 2);
    assert.match(noOwner.err, /--ownerAuthorization is required/);
    const drift = run(["--mode", "copy", "--mapping", bad, "--principalId", clerk.principalId, "--reviewedChecksum", checksum, "--ownerAuthorization", "test"]);
    assert.match(drift.err, /SOURCE_CHECKSUM_DRIFT/);
    assert.equal(await count(), 0);
    const copy = run(["--mode", "copy", "--mapping", good, "--principalId", clerk.principalId, "--reviewedChecksum", checksum, "--ownerAuthorization", "Owner F7a test"]);
    assert.equal(copy.status, 0, copy.err);
    assert.deepEqual([copy.json.outcome, copy.json.inserted], ["APPLIED", 2]);
    const rows = (await q(`SELECT id, received_by, created_by, received_at, quantity, serial_numbers FROM eos_ops.inventory_returns WHERE provenance = 'MIGRATED' ORDER BY id`)).rows;
    assert.deepEqual(rows.map((r) => [r.id, r.received_by, r.created_by]), [["ret_legacy-1", null, clerk.principalId], ["ret_legacy-2", null, clerk.principalId]],
      "the Firebase actor is evidence, never a column");
    const again = run(["--mode", "copy", "--mapping", good, "--principalId", clerk.principalId, "--reviewedChecksum", checksum, "--ownerAuthorization", "Owner F7a test"]);
    assert.deepEqual([again.status, again.json.outcome], [0, "NO_CHANGE"]);
    const verify = run(["--mode", "verify", "--mapping", good]);
    assert.equal(verify.status, 0, verify.err);
    assert.equal(verify.json.report.reconciled, true);
    assert.ok(!(copy.err + JSON.stringify(copy.json)).includes(URL_BASE), "the database URL leaked");
  });
});

test("STATIC: the copy tool loads no Firebase module and is insert-only; the exporter only reads inventory_returns", () => {
  const strip = (f) => readFileSync(join(FUNCTIONS_DIR, f), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const copy = strip("scripts/returnIntakeCopy.js");
  for (const banned of [/\bUPDATE\s+eos_ops/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /require\(["'][^"']*firebase/i]) assert.doesNotMatch(copy, banned);
  const exporter = strip("scripts/exportReturnIntakeSnapshot.js");
  assert.match(readFileSync(join(FUNCTIONS_DIR, "scripts/exportReturnIntakeSnapshot.js"), "utf8").split("\n")[0], /^\/\/ FIREBASE_EXIT_MIGRATION_ONLY\r?$/);
  assert.doesNotMatch(exporter, /\.(set|add|update|delete|create|commit|batch|runTransaction|bulkWriter|recursiveDelete)\s*\(/);
  assert.deepEqual([...exporter.matchAll(/\bdb\.(\w+)\(/g)].map((m) => m[1]), ["collection"]);
  assert.match(exporter, /collection\(SOURCE_COLLECTION\)\.get\(\)/);
});
