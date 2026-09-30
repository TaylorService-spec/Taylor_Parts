// WORK ORDER FIELD CONTEXT + READINESS -- the governed EOS reads that replace getWorkOrderFieldContext and
// getWorkOrderReadinessContext (Owner DECISION 7, 2026-09-30), against a real postgres:16.
//
// Both are READS behind the entitled per-record Work Order read: a technician whose workOrder.record.read is
// conditioned (DQ-016) reads only their own; the office reads the tenant's. Every subdomain states its availability;
// inventory stops at a canonical NOT_YET_ACTIVATED, and nothing reads Firestore -- least of all the frozen Catalog.
//
// Real PostgreSQL. Set POLICY_TEST_DATABASE_URL; without it the database half SKIPS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const fieldContext = require("../lib/eosOps/workOrderFieldContext.js");
const readiness = require("../lib/eosOps/workOrderReadiness.js");
const ops = require("../lib/eosOps/workOrderOperations.js");
const scheduling = require("../lib/eosOps/workOrderScheduling.js");
const ctx = require("../lib/eosOps/contextualAuthorization.js");
const model = require("../lib/eosOps/conditionalEntitlement.js");

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const BASELINE = JSON.parse(readFileSync(resolve(FUNCTIONS_DIR, "src/adminPolicy/seed/roleCapabilityAuthorityBaseline.json"), "utf8"));
const capsOf = (...roleKeys) => new Set(BASELINE.grants.filter((g) => roleKeys.includes(g.roleKey)).map((g) => g.capabilityKey));

// ════════════════════ OFFLINE ════════════════════

test("both reads are wired to their reserved names and hold no Firebase, no frozen Catalog, no invented stock", () => {
  assert.equal(ops.EOS_WORK_ORDER_OPERATIONS.readWorkOrderFieldContext, fieldContext.readWorkOrderFieldContext);
  assert.equal(ops.EOS_WORK_ORDER_OPERATIONS.readWorkOrderReadiness, readiness.readWorkOrderReadiness);
  for (const op of ["readWorkOrderFieldContext", "readWorkOrderReadiness"]) assert.ok(ops.WORK_ORDER_READ_OPERATIONS.includes(op));
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const rel of ["workOrderFieldContext.ts", "workOrderReadiness.ts"]) {
    const src = strip(readFileSync(resolve(FUNCTIONS_DIR, "src/eosOps", rel), "utf8"));
    assert.equal(/firebase-admin|firebase-functions|getFirestore|onCall|fieldops_wos|\.collection\(/.test(src), false, `${rel}: Firebase`);
    assert.equal(/partMasterRepository|buildFirestorePartRepository|assertFirestoreCatalogReadCurrent|partBalance|readPartBalances/.test(src), false,
      `${rel}: the frozen Firestore Catalog / Firestore balances`);
    assert.equal(/inventory_commitments|inventory_balances|stock_locations|inventory_transactions/.test(src), false,
      `${rel}: no stock source is read -- inventory is NOT_YET_ACTIVATED`);
    assert.equal(/caller\.role|getCallerContext|\.technicianId|customClaims/.test(src), false, `${rel}: legacy identity`);
    assert.equal(/\bFROM\s+eos_ops\.parts\b/i.test(src), false, `${rel}: Part names come through the Catalog's governed read`);
  }
});

