// DQ-034 (journey 5, equipment installation): the EOS / PostgreSQL implementation of
// getInstallableEquipmentForWorkOrder + recordWorkOrderEquipmentInstall reads the PostgreSQL CATALOG
// (whole_unit) through the one Part policy authority, and applies the Work Order boundary with governed
// authority: equipment.install + RECORD_ASSIGNMENT (assigned Employee), INSTALL type, WORK_IN_PROGRESS,
// customer / site / operating company taken from the Work Order. Real postgres:16, its own database.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const woInstall = require("../lib/eosOps/workOrderEquipmentInstall.js");
const partsPlan = require("../lib/eosOps/workOrderPartsPlanAuthority.js");

test("the EOS install derives the Equipment id exactly as the deployed command does", async () => {
  // The Firestore-bound module is imported only here, by the test, to prove the restated derivation agrees.
  const legacy = await import("../lib/equipmentInstall/installSerializedAssetCommand.js");
  for (const key of ["k-1", "idem-2026-09-28", "x".repeat(80)]) {
    assert.equal(woInstall.workOrderInstallEquipmentId(key), legacy.equipmentDocIdFor(key));
  }
});

test("the EOS install module reads the catalog only through the Part policy authority", () => {
  const src = readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps/workOrderEquipmentInstall.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/eos_ops\.parts\b/.test(src), false, "no private SELECT on eos_ops.parts");
  assert.match(src, /createPostgresPartPolicyAuthority/);
  assert.equal(/firebase|firestore/i.test(src), false);
});

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("Work Order equipment installation against the PostgreSQL catalog", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `l2woinst_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 6 });
  const q = (s, v = []) => pool.query(s, v);
  const T = "t1";

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-1',$1,'Cust','ACTIVE','f','f')`, [T]);
  const principal = async (pid) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'firebase','active')`, [pid, `uid-${pid}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
  };
  for (const p of ["prn-tech-a", "prn-tech-b", "prn-admin"]) await principal(p);
  for (const [pid, eid] of [["prn-tech-a", "emp-a"], ["prn-tech-b", "emp-b"]]) {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number) VALUES ($1,$2,'ACTIVE','taylor',$1)`, [eid, T]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
             VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','active','fixture','install fixture')`, [`lnk-${pid}`, T, pid, eid]);
  }
  const part = (id, { control = "STANDARD", whole = false } = {}) => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
       control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
     VALUES ($1, $2, 'seed', $3, 'proof part', 'ACTIVE', 'EACH', $4, 'STOCKED', false, false, false, $5, 1, 'seed')`,
    [id, T, `IPN-${id}`, control, whole]);
  await part("p-unit", { control: "SERIALIZED", whole: true });
  await part("p-component", { control: "SERIALIZED", whole: false });
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, status) VALUES ('wh-1',$1,'taylor','WH','ACTIVE')`, [T]).catch(() => undefined);
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, status) VALUES ('wh-v',$1,'ventana','WHV','ACTIVE')`, [T]).catch(() => undefined);
  const custody = (partId, serial, company = "taylor", wh = "wh-1", status = "AVAILABLE") => q(
    `INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, operating_company_key, status, location_type, location_id, updated_by)
     VALUES ($6, $5, $1, $2, $3, $4, 'WAREHOUSE', $7, 'seed')`, [partId, serial, company, status, T, `cust-${partId}-${serial}`, wh]);
  await custody("p-unit", "SN-1");
  await custody("p-unit", "SN-2");
  await custody("p-component", "SN-C1");
  await custody("p-unit", "SN-V", "ventana", "wh-v");
  const wo = (id, { type = "INSTALL", status = "WORK_IN_PROGRESS" } = {}) => q(
    `INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, status, work_order_type, priority, customer_id,
       location_id, provenance, created_by_principal_id, created_at, updated_at)
     VALUES ($1,$2,'taylor',$3,$4,2,'acct-1','crmloc-1','NATIVE','prn-admin',now(),now())`, [id, T, status, type]);
  // Status is written directly where the WO lifecycle's check constraints allow, as the lifecycle fixtures do.
  await wo("wo-inst");
  await wo("wo-svc", { type: "SERVICE_CALL" });
  await wo("wo-ready", { status: "READY_TO_DISPATCH" });
  for (const [aid, w, e] of [["woa-1", "wo-inst", "emp-a"], ["woa-2", "wo-svc", "emp-a"], ["woa-3", "wo-ready", "emp-a"]]) {
    await q(`INSERT INTO eos_ops.work_order_assignments (id,tenant_id,work_order_id,assignee_employee_id,source,effective_from,assigned_by_principal_id,provenance)
             VALUES ($1,$2,$3,$4,'SCHEDULE',now() - interval '1 hour','prn-admin','NATIVE')`, [aid, T, w, e]);
  }

  const actor = (principalId, caps = ["equipment.install"]) => ({ tenantId: T, principalId, capabilities: new Set(caps) });
  const deps = { pool };

  await t.test("LIST: only WHOLE UNITS the catalog names, held by the Work Order's operating company", async () => {
    const r = await woInstall.listInstallableUnitsForWorkOrder(deps, actor("prn-tech-a"), { workOrderId: "wo-inst" });
    assert.deepEqual(r.units.map((u) => `${u.partId}/${u.serialNumber}`), ["p-unit/SN-1", "p-unit/SN-2"],
      "the serialized component is not a whole unit, and the Ventana-held unit is another company's");
    const one = await woInstall.listInstallableUnitsForWorkOrder(deps, actor("prn-tech-a"), { workOrderId: "wo-inst", serialNumber: "SN-2" });
    assert.deepEqual(one.units.map((u) => u.serialNumber), ["SN-2"]);
  });

  await t.test("the whole-unit fact is the PostgreSQL CATALOG's: flip it, and the list follows", async () => {
    await q(`UPDATE eos_ops.parts SET whole_unit = false WHERE tenant_id=$1 AND id='p-unit'`, [T]);
    const r = await woInstall.listInstallableUnitsForWorkOrder(deps, actor("prn-tech-a"), { workOrderId: "wo-inst" });
    assert.deepEqual(r.units, []);
    await assert.rejects(woInstall.recordWorkOrderEquipmentInstall(deps, actor("prn-tech-a"),
      { workOrderId: "wo-inst", partId: "p-unit", serialNumber: "SN-1", idempotencyKey: "k-flip", equipmentName: "Unit" }),
    (e) => e.code === "PART_NOT_WHOLE_UNIT");
    await q(`UPDATE eos_ops.parts SET whole_unit = true WHERE tenant_id=$1 AND id='p-unit'`, [T]);
  });

  await t.test("AUTHORITY: capability first (zero reads), then the ASSIGNMENT -- another technician is refused", async () => {
    await assert.rejects(woInstall.listInstallableUnitsForWorkOrder(deps, actor("prn-tech-a", []), { workOrderId: "wo-inst" }),
      (e) => e.code === "CAPABILITY_MISSING");
    await assert.rejects(woInstall.listInstallableUnitsForWorkOrder(deps, actor("prn-tech-b"), { workOrderId: "wo-inst" }),
      (e) => e.code === "NOT_ASSIGNED");
    await assert.rejects(woInstall.recordWorkOrderEquipmentInstall(deps, actor("prn-tech-b"),
      { workOrderId: "wo-inst", partId: "p-unit", serialNumber: "SN-1", idempotencyKey: "k-b", equipmentName: "Unit" }),
    (e) => e.code === "NOT_ASSIGNED");
    // An administrator holding the capability but not assigned is refused too (the legacy rule: own job only).
    await assert.rejects(woInstall.listInstallableUnitsForWorkOrder(deps, actor("prn-admin"), { workOrderId: "wo-inst" }),
      (e) => e.code === "EMPLOYEE_LINK_REQUIRED");
  });

  await t.test("THE JOB: only an INSTALL Work Order, only WORK_IN_PROGRESS", async () => {
    await assert.rejects(woInstall.listInstallableUnitsForWorkOrder(deps, actor("prn-tech-a"), { workOrderId: "wo-svc" }),
      (e) => e.code === "WORK_ORDER_NOT_INSTALL");
    await assert.rejects(woInstall.listInstallableUnitsForWorkOrder(deps, actor("prn-tech-a"), { workOrderId: "wo-ready" }),
      (e) => e.code === "WORK_ORDER_STATE_INVALID");
  });

  await t.test("RECORD: installs with the Work Order's customer, site and company; a retry reports done, installs nothing twice", async () => {
    const input = { workOrderId: "wo-inst", partId: "p-unit", serialNumber: "SN-1", idempotencyKey: "k-1", equipmentName: "Taylor C713" };
    const r = await woInstall.recordWorkOrderEquipmentInstall(deps, actor("prn-tech-a"), input);
    assert.equal(r.outcome, "installed");
    const { rows } = await q(`SELECT id, account_id, customer_location_id, operating_company_key FROM eos_ops.equipment WHERE tenant_id=$1`, [T]);
    assert.deepEqual(rows.map((e) => [e.id, e.account_id, e.customer_location_id, e.operating_company_key]),
      [[woInstall.workOrderInstallEquipmentId("k-1"), "acct-1", "crmloc-1", "taylor"]]);
    const again = await woInstall.recordWorkOrderEquipmentInstall(deps, actor("prn-tech-a"), input);
    assert.equal(again.outcome, "already_installed_for_this_work_order");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.equipment WHERE tenant_id=$1`, [T])).rows[0].n, 1);
  });

  // ── DQ-034 journey 4: the EOS parts plan resolves Parts from the PostgreSQL catalog ──
  await t.test("J4 PARTS PLAN: planned against the PG catalog; the legacy SKU_UNRESOLVED case is impossible by schema", async () => {
    const planner = { tenantId: T, principalId: "prn-admin", capabilities: new Set(["workOrder.parts.plan"]) };
    const r = await partsPlan.setPartsPlan({ pool }, planner, { workOrderId: "wo-inst", plan: [{ partId: "p-component", qtyPlanned: 2 }] });
    assert.deepEqual(r.added, ["p-component"]);
    // A Part that exists only in the frozen Firebase catalog is unknown here: refused, whole plan.
    await assert.rejects(partsPlan.setPartsPlan({ pool }, planner, { workOrderId: "wo-inst",
      plan: [{ partId: "p-component", qtyPlanned: 2 }, { partId: "fs-only-part", qtyPlanned: 1 }] }),
    (e) => e.code === "PART_NOT_FOUND");
    // The deployed command also refuses a Part with no internalPartNumber (SKU_UNRESOLVED). PostgreSQL makes
    // that Part impossible to store, so the EOS command needs no second check.
    await assert.rejects(q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
       control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
     VALUES ('p-noipn', $1, 'seed', '', 'x', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'seed')`, [T]),
    /part_internal_part_number_present/);
    // The capability is the registered one (DQ-011); a caller without it is refused before any read.
    await assert.rejects(partsPlan.setPartsPlan({ pool }, { ...planner, capabilities: new Set() }, { workOrderId: "wo-inst", plan: [] }),
      (e) => e.code === "CAPABILITY_MISSING");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_policy.capabilities WHERE key='workOrder.parts.plan'`)).rows[0].n, 1);
  });

  await t.test("RECORD: a serialized COMPONENT is refused by the catalog, and another company's unit by custody", async () => {
    await assert.rejects(woInstall.recordWorkOrderEquipmentInstall(deps, actor("prn-tech-a"),
      { workOrderId: "wo-inst", partId: "p-component", serialNumber: "SN-C1", idempotencyKey: "k-c", equipmentName: "x" }),
    (e) => e.code === "PART_NOT_WHOLE_UNIT");
    await assert.rejects(woInstall.recordWorkOrderEquipmentInstall(deps, actor("prn-tech-a"),
      { workOrderId: "wo-inst", partId: "p-unit", serialNumber: "SN-V", idempotencyKey: "k-v", equipmentName: "x" }),
    (e) => e.code === "OPERATING_COMPANY_MISMATCH");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_ops.equipment WHERE tenant_id=$1`, [T])).rows[0].n, 1, "nothing minted");
  });
});
