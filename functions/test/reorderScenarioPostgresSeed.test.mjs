// SBX-SCN-001's REORDER PORTION, IN POSTGRESQL, against a real postgres:16.
//
// The point is not that rows appear. It is that the scenario can be built ENTIRELY through the
// governed commands -- so a scenario the governed path would refuse cannot be seeded at all -- and
// that it stops exactly where the Firestore scenario stopped: receiving-ready, with the receipt left
// to the command the sandbox exists to exercise.
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
const seed = require("../lib/sandboxFixtures/reorderScenarioPostgresSeed.js");
const receive = require("../lib/eosOps/receiveReorderStockCommand.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const CAPS = [
  "reorder.request.create.manual", "reorder.request.approve", "reorder.request.reject",
  "reorder.request.assign", "reorder.request.startPurchasing",
  "reorder.request.recordPurchaseOrder", "reorder.request.read.queue",
];

test("the Reorder scenario builds through the GOVERNED PostgreSQL commands, and stops receiving-ready", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `scn_pg_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
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
  const repo = new PostgresPolicyRepository(pool);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  const principal = async (subject) => repo.transact({ tenantId: "t1", uid: "uid-fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const requesterId = await principal("uid-sbx-tech");
  const managerId = await principal("uid-sbx-partsmgr");
  const associateId = await principal("uid-sbx-partsassoc");
  const receiverId = await principal("uid-sbx-receiver");

  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys
             (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','sbx-co','ACTIVE','NATIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
           VALUES ('wh-main','t1','sbx-co','wh-main','Sandbox Main','ACTIVE','NATIVE','fixture','fixture')`);

  // The GOVERNED PART AUTHORITY. The scenario consumes Parts; it never creates them, which is why
  // this fixture has to provide them and why an empty catalog blocks the scenario outright.
  const part = (id, controlType) => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit,
                                control_type, stocking_class, expiry_tracked, consumable, returnable_core,
                                whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,'ACTIVE','EACH',$2,'STOCKED',false,false,false,false,1,'fixture')`,
    [id, controlType]);
  for (const id of seed.REORDER_SCENARIO_SPECS.map((s) => s.partId)) {
    await part(id, id === "PRT-2001" ? "SERIALIZED" : "STANDARD");
  }

  // The purchasing Employee, linked to the associate Principal -- the governed assignee commands
  // compare Employee to Employee, so the seeder must act as the person it assigned the work to.
  const employeeId = `emp-${randomUUID().slice(0, 8)}`;
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id,
                                                employee_number, first_name, last_name, display_name)
           VALUES ($1,'t1','ACTIVE','taylor',$1,'Sandbox','Associate','Sandbox Associate')`, [employeeId]);
  await q(`INSERT INTO eos_policy.employee_principal_links
             (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status,
              asserted_by, assertion_reason)
           VALUES ($1,'t1',$2,$3,'taylor','OPERATOR_ASSERTED','active','fixture','scenario fixture setup')`,
    [`epl_${randomUUID()}`, associateId, employeeId]);

  // WORK ELIGIBILITY, not a Security Role and not a Job Role. The governed assignment command
  // requires the Employee to currently hold WAREHOUSE_OPERATIONS, and that rule is exactly why the
  // scenario is worth building through the commands: a fixture that inserted rows directly would
  // have silently produced an assignment no person could have made.
  await q(`INSERT INTO eos_workforce.employee_work_eligibility
             (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by, reason)
           VALUES ($1,'t1',$2,'WAREHOUSE_OPERATIONS', now(), 'fixture', 'scenario fixture setup')`,
    [`ewe_${randomUUID()}`, employeeId]);

  const actor = (principalId) => ({ tenantId: "t1", principalId, capabilities: new Set(CAPS) });

  await t.test("the whole scenario is produced by governed commands alone", async () => {
    const result = await seed.seedReorderScenarioIntoPostgres(
      { pool },
      {
        requester: actor(requesterId),
        partsManager: actor(managerId),
        partsAssociate: actor(associateId),
        purchasingEmployeeId: employeeId,
      },
      "wh-main",
    );

    assert.equal(result.scenarioId, "SBX-SCN-001");
    assert.equal(result.reorders.length, 5);
    const byRole = Object.fromEntries(result.reorders.map((r) => [r.role, r]));
    assert.equal(byRole.STANDARD_RECEIVING_CANDIDATE.status, "ORDERED");
    assert.equal(byRole.SERIAL_RECEIVING_CANDIDATE.status, "ORDERED");
    assert.equal(byRole.UNREVIEWED_QUEUE_ITEM.status, "PENDING_REVIEW");
    assert.equal(byRole.PURCHASING_IN_PROGRESS_ITEM.status, "PURCHASING_IN_PROGRESS");
    assert.equal(byRole.REJECTED_TERMINAL_ITEM.status, "REJECTED");

    // Governed identity: the ids come from the command that owns identity, never from the legacy
    // fixture names.
    for (const r of result.reorders) {
      assert.match(r.reorderRequestId, /^rr_/);
      assert.equal(/^ro-sbx-/.test(r.reorderRequestId), false, "legacy fixture ids are not carried over");
    }
    assert.equal(result.receivingCandidates.length, 2);
  });

  await t.test("RECEIVING IS NOT PRE-COMPLETED -- the receipt is left to the governed command", async () => {
    const receipts = await q(`SELECT count(*)::int n FROM eos_ops.receiving_orders WHERE tenant_id='t1'`);
    assert.equal(receipts.rows[0].n, 0, "seeding a receipt would fake the step the scenario exists to prove");
    const movements = await q(`SELECT count(*)::int n FROM eos_ops.inventory_movements WHERE tenant_id='t1'`);
    assert.equal(movements.rows[0].n, 0);
    const received = await q(`SELECT count(*)::int n FROM eos_ops.reorder_requests WHERE tenant_id='t1' AND status='RECEIVED'`);
    assert.equal(received.rows[0].n, 0);
  });

  await t.test("both receiving candidates are actually receivable by the governed command", async () => {
    const rows = (await q(
      `SELECT r.id, r.part_id FROM eos_ops.reorder_requests r
        WHERE r.tenant_id='t1' AND r.status='ORDERED' ORDER BY r.part_id`)).rows;
    assert.equal(rows.length, 2);

    for (const row of rows) {
      const serial = row.part_id === "PRT-2001";
      const out = await receive.receiveReorderStock(
        { pool, now: () => new Date("2026-09-20T17:00:00.000Z") },
        { tenantId: "t1", principalId: receiverId, capabilities: new Set(["inventory.stock.receive"]) },
        {
          source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: row.id, purchaseOrderId: row.id },
          receivingLocation: { type: "WAREHOUSE", locationId: "wh-main" },
          lines: [{
            lineId: "L1", partId: row.part_id, receivedQuantity: serial ? 2 : 4,
            ...(serial ? { serialNumbers: ["SCN-SN-1", "SCN-SN-2"] } : {}),
          }],
          idempotencyKey: `idem-scn-${row.id}`,
        },
      );
      assert.equal(out.outcome, "applied", row.part_id);
      assert.equal(out.reorderStatus, "RECEIVED");
      assert.equal(out.movementIds.length, serial ? 2 : 1,
        serial ? "a serialized receipt posts one movement per unit" : "a standard receipt posts one");
      assert.equal(out.serializedCustodyIds.length, serial ? 2 : 0);
      // Neither purchase order carries a price, so neither produces a cost fact -- and certainly
      // not a zero one.
      assert.deepEqual(out.acquisitionCostIds, []);
    }
  });
});

test("the scenario's PostgreSQL form writes PostgreSQL and nothing else", async () => {
  // NO BRIDGE, in either direction. A Render -> Firestore reconciliation would reintroduce the dual
  // authority the cutover removes, with the added property of being invisible from the Firestore
  // side. Derived from the source rather than asserted in a comment.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(resolve(FUNCTIONS_DIR, "src/sandboxFixtures/reorderScenarioPostgresSeed.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  for (const banned of ["firebase-admin", "getFirestore", "applicationDefault"]) {
    assert.equal(src.includes(banned), false, `the PostgreSQL scenario form must not reach Firebase (${banned})`);
  }
  // And it builds the scenario through the governed commands, not through inserts.
  assert.equal(/INSERT\s+INTO/i.test(src), false, "the scenario is created by commands, never by direct inserts");
  for (const command of ["createGovernedReorderRequest", "reviewReorderRequest",
    "assignReorderRequestToEmployee", "startPurchasingOnReorder", "recordReorderPurchaseOrder"]) {
    assert.ok(src.includes(command), `${command} must be the path the scenario is built through`);
  }
});
