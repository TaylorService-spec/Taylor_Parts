// SALES ORDER ALLOCATION, ON POSTGRESQL (S1c; DECISIONS #S1c; Owner rulings 2026-10-20, S1a OD-2 / OD-9 / OD-11 / OD-12).
//
// An allocation is a hard reservation (S1b) of ONE Sales Order line's quantity at a warehouse the caller states, in the order's company. This suite
// proves the S1b wiring conditions (DECISIONS #S1b, F3): capability, then company authority, then WAREHOUSE scope; the Part and quantity bound to the
// LINE; a non-terminal order; an ACTIVE Part; and that a caller cannot "reserve arbitrary stock" (a different Part, more than ordered, a terminal order, a
// foreign company, a warehouse outside their scope). Also: no oversell under concurrency (across Sales Orders AND within one), replay and duplicate,
// release, a Sales Order cancel releasing its claims in its OWN transaction, one audit row per applied command, and readPartBalance reflecting it all.
//
// The capability is passed on the actor, exactly as the other command suites do (the grant is migration 1764714000000, written by the controller);
// company authority and the warehouse scope are the REAL ones, read from the database. Every proof runs against a real postgres
// (POLICY_TEST_DATABASE_URL); without it the suite SKIPS. It creates its own throwaway database.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import { ALL_COMPANIES } from "./support/commercialCompanyReachFixture.mjs"; // Q-1a: this suite is not about company authority
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
const ops = require("../lib/eosOps/salesOrderAllocation.js");
const ledger = require("../lib/eosOps/inventoryCommitmentRepository.js");
const reads = require("../lib/eosOps/partsReads.js");
const commercial = require("../lib/eosCommercial/commands/salesOrderCommandService.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const FULFILL = "salesOrder.fulfill";
const CO_A = "co-a";
const CO_B = "co-b";
const ID_A = "co-a-id";
const ID_B = "co-b-id";

test("Sales Order allocation on PostgreSQL: bound to the line, scoped by company and warehouse, never oversold, released with the order", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `s1c_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 16 });
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  // ---------------- people ----------------
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  const principal = (subject) => repo.transact({ tenantId: "t1", uid: "fixture" }, async (tx) => {
    const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
    await tx.createTenantMembership(p.id);
    return p.id;
  });
  const alice = await principal("uid-alice");   // Taylor (co-a); WAREHOUSE scope wh-a1 only
  const bob = await principal("uid-bob");       // Taylor (co-a); wh-a1, wh-a2 and the closed wh-a-closed
  const carol = await principal("uid-carol");   // Taylor (co-a); NO warehouse scope
  const dual = await principal("uid-dual");     // Taylor home + an explicit company-access grant for co-b; wh-a1 and wh-b1
  const vera = await principal("uid-vera");     // Ventana (co-b); wh-b1
  const nobody = await principal("uid-nobody"); // no Employee link: no company authority

  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1',$1,'ACTIVE','fixture','f','f'), ('t1',$2,'ACTIVE','fixture','f','f')`, [ID_A, ID_B]);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1',$1,$2,'ACTIVE','NATIVE','fixture','f','f'), ('t1',$3,$4,'ACTIVE','NATIVE','fixture','f','f')`, [ID_A, CO_A, ID_B, CO_B]);
  const warehouse = (id, key, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1,'t1',$2,$1,'Site',$3,'NATIVE','fixture','fixture')`, [id, key, status]);
  await warehouse("wh-a1", CO_A); await warehouse("wh-a2", CO_A); await warehouse("wh-a-closed", CO_A, "INACTIVE"); await warehouse("wh-b1", CO_B);
  await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at)
           VALUES ('e-alice','t1','ACTIVE',$1,'2020-01-01T00:00:00Z'), ('e-bob','t1','ACTIVE',$1,'2020-01-01T00:00:00Z'), ('e-carol','t1','ACTIVE',$1,'2020-01-01T00:00:00Z'),
                  ('e-dual','t1','ACTIVE',$1,'2020-01-01T00:00:00Z'), ('e-vera','t1','ACTIVE',$2,'2020-01-01T00:00:00Z')`, [ID_A, ID_B]);
  await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
           VALUES ('l-alice','t1',$1,'e-alice',$6,'OPERATOR_ASSERTED','f','test','active'), ('l-bob','t1',$2,'e-bob',$6,'OPERATOR_ASSERTED','f','test','active'),
                  ('l-carol','t1',$3,'e-carol',$6,'OPERATOR_ASSERTED','f','test','active'), ('l-dual','t1',$4,'e-dual',$6,'OPERATOR_ASSERTED','f','test','active'),
                  ('l-vera','t1',$5,'e-vera',$7,'OPERATOR_ASSERTED','f','test','active')`, [alice, bob, carol, dual, vera, ID_A, ID_B]);
  await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
           VALUES ('os-1','t1','e-alice','WAREHOUSE','wh-a1', now(),'fixture'),
                  ('os-2','t1','e-bob','WAREHOUSE','wh-a1', now(),'fixture'), ('os-3','t1','e-bob','WAREHOUSE','wh-a2', now(),'fixture'), ('os-4','t1','e-bob','WAREHOUSE','wh-a-closed', now(),'fixture'),
                  ('os-5','t1','e-dual','WAREHOUSE','wh-a1', now(),'fixture'), ('os-6','t1','e-dual','WAREHOUSE','wh-b1', now(),'fixture'),
                  ('os-7','t1','e-vera','WAREHOUSE','wh-b1', now(),'fixture')`);
  {
    // The explicit company-access grant is written only inside an Administration command; the fixture states that, as the grant suite does.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT set_config('eos_policy.administration_command', 'on', true)`);
      await c.query(`INSERT INTO eos_policy.employee_company_authority_grants (id, tenant_id, employee_id, operating_company_id, reason, granted_by)
                     VALUES ('g-dual','t1','e-dual',$1,'fixture: reaches both companies','fixture')`, [ID_B]);
      await c.query("COMMIT");
    } finally { c.release(); }
  }

  // ---------------- parts and stock ----------------
  const part = (id, control = "STANDARD", whole = false, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
       expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,$4,'EACH',$2,'STOCKED',false,false,false,$3,1,'fixture')`, [id, control, whole, status]);
  for (const id of ["P-A", "P-OTHER", "P-REL", "P-RACE", "P-SHORT", "P-CXL", "P-CXL2", "P-NOSTOCK", "P-B", "P-FUL", "P-CLO", "P-READ", "P-NULL", "P-D1", "P-D2"]) await part(id);
  await part("P-SER", "SERIALIZED"); await part("P-UNIT", "SERIALIZED", true); await part("P-INACT", "STANDARD", false, "INACTIVE");
  let seq = 0;
  const move = (partId, warehouseId, delta, companyKey = CO_A) => q(
    `INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
       movement_type, quantity_delta, source_kind, source_id, created_by)
     VALUES ($1,'t1',$2,$3,'NONE','WAREHOUSE',$4,'RECEIVED',$5,'FIXTURE','fixture','fixture')`, [`mov-${++seq}`, companyKey, partId, warehouseId, delta]);
  for (const id of ["P-A", "P-REL", "P-READ"]) { await move(id, "wh-a1", 20); await move(id, "wh-a2", 20); }
  await move("P-OTHER", "wh-a1", 5); await move("P-INACT", "wh-a1", 5); await move("P-RACE", "wh-a1", 10); await move("P-SHORT", "wh-a1", 3);
  await move("P-CXL", "wh-a1", 10); await move("P-CXL2", "wh-a1", 10); await move("P-FUL", "wh-a1", 10); await move("P-CLO", "wh-a1", 10); await move("P-NULL", "wh-a1", 10);
  await move("P-D1", "wh-a1", 50); await move("P-D2", "wh-a1", 50);
  await move("P-A", "wh-a-closed", 5);
  await move("P-B", "wh-b1", 5, CO_B);

  // ---------------- orders ----------------
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-1','t1','Cust','ACTIVE','f','f')`);
  let n = 0;
  const order = async (id, lines, { company = CO_A, state = "CONFIRMED" } = {}) => {
    await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, sales_channel, currency, state, booked_at, created_by, updated_by)
             VALUES ($1,'t1',$2,'acct-1','e-alice',$3,'RETAIL','USD',$4,now(),'f','f')`, [id, `SO-T-${String(++n).padStart(4, "0")}`, company, state]);
    let line = 0;
    for (const [kind, ref, qty] of lines) {
      await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty) VALUES ('t1',$1,$2,$3,$4,'PARTS',$5)`, [id, ++line, kind, ref, qty]);
    }
  };
  await order("so-main", [["PART", "P-A", 6], ["PART", "P-A", 10]]);
  await order("so-prog", [["PART", "P-A", 2]], { state: "IN_FULFILLMENT" });
  await order("so-neg", [["PART", "P-A", 3], ["PART", "P-OTHER", 2], ["PART", "P-SER", 2], ["SERVICE", "SVC-1", 1], ["PART", "P-INACT", 2], ["PART", "P-NOSTOCK", 2], ["PART", "P-UNIT", 1], ["PART", "P-SHORT", 20]]);
  for (const [id, state] of [["so-cancelled", "CANCELLED"], ["so-closed", "CLOSED"], ["so-fulfilled", "FULFILLED"]]) await order(id, [["PART", "P-A", 2]], { state });
  await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, created_by, updated_by)
           VALUES ('so-nostate','t1','SO-T-9000','acct-1','e-alice',$1,'f','f')`, [CO_A]);
  await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty) VALUES ('t1','so-nostate',1,'PART','P-A','PARTS',2)`);
  await order("so-b", [["PART", "P-B", 3]], { company: CO_B });
  for (const id of ["so-r1", "so-r2", "so-r3", "so-r4"]) await order(id, [["PART", "P-RACE", 8]]);
  await order("so-r5", [["PART", "P-A", 6]]);
  await order("so-rel", [["PART", "P-REL", 9]]);
  await order("so-cxl-atomic", [["PART", "P-CXL", 5]]);
  await order("so-cxl", [["PART", "P-CXL", 5], ["PART", "P-CXL2", 3]]);
  await order("so-fulfilled-claims", [["PART", "P-FUL", 4]]);
  await order("so-closed-claims", [["PART", "P-CLO", 4]]);
  await order("so-read", [["PART", "P-READ", 6], ["SERVICE", "SVC-2", 1]]);
  await order("so-null-claims", [["PART", "P-NULL", 4]]);
  for (let i = 1; i <= 6; i++) { await order(`so-dl${i}a`, [["PART", "P-D1", 3], ["PART", "P-D2", 3]]); await order(`so-dl${i}b`, [["PART", "P-D2", 3], ["PART", "P-D1", 3]]); }

  // Hard reservations are activated for Taylor's company only; Ventana's is not.
  await q(`INSERT INTO eos_ops.stock_reservation_activation (tenant_id, operating_company_key, activated_by, reason) VALUES ('t1',$1,'fixture','test activation')`, [CO_A]);

  // ---------------- helpers ----------------
  const actor = (principalId, caps = [FULFILL]) => ({ tenantId: "t1", principalId, capabilities: new Set(caps) });
  const key = () => `k-${randomUUID().slice(0, 12)}`;
  const req = (over = {}) => ({ salesOrderId: "so-main", lineNumber: 1, operatingCompanyId: ID_A, warehouseId: "wh-a1", partId: "P-A", quantity: 1, idempotencyKey: key(), ...over });
  const allocate = (who, over, caps) => ops.allocateSalesOrderLine({ pool }, actor(who, caps), req(over));
  const releaseReq = (over = {}) => ({ salesOrderId: "so-rel", lineNumber: 1, operatingCompanyId: ID_A, warehouseId: "wh-a1", reason: "customer changed the order", idempotencyKey: key(), ...over });
  const release = (who, over, caps) => ops.releaseSalesOrderAllocation({ pool }, actor(who, caps), releaseReq(over));
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } return assert.fail("expected a refusal"); };
  const refused = async (fn, code, category) => {
    const err = await refusal(fn);
    assert.equal(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (category) assert.equal(err.category, category, `${code} category`);
    return err;
  };
  const counts = async () => ({
    rows: (await q(`SELECT count(*)::int AS n FROM eos_ops.inventory_commitments`)).rows[0].n,
    audit: (await q(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE action LIKE 'stock.%'`)).rows[0].n,
  });
  const claimRows = (soId, line) => q(`SELECT * FROM eos_ops.inventory_commitments WHERE sales_order_id = $1 AND sales_order_line_number = $2 ORDER BY created_at, id`, [soId, line]).then((r) => r.rows);
  const held = async (soId, line, warehouseId = null) => Number((await q(
    `SELECT COALESCE(SUM(CASE event_type WHEN 'RESERVED' THEN quantity ELSE -quantity END), 0) AS n FROM eos_ops.inventory_commitments
      WHERE sales_order_id = $1 AND sales_order_line_number = $2 AND ($3::text IS NULL OR warehouse_id = $3)`, [soId, line, warehouseId])).rows[0].n);
  const auditOf = (action) => q(`SELECT * FROM eos_policy.audit_events WHERE action = $1 ORDER BY occurred_at, id`, [action]).then((r) => r.rows);
  const committed = (partId, warehouseId = "wh-a1", company = CO_A) => ledger.committedQuantity(pool, "t1", company, warehouseId, partId);
  const balance = (who, partId) => reads.readPartBalance({ pool }, actor(who, ["inventory.transaction.read"]), { partId });

  // ════════════════════ allocate ════════════════════

  await t.test("allocate: ONE hard reservation at the stated company and warehouse, bound to the line; one audit row; readPartBalance reflects it", async () => {
    const before = await counts();
    const r = await allocate(alice, { quantity: 4 });
    assert.equal(r.outcome, "allocated");
    assert.deepEqual([r.salesOrderId, r.lineNumber, r.partId, r.warehouseId, r.quantity, r.allocatedAtWarehouse, r.allocatedTotal], ["so-main", 1, "P-A", "wh-a1", 4, 4, 4]);
    const rows = await claimRows("so-main", 1);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      [rows[0].event_type, rows[0].operating_company_key, rows[0].warehouse_id, rows[0].work_order_id, rows[0].sales_order_id, Number(rows[0].sales_order_line_number), rows[0].part_id, Number(rows[0].quantity), rows[0].created_by],
      ["RESERVED", CO_A, "wh-a1", null, "so-main", 1, "P-A", 4, alice]);
    const after = await counts();
    assert.equal(after.rows, before.rows + 1);
    assert.equal(after.audit, before.audit + 1, "exactly one audit row per applied command");
    const audit = (await auditOf("stock.reserve")).at(-1);
    assert.deepEqual([audit.target_kind, audit.target_id, audit.actor_uid], ["salesOrderLine", "so-main:1", alice]);
    // The balance read is the same arithmetic as the gate: bob (scope wh-a1 and wh-a2) sees 4 reserved of P-A, all at wh-a1.
    const b = await balance(bob, "P-A");
    assert.deepEqual([b.reserved.state, b.reserved.value], ["KNOWN", 4]);
    assert.deepEqual(b.byLocation.find((l) => l.warehouseId === "wh-a1").reserved, { state: "KNOWN", value: 4 });
    assert.equal(b.byLocation.find((l) => l.warehouseId === "wh-a2").reserved.value, 0);
  });

  await t.test("an IN_FULFILLMENT order still takes allocations (non-terminal)", async () => {
    const r = await allocate(alice, { salesOrderId: "so-prog", quantity: 2 });
    assert.equal(r.outcome, "allocated");
    assert.equal(await held("so-prog", 1), 2);
  });

  await t.test("replay: the same key and request writes and audits nothing, even after the line has since filled; the same key with another request is IDEMPOTENCY_CONFLICT", async () => {
    const k = key();
    const first = await allocate(bob, { warehouseId: "wh-a2", quantity: 2, idempotencyKey: k });
    assert.equal(first.outcome, "allocated");
    assert.equal(await held("so-main", 1), 6, "the line is now full (4 + 2 of 6)");
    const before = await counts();
    const again = await allocate(bob, { warehouseId: "wh-a2", quantity: 2, idempotencyKey: k });
    assert.equal(again.outcome, "replayed", "a retry after the allocation filled the line is a replay, not 'quantity exceeds the order'");
    assert.deepEqual(await counts(), before);
    await refused(() => allocate(bob, { warehouseId: "wh-a2", quantity: 1, idempotencyKey: k }), "IDEMPOTENCY_CONFLICT", "CONFLICT");
    assert.deepEqual(await counts(), before);
  });

  await t.test("duplicate and bound: a second claim on a line at the same warehouse is DUPLICATE_CLAIM; the quantity is bound to ordered less what ALL warehouses hold", async () => {
    await allocate(alice, { lineNumber: 2, quantity: 3 });
    const before = await counts();
    await refused(() => allocate(alice, { lineNumber: 2, quantity: 2 }), "DUPLICATE_CLAIM", "CONFLICT");
    // 3 held of 10: eight more would exceed it (at most 7), counting what a DIFFERENT warehouse's claim will hold too.
    const err = await refused(() => allocate(bob, { lineNumber: 2, warehouseId: "wh-a2", quantity: 8 }), "QUANTITY_EXCEEDS_ORDER", "PRECONDITION_FAILED");
    assert.match(err.message, /at most 7 more/);
    assert.deepEqual(await counts(), before);
    const ok = await allocate(bob, { lineNumber: 2, warehouseId: "wh-a2", quantity: 7 });
    assert.equal(ok.allocatedTotal, 10);
    assert.equal(ok.allocatedAtWarehouse, 7);
    await refused(() => allocate(bob, { lineNumber: 2, warehouseId: "wh-a-closed", quantity: 1 }), "QUANTITY_EXCEEDS_ORDER");
  });

  // ════════════════════ negative: a caller cannot "reserve arbitrary stock" ════════════════════

  await t.test("negative: every refusal leaves ZERO trace -- a different Part, a nonexistent or non-PART line, more than ordered, a terminal order, a stateless order", async () => {
    const before = await counts();
    await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 1, partId: "P-OTHER" }), "PART_NOT_ON_LINE", "PRECONDITION_FAILED");
    await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 99 }), "LINE_NOT_FOUND", "NOT_FOUND");
    await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 4, partId: "SVC-1" }), "LINE_NOT_A_PART", "PRECONDITION_FAILED");
    await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 1, quantity: 4 }), "QUANTITY_EXCEEDS_ORDER", "PRECONDITION_FAILED");
    // A line of ANOTHER order cannot be reached by naming this order's id with that order's Part.
    await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 1, partId: "P-B" }), "PART_NOT_ON_LINE");
    for (const salesOrderId of ["so-cancelled", "so-closed", "so-fulfilled", "so-nostate"]) {
      const err = await refused(() => allocate(alice, { salesOrderId, quantity: 1 }), "ORDER_NOT_ALLOCATABLE", "PRECONDITION_FAILED");
      assert.ok(err.message.length > 0, salesOrderId);
    }
    await refused(() => allocate(alice, { salesOrderId: "so-missing" }), "SALES_ORDER_NOT_FOUND", "NOT_FOUND");
    assert.deepEqual(await counts(), before, "nothing written, nothing audited");
  });

  await t.test("negative: capability first, then company, then warehouse scope", async () => {
    const before = await counts();
    // capability
    for (const caps of [[], ["salesOrder.read"], ["salesOrder.write"], ["inventory.stock.receive"]]) {
      await refused(() => allocate(alice, {}, caps), "CAPABILITY_REQUIRED", "FORBIDDEN");
    }
    // company authority: no Employee link = none
    await refused(() => allocate(nobody), "COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN");
    // a foreign company's order reads exactly as a missing one; a foreign company STATED is refused as out of authority
    const foreignOrder = await refused(() => allocate(alice, { salesOrderId: "so-b", partId: "P-B" }), "SALES_ORDER_NOT_FOUND", "NOT_FOUND");
    const missing = await refused(() => allocate(alice, { salesOrderId: "so-missing", partId: "P-B" }), "SALES_ORDER_NOT_FOUND", "NOT_FOUND");
    assert.equal(foreignOrder.message, missing.message, "no oracle for another company's orders");
    await refused(() => allocate(alice, { operatingCompanyId: ID_B }), "COMPANY_OUT_OF_AUTHORITY", "FORBIDDEN");
    await refused(() => allocate(alice, { operatingCompanyId: "no-such-company" }), "COMPANY_OUT_OF_AUTHORITY", "FORBIDDEN");
    // a caller who reaches BOTH companies still states which: the order's company must be the stated one, and the warehouse must belong to it
    await refused(() => allocate(dual, { operatingCompanyId: ID_B }), "COMPANY_MISMATCH", "PRECONDITION_FAILED");
    await refused(() => allocate(dual, { warehouseId: "wh-b1" }), "COMPANY_WAREHOUSE_MISMATCH", "PRECONDITION_FAILED");
    // warehouse scope: a warehouse of the caller's company outside their scope, an Employee with no scope at all, and another company's warehouse
    await refused(() => allocate(alice, { warehouseId: "wh-a2" }), "OUTSIDE_OPERATIONAL_SCOPE", "FORBIDDEN");
    await refused(() => allocate(carol), "OUTSIDE_OPERATIONAL_SCOPE", "FORBIDDEN");
    await refused(() => allocate(alice, { warehouseId: "wh-b1" }), "WAREHOUSE_NOT_FOUND", "NOT_FOUND");
    await refused(() => allocate(alice, { warehouseId: "wh-nowhere" }), "WAREHOUSE_NOT_FOUND", "NOT_FOUND");
    assert.deepEqual(await counts(), before);
  });

  await t.test("negative: the Part must be ACTIVE and quantity-tracked (serialized and whole-unit Parts stay refused), and the stock must be known and sufficient", async () => {
    const before = await counts();
    await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 5, partId: "P-INACT", quantity: 1 }), "PART_NOT_ACTIVE", "PRECONDITION_FAILED");
    await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 3, partId: "P-SER", quantity: 1 }), "TRACKING_MODE_NOT_SUPPORTED", "PRECONDITION_FAILED");
    await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 7, partId: "P-UNIT", quantity: 1 }), "TRACKING_MODE_NOT_SUPPORTED", "PRECONDITION_FAILED");
    await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 6, partId: "P-NOSTOCK", quantity: 1 }), "UNKNOWN_STOCK", "PRECONDITION_FAILED");
    const short = await refused(() => allocate(alice, { salesOrderId: "so-neg", lineNumber: 8, partId: "P-SHORT", quantity: 5 }), "INSUFFICIENT_STOCK", "PRECONDITION_FAILED");
    assert.match(short.message, /need 5 .* available 3/);
    // A closed warehouse takes no new reservation, even for a caller whose scope still names it.
    await refused(() => allocate(bob, { salesOrderId: "so-main", lineNumber: 1, warehouseId: "wh-a-closed", partId: "P-A", quantity: 1 }), "QUANTITY_EXCEEDS_ORDER");
    await refused(() => allocate(bob, { salesOrderId: "so-r5", warehouseId: "wh-a-closed", partId: "P-A", quantity: 1 }), "WAREHOUSE_NOT_ACTIVE", "PRECONDITION_FAILED");
    assert.deepEqual(await counts(), before);
  });

  await t.test("negative: a company whose hard reservations are not activated takes none (Ventana here), and refuses with the repository's own words", async () => {
    const before = await counts();
    const err = await refused(() => allocate(vera, { salesOrderId: "so-b", operatingCompanyId: ID_B, warehouseId: "wh-b1", partId: "P-B", quantity: 1 }),
      "RESERVATION_NOT_ACTIVATED", "PRECONDITION_FAILED");
    assert.match(err.message, /not yet activated/);
    assert.deepEqual(await counts(), before);
  });

  // ════════════════════ no oversell ════════════════════

  await t.test("concurrency: four Sales Orders race for the same stock -- exactly one wins, committed never exceeds on-hand", async () => {
    const results = await Promise.allSettled(["so-r1", "so-r2", "so-r3", "so-r4"].map((salesOrderId) =>
      allocate(alice, { salesOrderId, partId: "P-RACE", quantity: 6 })));
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1, "6 + 6 > 10: exactly one allocation of 6 fits");
    assert.equal(lost.length, 3);
    for (const l of lost) assert.equal(l.reason.code, "INSUFFICIENT_STOCK");
    assert.equal(await committed("P-RACE"), 6);
    assert.ok(await committed("P-RACE") <= 10);
  });

  await t.test("concurrency: two warehouses racing for ONE line cannot together exceed what the line ordered", async () => {
    const results = await Promise.allSettled([
      allocate(bob, { salesOrderId: "so-r5", warehouseId: "wh-a1", quantity: 4 }),
      allocate(bob, { salesOrderId: "so-r5", warehouseId: "wh-a2", quantity: 4 }),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const lost = results.find((r) => r.status === "rejected");
    assert.equal(lost.reason.code, "QUANTITY_EXCEEDS_ORDER");
    assert.equal(await held("so-r5", 1), 4);
  });

  // ════════════════════ release ════════════════════

  await t.test("release: a reason is required; a part, then the rest; replay; never more than held; nothing held is refused; audited; the balance falls", async () => {
    await allocate(alice, { salesOrderId: "so-rel", partId: "P-REL", quantity: 5 });
    assert.equal((await balance(bob, "P-REL")).reserved.value, 5);
    const before = await counts();
    await refused(() => release(alice, { reason: "" }), "REASON_REQUIRED", "INVALID_INPUT");
    await refused(() => release(alice, { quantity: 10 }), "RELEASE_EXCEEDS_OUTSTANDING", "PRECONDITION_FAILED");
    assert.deepEqual(await counts(), before);

    const k = key();
    const part = await release(alice, { quantity: 2, idempotencyKey: k });
    assert.deepEqual([part.outcome, part.releasedQuantity, part.allocatedAtWarehouse, part.allocatedTotal], ["released", 2, 3, 3]);
    assert.equal((await counts()).audit, before.audit + 1);
    const audit = (await auditOf("stock.release")).at(-1);
    assert.deepEqual([audit.target_kind, audit.target_id, audit.reason], ["salesOrderLine", "so-rel:1", "customer changed the order"]);
    assert.equal((await balance(bob, "P-REL")).reserved.value, 3);

    const mid = await counts();
    assert.equal((await release(alice, { quantity: 2, idempotencyKey: k })).outcome, "replayed");
    assert.deepEqual(await counts(), mid, "a replay writes and audits nothing");

    const rest = await release(alice, {});
    assert.deepEqual([rest.outcome, rest.releasedQuantity, rest.allocatedTotal], ["released", 3, 0]);
    assert.equal((await balance(bob, "P-REL")).reserved.value, 0);
    await refused(() => release(alice, {}), "NO_ACTIVE_CLAIM", "PRECONDITION_FAILED");
    // The ledger is append-only: the claim and its two releases are three rows, never an edit.
    assert.deepEqual((await claimRows("so-rel", 1)).map((r) => [r.event_type, Number(r.quantity)]), [["RESERVED", 5], ["RELEASED", 2], ["RELEASED", 3]]);
  });

  await t.test("release is scoped like allocate: capability, then company, then the warehouse (a claim at a warehouse outside your scope cannot be released by you)", async () => {
    await allocate(bob, { salesOrderId: "so-rel", partId: "P-REL", warehouseId: "wh-a2", quantity: 2 });
    const before = await counts();
    await refused(() => release(alice, { warehouseId: "wh-a2" }), "OUTSIDE_OPERATIONAL_SCOPE", "FORBIDDEN");
    await refused(() => release(bob, { warehouseId: "wh-a2" }, []), "CAPABILITY_REQUIRED", "FORBIDDEN");
    await refused(() => release(nobody, { warehouseId: "wh-a2" }), "COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN");
    await refused(() => release(alice, { warehouseId: "wh-b1" }), "WAREHOUSE_NOT_FOUND", "NOT_FOUND");
    await refused(() => release(alice, { salesOrderId: "so-b" }), "SALES_ORDER_NOT_FOUND", "NOT_FOUND");
    assert.deepEqual(await counts(), before);
    assert.equal((await release(bob, { warehouseId: "wh-a2" })).releasedQuantity, 2);
  });

  // ════════════════════ release with the order ════════════════════

  await t.test("cancel: the order's claims are released IN the order's own transaction -- a failing release rolls the cancel back; the next cancel releases per line with one audit row each", async () => {
    await allocate(alice, { salesOrderId: "so-cxl-atomic", partId: "P-CXL", quantity: 3 });
    const csActor = { tenantId: "t1", principalId: alice, capabilities: new Set(["salesOrder.write"]) };
    // A release that cannot be written fails the whole transition: the order is still CONFIRMED and still holds its stock.
    await q(`CREATE OR REPLACE FUNCTION pg_temp_s1c_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced release failure'; END $$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER s1c_force_fail BEFORE INSERT ON eos_ops.inventory_commitments FOR EACH ROW WHEN (NEW.event_type = 'RELEASED') EXECUTE FUNCTION pg_temp_s1c_fail()`);
    try {
      await assert.rejects(() => commercial.transitionSalesOrder({ pool, companyReach: ALL_COMPANIES }, csActor, { salesOrderId: "so-cxl-atomic", transition: "CANCEL", idempotencyKey: key() }));
    } finally {
      await q(`DROP TRIGGER s1c_force_fail ON eos_ops.inventory_commitments`);
    }
    assert.equal((await q(`SELECT state::text AS s FROM eos_commercial.sales_orders WHERE id = 'so-cxl-atomic'`)).rows[0].s, "CONFIRMED", "the cancel did not commit without its release");
    assert.equal(await held("so-cxl-atomic", 1), 3);

    await allocate(alice, { salesOrderId: "so-cxl", lineNumber: 1, partId: "P-CXL", quantity: 3 });
    await allocate(alice, { salesOrderId: "so-cxl", lineNumber: 2, partId: "P-CXL2", quantity: 2 });
    const pooled = { cxl: await committed("P-CXL"), cxl2: await committed("P-CXL2") };
    assert.deepEqual(pooled, { cxl: 6, cxl2: 2 }, "both orders hold P-CXL (3 + 3)");
    const before = await counts();
    const cancelled = await commercial.transitionSalesOrder({ pool, companyReach: ALL_COMPANIES }, csActor, { salesOrderId: "so-cxl", transition: "CANCEL", idempotencyKey: key() });
    assert.equal(cancelled.state, "CANCELLED");
    assert.equal(await held("so-cxl", 1), 0);
    assert.equal(await held("so-cxl", 2), 0);
    assert.equal(await committed("P-CXL"), 3, "only the atomic order's claim remains");
    assert.equal(await committed("P-CXL2"), 0);
    const after = await counts();
    assert.equal(after.rows, before.rows + 2, "one RELEASED row per line");
    assert.equal(after.audit, before.audit + 2, "one stock.cancel audit row per line that held something");
    assert.deepEqual((await auditOf("stock.cancel")).map((a) => a.target_id).sort(), ["so-cxl:1", "so-cxl:2"]);
    // The released order takes nothing further.
    await refused(() => allocate(alice, { salesOrderId: "so-cxl", partId: "P-CXL", quantity: 1 }), "ORDER_NOT_ALLOCATABLE");
    // The order whose first cancel rolled back now cancels cleanly, releasing its one claim.
    const idle = await counts();
    await commercial.transitionSalesOrder({ pool, companyReach: ALL_COMPANIES }, csActor, { salesOrderId: "so-cxl-atomic", transition: "CANCEL", idempotencyKey: key() });
    assert.equal((await counts()).rows, idle.rows + 1, "the atomic order held 3 of one line: one RELEASED row");
  });

  await t.test("cancel race: two orders whose lines hold the same Parts in OPPOSITE order are cancelled concurrently -- both succeed, none deadlocks (40P01)", async () => {
    const csActor = { tenantId: "t1", principalId: alice, capabilities: new Set(["salesOrder.write"]) };
    const partOf = ["P-D1", "P-D2"];
    for (let i = 1; i <= 6; i++) {
      for (const [suffix, parts] of [["a", partOf], ["b", [...partOf].reverse()]]) {
        const salesOrderId = `so-dl${i}${suffix}`;
        for (let line = 1; line <= 2; line++) await allocate(alice, { salesOrderId, lineNumber: line, partId: parts[line - 1], quantity: 3 });
      }
    }
    for (let i = 1; i <= 6; i++) {
      const results = await Promise.allSettled(["a", "b"].map((s) =>
        commercial.transitionSalesOrder({ pool, companyReach: ALL_COMPANIES }, csActor, { salesOrderId: `so-dl${i}${s}`, transition: "CANCEL", idempotencyKey: key() })));
      for (const r of results) assert.equal(r.status, "fulfilled", `round ${i}: ${r.status === "rejected" ? `${r.reason?.code} ${r.reason?.message}` : ""}`);
      for (const s of ["a", "b"]) {
        assert.equal(await held(`so-dl${i}${s}`, 1) + await held(`so-dl${i}${s}`, 2), 0, `so-dl${i}${s} holds nothing`);
        assert.equal((await q(`SELECT state::text AS s FROM eos_commercial.sales_orders WHERE id = $1`, [`so-dl${i}${s}`])).rows[0].s, "CANCELLED");
      }
    }
    assert.equal(await committed("P-D1"), 0);
    assert.equal(await committed("P-D2"), 0);
  });

  await t.test("a foreign order's row lock is no oracle: a caller outside its company is refused at once, even while the order is locked by another transaction", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM eos_commercial.sales_orders WHERE tenant_id = 't1' AND id = 'so-b' FOR UPDATE`);
      const started = Date.now();
      const err = await refused(() => allocate(alice, { salesOrderId: "so-b", partId: "P-B" }), "SALES_ORDER_NOT_FOUND", "NOT_FOUND");
      assert.ok(err);
      assert.ok(Date.now() - started < 2500, "the refusal did not wait for the foreign order's lock");
      await refused(() => release(alice, { salesOrderId: "so-b" }), "SALES_ORDER_NOT_FOUND", "NOT_FOUND");
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
  });

  await t.test("fulfil / close release the remainder too (a ledger has no implicit release); a live state never releases", async () => {
    const claim = (salesOrderId, partId, lineNumber = 1) => ledger.reserve(pool, {
      tenantId: "t1", operatingCompanyKey: CO_A, warehouseId: "wh-a1", source: { kind: "SALES_ORDER", salesOrderId, lineNumber }, actorId: alice, idempotencyKey: key(),
    }, [{ partId, quantity: 2 }]);
    const inTx = async (fn) => {
      const c = await pool.connect();
      try { await c.query("BEGIN"); const out = await fn(c); await c.query("COMMIT"); return out; } catch (e) { await c.query("ROLLBACK").catch(() => undefined); throw e; } finally { c.release(); }
    };
    await claim("so-fulfilled-claims", "P-FUL");
    await claim("so-closed-claims", "P-CLO");
    assert.equal(await inTx((c) => ops.releaseSalesOrderClaims(c, { tenantId: "t1", salesOrderId: "so-closed-claims", toState: "IN_FULFILLMENT", actorId: alice })), 0);
    assert.equal(await held("so-closed-claims", 1), 2, "IN_FULFILLMENT releases nothing");
    assert.equal(await inTx((c) => ops.releaseSalesOrderClaims(c, { tenantId: "t1", salesOrderId: "so-closed-claims", toState: "CLOSED", actorId: alice })), 1);
    assert.equal(await held("so-closed-claims", 1), 0);
    assert.equal(await inTx((c) => ops.releaseSalesOrderClaims(c, { tenantId: "t1", salesOrderId: "so-fulfilled-claims", toState: "FULFILLED", actorId: alice })), 1);
    assert.equal(await held("so-fulfilled-claims", 1), 0);
    // Releasing twice is idempotent: nothing held, nothing written.
    const before = await counts();
    assert.equal(await inTx((c) => ops.releaseSalesOrderClaims(c, { tenantId: "t1", salesOrderId: "so-fulfilled-claims", toState: "FULFILLED", actorId: alice })), 0);
    assert.deepEqual(await counts(), before);
  });

  // ════════════════════ read ════════════════════

  await t.test("read: per line the allocated total, where it is held within YOUR scope, what is held outside it, the warehouses you may use and what you may do", async () => {
    await allocate(alice, { salesOrderId: "so-read", partId: "P-READ", quantity: 2 });
    await allocate(bob, { salesOrderId: "so-read", partId: "P-READ", warehouseId: "wh-a2", quantity: 1 });
    const read = (who, caps, over = {}) => ops.readSalesOrderAllocations({ pool }, actor(who, caps), { salesOrderId: "so-read", ...over });

    const a = await read(alice, [FULFILL]);
    assert.deepEqual([a.salesOrderId, a.operatingCompanyId, a.state, a.canAllocate, a.canRelease], ["so-read", ID_A, "CONFIRMED", true, true]);
    assert.deepEqual(a.warehouses, [{ warehouseId: "wh-a1", name: "wh-a1", active: true }], "only warehouses in alice's scope");
    const l1 = a.lines.find((l) => l.lineNumber === 1);
    assert.deepEqual([l1.kind, l1.partId, l1.orderedQty, l1.allocatedTotal, l1.heldOutsideYourScope], ["PART", "P-READ", 6, 3, 1]);
    assert.deepEqual(l1.byWarehouse, [{ warehouseId: "wh-a1", allocated: 2 }], "the claim at wh-a2 is counted, and named nowhere");
    const l2 = a.lines.find((l) => l.lineNumber === 2);
    assert.deepEqual([l2.kind, l2.partId, l2.allocatedTotal], ["SERVICE", null, 0]);

    const b = await read(bob, [FULFILL]);
    assert.deepEqual(b.warehouses.map((w) => [w.warehouseId, w.active]).sort((x, y) => (x[0] < y[0] ? -1 : 1)), [["wh-a-closed", false], ["wh-a1", true], ["wh-a2", true]],
      "every warehouse in bob's scope, the closed one marked inactive (it is never offered)");
    assert.deepEqual(b.lines[0].byWarehouse, [{ warehouseId: "wh-a1", allocated: 2 }, { warehouseId: "wh-a2", allocated: 1 }]);
    assert.equal(b.lines[0].heldOutsideYourScope, 0);

    // A reader who holds salesOrder.read only SEES the totals and is offered nothing.
    const viewer = await read(alice, ["salesOrder.read"]);
    assert.deepEqual([viewer.canAllocate, viewer.canRelease, viewer.warehouses.length], [false, false, 0]);
    assert.deepEqual([viewer.lines[0].allocatedTotal, viewer.lines[0].byWarehouse.length, viewer.lines[0].heldOutsideYourScope], [3, 0, 3]);

    // A terminal order is not offered new allocations (it can still be released).
    const done = await ops.readSalesOrderAllocations({ pool }, actor(alice), { salesOrderId: "so-closed" });
    assert.deepEqual([done.state, done.canAllocate, done.canRelease], ["CLOSED", false, true]);

    await refused(() => read(alice, []), "CAPABILITY_REQUIRED", "FORBIDDEN");
    await refused(() => read(nobody, [FULFILL]), "COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN");
    await refused(() => read(alice, [FULFILL], { salesOrderId: "so-b" }), "SALES_ORDER_NOT_FOUND", "NOT_FOUND");
    await refused(() => read(alice, [FULFILL], { salesOrderId: "so-missing" }), "SALES_ORDER_NOT_FOUND", "NOT_FOUND");
  });

  await t.test("a stateless (identity-only) order is never allocatable and never offered allocation", async () => {
    const r = await ops.readSalesOrderAllocations({ pool }, actor(alice), { salesOrderId: "so-nostate" });
    assert.equal(r.canAllocate, false);
    await refused(() => allocate(alice, { salesOrderId: "so-nostate" }), "ORDER_NOT_ALLOCATABLE");
  });

  await t.test("the ledger holds only RESERVED / RELEASED rows for Sales Order lines here (no consume), and none of them touched the movement ledger", async () => {
    const kinds = (await q(`SELECT DISTINCT event_type::text AS e FROM eos_ops.inventory_commitments WHERE sales_order_id IS NOT NULL ORDER BY 1`)).rows.map((r) => r.e);
    assert.deepEqual(kinds, ["RELEASED", "RESERVED"]);
    const stray = await q(`SELECT count(*)::int AS n FROM eos_ops.inventory_movements WHERE source_kind <> 'FIXTURE'`);
    assert.equal(stray.rows[0].n, 0, "allocation moves no stock");
  });
});
