// LANE 3 -- the Work Order business process against the PostgreSQL CATALOG, on a real postgres:16.
//
// The claim under test is narrow and it is the one that matters: a governed Render command asks the
// CATALOG what a Part is, in its own transaction, and refuses when the answer does not permit the act.
// Not "the column exists"; not "a stub said FOUND".
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const policyAuthority = require("../lib/catalogAuthority/postgresPartPolicyAuthority.js");
const custody = require("../lib/eosOps/equipmentCustody.js");
const commitments = require("../lib/eosOps/inventoryCommitmentRepository.js");
const partsPlan = require("../lib/eosOps/workOrderPartsPlanAuthority.js");
const boundary = require("../lib/eosOps/serviceFromSalesOrderBoundary.js");
const transitionEngine = require("../lib/transitionEngine.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

test("Work Order commands resolve Parts from the PostgreSQL catalog", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `wocat_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await pool?.end();
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  const q = (text, values = []) => pool.query(text, values);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by)
           VALUES ('acct-1','t1','Cust','ACTIVE','f','f')`);
  const repo = new PostgresPolicyRepository(pool);
  const actorPrincipal = await repo.transact({ tenantId: "t1", uid: "fixture" }, async (tx) => {
    const pr = await tx.createPrincipal({ externalSubject: "uid-actor", identityProvider: "firebase" });
    await tx.createTenantMembership(pr.id);
    return pr.id;
  });

  // Four Parts spanning the decisions under test. The `part_whole_unit_serialized` CHECK does half the
  // work for us: a whole unit CANNOT be STANDARD or SERVICE, so "whole unit" already means installable.
  const part = (tenant, id, { control = "STANDARD", whole = false, klass = "STOCKED" } = {}) => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
       control_type, stocking_class, expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
     VALUES ($1, $2, 'seed', $3, 'proof part', 'ACTIVE', 'EACH', $4, $5, false, false, false, $6, 1, 'seed')`,
    [id, tenant, `IPN-${id}`, control, klass, whole]);

  await part("t1", "p-wholeunit", { control: "SERIALIZED", whole: true });
  await part("t1", "p-serial-component", { control: "SERIALIZED", whole: false });
  await part("t1", "p-standard");
  await part("t1", "p-lot", { control: "LOT" });
  await part("t2", "p-othertenant", { control: "SERIALIZED", whole: true });

  // ════════════════════ THE PART POLICY AUTHORITY ════════════════════

  await t.test("it answers one row per Part, in order, including for Parts that do not exist", async () => {
    const asked = ["p-standard", "nope", "p-wholeunit"];
    const got = await policyAuthority.createPostgresPartPolicyAuthority().readPartPolicies(pool, "t1", asked);
    assert.deepEqual(got.map((p) => p.partId), asked, "a missing Part must occupy its own position");
    assert.deepEqual(got.map((p) => p.found), [true, false, true]);
    // A stated absence, not a silently shorter list the caller would re-align wrongly.
    assert.equal(got[1].wholeUnit, null);
    assert.equal(got[1].trackingMode, null);
  });

  await t.test("tracking mode comes from THE shared mapping, not a second one", async () => {
    const a = policyAuthority.createPostgresPartPolicyAuthority();
    const [std, ser, lot] = await a.readPartPolicies(pool, "t1", ["p-standard", "p-serial-component", "p-lot"]);
    assert.equal(std.trackingMode, "NONE");
    assert.equal(ser.trackingMode, "SERIAL");
    assert.equal(lot.trackingMode, "LOT");
    const shared = require("../lib/partMaster/controlTypeTrackingMode.js");
    for (const p of [std, ser, lot]) {
      assert.equal(p.trackingMode, shared.controlTypeToTrackingMode(p.controlType),
        "the authority must not carry its own copy of the controlType -> trackingMode rule");
    }
  });

  await t.test("another tenant's Part is NOT FOUND, never borrowed", async () => {
    const [p] = await policyAuthority.createPostgresPartPolicyAuthority()
      .readPartPolicies(pool, "t1", ["p-othertenant"]);
    assert.equal(p.found, false);
  });

  await t.test("it refuses a request it cannot answer within a tenant", async () => {
    const a = policyAuthority.createPostgresPartPolicyAuthority();
    await assert.rejects(() => a.readPartPolicies(pool, "", ["p-standard"]), /INVALID_TENANT|only answerable/);
    await assert.rejects(() => a.readPartPolicies(pool, "t1", [""]), /INVALID_PART_ID|stated Part id/);
  });

  // ════════════════════ EQUIPMENT INSTALL ════════════════════

  const custodyRow = (partId, serial, status = "AVAILABLE") => q(
    `INSERT INTO eos_ops.serialized_custody (id, tenant_id, part_id, serial_number, operating_company_key, status, location_type, location_id, updated_by)
     VALUES ($4, 't1', $1, $2, 'sample-co', $3, 'WAREHOUSE', 'wh-1', 'seed')`, [partId, serial, status, `cust-${partId}-${serial}`]);
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, status)
           VALUES ('wh-1','t1','sample-co','WH','ACTIVE')`).catch(() => undefined);

  const install = (partId, serial, equipmentId) => custody.installSerializedUnitAsEquipment(pool, {
    tenantId: "t1", actorId: "prn-1", operatingCompanyKey: "sample-co",
    partId, serialNumber: serial, equipmentId,
    accountId: "acct-1",
    customerLocation: { namespace: "CRM_LOCATION", id: "crmloc-1" },
    equipment: { name: "Unit A" },
  });

  await t.test("a serialized WHOLE UNIT installs as customer Equipment", async () => {
    await custodyRow("p-wholeunit", "SN-1");
    const result = await install("p-wholeunit", "SN-1", "eq-1");
    assert.equal(result.equipment.id, "eq-1");
    assert.equal(result.unit.partId ?? result.unit.part_id ?? "p-wholeunit", "p-wholeunit");
  });

  await t.test("a serialized SERVICE COMPONENT is refused -- custody alone does not make it Equipment", async () => {
    await custodyRow("p-serial-component", "SN-2");
    await assert.rejects(() => install("p-serial-component", "SN-2", "eq-2"), (e) => {
      assert.equal(e.code, "PART_NOT_WHOLE_UNIT");
      return true;
    });
    // AND NOTHING WAS WRITTEN. The refusal is worth little if it leaves an Equipment row behind.
    const { rows } = await q(`SELECT 1 FROM eos_ops.equipment WHERE tenant_id='t1' AND id='eq-2'`);
    assert.equal(rows.length, 0, "a refused install must not have created Equipment");
  });

  await t.test("an unknown Part is refused, and a wrong-tenant Part is unknown", async () => {
    await custodyRow("p-ghost", "SN-3");
    await assert.rejects(() => install("p-ghost", "SN-3", "eq-3"), (e) => {
      assert.equal(e.code, "PART_NOT_FOUND");
      return true;
    });
    await custodyRow("p-othertenant", "SN-4");
    await assert.rejects(() => install("p-othertenant", "SN-4", "eq-4"), (e) => {
      assert.equal(e.code, "PART_NOT_FOUND", "another tenant's whole unit is not this tenant's whole unit");
      return true;
    });
  });

  await t.test("the existing custody refusals keep their precedence", async () => {
    // The Part check was placed AFTER these deliberately, so adding it changed no existing answer.
    await assert.rejects(() => install("p-wholeunit", "SN-NOSUCH", "eq-5"), (e) => {
      assert.equal(e.code, "UNIT_NOT_FOUND");
      return true;
    });
    await assert.rejects(() => install("p-wholeunit", "SN-1", "eq-6"), (e) => {
      assert.equal(e.code, "ALREADY_INSTALLED", "a retry of a completed install is still a conflict, not a duplicate");
      return true;
    });
  });

  await t.test("wholeUnit is not an input the caller can state", async () => {
    const src = require("node:fs").readFileSync(`${FUNCTIONS_DIR}/src/eosOps/equipmentCustody.ts`, "utf8");
    const iface = src.slice(src.indexOf("export interface InstallRequest"), src.indexOf("export interface InstallResult"));
    assert.equal(/wholeUnit|whole_unit/.test(iface), false,
      "InstallRequest must not accept wholeUnit -- a caller that states it can state it wrongly");
  });

  // ════════════════════ CONSUMPTION ════════════════════

  const ctx = (workOrderId, key) => ({
    tenantId: "t1", operatingCompanyKey: "sample-co", workOrderId, actorId: "prn-1", idempotencyKey: key,
  });
  const workOrder = (id, status = "WORK_IN_PROGRESS") => q(
    `INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, status, work_order_type, priority,
       customer_id, location_id, provenance, created_by_principal_id, created_at, updated_at,
       completed_at, closed_at)
     VALUES ($1,'t1','sample-co',$2::eos_ops.ops_work_order_status,'SERVICE_CALL',2,'acct-1','loc-1','NATIVE',$3,now(),now(),
       CASE WHEN $4 = 'COMPLETED' THEN now() END,
       CASE WHEN $4 = 'CLOSED' THEN now() END)`, [id, status, actorPrincipal, status]);

  await t.test("consumption resolves the Part and refuses one the catalog does not know", async () => {
    await workOrder("wo-c1");
    await assert.rejects(
      () => commitments.reconcileConsumption(pool, ctx("wo-c1", "idem-c1"), [{ partId: "p-ghost", qtyPlanned: 2 }]),
      (e) => { assert.equal(e.code, "PART_NOT_FOUND"); return true; });
    const { rows } = await q(`SELECT 1 FROM eos_ops.inventory_commitments WHERE work_order_id='wo-c1'`);
    assert.equal(rows.length, 0, "a refused consumption must write no commitment row");
  });

  await t.test("a quantity commitment refuses a SERIAL part rather than approximating it", async () => {
    await workOrder("wo-c2");
    await assert.rejects(
      () => commitments.reconcileConsumption(pool, ctx("wo-c2", "idem-c2"), [{ partId: "p-serial-component", qtyPlanned: 3 }]),
      (e) => { assert.equal(e.code, "TRACKING_MODE_NOT_SUPPORTED"); return true; });
  });

  await t.test("a quantity-tracked part still reconciles exactly as before", async () => {
    await workOrder("wo-c3");
    const written = await commitments.reconcileConsumption(pool, ctx("wo-c3", "idem-c3"),
      [{ partId: "p-standard", qtyPlanned: 5, qtyUsed: 2 }]);
    const kinds = written.map((w) => w.record.eventType).sort();
    // 5 planned, 2 used: reserve the 5, consume 2, release the unused 3. Unchanged by the catalog check.
    assert.deepEqual(kinds, ["CONSUMED", "RELEASED", "RESERVED"]);
  });

  await t.test("ONE bad line refuses the whole plan, before any row is written", async () => {
    await workOrder("wo-c4");
    await assert.rejects(
      () => commitments.reconcileConsumption(pool, ctx("wo-c4", "idem-c4"), [
        { partId: "p-standard", qtyPlanned: 1 },
        { partId: "p-ghost", qtyPlanned: 1 },
      ]),
      (e) => { assert.equal(e.code, "PART_NOT_FOUND"); return true; });
    const { rows } = await q(`SELECT 1 FROM eos_ops.inventory_commitments WHERE work_order_id='wo-c4'`);
    assert.equal(rows.length, 0, "the good line must not have been written");
  });

  await t.test("RESERVE validates too -- a promise is a promise wherever it is made", async () => {
    await workOrder("wo-c6");
    await assert.rejects(
      () => commitments.reserve(pool, ctx("wo-c6", "idem-c6"), [{ partId: "p-serial-component", quantity: 1 }]),
      (e) => { assert.equal(e.code, "TRACKING_MODE_NOT_SUPPORTED"); return true; });
    await assert.rejects(
      () => commitments.reserve(pool, ctx("wo-c6", "idem-c6b"), [{ partId: "p-ghost", quantity: 1 }]),
      (e) => { assert.equal(e.code, "PART_NOT_FOUND"); return true; });
  });

  await t.test("RELEASE does not consult the catalog -- stranded stock is worse than a stale Part", async () => {
    await workOrder("wo-c5");
    // RESERVE only -- reconcileConsumption with no qtyUsed consumes the whole plan and leaves nothing
    // outstanding, which would make this test pass for the wrong reason.
    await commitments.reserve(pool, ctx("wo-c5", "idem-c5"), [{ partId: "p-standard", quantity: 4 }]);
    // Deactivating the Part must not trap the reservation this Work Order is holding.
    await q(`UPDATE eos_ops.parts SET status='INACTIVE' WHERE tenant_id='t1' AND id='p-standard'`);
    const released = await commitments.releaseOutstanding(pool, ctx("wo-c5", "idem-c5-rel"));
    assert.ok(released.length > 0, "an outstanding reservation must still be releasable");
    await q(`UPDATE eos_ops.parts SET status='ACTIVE' WHERE tenant_id='t1' AND id='p-standard'`);
  });

  // ════════════════════ PARTS PLAN ════════════════════

  const planActor = (caps = [partsPlan.WORK_ORDER_PARTS_PLAN]) =>
    ({ tenantId: "t1", principalId: "prn-planner", capabilities: new Set(caps) });
  const setPlan = (workOrderId, plan, actor = planActor()) =>
    partsPlan.setPartsPlan({ pool }, actor, { workOrderId, plan });

  await t.test("the terminal-status rule is THE canonical one, not a second list", () => {
    assert.deepEqual(
      [...partsPlan.TERMINAL_WORK_ORDER_STATUSES].sort(),
      [...transitionEngine.TERMINAL_STATUSES].sort(),
      "the PostgreSQL plan must terminate on the same statuses the transition engine calls terminal");
  });

  await t.test("planning requires the capability, checked before anything is read", async () => {
    await workOrder("wo-p1");
    await assert.rejects(() => setPlan("wo-p1", [{ partId: "p-standard", qtyPlanned: 1 }], planActor([])),
      (e) => { assert.equal(e.code, "CAPABILITY_MISSING"); return true; });
  });

  await t.test("a plan is set, re-read, and a restated identical line writes nothing", async () => {
    await workOrder("wo-p2");
    const first = await setPlan("wo-p2", [
      { partId: "p-standard", qtyPlanned: 3 },
      { partId: "p-serial-component", qtyPlanned: 1 },
    ]);
    assert.deepEqual([...first.added].sort(), ["p-serial-component", "p-standard"]);
    assert.equal(first.plan.length, 2);
    assert.equal(first.plan.find((r) => r.partId === "p-standard").version, 1);

    const again = await setPlan("wo-p2", [
      { partId: "p-standard", qtyPlanned: 3 },
      { partId: "p-serial-component", qtyPlanned: 1 },
    ]);
    assert.deepEqual([...again.unchanged].sort(), ["p-serial-component", "p-standard"]);
    assert.equal(again.plan.find((r) => r.partId === "p-standard").version, 1,
      "an unchanged quantity must not manufacture an edit nobody made");
  });

  await t.test("planning a SERIAL part is allowed -- you plan to fit a compressor before you know which", async () => {
    await workOrder("wo-p3");
    const r = await setPlan("wo-p3", [{ partId: "p-serial-component", qtyPlanned: 2 }]);
    assert.deepEqual(r.added, ["p-serial-component"]);
  });

  await t.test("a changed quantity bumps the version, and a stale expectedVersion is a CONFLICT", async () => {
    await workOrder("wo-p4");
    await setPlan("wo-p4", [{ partId: "p-standard", qtyPlanned: 1 }]);
    const changed = await setPlan("wo-p4", [{ partId: "p-standard", qtyPlanned: 7, expectedVersion: 1 }]);
    assert.deepEqual(changed.changed, ["p-standard"]);
    assert.equal(changed.plan[0].version, 2);
    await assert.rejects(() => setPlan("wo-p4", [{ partId: "p-standard", qtyPlanned: 9, expectedVersion: 1 }]),
      (e) => { assert.equal(e.code, "VERSION_CONFLICT"); return true; });
  });

  await t.test("a plan line naming an unknown Part refuses the WHOLE plan", async () => {
    await workOrder("wo-p5");
    await assert.rejects(() => setPlan("wo-p5", [
      { partId: "p-standard", qtyPlanned: 1 },
      { partId: "p-ghost", qtyPlanned: 1 },
    ]), (e) => { assert.equal(e.code, "PART_NOT_FOUND"); return true; });
    assert.deepEqual(await partsPlan.readPartsPlan(pool, "t1", "wo-p5"), []);
  });

  await t.test("a part with recorded USAGE cannot be un-planned, and usage is read from the ledger", async () => {
    await workOrder("wo-p6");
    await setPlan("wo-p6", [{ partId: "p-standard", qtyPlanned: 5 }]);
    await commitments.reconcileConsumption(pool, ctx("wo-p6", "idem-p6"),
      [{ partId: "p-standard", qtyPlanned: 5, qtyUsed: 2 }]);
    await assert.rejects(() => setPlan("wo-p6", []), (e) => {
      assert.equal(e.code, "USED_PART_REMOVAL");
      return true;
    });
    // Still there -- the refusal did not half-apply.
    assert.equal((await partsPlan.readPartsPlan(pool, "t1", "wo-p6")).length, 1);
  });

  await t.test("a part with NO usage is removed cleanly by omission", async () => {
    await workOrder("wo-p7");
    await setPlan("wo-p7", [{ partId: "p-standard", qtyPlanned: 2 }, { partId: "p-lot", qtyPlanned: 1 }]);
    const r = await setPlan("wo-p7", [{ partId: "p-standard", qtyPlanned: 2 }]);
    assert.deepEqual(r.removed, ["p-lot"]);
    assert.deepEqual(r.plan.map((x) => x.partId), ["p-standard"]);
  });

  await t.test("a terminal Work Order's plan is closed", async () => {
    await workOrder("wo-p8", "COMPLETED");
    await assert.rejects(() => setPlan("wo-p8", [{ partId: "p-standard", qtyPlanned: 1 }]),
      (e) => { assert.equal(e.code, "TERMINAL_WORK_ORDER"); return true; });
  });

  await t.test("the plan stores no Part description -- the catalog is the authority for that", async () => {
    const { rows } = await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='eos_ops' AND table_name='work_order_parts_plan'`);
    const cols = rows.map((r) => r.column_name);
    for (const forbidden of ["name", "sku", "internal_part_number", "description", "qty_used"]) {
      assert.equal(cols.includes(forbidden), false, `work_order_parts_plan must not carry ${forbidden}`);
    }
  });

  // ════════════════════ SERVICE FROM SALES ORDER ════════════════════

  await t.test("the Sales Order handoff is read from PostgreSQL Commercial, in the same runtime", async () => {
    await q(`INSERT INTO eos_commercial.sales_orders
      (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, created_by, updated_by, state, location_id)
      VALUES ('so-1','t1','SO-2026-000001','acct-1','e-1','sample-co','seed','seed','CONFIRMED','crmloc-1')`);
    await q(`INSERT INTO eos_commercial.sales_order_lines
      (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty)
      VALUES ('t1','so-1',1,'SERVICE','svc-visit','SERVICE',1)`);
    const handoff = await boundary.readSalesOrderHandoff(pool, "t1", "so-1");
    assert.equal(handoff.accountId, "acct-1");
    assert.equal(handoff.locationId, "crmloc-1");
    assert.equal(handoff.lines.length, 1);
  });

  await t.test("a SERVICE-only Sales Order raises service today, with full lineage", async () => {
    const handoff = await boundary.readSalesOrderHandoff(pool, "t1", "so-1");
    const seed = boundary.buildServiceWorkOrderSeed(handoff, []);
    assert.equal(seed.customerId, "acct-1");
    assert.equal(seed.locationId, "crmloc-1");
    assert.match(seed.complaint, /SO-2026-000001/, "the complaint names the order the way a person says it");
    assert.deepEqual(seed.lineRefs, [{ salesOrderId: "so-1", salesOrderLineId: "1" }]);
    assert.deepEqual(seed.plannedParts, []);
  });

  await t.test("a Sales Order with PART lines is REFUSED -- never seeded from ordered quantity", async () => {
    await q(`INSERT INTO eos_commercial.sales_orders
      (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, created_by, updated_by, state, location_id)
      VALUES ('so-2','t1','SO-2026-000002','acct-1','e-1','sample-co','seed','seed','CONFIRMED','crmloc-1')`);
    await q(`INSERT INTO eos_commercial.sales_order_lines
      (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty)
      VALUES ('t1','so-2',1,'PART','p-standard','PARTS',4)`);
    const handoff = await boundary.readSalesOrderHandoff(pool, "t1", "so-2");
    const policies = await policyAuthority.createPostgresPartPolicyAuthority()
      .readPartPolicies(pool, "t1", ["p-standard"]);
    assert.throws(() => boundary.buildServiceWorkOrderSeed(handoff, policies), (e) => {
      assert.equal(e.code, "ALLOCATION_AUTHORITY_UNAVAILABLE");
      assert.equal(e.category, "UNAVAILABLE");
      // The message must say WHY, because this is the blocker a person has to act on.
      assert.match(e.message, /ordered quantity|unbacked/);
      return true;
    });
  });

  await t.test("PostgreSQL Commercial genuinely carries no allocated quantity", async () => {
    // The premise of the refusal above, derived from the database rather than asserted in a comment.
    const { rows } = await q(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='eos_commercial' AND table_name IN ('sales_orders','sales_order_lines')`);
    const cols = rows.map((r) => r.column_name);
    assert.equal(cols.some((c) => /alloc/.test(c)), false,
      "if allocation has landed, this refusal must be replaced by a real seed rather than left standing");
  });

  await t.test("an unsited Sales Order cannot become a visit", async () => {
    await q(`INSERT INTO eos_commercial.sales_orders
      (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, created_by, updated_by, state)
      VALUES ('so-3','t1','SO-2026-000003','acct-1','e-1','sample-co','seed','seed','CONFIRMED')`);
    const handoff = await boundary.readSalesOrderHandoff(pool, "t1", "so-3");
    assert.throws(() => boundary.buildServiceWorkOrderSeed(handoff, []), (e) => {
      assert.equal(e.code, "SALES_ORDER_HAS_NO_LOCATION");
      return true;
    });
  });

  await t.test("a cancelled Sales Order raises no service", async () => {
    await q(`INSERT INTO eos_commercial.sales_orders
      (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, created_by, updated_by, state, location_id)
      VALUES ('so-4','t1','SO-2026-000004','acct-1','e-1','sample-co','seed','seed','CANCELLED','crmloc-1')`);
    const handoff = await boundary.readSalesOrderHandoff(pool, "t1", "so-4");
    assert.throws(() => boundary.buildServiceWorkOrderSeed(handoff, []), (e) => {
      assert.equal(e.code, "SALES_ORDER_NOT_SERVICEABLE");
      return true;
    });
  });
});