// ════════════════════ AGAINST REAL POSTGRESQL ════════════════════

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const T = "t-wofield";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("Work Order field context and readiness", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wofld_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations", "--no-check-order"],
    { cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe" });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (sql, v = []) => pool.query(sql, v);

  await q(`INSERT INTO eos_policy.tenants (id,key,name) VALUES ($1,$1,$1)`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id,operating_company_id,status,source,established_by,updated_by)
           VALUES ($1,'taylor','ACTIVE','fixture','fixture','fixture')`, [T]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id,operating_company_id,operating_company_key,status,provenance,source,established_by,updated_by)
           VALUES ($1,'taylor','taylor','ACTIVE','MIGRATED','fixture','fixture','fixture')`, [T]);
  const principal = async (pid) => {
    await q(`INSERT INTO eos_policy.principals (id,external_subject,identity_provider,status) VALUES ($1,$2,'eos','active')`, [pid, `sub-${pid}`]);
    await q(`INSERT INTO eos_policy.tenant_memberships (id,tenant_id,principal_id,status) VALUES ($1,$2,$3,'active')`, [`mem-${pid}`, T, pid]);
  };
  const employee = async (eid) => {
    await q(`INSERT INTO eos_workforce.employees (id,tenant_id,employment_status,operating_company_id,employee_number,display_name)
             VALUES ($1,$2,'ACTIVE','taylor',$1,$3)`, [eid, T, `Tech ${eid}`]);
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id,tenant_id,employee_id,qualification_code,effective_from,assigned_by,reason)
             VALUES ($1,$2,$3,'SERVICE_TECHNICIAN',now(),'fixture','field fixture')`, [`elig-${eid}`, T, eid]);
  };
  const link = (pid, eid) => q(
    `INSERT INTO eos_policy.employee_principal_links
       (id,tenant_id,principal_id,employee_id,operating_company_id,link_source,status,asserted_by,assertion_reason)
     VALUES ($1,$2,$3,$4,'taylor','OPERATOR_ASSERTED','active','fixture','field fixture')`, [`lnk-${pid}`, T, pid, eid]);
  for (const p of ["prn-dispatcher", "prn-tech-a", "prn-tech-b"]) await principal(p);
  await employee("emp-a"); await link("prn-tech-a", "emp-a");
  await employee("emp-b"); await link("prn-tech-b", "emp-b");
  await q(`INSERT INTO eos_crm.accounts (id,tenant_id,name,status,created_by,updated_by) VALUES ('acct-1',$1,'Harbor Diner','ACTIVE','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,address_street,address_city,address_state,access_notes,created_by,updated_by)
           VALUES ('loc-1',$1,'acct-1','Harbor Diner Main','1 Pier Rd','Portsmouth','NH','Back door, ring twice','f','f')`, [T]);
  await q(`INSERT INTO eos_crm.account_locations (id,tenant_id,account_id,name,created_by,updated_by) VALUES ('loc-blank',$1,'acct-1',' ','f','f')`, [T])
    .catch(() => undefined);
  await q(`INSERT INTO eos_ops.equipment_models (id, tenant_id, manufacturer_id, manufacturer_name, model_number, display_name, status, source_authority, version, created_by, updated_by)
           VALUES ('HOSHIZAKI--KM-515', $1, 'HOSHIZAKI', 'Hoshizaki', 'KM-515', 'Hoshizaki KM-515', 'ACTIVE', 'proof', 1, 'f', 'f')`, [T]);
  await q(`INSERT INTO eos_ops.equipment (id, tenant_id, operating_company_key, account_id, customer_location_id, equipment_model_id, name, status,
             serial_number, created_by, updated_by)
           VALUES ('eq-1', $1, 'taylor', 'acct-1', 'loc-1', 'HOSHIZAKI--KM-515', 'Ice machine', 'ACTIVE', 'SN-42', 'f', 'f')`, [T]);
  await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
             expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
           VALUES ('PRT-1005', $1, 'f', 'PRT-1005', 'Water Filter Cartridge', 'ACTIVE', 'EACH', 'STANDARD', 'STOCKED', false, false, false, false, 1, 'f')`, [T]);

  const OFFICE = ["workOrder.lifecycle.ready", "workOrder.lifecycle.schedule"];
  const P = Object.freeze({
    dispatcher: { principalId: "prn-dispatcher", caps: new Set([...capsOf("dispatcher"), ...OFFICE]) },
    techA: { principalId: "prn-tech-a", caps: capsOf("technician") },
    techB: { principalId: "prn-tech-b", caps: capsOf("technician") },
    nobody: { principalId: "prn-tech-b", caps: new Set() },
  });
  const DQ016 = model.grantConditionCatalog([{ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey: "workOrder.record.read",
    condition: { paths: [[{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }]], recordKind: "workOrder" } }]);
  const caller = (p, conditions = model.SHIPPED_GRANT_CONDITIONS) => {
    const ent = model.entitlementsFrom([...p.caps].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "persona" }, capabilityKey })), conditions);
    const unconditioned = new Set(ent.filter((e) => e.condition === null).map((e) => e.capabilityKey));
    return {
      actor: { tenantId: T, principalId: p.principalId, capabilities: unconditioned },
      operational: { tenantId: T, principalId: p.principalId, capabilities: unconditioned,
        conditionallyHeld: new Set(ent.filter((e) => e.condition !== null).map((e) => e.capabilityKey)), entitlements: () => ent },
    };
  };
  const tech = (p) => caller(p, DQ016);
  const deps = { pool, reader: ctx.postgresContextualReader(pool) };
  const readField = (c, workOrderId) => fieldContext.readWorkOrderFieldContext(deps, c, { workOrderId });
  const readReady = (c, workOrderId) => readiness.readWorkOrderReadiness(deps, c, { workOrderId });

  let seq = 0;
  const newWo = async ({ equipmentId = null, locationId = "loc-1" } = {}) => {
    const id = `wo-${++seq}`;
    await q(`INSERT INTO eos_ops.work_orders
               (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority, customer_id, location_id,
                equipment_id, complaint, provenance, created_by_principal_id, created_at, updated_at)
             VALUES ($1,$2,'taylor',$3,'READY_TO_DISPATCH','SERVICE_CALL',2,'acct-1',$4,$5,'Ice machine not freezing','NATIVE','prn-dispatcher',now(),now())`,
      [id, T, `WO-2033-${String(seq).padStart(6, "0")}`, locationId, equipmentId]);
    return id;
  };
  const future = (days) => { const s = Date.now() + days * DAY; return { scheduledStart: new Date(s).toISOString(), scheduledEnd: new Date(s + 2 * HOUR).toISOString() }; };
  const scheduled = async (employeeId, days, opts) => {
    const wo = await newWo(opts);
    await scheduling.scheduleWorkOrder({ pool }, caller(P.dispatcher).actor, { workOrderId: wo, employeeId, ...future(days) });
    return wo;
  };

  const woA = await scheduled("emp-a", 2, { equipmentId: "eq-1" });
  await q(`INSERT INTO eos_ops.work_order_parts_plan (tenant_id, work_order_id, part_id, qty_planned, planned_by, updated_by)
           VALUES ($1,$2,'PRT-1005',2,'prn-dispatcher','prn-dispatcher'), ($1,$2,'PRT-GONE',1,'prn-dispatcher','prn-dispatcher')`, [T, woA]);
  const woB = await scheduled("emp-b", 3);

  await t.test("FIELD CONTEXT: the assigned technician reads their own job from governed sources, each subdomain stating its availability", async () => {
    const c = await readField(tech(P.techA), woA);
    assert.equal(c.workOrderId, woA);
    assert.deepEqual(c.customer, { state: "RESOLVED", displayName: "Harbor Diner" });
    assert.equal(c.site.state, "RESOLVED");
    assert.equal(c.site.displayLabel, "Harbor Diner Main — Portsmouth, NH");
    assert.equal(c.site.address.street, "1 Pier Rd");
    assert.equal(c.site.accessNotes, "Back door, ring twice");
    assert.deepEqual([c.workOrder.state, c.workOrder.status, c.workOrder.complaint], ["AVAILABLE", "SCHEDULED", "Ice machine not freezing"]);
    assert.deepEqual([c.assignment.state, c.assignment.assigneeEmployeeId, c.assignment.assigneeDisplayName, c.assignment.assignedToCaller],
      ["AVAILABLE", "emp-a", "Tech emp-a", true]);
    assert.equal(c.equipment.state, "AVAILABLE");
    assert.equal(c.equipment.equipment.serialNumber, "SN-42");
    assert.deepEqual(c.equipment.model, { equipmentModelId: "HOSHIZAKI--KM-515", displayName: "Hoshizaki KM-515", manufacturerName: "Hoshizaki", modelNumber: "KM-515" });
    assert.deepEqual(c.equipment.custody, { state: "NOT_YET_ACTIVATED" }, "serialized custody stays behind the Inventory boundary");
    assert.equal(c.parts.state, "AVAILABLE");
    assert.deepEqual(c.parts.lines.map((l) => [l.partId, l.name, l.internalPartNumber, l.catalog, l.qtyPlanned, l.qtyUsed]), [
      ["PRT-1005", "Water Filter Cartridge", "PRT-1005", "RESOLVED", 2, 0],
      ["PRT-GONE", null, null, "UNRESOLVED", 1, 0],
    ], "a Part the Catalog cannot name is UNRESOLVED, never given a guessed name");
    assert.equal(c.execution.state, "AVAILABLE");
    assert.equal(c.inventory.state, "NOT_YET_ACTIVATED");
  });

  await t.test("FIELD CONTEXT: another technician is refused; no capability is refused; the office reads it", async () => {
    await assert.rejects(readField(tech(P.techB), woA), (e) => { assert.equal(e.category, "FORBIDDEN"); return true; });
    await assert.rejects(readField(caller(P.nobody), woA), (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
    await assert.rejects(readField(tech(P.techB), "wo-guessed"), (e) => { assert.equal(e.category, "FORBIDDEN"); return true; },
      "a guessed id refuses exactly like somebody else's");
    const office = await readField(caller(P.dispatcher), woA);
    assert.equal(office.assignment.assignedToCaller, false);
    await assert.rejects(fieldContext.readWorkOrderFieldContext(deps, caller(P.dispatcher), { workOrderId: woA, customerId: "acct-1" }),
      (e) => { assert.equal(e.code, "INPUT_FIELD_NOT_ACCEPTED"); return true; }, "the request carries workOrderId only");
  });

  await t.test("FIELD CONTEXT: no Equipment is NOT_APPLICABLE; an unusable site name is UNRESOLVED, never the raw id", async () => {
    const own = await readField(tech(P.techB), woB);
    assert.deepEqual([own.equipment.state, own.equipment.equipment], ["NOT_APPLICABLE", null]);
    assert.deepEqual(own.parts.lines, []);
    const blank = await q(`SELECT 1 FROM eos_crm.account_locations WHERE id='loc-blank'`);
    if (blank.rows.length === 1) {
      const wo = await newWo({ locationId: "loc-blank" });
      const c = await readField(caller(P.dispatcher), wo);
      assert.deepEqual([c.site.state, c.site.displayLabel], ["UNRESOLVED", null]);
    }
  });

  await t.test("READINESS: Work Order + Catalog dimensions from PostgreSQL; inventory is a canonical NOT_YET_ACTIVATED, never a balance", async () => {
    const r = await readReady(tech(P.techA), woA);
    assert.equal(r.schemaVersion, 1);
    assert.deepEqual(r.subject, { workOrderId: woA, reference: "WO-2033-000001", status: "SCHEDULED", customerName: "Harbor Diner" });
    assert.deepEqual(r.inventory.state, "NOT_YET_ACTIVATED");
    assert.deepEqual(r.sources, { workOrder: "AVAILABLE", customer: "AVAILABLE", catalog: "AVAILABLE",
      inventory: "NOT_YET_ACTIVATED", truckInventory: "NOT_YET_ACTIVATED", procurement: "UNAVAILABLE" });
    assert.deepEqual(r.capabilities, { warehouse: false, truckInventory: false, purchasing: false, requestReorder: false });
    const line = r.plannedParts.find((l) => l.partId === "PRT-1005");
    assert.deepEqual(line, { partId: "PRT-1005", name: "Water Filter Cartridge", sku: "PRT-1005", catalog: "RESOLVED", qtyPlanned: 2, qtyUsed: 0,
      reservedForJob: null, warehouse: { status: "UNAVAILABLE" }, truck: { status: "UNAVAILABLE" }, procurement: { status: "UNAVAILABLE" } });
    for (const l of r.plannedParts) {
      assert.equal("available" in l.warehouse, false, "no warehouse quantity is invented");
      assert.equal(l.reservedForJob, null, "no reservation is invented -- not even a zero");
    }
    assert.ok(r.limitations.includes("INVENTORY_BALANCE_NOT_YET_ACTIVATED"));
  });

  await t.test("READINESS: the same record gate -- another technician and a capability-less caller are refused", async () => {
    await assert.rejects(readReady(tech(P.techB), woA), (e) => { assert.equal(e.category, "FORBIDDEN"); return true; });
    await assert.rejects(readReady(caller(P.nobody), woA), (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
    assert.equal((await readReady(caller(P.dispatcher), woA)).plannedParts.length, 2);
  });
});
