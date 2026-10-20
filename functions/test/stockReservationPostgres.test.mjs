// S1b HARD STOCK RESERVATIONS, ON POSTGRESQL (DECISIONS #165; Owner rulings 2026-10-20, S1a OD-2 and section 4 tests).
//
// A hard reservation states an operating company AND a warehouse, never infers one from the other, cannot oversell under
// concurrency, replays idempotently, moves through governed release / consume / cancel transitions (each audited) and
// never claims a serialized unit by quantity. Every proof here runs against a real postgres (POLICY_TEST_DATABASE_URL);
// without it the suite SKIPS. It creates its own throwaway database, so it needs no schema-reset registration.
import { endPoolAndDrain } from "./support/poolTeardown.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import pg from "pg";
import { applyStockReservationMigration } from "./support/stockReservationMigration.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";
const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ledger = require("../lib/eosOps/inventoryCommitmentRepository.js");
const { stockLocationLockKey } = require("../lib/eosOps/stockLocationLock.js");
const { OperatingCompanyAuthorityError } = require("../lib/eosOps/operatingCompanyCustody.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const CO_A = "co-a";
const CO_B = "co-b";
const ACTOR = "uid-system-effect";
const BIN = `bin_${"a".repeat(40)}`;

test("hard stock reservations: company + warehouse, no oversell, replay, governed transitions, serial custody", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `s1b_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], {
    maxBuffer: 256 * 1024 * 1024, cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 12 });
  await applyStockReservationMigration(pool);
  const q = (text, values = []) => pool.query(text, values);

  // ---------------- fixtures ----------------
  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1'), ('t2','t2','T2')`);
  await q(`INSERT INTO eos_crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES ('acct-1','t1','Cust','ACTIVE','f','f')`);
  const warehouse = (id, key, status = "ACTIVE") => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1,'t1',$2,$1,'Site',$3,'NATIVE','fixture','fixture')`, [id, key, status]);
  await warehouse("wh-a1", CO_A);
  await warehouse("wh-a2", CO_A);
  await warehouse("wh-a-closed", CO_A, "INACTIVE");
  await warehouse("wh-b1", CO_B);
  await q(`INSERT INTO eos_ops.bins (id, tenant_id, warehouse_id, area, aisle, bay, position, code, status, idempotency_key, created_by, updated_by)
           VALUES ($1,'t1','wh-a1','MAIN','A',1,1,'MAIN-A-1-1','ACTIVE','bin-fixture','fixture','fixture')`, [BIN]);

  const part = (id, control = "STANDARD", whole = false) => q(
    `INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
       expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
     VALUES ($1,'t1','fixture',$1,$1,'ACTIVE','EACH',$2,'STOCKED',false,false,false,$3,1,'fixture')`, [id, control, whole]);
  await part("P-STD"); await part("P-STD2"); await part("P-NOSTOCK"); await part("P-SER", "SERIALIZED"); await part("P-UNIT", "SERIALIZED", true);

  let seq = 0;
  const move = (partId, locationType, locationId, delta, companyKey = CO_A) => q(
    `INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
       movement_type, quantity_delta, source_kind, source_id, created_by)
     VALUES ($1,'t1',$2,$3,'NONE',$4,$5,'RECEIVED',$6,'FIXTURE','fixture','fixture')`, [`mov-${++seq}`, companyKey, partId, locationType, locationId, delta]);
  await move("P-STD", "WAREHOUSE", "wh-a1", 7);
  await move("P-STD", "BIN", BIN, 3);                  // a bin is its warehouse's stock: wh-a1 holds 10
  await move("P-STD", "WAREHOUSE", "wh-a2", 4);
  await move("P-STD2", "WAREHOUSE", "wh-b1", 5, CO_B);
  await move("P-STD2", "WAREHOUSE", "wh-a1", 6);

  const creator = await new PostgresPolicyRepository(pool).transact({ tenantId: "t1", uid: "fixture" }, async (tx) => {
    const pr = await tx.createPrincipal({ externalSubject: "uid-creator", identityProvider: "firebase" });
    await tx.createTenantMembership(pr.id);
    return pr.id;
  });
  const workOrder = (id, companyKey = CO_A) => q(
    `INSERT INTO eos_ops.work_orders (id, tenant_id, operating_company_key, status, work_order_type, priority, customer_id, location_id,
       provenance, created_by_principal_id, created_at, updated_at)
     VALUES ($1,'t1',$2,'WORK_IN_PROGRESS'::eos_ops.ops_work_order_status,'SERVICE_CALL',2,'acct-1','loc-1','NATIVE',$3,now(),now())`, [id, companyKey, creator]);
  for (let i = 1; i <= 16; i++) await workOrder(`wo-${i}`);
  await workOrder("wo-b1", CO_B);
  await q(`INSERT INTO eos_commercial.sales_orders (id, tenant_id, sales_order_number, account_id, owner_employee_id, operating_company_key, created_by, updated_by)
           VALUES ('so-1','t1','SO-0001','acct-1','emp-1',$1,'f','f')`, [CO_A]);
  await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty)
           VALUES ('t1','so-1',1,'PART','P-STD','PARTS',50), ('t1','so-1',2,'PART','P-STD','PARTS',2)`);
  await q(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id) VALUES ('seed-audit','t1','seed','f','x','x')`);
  // Both companies are bound to the tenant (the activation switch has a foreign key to the binding table).
  for (const [id, key] of [["co-a-id", CO_A], ["co-b-id", CO_B]]) {
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ('t1',$1,'ACTIVE','fixture','f','f')`, [id]);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
             VALUES ('t1',$1,$2,'ACTIVE','NATIVE','fixture','f','f')`, [id, key]);
  }
  const activate = (key, reason = "test activation") => q(`INSERT INTO eos_ops.stock_reservation_activation (tenant_id, operating_company_key, activated_by, reason) VALUES ('t1',$1,'fixture',$2)`, [key, reason]);
  await activate(CO_A);

  const wo = (n) => ({ kind: "WORK_ORDER", workOrderId: `wo-${n}` });
  const ctx = (n, key, warehouseId = "wh-a1", overrides = {}) => ({
    tenantId: "t1", operatingCompanyKey: CO_A, warehouseId, source: wo(n), actorId: ACTOR, idempotencyKey: key, ...overrides,
  });
  const stockActions = (action) => q(`SELECT * FROM eos_policy.audit_events WHERE action = $1 ORDER BY occurred_at, id`, [action]).then((r) => r.rows);
  const countRows = () => q(`SELECT count(*)::int AS n FROM eos_ops.inventory_commitments`).then((r) => r.rows[0].n);
  const countAudit = () => q(`SELECT count(*)::int AS n FROM eos_policy.audit_events WHERE action LIKE 'stock.%'`).then((r) => r.rows[0].n);
  const refused = (code) => (e) => { assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`); return true; };
  const committed = (warehouseId, partId = "P-STD", company = CO_A) => ledger.committedQuantity(pool, "t1", company, warehouseId, partId);

  // ════════════════════ explicit company AND warehouse ════════════════════

  await t.test("a reservation without a company or a location is refused, in the command and in the database", async () => {
    const before = await countRows();
    for (const bad of [undefined, null, "", "   "]) {
      await assert.rejects(() => ledger.reserve(pool, ctx(1, "k-nocompany", "wh-a1", { operatingCompanyKey: bad }), [{ partId: "P-STD", quantity: 1 }]), OperatingCompanyAuthorityError);
    }
    for (const bad of [undefined, null, "", "  ", "wh-a1 "]) {
      await assert.rejects(() => ledger.reserve(pool, ctx(1, "k-nowh", "wh-a1", { warehouseId: bad }), [{ partId: "P-STD", quantity: 1 }]), refused("WAREHOUSE_REQUIRED"));
    }
    await assert.rejects(() => ledger.reserve(pool, ctx(1, "k-nosrc", "wh-a1", { source: undefined }), [{ partId: "P-STD", quantity: 1 }]), refused("DEMAND_REQUIRED"));
    // The database refuses the same shapes when the command is bypassed.
    const raw = (cols, vals) => q(`INSERT INTO eos_ops.inventory_commitments (id, tenant_id, work_order_id, part_id, event_type, quantity, idempotency_key, request_fingerprint, created_by${cols})
                                   VALUES ('raw1','t1','wo-1','P-STD','RESERVED',1,'raw1',repeat('a',64),'f'${vals})`);
    await assert.rejects(() => raw(", operating_company_key", ",'co-a'"), /null value in column "warehouse_id"/);
    await assert.rejects(() => raw(", warehouse_id", ",'wh-a1'"), /null value in column "operating_company_key"/);
    assert.equal(await countRows(), before, "nothing was written");
  });

  await t.test("company is never derived from the warehouse: a mismatch is refused, and the database proves the pair agrees", async () => {
    const before = await countRows();
    // wh-a1 belongs to co-a; stating co-b (on a co-b demand) must not "correct" itself to co-a.
    await assert.rejects(() => ledger.reserve(pool, { ...ctx(1, "k-mm"), operatingCompanyKey: CO_B, source: { kind: "WORK_ORDER", workOrderId: "wo-b1" } },
      [{ partId: "P-STD", quantity: 1 }]), refused("COMPANY_WAREHOUSE_MISMATCH"));
    await assert.rejects(() => ledger.reserve(pool, ctx(1, "k-mm2", "wh-b1"), [{ partId: "P-STD", quantity: 1 }]), refused("COMPANY_WAREHOUSE_MISMATCH"));
    await assert.rejects(() => ledger.reserve(pool, ctx(1, "k-nowarehouse", "wh-ghost"), [{ partId: "P-STD", quantity: 1 }]), refused("WAREHOUSE_NOT_FOUND"));
    await assert.rejects(() => q(`INSERT INTO eos_ops.inventory_commitments (id, tenant_id, operating_company_key, warehouse_id, work_order_id, part_id, event_type, quantity, idempotency_key, request_fingerprint, created_by)
                                  VALUES ('raw2','t1','co-b','wh-a1','wo-1','P-STD','RESERVED',1,'raw2',repeat('b',64),'f')`), /commitment_company_and_warehouse_agree/);
    assert.equal(await countRows(), before);
  });

  await t.test("a cross-company claim is refused: the demand's company must be the stated company", async () => {
    const before = await countRows();
    await assert.rejects(() => ledger.reserve(pool, { ...ctx(1, "k-x1"), source: { kind: "WORK_ORDER", workOrderId: "wo-b1" } }, [{ partId: "P-STD", quantity: 1 }]), refused("DEMAND_COMPANY_MISMATCH"));
    await assert.rejects(() => ledger.reserve(pool, { ...ctx(1, "k-x2", "wh-b1"), operatingCompanyKey: CO_B, source: { kind: "SALES_ORDER", salesOrderId: "so-1", lineNumber: 1 } },
      [{ partId: "P-STD2", quantity: 1 }]), refused("DEMAND_COMPANY_MISMATCH"));
    await assert.rejects(() => ledger.reserve(pool, { ...ctx(1, "k-x3"), source: { kind: "WORK_ORDER", workOrderId: "wo-ghost" } }, [{ partId: "P-STD", quantity: 1 }]), refused("DEMAND_NOT_FOUND"));
    assert.equal(await countRows(), before);
    // Co-b stock is never netted against co-a: co-b has P-STD2 at wh-b1 only, so co-a's gate at wh-a1 sees its own 6.
    assert.equal(await ledger.sellableOnHandAtWarehouse(pool, "t1", CO_A, "wh-a1", "P-STD2"), 6);
    assert.equal(await ledger.sellableOnHandAtWarehouse(pool, "t1", CO_B, "wh-b1", "P-STD2"), 5);
  });

  await t.test("a company that is not activated cannot reserve (NOT_YET_ACTIVATED), and activation is per company", async () => {
    const c = { ...ctx(1, "k-act", "wh-b1"), operatingCompanyKey: CO_B, source: { kind: "WORK_ORDER", workOrderId: "wo-b1" } };
    await assert.rejects(() => ledger.reserve(pool, c, [{ partId: "P-STD2", quantity: 1 }]), refused("RESERVATION_NOT_ACTIVATED"));
    await activate(CO_B);
    const [r] = await ledger.reserve(pool, c, [{ partId: "P-STD2", quantity: 1 }]);
    assert.equal(r.outcome, "applied");
    assert.equal(await committed("wh-b1", "P-STD2", CO_B), 1);
    assert.equal(await committed("wh-a1", "P-STD2", CO_A), 0, "co-b's claim is not co-a's");
  });

  await t.test("unknown stock and a closed warehouse are refused before any write; unknown is neither zero nor plenty", async () => {
    const before = await countRows();
    await assert.rejects(() => ledger.reserve(pool, ctx(2, "k-unk"), [{ partId: "P-NOSTOCK", quantity: 1 }]), refused("UNKNOWN_STOCK"));
    await assert.rejects(() => ledger.reserve(pool, ctx(2, "k-unk2", "wh-a2"), [{ partId: "P-STD2", quantity: 1 }]), refused("UNKNOWN_STOCK"));
    await assert.rejects(() => ledger.reserve(pool, ctx(2, "k-shortage"), [{ partId: "P-STD", quantity: 11 }]), refused("INSUFFICIENT_STOCK"));
    await assert.rejects(() => ledger.reserve(pool, ctx(2, "k-closed", "wh-a-closed"), [{ partId: "P-STD", quantity: 1 }]), refused("WAREHOUSE_NOT_ACTIVE"));
    await assert.rejects(() => ledger.reserve(pool, ctx(2, "k-nopart"), [{ partId: "P-GHOST", quantity: 1 }]), refused("PART_NOT_FOUND"));
    // All-or-nothing: P-STD fits, P-NOSTOCK does not -> nothing is written for P-STD either.
    await assert.rejects(() => ledger.reserve(pool, ctx(2, "k-aon"), [{ partId: "P-STD", quantity: 1 }, { partId: "P-NOSTOCK", quantity: 1 }]), refused("UNKNOWN_STOCK"));
    assert.equal(await countRows(), before);
  });

  // ════════════════════ no oversell under concurrency ════════════════════

  await t.test("no oversell under concurrency: concurrent reservations never exceed the location's available stock", async () => {
    // wh-a2 holds 4 of P-STD. Eight demands race for one unit each: exactly four win.
    // BARRIER: a separate transaction holds the Part lock while all eight racers queue behind it (pg_locks shows eight waiters),
    // then lets them go together -- so the contention is real, not left to scheduling luck.
    const barrier = await pool.connect();
    await barrier.query("BEGIN");
    await barrier.query("SELECT pg_advisory_xact_lock(hashtext($1))", [stockLocationLockKey("t1", "P-STD", "WAREHOUSE", "wh-a2")]);
    const pending = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      ledger.reserve(pool, ctx(n, `k-race-${n}`, "wh-a2"), [{ partId: "P-STD", quantity: 1 }]));
    for (let waited = 0; ; waited += 25) {
      const { rows } = await q("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
      if (rows[0].n >= 8) break;
      assert.ok(waited < 15000, "the eight racers never queued on the Part lock");
      await new Promise((r) => setTimeout(r, 25));
    }
    await barrier.query("COMMIT");
    barrier.release();
    const racers = await Promise.allSettled(pending);
    const won = racers.filter((r) => r.status === "fulfilled");
    const lost = racers.filter((r) => r.status === "rejected");
    assert.equal(won.length, 4, "exactly the stock on hand was reserved");
    for (const l of lost) assert.equal(l.reason.code, "INSUFFICIENT_STOCK");
    assert.equal(await committed("wh-a2"), 4);
    const onHand = await ledger.sellableOnHandAtWarehouse(pool, "t1", CO_A, "wh-a2", "P-STD");
    assert.ok(await committed("wh-a2") <= onHand, "committed never exceeds on-hand");

    // Two reservations of 3 against the 6 of P-STD2 at wh-a1 already... use a fresh pair against wh-a1's P-STD (10): 6 + 6.
    const pair = await Promise.allSettled([9, 10].map((n) => ledger.reserve(pool, ctx(n, `k-pair-${n}`, "wh-a1"), [{ partId: "P-STD", quantity: 6 }])));
    assert.equal(pair.filter((r) => r.status === "fulfilled").length, 1, "two claims of 6 cannot both fit in 10");
    assert.equal(pair.find((r) => r.status === "rejected").reason.code, "INSUFFICIENT_STOCK");
    assert.equal(await committed("wh-a1"), 6);
    // release so later proofs start from a known shelf
    const winner = pair.findIndex((r) => r.status === "fulfilled") === 0 ? 9 : 10;
    await ledger.release(pool, ctx(winner, "k-pair-rel", "wh-a1"), { reason: "test cleanup" });
    assert.equal(await committed("wh-a1"), 0);
  });

  // ════════════════════ duplicate / replay ════════════════════

  await t.test("a duplicate claim is refused and a replay writes nothing (rows or audit)", async () => {
    const first = await ledger.reserve(pool, ctx(11, "k-dup"), [{ partId: "P-STD", quantity: 2 }]);
    assert.deepEqual(first.map((w) => w.outcome), ["applied"]);
    const rows = await countRows();
    const audits = await countAudit();

    const replay = await ledger.reserve(pool, ctx(11, "k-dup"), [{ partId: "P-STD", quantity: 2 }]);
    assert.deepEqual(replay.map((w) => w.outcome), ["replayed"]);
    assert.equal(replay[0].record.id, first[0].record.id, "the replay returns the original row");
    assert.equal(await countRows(), rows, "a replay writes no row");
    assert.equal(await countAudit(), audits, "a replay writes no audit");

    // Same key, different content: a conflict, never a silent replay.
    await assert.rejects(() => ledger.reserve(pool, ctx(11, "k-dup"), [{ partId: "P-STD", quantity: 3 }]), (e) => e instanceof ledger.CommitmentIdempotencyConflictError);
    // A NEW key for the same demand line + location while a claim is active is a duplicate claim.
    await assert.rejects(() => ledger.reserve(pool, ctx(11, "k-dup-2"), [{ partId: "P-STD", quantity: 1 }]), refused("DUPLICATE_CLAIM"));
    assert.equal(await countRows(), rows);
    assert.equal(await committed("wh-a1"), 2);

    // Replay is decided BEFORE the availability gate: it still replays after the shelf is emptied.
    await move("P-STD", "WAREHOUSE", "wh-a1", -7);
    await move("P-STD", "BIN", BIN, -3);
    const late = await ledger.reserve(pool, ctx(11, "k-dup"), [{ partId: "P-STD", quantity: 2 }]);
    assert.deepEqual(late.map((w) => w.outcome), ["replayed"]);
    await move("P-STD", "WAREHOUSE", "wh-a1", 7);
    await move("P-STD", "BIN", BIN, 3);

    // Duplicate lines for one Part are summed first, as one row.
    const summed = await ledger.reserve(pool, ctx(12, "k-sum"), [{ partId: "P-STD", quantity: 1 }, { partId: "P-STD", quantity: 2 }]);
    assert.deepEqual(summed.map((w) => [w.record.partId, w.record.quantity]), [["P-STD", 3]]);
  });

  await t.test("unallocated demand is never a hard reservation: only ledger rows reduce available stock", async () => {
    // so-1 line 1 orders 50 of P-STD -- demand that is visible but not allocated. It must not touch the pool.
    assert.equal(await committed("wh-a1"), 5, "only wo-11 (2) + wo-12 (3) hold claims at wh-a1");
    const before = await ledger.sellableOnHandAtWarehouse(pool, "t1", CO_A, "wh-a1", "P-STD");
    const [claim] = await ledger.reserve(pool, { ...ctx(1, "k-so-1"), source: { kind: "SALES_ORDER", salesOrderId: "so-1", lineNumber: 2 } }, [{ partId: "P-STD", quantity: 2 }]);
    assert.equal(claim.outcome, "applied");
    assert.equal(claim.record.workOrderId, null);
    assert.deepEqual(claim.record.source, { kind: "SALES_ORDER", salesOrderId: "so-1", lineNumber: 2 });
    assert.equal(await committed("wh-a1"), 7, "a Sales Order claim joins the ONE pool: 5 + 2");
    // Line 1 (ordered 50, never allocated) has no claim at all; an order line quantity is not a reservation.
    const { rows } = await q(`SELECT count(*)::int AS n FROM eos_ops.inventory_commitments WHERE sales_order_id='so-1' AND sales_order_line_number=1`);
    assert.equal(rows[0].n, 0);
    assert.equal(await ledger.sellableOnHandAtWarehouse(pool, "t1", CO_A, "wh-a1", "P-STD"), before, "claims do not move stock");
    // Second claim on the same SO line + location is a duplicate; exactly one source is a database CHECK.
    await assert.rejects(() => ledger.reserve(pool, { ...ctx(1, "k-so-2"), source: { kind: "SALES_ORDER", salesOrderId: "so-1", lineNumber: 2 } }, [{ partId: "P-STD", quantity: 1 }]), refused("DUPLICATE_CLAIM"));
    await assert.rejects(() => q(`INSERT INTO eos_ops.inventory_commitments (id, tenant_id, operating_company_key, warehouse_id, work_order_id, sales_order_id, sales_order_line_number, part_id, event_type, quantity, idempotency_key, request_fingerprint, created_by)
                                  VALUES ('raw3','t1','co-a','wh-a1','wo-1','so-1',1,'P-STD','RESERVED',1,'raw3',repeat('c',64),'f')`), /commitment_exactly_one_source/);
    await assert.rejects(() => q(`INSERT INTO eos_ops.inventory_commitments (id, tenant_id, operating_company_key, warehouse_id, part_id, event_type, quantity, idempotency_key, request_fingerprint, created_by)
                                  VALUES ('raw4','t1','co-a','wh-a1','P-STD','RESERVED',1,'raw4',repeat('d',64),'f')`), /commitment_exactly_one_source/);
  });

  // ════════════════════ governed transitions, each audited ════════════════════

  await t.test("release, consume and cancel are governed transitions, each audited once, a replay never", async () => {
    const reservedAudits = (await stockActions("stock.reserve")).length;
    assert.ok(reservedAudits >= 1);
    assert.ok((await stockActions("stock.reserve")).every((a) => a.reason === null), "a reserve carries no free text");

    // wo-12 holds 3 at wh-a1. Release 1 with a reason, then consume 2.
    const releaseAudits = (await stockActions("stock.release")).length;
    const [rel] = await ledger.release(pool, ctx(12, "k-rel-1"), { reason: "customer reduced the order", lines: [{ partId: "P-STD", quantity: 1 }] });
    assert.equal(rel.record.eventType, "RELEASED");
    assert.equal((await stockActions("stock.release")).at(-1).reason, "customer reduced the order");
    const again = await ledger.release(pool, ctx(12, "k-rel-1"), { reason: "customer reduced the order", lines: [{ partId: "P-STD", quantity: 1 }] });
    assert.deepEqual(again.map((w) => w.outcome), ["replayed"]);
    assert.equal((await stockActions("stock.release")).length, releaseAudits + 1, "the replay wrote no second audit row");

    await assert.rejects(() => ledger.consume(pool, ctx(12, "k-con-big"), [{ partId: "P-STD", quantity: 3 }]), refused("CONSUME_EXCEEDS_OUTSTANDING"));
    await assert.rejects(() => ledger.release(pool, ctx(12, "k-rel-big"), { reason: "too much", lines: [{ partId: "P-STD", quantity: 3 }] }), refused("RELEASE_EXCEEDS_OUTSTANDING"));
    const [con] = await ledger.consume(pool, ctx(12, "k-con"), [{ partId: "P-STD", quantity: 2 }]);
    assert.equal(con.record.eventType, "CONSUMED");
    assert.equal((await stockActions("stock.consume")).length, 1);
    assert.deepEqual([...(await ledger.outstandingByPart(pool, "t1", "wo-12"))], [["P-STD", 0]]);
    // Consumed stock is not committed any more and moved no stock.
    assert.equal(await committed("wh-a1"), 4, "wo-11 (2) + so-1:2 (2)");
    // Nothing left to release or consume for wo-12.
    await assert.rejects(() => ledger.release(pool, ctx(12, "k-rel-none"), { reason: "nothing", lines: [{ partId: "P-STD", quantity: 1 }] }), refused("NO_ACTIVE_CLAIM"));
    assert.deepEqual(await ledger.release(pool, ctx(12, "k-rel-all"), { reason: "sweep" }), [], "release-all with nothing outstanding writes nothing");
    assert.equal((await stockActions("stock.release")).length, releaseAudits + 1, "and audits nothing");

    // A transition stated for another company or warehouse finds no claim: refused, nothing written.
    const rows = await countRows();
    await assert.rejects(() => ledger.release(pool, ctx(11, "k-rel-wrongwh", "wh-a2"), { reason: "wrong place", lines: [{ partId: "P-STD", quantity: 1 }] }), refused("NO_ACTIVE_CLAIM"));
    await assert.rejects(() => ledger.release(pool, { ...ctx(11, "k-rel-wrongco"), operatingCompanyKey: CO_B }, { reason: "wrong company", lines: [{ partId: "P-STD", quantity: 1 }] }), refused("NO_ACTIVE_CLAIM"));
    assert.equal(await countRows(), rows);
    await assert.rejects(() => ledger.release(pool, ctx(11, "k-rel-noreason"), { reason: "  " }), refused("REASON_REQUIRED"));
    await assert.rejects(() => ledger.release(pool, ctx(11, "k-rel-longreason"), { reason: "x".repeat(201) }), refused("REASON_REQUIRED"));

    // CANCEL: a demand holding claims at two warehouses releases everything in one command, ONE audit row.
    await move("P-STD2", "WAREHOUSE", "wh-a2", 5);
    await ledger.reserve(pool, ctx(13, "k-c13-1", "wh-a1"), [{ partId: "P-STD2", quantity: 2 }]);
    await ledger.reserve(pool, ctx(13, "k-c13-2", "wh-a2"), [{ partId: "P-STD2", quantity: 3 }]);
    const cancelAudits = (await stockActions("stock.cancel")).length;
    const cancelled = await ledger.cancel(pool, { tenantId: "t1", operatingCompanyKey: CO_A, source: wo(13), actorId: ACTOR, idempotencyKey: "k-cancel-13" }, { reason: "work order cancelled" });
    assert.deepEqual(cancelled.map((w) => [w.record.warehouseId, w.record.partId, w.record.eventType, w.record.quantity]).sort(),
      [["wh-a1", "P-STD2", "RELEASED", 2], ["wh-a2", "P-STD2", "RELEASED", 3]]);
    assert.equal((await stockActions("stock.cancel")).length, cancelAudits + 1, "one audit row per applied command, not per row");
    assert.equal((await stockActions("stock.cancel")).at(-1).reason, "work order cancelled");
    const replayCancel = await ledger.cancel(pool, { tenantId: "t1", operatingCompanyKey: CO_A, source: wo(13), actorId: ACTOR, idempotencyKey: "k-cancel-13" }, { reason: "work order cancelled" });
    assert.ok(replayCancel.every((w) => w.outcome === "replayed"));
    assert.equal((await stockActions("stock.cancel")).length, cancelAudits + 1);
    assert.equal(await committed("wh-a1", "P-STD2"), 0);
    // A cancelled demand can claim again (the old claim is closed) -- the pool shows only the new one.
    await ledger.reserve(pool, ctx(13, "k-c13-again", "wh-a1"), [{ partId: "P-STD2", quantity: 1 }]);
    assert.equal(await committed("wh-a1", "P-STD2"), 1);

    // Every applied command wrote exactly one stock.* audit row (actor + company in the payload, nothing else free-text).
    const audits = await q(`SELECT action, actor_uid, after FROM eos_policy.audit_events WHERE action LIKE 'stock.%'`);
    for (const a of audits.rows) {
      assert.equal(a.actor_uid, ACTOR);
      assert.ok(a.after.operatingCompanyKey && Array.isArray(a.after.rows));
    }
  });

  await t.test("the ledger is append-only in the database: a release is a new row, never an edit", async () => {
    await assert.rejects(() => q(`UPDATE eos_ops.inventory_commitments SET quantity = 99`), /append-only/);
    await assert.rejects(() => q(`DELETE FROM eos_ops.inventory_commitments`), /append-only/);
    await assert.rejects(() => q(`TRUNCATE eos_ops.inventory_commitments`), /append-only/, "one statement must not erase every reservation fact");
  });

  // ════════════════════ serial custody ════════════════════

  await t.test("a serialized or whole-unit Part is never quantity-reserved, so a unit cannot be claimed twice", async () => {
    const before = await countRows();
    const audits = await countAudit();
    for (const partId of ["P-SER", "P-UNIT"]) {
      for (const key of ["k-ser-1", "k-ser-2"]) {
        await assert.rejects(() => ledger.reserve(pool, ctx(7, key), [{ partId, quantity: 1 }]), refused("TRACKING_MODE_NOT_SUPPORTED"));
      }
    }
    await assert.rejects(() => ledger.reserve(pool, { ...ctx(7, "k-ser-so"), source: { kind: "SALES_ORDER", salesOrderId: "so-1", lineNumber: 1 } }, [{ partId: "P-UNIT", quantity: 1 }]), refused("TRACKING_MODE_NOT_SUPPORTED"));
    assert.equal(await countRows(), before, "no claim row exists for any serialized unit");
    assert.equal(await countAudit(), audits);
    // A serial Part mixed with a good line refuses the whole command: the good line is not written either.
    await assert.rejects(() => ledger.reserve(pool, ctx(7, "k-ser-mix"), [{ partId: "P-STD", quantity: 1 }, { partId: "P-SER", quantity: 1 }]), refused("TRACKING_MODE_NOT_SUPPORTED"));
    assert.equal(await countRows(), before);
  });

  // ════════════════════ transitions never depend on the demand still existing (F2) ════════════════════

  await t.test("a purged or renumbered demand can never strand stock: release, consume and cancel work from the commitment rows", async () => {
    // Work Order: reserve, delete the Work Order, then release.
    await ledger.reserve(pool, ctx(14, "k-f2-wo"), [{ partId: "P-STD2", quantity: 2 }]);
    await q(`DELETE FROM eos_ops.work_orders WHERE tenant_id = 't1' AND id = 'wo-14'`);
    await assert.rejects(() => ledger.reserve(pool, ctx(14, "k-f2-wo-again"), [{ partId: "P-STD2", quantity: 1 }]), refused("DEMAND_NOT_FOUND"), "a NEW claim still needs the demand");
    const [consumed] = await ledger.consume(pool, ctx(14, "k-f2-con"), [{ partId: "P-STD2", quantity: 1 }]);
    assert.equal(consumed.record.eventType, "CONSUMED");
    const [released] = await ledger.release(pool, ctx(14, "k-f2-rel"), { reason: "demand purged" });
    assert.deepEqual([released.record.eventType, released.record.quantity], ["RELEASED", 1]);
    assert.deepEqual([...(await ledger.outstandingByPart(pool, "t1", "wo-14"))], [["P-STD2", 0]]);

    // Sales Order line: reserve, renumber the line, then cancel the claim under the old number.
    await q(`INSERT INTO eos_commercial.sales_order_lines (tenant_id, sales_order_id, line_number, kind, ref, business_unit, ordered_qty) VALUES ('t1','so-1',3,'PART','P-STD2','PARTS',4)`);
    const so3 = { kind: "SALES_ORDER", salesOrderId: "so-1", lineNumber: 3 };
    await ledger.reserve(pool, { ...ctx(1, "k-f2-so"), source: so3 }, [{ partId: "P-STD2", quantity: 2 }]);
    await q(`UPDATE eos_commercial.sales_order_lines SET line_number = 9 WHERE tenant_id = 't1' AND sales_order_id = 'so-1' AND line_number = 3`);
    const cancelled = await ledger.cancel(pool, { tenantId: "t1", operatingCompanyKey: CO_A, source: so3, actorId: ACTOR, idempotencyKey: "k-f2-so-cancel" }, { reason: "line renumbered" });
    assert.deepEqual(cancelled.map((w) => [w.record.eventType, w.record.quantity]), [["RELEASED", 2]]);
  });

  await t.test("release-all and cancel take the DEMAND lock first, so the Parts they read cannot go stale before the Part locks", async () => {
    await ledger.reserve(pool, ctx(15, "k-f4-res"), [{ partId: "P-STD2", quantity: 1 }]);
    await ledger.reserve(pool, ctx(16, "k-f4-res16"), [{ partId: "P-STD2", quantity: 1 }]);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const [n, run] of [
      [15, () => ledger.release(pool, ctx(15, "k-f4-rel"), { reason: "release all" })],
      [16, () => ledger.cancel(pool, { tenantId: "t1", operatingCompanyKey: CO_A, source: wo(16), actorId: ACTOR, idempotencyKey: "k-f4-cancel" }, { reason: "cancel all" })],
    ]) {
      const holder = await pool.connect();
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ledger.demandLockKey("t1", wo(n))]);
      let done = false;
      const running = run().then((r) => { done = true; return r; });
      await sleep(400);
      const waited = done === false;
      await holder.query("COMMIT"); // always let go, so a failing assertion cannot hang the suite
      holder.release();
      const written = await running;
      assert.equal(waited, true, `wo-${n}: the command must wait for the demand lock before it reads the claim`);
      assert.deepEqual(written.map((w) => w.record.eventType), ["RELEASED"]);
    }
  });

  await t.test("the activation switch is bound to a real company key, states a reason, and is insert-only", async () => {
    const insert = (key, by, reason) => q(`INSERT INTO eos_ops.stock_reservation_activation (tenant_id, operating_company_key, activated_by, reason) VALUES ('t1',$1,$2,$3)`, [key, by, reason]);
    await assert.rejects(() => insert("co-unbound", "op", "no such company"), /stock_reservation_activation_company_is_bound/);
    await assert.rejects(() => insert("co-a", "op", "x"), /duplicate key/, "one row per company");
    await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by) VALUES ('t1','co-c-id','ACTIVE','fixture','f','f')`);
    await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by) VALUES ('t1','co-c-id','co-c','ACTIVE','NATIVE','fixture','f','f')`);
    for (const reason of ["", "   "]) await assert.rejects(() => insert("co-c", "op", reason), /stock_reservation_activation_reason_is_stated/);
    await assert.rejects(() => insert("co-c", "  ", "why"), /stock_reservation_activation_actor_is_stated/);
    await assert.rejects(() => q(`INSERT INTO eos_ops.stock_reservation_activation (tenant_id, operating_company_key, activated_by) VALUES ('t1','co-c','op')`), /null value in column "reason"/);
    await assert.rejects(() => q(`UPDATE eos_ops.stock_reservation_activation SET reason = 'edited'`), /insert-only/);
    await assert.rejects(() => q(`DELETE FROM eos_ops.stock_reservation_activation`), /insert-only/);
    await assert.rejects(() => q(`TRUNCATE eos_ops.stock_reservation_activation`), /insert-only/);
    // co-c is not activated: a reservation for it is refused (and only an operator row can change that).
    await insert("co-c", "op", "activate for the test");
  });

  // ════════════════════ the one arithmetic ════════════════════

  await t.test("committed is RESERVED - RELEASED - CONSUMED, floored at 0, per company AND warehouse", async () => {
    assert.equal(await committed("wh-a2", "P-STD"), 4);
    assert.equal(await committed("wh-a1", "P-STD"), 4);
    assert.equal(await committed("wh-a-closed", "P-STD"), 0, "no row is 0 committed");
    const map = await ledger.committedByWarehouse(pool, "t1", [CO_A], "P-STD", ["wh-a1", "wh-a2", "wh-b1"]);
    assert.deepEqual([...map].sort(), [["wh-a1", 4], ["wh-a2", 4]]);
    const other = await ledger.committedByWarehouse(pool, "t1", [CO_B], "P-STD", ["wh-a1", "wh-a2"]);
    assert.equal(other.size, 0, "another company's key sees none of co-a's claims");
  });
});
