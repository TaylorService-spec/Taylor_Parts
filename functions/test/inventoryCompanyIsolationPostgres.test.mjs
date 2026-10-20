// COMPANY ISOLATION FOR WAREHOUSE-SCOPED INVENTORY (ISO inventory, 2026-10-19; #235 / #237; the D-248-1 and B3 patterns) -- against a real postgres:16.
//
// THE FINDING (deployed proof, Noor / warehouseAssociate): a WAREHOUSE operational scope was treated as enough. Noor, a Taylor employee scoped to a warehouse
// OF ANOTHER COMPANY, with no company authority there, listed that company's cycle counts, while transfers (which filter by company) offered only Taylor's.
//
// THE RULE, proved per domain: CAPABILITY first, then COMPANY AUTHORITY (none at all = COMPANY_AUTHORITY_REQUIRED, before any row is read), then the
// WAREHOUSE scope. A record -- or a location named in a request -- of a company outside the caller's reads EXACTLY as a nonexistent one (the same code,
// category and message), every refusal precedes any write, and a warehouse scope never grants reach into another company's warehouse.
//
// For every domain three personas are proved, plus the no-company one:
//   inCo           a Taylor employee, Taylor company authority, WAREHOUSE scope over Taylor's warehouses          -> succeeds
//   foreignScoped  a Taylor employee with a WAREHOUSE scope over VENTANA's warehouse but NO Ventana authority      -> refused AS NONEXISTENT, no write
//   noScope        a Taylor employee with company authority but NO warehouse scope                                -> refused (OUTSIDE_OPERATIONAL_SCOPE)
//   noCompany      a principal with every capability and no Employee, so no company authority                    -> COMPANY_AUTHORITY_REQUIRED
// The cross-company actor (Taylor home + an explicit Ventana grant + a Ventana scope) creates the Ventana records the others must not reach.
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
import { certifyInventoryBaselineFixture } from "./support/inventoryBaselineCertified.mjs";
import { grantSyntheticCompanyAuthority } from "./support/syntheticAvailability.mjs";

const URL_BASE = process.env.POLICY_TEST_DATABASE_URL;
const SKIP = URL_BASE ? false : "POLICY_TEST_DATABASE_URL is not set -- no database to prove anything against";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cc = require("../lib/eosOps/cycleCountOperations.js");
const tr = require("../lib/eosOps/transferOperations.js");
const reloc = require("../lib/eosOps/stockRelocationOperations.js");
const plc = require("../lib/eosOps/binPlacementOperations.js");
const rcv = require("../lib/eosOps/receiveReorderStockCommand.js");
const corr = require("../lib/eosOps/receiptCorrectionCommand.js");
const reads = require("../lib/eosOps/partsReads.js");
const scopeCommands = require("../lib/eosWorkforce/commands/employeeOperationalScopeCommands.js");
const scopeReads = require("../lib/eosWorkforce/reads/operationalScopeReads.js");
const entitlement = require("../lib/eosOps/conditionalEntitlement.js");
const { createBin } = require("../lib/eosOps/warehouseBinRepository.js");
const { createMobileLocation, createTruck } = require("../lib/eosOps/truckFleetRepository.js");
const { PostgresPolicyRepository } = require("../lib/adminPolicy/postgresPolicyRepository.js");

const dbUrlFor = (n) => { const u = new URL(URL_BASE); u.pathname = `/${n}`; return u.toString(); };
async function withClient(url, fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

const T = "t1";
const CC_CAPS = ["inventory.cycleCount.create", "inventory.cycleCount.submit", "inventory.cycleCount.reconcile", "inventory.cycleCount.cancel", "inventory.cycleCount.close"];
const TR_CAPS = ["inventory.transfer.create", "inventory.transfer.dispatch", "inventory.transfer.receive", "inventory.transfer.cancel", "warehouse.transferOrder.read"];
const OTHER_CAPS = ["inventory.stock.relocate", "inventory.placement.record", "inventory.transaction.read", "warehouse.record.read", "receivingOrder.record.read",
  "inventory.stock.receive", "inventory.receipt.correct"];
const ALL_CAPS = [...CC_CAPS, ...TR_CAPS, ...OTHER_CAPS];
const ACTIVE = "ACTIVE";

test("Company isolation for warehouse-scoped inventory: capability, then company, then warehouse scope", { skip: SKIP, concurrency: 1 }, async (t) => {
  const name = `isoinv_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let pool;
  await withClient(URL_BASE, (c) => c.query(`CREATE DATABASE ${name}`));
  t.after(async () => {
    await endPoolAndDrain(pool);
    await withClient(URL_BASE, (c) => c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
  });
  execFileSync(process.execPath, ["node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "--migrations-dir", "migrations"], { maxBuffer: 256 * 1024 * 1024,
    cwd: FUNCTIONS_DIR, env: { ...process.env, DATABASE_URL: dbUrlFor(name) }, stdio: "pipe",
  });
  pool = new pg.Pool({ connectionString: dbUrlFor(name), max: 8 });
  await applyStockReservationMigration(pool);
  const q = (text, values = []) => pool.query(text, values);
  const repo = new PostgresPolicyRepository(pool);

  await q(`INSERT INTO eos_policy.tenants (id, key, name) VALUES ('t1','t1','T1')`);
  await certifyInventoryBaselineFixture(q, T);
  // Two companies; the KEY is not the company id.
  await q(`INSERT INTO eos_policy.tenant_operating_companies (tenant_id, operating_company_id, status, source, established_by, updated_by)
           VALUES ('t1','taylor','ACTIVE','fixture','f','f'), ('t1','ventana','ACTIVE','fixture','f','f')`);
  await q(`INSERT INTO eos_policy.tenant_operating_company_keys (tenant_id, operating_company_id, operating_company_key, status, provenance, source, established_by, updated_by)
           VALUES ('t1','taylor','taylor-co','ACTIVE','NATIVE','fixture','f','f'), ('t1','ventana','ventana-co','ACTIVE','NATIVE','fixture','f','f')`);
  const warehouse = (id, key) => q(
    `INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
     VALUES ($1,'t1',$2,$1,'Sampleton','ACTIVE','NATIVE','fixture','fixture')`, [id, key]);
  await warehouse("wh-t1", "taylor-co");
  await warehouse("wh-t2", "taylor-co");
  await warehouse("wh-v", "ventana-co");
  const bin = async (wh, aisle) => (await createBin(pool, T, "fixture", { warehouseId: wh, area: "MAIN", aisle, bay: 1, position: 1, idempotencyKey: `bin-${wh}-${aisle}` })).id;
  const BIN_T = await bin("wh-t1", "A");
  const BIN_V = await bin("wh-v", "A");
  // One truck per company, each bound to its own company's warehouse.
  await createMobileLocation(pool, T, "fixture", { locationId: "mob-t", displayLabel: "Taylor Truck 1", operatingCompanyKey: "taylor-co" });
  await createMobileLocation(pool, T, "fixture", { locationId: "mob-v", displayLabel: "Ventana Truck 1", operatingCompanyKey: "ventana-co" });
  for (const [loc, wh] of [["mob-t", "wh-t1"], ["mob-v", "wh-v"]]) {
    await q(`INSERT INTO eos_ops.mobile_location_scope_bindings (id, tenant_id, location_type, location_id, warehouse_id, established_by, reason)
             VALUES ($1,'t1','MOBILE',$2,$3,'fixture','fixture')`, [`msb-${loc}`, loc, wh]);
  }
  await createTruck(pool, T, "fixture", { truckId: "trk-t", vehicleNumber: "T-1", displayLabel: "Taylor Truck 1", homeWarehouseId: "wh-t1", mobileLocationId: "mob-t" });
  await createTruck(pool, T, "fixture", { truckId: "trk-v", vehicleNumber: "V-1", displayLabel: "Ventana Truck 1", homeWarehouseId: "wh-v", mobileLocationId: "mob-v" });
  for (const id of ["PART-A", "PART-B"]) {
    await q(`INSERT INTO eos_ops.parts (id, tenant_id, created_by, internal_part_number, name, status, stocking_unit, control_type, stocking_class,
               expiry_tracked, consumable, returnable_core, whole_unit, version, updated_by)
             VALUES ($1,'t1','fixture',$1,$1,'ACTIVE','EACH','STANDARD','STOCKED',false,false,false,false,1,'fixture')`, [id]);
  }
  const stock = (id, key, partId, type, location, qty) => q(
    `INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta, source_kind, source_id, created_by)
     VALUES ($1,'t1',$2,$3,'NONE',$4,$5,'RECEIVED',$6,'TEST',$1,'fixture')`, [id, key, partId, type, location, qty]);
  await stock("mv-t1", "taylor-co", "PART-A", "WAREHOUSE", "wh-t1", 10);
  await stock("mv-t1b", "taylor-co", "PART-B", "WAREHOUSE", "wh-t1", 10);
  await stock("mv-v", "ventana-co", "PART-A", "WAREHOUSE", "wh-v", 10);
  // A truck is never received into (OD-T5); its stock arrives by transfer or adjustment -- a ledger row of the truck's own company.
  await q(`INSERT INTO eos_ops.inventory_movements (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id, movement_type, quantity_delta, source_kind, source_id, idempotency_key, created_by)
           VALUES ('mv-vtruck','t1','ventana-co','PART-A','NONE','MOBILE','mob-v','ADJUSTED',3,'CYCLE_COUNT','fx','fx-vtruck','fixture')`);

  // ── the people ──
  let n = 0;
  const person = async ({ employee = true, scopes = [], eligibility = true }) => {
    n += 1;
    const principalId = await repo.transact({ tenantId: T, uid: "fixture" }, async (tx) => {
      const p = await tx.createPrincipal({ externalSubject: `uid-iso-${n}`, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id);
      return p.id;
    });
    if (employee) {
      const e = `e-iso-${n}`;
      await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id) VALUES ($1,'t1','ACTIVE','taylor')`, [e]);
      await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason)
               VALUES ($1,'t1',$2,$3,'taylor','OPERATOR_ASSERTED','active','f','iso fixture')`, [`epl-iso-${n}`, principalId, e]);
      if (eligibility) {
        await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
                 VALUES ($1,'t1',$2,'WAREHOUSE_OPERATIONS', now(), 'fixture')`, [`we-iso-${n}`, e]);
      }
      for (const wh of scopes) {
        await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
                 VALUES ($1,'t1',$2,'WAREHOUSE',$3, now(), 'fixture')`, [`os-iso-${n}-${wh}`, e, wh]);
      }
    }
    return principalId;
  };
  const inCo = await person({ scopes: ["wh-t1", "wh-t2"] });
  const foreignScoped = await person({ scopes: ["wh-t1", "wh-v"] }); // Noor: Taylor, scoped at a Ventana warehouse, no Ventana authority
  const noScope = await person({});
  const noCompany = await person({ employee: false });
  const crossActor = await person({ scopes: ["wh-t1", "wh-v"] });
  await grantSyntheticCompanyAuthority(pool, T, crossActor, ["taylor", "ventana"]);
  const as = (principalId, caps = ALL_CAPS) => ({ tenantId: T, principalId, capabilities: new Set(caps) });

  const CC = { pool, postgresState: ACTIVE };
  const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };
  const shape = (e) => [e.code, e.category, e.message];
  /** Refused EXACTLY as the nonexistent twin is: same code, category and message. */
  const sameAsMissing = async (fn, missingFn, what, ids = []) => {
    // `ids`: [theId, theMissingId] -- a refusal that names the requested id ("no Reorder Request <id> in this tenant") is compared with the id masked.
    const norm = (e, id) => shape(e).map((p) => (id ? String(p).split(id).join("<id>") : p));
    assert.deepEqual(norm(await refusal(fn), ids[0]), norm(await refusal(missingFn), ids[1]), what);
  };
  const counts = async () => {
    const one = async (sql) => (await q(sql)).rows[0].n;
    return [
      await one(`SELECT count(*)::int n FROM eos_ops.cycle_count_sheets`), await one(`SELECT count(*)::int n FROM eos_ops.cycle_count_lines`),
      await one(`SELECT count(*)::int n FROM eos_ops.transfer_orders`), await one(`SELECT count(*)::int n FROM eos_ops.inventory_movements`),
      await one(`SELECT count(*)::int n FROM eos_ops.receiving_orders`), await one(`SELECT count(*)::int n FROM eos_policy.audit_events`),
      await one(`SELECT count(*)::int n FROM eos_ops.bin_placements`), await one(`SELECT count(*)::int n FROM eos_ops.receiving_corrections`),
    ];
  };
  const noWrite = async (fn) => { const before = await counts(); const out = await fn(); assert.deepEqual(await counts(), before, "a refusal precedes every write"); return out; };

  // ════════════════════ CYCLE COUNT (all nine) ════════════════════
  let taylorSheet, ventanaSheet;
  await t.test("cycle count: a same-company in-scope actor succeeds; the cross-company actor makes the Ventana sheet the others must not reach", async () => {
    const made = await cc.createEosCycleCountSheet(CC, as(inCo), { location: { type: "WAREHOUSE", locationId: "wh-t1" }, idempotencyKey: "iso-cc-t" });
    assert.equal(made.outcome, "applied");
    taylorSheet = made.sheet.sheetId;
    assert.equal((await cc.openEosCycleCountLine(CC, as(inCo), { sheetId: taylorSheet, partId: "PART-A" })).outcome, "applied");
    assert.equal((await cc.submitEosCycleCountLine(CC, as(inCo), { sheetId: taylorSheet, partId: "PART-A", countedQuantity: 10 })).outcome, "applied");
    assert.equal((await cc.getEosCycleCountSheet(CC, as(inCo), { sheetId: taylorSheet })).lines.length, 1);
    assert.deepEqual((await cc.listEosCycleCountSheets(CC, as(inCo), {})).sheets.map((s) => s.sheetId), [taylorSheet]);
    const v = await cc.createEosCycleCountSheet(CC, as(crossActor), { location: { type: "WAREHOUSE", locationId: "wh-v" }, idempotencyKey: "iso-cc-v" });
    assert.equal(v.outcome, "applied");
    ventanaSheet = v.sheet.sheetId;
    await cc.openEosCycleCountLine(CC, as(crossActor), { sheetId: ventanaSheet, partId: "PART-A" });
    await cc.submitEosCycleCountLine(CC, as(crossActor), { sheetId: ventanaSheet, partId: "PART-A", countedQuantity: 9 });
  });

  await t.test("cycle count: an actor scoped at another company's warehouse with no authority over it is refused AS NONEXISTENT on all nine, with no write", async () => {
    const f = as(foreignScoped);
    const missingSheet = { sheetId: "ccs_does_not_exist" };
    const attempts = [
      ["create at the foreign warehouse", () => cc.createEosCycleCountSheet(CC, f, { location: { type: "WAREHOUSE", locationId: "wh-v" }, idempotencyKey: "iso-cc-x" }),
        () => cc.createEosCycleCountSheet(CC, f, { location: { type: "WAREHOUSE", locationId: "wh-nope" }, idempotencyKey: "iso-cc-y" })],
      ["create at the foreign bin", () => cc.createEosCycleCountSheet(CC, f, { location: { type: "BIN", locationId: BIN_V }, idempotencyKey: "iso-cc-x2" }),
        () => cc.createEosCycleCountSheet(CC, f, { location: { type: "BIN", locationId: "bin_nope" }, idempotencyKey: "iso-cc-y2" })],
      ["create at the foreign truck", () => cc.createEosCycleCountSheet(CC, f, { location: { type: "MOBILE", locationId: "mob-v" }, idempotencyKey: "iso-cc-x3" }),
        () => cc.createEosCycleCountSheet(CC, f, { location: { type: "MOBILE", locationId: "mob-nope" }, idempotencyKey: "iso-cc-y3" })],
      ["open a line", () => cc.openEosCycleCountLine(CC, f, { sheetId: ventanaSheet, partId: "PART-B" }), () => cc.openEosCycleCountLine(CC, f, { ...missingSheet, partId: "PART-B" })],
      ["submit a count", () => cc.submitEosCycleCountLine(CC, f, { sheetId: ventanaSheet, partId: "PART-A", countedQuantity: 1 }), () => cc.submitEosCycleCountLine(CC, f, { ...missingSheet, partId: "PART-A", countedQuantity: 1 })],
      ["reconcile", () => cc.reconcileEosCycleCountLine(CC, f, { sheetId: ventanaSheet, partId: "PART-A", decision: "REJECT", reason: "x" }), () => cc.reconcileEosCycleCountLine(CC, f, { ...missingSheet, partId: "PART-A", decision: "REJECT", reason: "x" })],
      ["cancel a line", () => cc.cancelEosCycleCountLine(CC, f, { sheetId: ventanaSheet, partId: "PART-A" }), () => cc.cancelEosCycleCountLine(CC, f, { ...missingSheet, partId: "PART-A" })],
      ["close", () => cc.closeEosCycleCountSheet(CC, f, { sheetId: ventanaSheet }), () => cc.closeEosCycleCountSheet(CC, f, missingSheet)],
      ["cancel the sheet", () => cc.cancelEosCycleCountSheet(CC, f, { sheetId: ventanaSheet }), () => cc.cancelEosCycleCountSheet(CC, f, missingSheet)],
      ["read the sheet", () => cc.getEosCycleCountSheet(CC, f, { sheetId: ventanaSheet }), () => cc.getEosCycleCountSheet(CC, f, missingSheet)],
    ];
    for (const [what, fn, missing] of attempts) await noWrite(() => sameAsMissing(fn, missing, what));
    const list = await cc.listEosCycleCountSheets(CC, f, {});
    assert.equal(list.sheets.some((s) => s.sheetId === ventanaSheet), false, "the list never carries the other company's sheet");
    assert.deepEqual(list.scopedWarehouseIds, ["wh-t1"], "the warehouse scope never names the other company's warehouse");
    assert.equal((await q(`SELECT status::text s FROM eos_ops.cycle_count_sheets WHERE id = $1`, [ventanaSheet])).rows[0].s, "OPEN", "the foreign sheet is untouched");
  });

  await t.test("cycle count: company authority but no warehouse scope is refused (scope is still required); no company authority is COMPANY_AUTHORITY_REQUIRED, capability first", async () => {
    const at = { location: { type: "WAREHOUSE", locationId: "wh-t1" }, idempotencyKey: "iso-cc-s" };
    assert.equal((await noWrite(() => refusal(() => cc.createEosCycleCountSheet(CC, as(noScope), at)))).code, "OUTSIDE_OPERATIONAL_SCOPE");
    for (const [what, fn] of [
      ["create", () => cc.createEosCycleCountSheet(CC, as(noCompany), at)], ["open", () => cc.openEosCycleCountLine(CC, as(noCompany), { sheetId: taylorSheet, partId: "PART-B" })],
      ["submit", () => cc.submitEosCycleCountLine(CC, as(noCompany), { sheetId: taylorSheet, partId: "PART-A", countedQuantity: 1 })],
      ["reconcile", () => cc.reconcileEosCycleCountLine(CC, as(noCompany), { sheetId: taylorSheet, partId: "PART-A", decision: "REJECT", reason: "x" })],
      ["cancel line", () => cc.cancelEosCycleCountLine(CC, as(noCompany), { sheetId: taylorSheet, partId: "PART-A" })], ["close", () => cc.closeEosCycleCountSheet(CC, as(noCompany), { sheetId: taylorSheet })],
      ["cancel sheet", () => cc.cancelEosCycleCountSheet(CC, as(noCompany), { sheetId: taylorSheet })], ["get", () => cc.getEosCycleCountSheet(CC, as(noCompany), { sheetId: taylorSheet })],
      ["list", () => cc.listEosCycleCountSheets(CC, as(noCompany), {})],
    ]) assert.equal((await noWrite(() => refusal(fn))).code, "COMPANY_AUTHORITY_REQUIRED", what);
    // Capability FIRST: a caller with neither is told about the capability, not the company.
    assert.equal((await refusal(() => cc.createEosCycleCountSheet(CC, as(noCompany, []), at))).code, "CAPABILITY_MISSING");
  });

  // ════════════════════ TRANSFERS (create, dispatch, receive, cancel, list) ════════════════════
  const W = (id) => ({ type: "WAREHOUSE", locationId: id });
  const M = (id) => ({ type: "MOBILE", locationId: id });
  const TR = { pool, postgresState: ACTIVE };
  let taylorTransfer, ventanaTransfer, crossTransfer;
  await t.test("transfers: a same-company in-scope actor creates, dispatches and receives; the cross-company actor makes the Ventana-only and the cross-company transfer", async () => {
    const made = await tr.createEosTransfer(TR, as(inCo), { partId: "PART-A", quantity: 2, origin: W("wh-t1"), destination: W("wh-t2"), idempotencyKey: "iso-tr-t" });
    assert.equal(made.outcome, "applied");
    taylorTransfer = made.transferOrderId;
    assert.equal((await tr.dispatchEosTransfer(TR, as(inCo), { transferOrderId: taylorTransfer })).outcome, "applied");
    assert.equal((await tr.receiveEosTransfer(TR, as(inCo), { transferOrderId: taylorTransfer })).outcome, "applied");
    ventanaTransfer = (await tr.createEosTransfer(TR, as(crossActor), { partId: "PART-A", quantity: 1, origin: W("wh-v"), destination: M("mob-v"), idempotencyKey: "iso-tr-v" })).transferOrderId;
    crossTransfer = (await tr.createEosTransfer(TR, as(crossActor), { partId: "PART-A", quantity: 1, origin: W("wh-v"), destination: W("wh-t1"), idempotencyKey: "iso-tr-x" })).transferOrderId;
    assert.ok(ventanaTransfer && crossTransfer);
  });

  await t.test("transfers: another company's warehouse -- as origin OR destination -- and another company's transfer read EXACTLY as nonexistent; nothing is written", async () => {
    const f = as(foreignScoped);
    const create = (over) => tr.createEosTransfer(TR, f, { partId: "PART-A", quantity: 1, origin: W("wh-t1"), destination: W("wh-t2"), idempotencyKey: `iso-tr-${randomUUID()}`, ...over });
    await noWrite(() => sameAsMissing(() => create({ origin: W("wh-v"), destination: W("wh-t1") }), () => create({ origin: W("wh-nope"), destination: W("wh-t1") }), "foreign ORIGIN"));
    await noWrite(() => sameAsMissing(() => create({ destination: W("wh-v") }), () => create({ destination: W("wh-nope") }), "foreign DESTINATION"));
    await noWrite(() => sameAsMissing(() => create({ destination: M("mob-v") }), () => create({ destination: M("mob-nope") }), "foreign TRUCK destination"));
    for (const [what, op] of [["dispatch", tr.dispatchEosTransfer], ["receive", tr.receiveEosTransfer], ["cancel", tr.cancelEosTransfer]]) {
      await noWrite(() => sameAsMissing(() => op(TR, f, { transferOrderId: ventanaTransfer }), () => op(TR, f, { transferOrderId: "trf_does_not_exist" }), what));
    }
    const list = await reads.listTransferOrders({ pool }, f, {});
    assert.equal(list.items.some((i) => i.transferOrderId === ventanaTransfer), false, "the list never carries a transfer of an unreachable company");
    // A cross-company transfer with one reachable company IS visible; its far end is not the caller's to act at.
    assert.equal(list.items.some((i) => i.transferOrderId === crossTransfer), true);
    assert.equal((await noWrite(() => refusal(() => tr.dispatchEosTransfer(TR, f, { transferOrderId: crossTransfer })))).code, "OUTSIDE_OPERATIONAL_SCOPE");
    assert.equal((await q(`SELECT status::text s FROM eos_ops.transfer_orders WHERE id = $1`, [ventanaTransfer])).rows[0].s, "REQUESTED");
  });

  await t.test("transfers: company authority without a warehouse scope is refused; no company authority is COMPANY_AUTHORITY_REQUIRED on every act and the list", async () => {
    const req = { partId: "PART-A", quantity: 1, origin: W("wh-t1"), destination: W("wh-t2"), idempotencyKey: "iso-tr-s" };
    assert.equal((await noWrite(() => refusal(() => tr.createEosTransfer(TR, as(noScope), req)))).code, "OUTSIDE_OPERATIONAL_SCOPE");
    for (const [what, fn] of [
      ["create", () => tr.createEosTransfer(TR, as(noCompany), req)], ["dispatch", () => tr.dispatchEosTransfer(TR, as(noCompany), { transferOrderId: taylorTransfer })],
      ["receive", () => tr.receiveEosTransfer(TR, as(noCompany), { transferOrderId: taylorTransfer })], ["cancel", () => tr.cancelEosTransfer(TR, as(noCompany), { transferOrderId: taylorTransfer })],
      ["list", () => reads.listTransferOrders({ pool }, as(noCompany), {})],
    ]) assert.equal((await noWrite(() => refusal(fn))).code, "COMPANY_AUTHORITY_REQUIRED", what);
  });

  // ════════════════════ RELOCATION ════════════════════
  await t.test("relocation: in-company succeeds; another company's warehouse or bin reads as nonexistent; no scope is refused; no company authority is COMPANY_AUTHORITY_REQUIRED", async () => {
    const RL = { pool, postgresState: ACTIVE };
    const move = (who, over) => reloc.relocateEosStock(RL, who, { partId: "PART-B", source: W("wh-t1"), destination: { type: "BIN", locationId: BIN_T }, quantity: 1, idempotencyKey: `iso-rl-${randomUUID()}`, ...over });
    assert.equal((await move(as(inCo))).outcome, "relocated");
    const f = as(foreignScoped);
    await noWrite(() => sameAsMissing(() => move(f, { partId: "PART-A", source: W("wh-v"), destination: { type: "BIN", locationId: BIN_V } }),
      () => move(f, { partId: "PART-A", source: W("wh-nope"), destination: { type: "BIN", locationId: "bin_nope" } }), "foreign source and destination"));
    await noWrite(() => sameAsMissing(() => move(f, { partId: "PART-A", destination: { type: "BIN", locationId: BIN_V } }),
      () => move(f, { partId: "PART-A", destination: { type: "BIN", locationId: "bin_nope" } }), "foreign destination bin"));
    assert.equal((await noWrite(() => refusal(() => move(as(noScope))))).code, "OUTSIDE_OPERATIONAL_SCOPE");
    assert.equal((await noWrite(() => refusal(() => move(as(noCompany))))).code, "COMPANY_AUTHORITY_REQUIRED");
    assert.equal((await refusal(() => move(as(noCompany, [])))).code, "CAPABILITY_MISSING", "capability first");
  });

  // ════════════════════ PLACEMENT / PUT-AWAY ════════════════════
  await t.test("put-away: in-company succeeds; another company's warehouse reads as nonexistent; no scope is refused; no company authority is COMPANY_AUTHORITY_REQUIRED", async () => {
    const PL = { pool, postgresState: ACTIVE };
    const put = (who, over) => plc.recordEosPutAway(PL, who, { warehouseId: "wh-t1", partId: "PART-B", binId: BIN_T, quantity: 1, idempotencyKey: `iso-pl-${randomUUID()}`, ...over });
    assert.equal((await put(as(inCo))).outcome, "recorded");
    const f = as(foreignScoped);
    await noWrite(() => sameAsMissing(() => put(f, { warehouseId: "wh-v", partId: "PART-A", binId: BIN_V }), () => put(f, { warehouseId: "wh-nope", partId: "PART-A", binId: BIN_V }), "foreign warehouse"));
    assert.equal((await noWrite(() => refusal(() => put(as(noScope))))).code, "OUTSIDE_OPERATIONAL_SCOPE");
    assert.equal((await noWrite(() => refusal(() => put(as(noCompany))))).code, "COMPANY_AUTHORITY_REQUIRED");
  });

  // ════════════════════ REORDER RECEIVING (+ receipt correction) ════════════════════
  let taylorReceipt, ventanaReceipt;
  const chain = async (id, key, warehouseId, partId = "PART-A") => {
    await q(`INSERT INTO eos_ops.reorder_requests (id, tenant_id, operating_company_key, part_id, warehouse_id, status, requested_quantity, requested_by, updated_by, provenance)
             VALUES ($1,'t1',$2,$3,$4,'ORDERED',4,$5,$5,'NATIVE')`, [id, key, partId, warehouseId, inCo]);
    await q(`INSERT INTO eos_ops.purchase_orders (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number, ordered_quantity, ordered_date, created_by)
             VALUES ($1,'t1',$2,$3,'Acme Supply','PO-EXT-1',4, DATE '2026-09-01',$4)`, [id, key, partId, inCo]);
    return id;
  };
  const receipt = (id, wh, partId = "PART-A", over = {}) => ({
    source: { type: "REORDER_PURCHASE_ORDER", reorderRequestId: id, purchaseOrderId: id }, receivingLocation: { type: "WAREHOUSE", locationId: wh },
    lines: [{ lineId: "L1", partId, receivedQuantity: 4 }], idempotencyKey: `idem-${id}`, ...over });
  await t.test("reorder receiving: in-company succeeds; another company's Reorder or destination reads as nonexistent; no scope is refused; no company authority is COMPANY_AUTHORITY_REQUIRED", async () => {
    const rrT = await chain("rr-t", "taylor-co", "wh-t1");
    const rrV = await chain("rr-v", "ventana-co", "wh-v");
    const got = await rcv.receiveReorderStock({ pool }, as(inCo), receipt(rrT, "wh-t1"));
    assert.equal(got.outcome, "applied");
    taylorReceipt = got.receivingId;
    const f = as(foreignScoped);
    await noWrite(() => sameAsMissing(() => rcv.receiveReorderStock({ pool }, f, receipt(rrV, "wh-v")), () => rcv.receiveReorderStock({ pool }, f, receipt("rr-nope", "wh-v")), "foreign Reorder", [rrV, "rr-nope"]));
    // Own Reorder, but the destination is another company's warehouse: reads as a nonexistent destination.
    const rrT2 = await chain("rr-t2", "taylor-co", "wh-t1");
    await noWrite(() => sameAsMissing(() => rcv.receiveReorderStock({ pool }, f, receipt(rrT2, "wh-v")), () => rcv.receiveReorderStock({ pool }, f, receipt(rrT2, "wh-nope")), "foreign destination"));
    assert.equal((await noWrite(() => refusal(() => rcv.receiveReorderStock({ pool }, as(noScope), receipt(rrT2, "wh-t1"))))).code, "OUTSIDE_OPERATIONAL_SCOPE");
    assert.equal((await noWrite(() => refusal(() => rcv.receiveReorderStock({ pool }, as(noCompany), receipt(rrT2, "wh-t1"))))).code, "COMPANY_AUTHORITY_REQUIRED");
    assert.equal((await refusal(() => rcv.receiveReorderStock({ pool }, as(noCompany, []), receipt(rrT2, "wh-t1")))).code, "CAPABILITY_REQUIRED", "capability first");
    ventanaReceipt = (await rcv.receiveReorderStock({ pool }, as(crossActor), receipt(rrV, "wh-v"))).receivingId;
    assert.ok(ventanaReceipt);
  });

  await t.test("receipt correction: another company's receipt reads as nonexistent; the replay probe runs only after the company filter, the lock and the scope check", async () => {
    const f = as(foreignScoped);
    const input = (id) => ({ receivingId: id, correction: "VOID", reason: "wrong delivery", idempotencyKey: `iso-corr-${randomUUID()}` });
    await noWrite(() => sameAsMissing(() => corr.correctReorderReceipt({ pool }, f, input(ventanaReceipt)), () => corr.correctReorderReceipt({ pool }, f, input("rcv_does_not_exist")), "foreign receipt"));
    assert.equal((await noWrite(() => refusal(() => corr.correctReorderReceipt({ pool }, as(noCompany), input(taylorReceipt))))).code, "COMPANY_AUTHORITY_REQUIRED");
    assert.equal((await noWrite(() => refusal(() => corr.correctReorderReceipt({ pool }, as(noScope), input(taylorReceipt))))).code, "OUTSIDE_OPERATIONAL_SCOPE");
    // The same-company, in-scope actor voids its own receipt; the same key + request replays and writes nothing.
    const body = input(taylorReceipt);
    const done = await corr.correctReorderReceipt({ pool }, as(inCo), body);
    assert.equal(done.outcome, "applied");
    const before = await counts();
    assert.equal((await corr.correctReorderReceipt({ pool }, as(inCo), body)).outcome, "replayed");
    assert.deepEqual(await counts(), before, "a replay writes nothing");
    // A caller outside the company cannot probe that key: it never reaches the replay (the receipt is nonexistent to it).
    await noWrite(() => sameAsMissing(() => corr.correctReorderReceipt({ pool }, f, { ...body, receivingId: ventanaReceipt }), () => corr.correctReorderReceipt({ pool }, f, input("rcv_does_not_exist")), "foreign replay probe"));
  });

  // ════════════════════ READS ════════════════════
  await t.test("reads: a company-scoped caller sees only its own companies' stock, movements, warehouses, locations, transfers, trucks and receipts", async () => {
    const f = as(foreignScoped);
    const onHand = await reads.readInventoryOnHand({ pool }, f, {});
    assert.deepEqual(onHand.scopedWarehouseIds, ["wh-t1"], "the scope never names the other company's warehouse");
    assert.equal(onHand.rows.some((r) => r.warehouseId === "wh-v" || r.locationId === "mob-v"), false);
    assert.deepEqual((await reads.readInventoryOnHand({ pool }, f, { warehouseId: "wh-v" })).rows, []);
    assert.equal((await reads.readInventoryMovements({ pool }, f, {})).items.some((m) => m.warehouseId === "wh-v"), false);
    const warehouses = (await reads.listInventoryWarehouses({ pool }, f, {})).items.map((w) => w.warehouseId);
    assert.deepEqual(warehouses, ["wh-t1"]);
    assert.deepEqual((await reads.listInventoryLocations({ pool }, f, { warehouseId: "wh-v" })).items, []);
    assert.equal((await reads.listInventoryLocations({ pool }, f, {})).items.some((l) => l.locationId === "mob-v" || l.warehouseId === "wh-v"), false);
    const roster = await reads.listTruckRoster({ pool }, f, {});
    assert.deepEqual(roster.trucks.map((x) => x.truckId), ["trk-t"], "the roster carries only the caller's companies' trucks");
    await sameAsMissing(() => reads.readTruckStock({ pool }, f, { mobileLocationId: "mob-v" }), () => reads.readTruckStock({ pool }, f, { mobileLocationId: "mob-nope" }), "foreign truck");
    assert.equal((await reads.listReceipts({ pool }, f, {})).items.some((r) => r.receiptId === ventanaReceipt), false);
    await sameAsMissing(() => reads.readReceipt({ pool }, f, { receiptId: ventanaReceipt }), () => reads.readReceipt({ pool }, f, { receiptId: "rcv_does_not_exist" }), "foreign receipt");
    const rrV2 = await chain("rr-v2", "ventana-co", "wh-v");
    await sameAsMissing(() => reads.listReceivingLocationOptions({ pool }, f, { reorderRequestId: rrV2 }), () => reads.listReceivingLocationOptions({ pool }, f, { reorderRequestId: "rr-nope" }), "foreign Reorder destinations");
    assert.equal((await reads.readPartBalance({ pool }, f, { partId: "PART-A" })).scopedWarehouseIds.includes("wh-v"), false);
  });

  await t.test("reads: the same-company in-scope caller sees its own; a caller with company authority and no scope sees nothing; no company authority is COMPANY_AUTHORITY_REQUIRED on every read", async () => {
    const mine = as(inCo);
    assert.ok((await reads.readInventoryOnHand({ pool }, mine, {})).rows.some((r) => r.warehouseId === "wh-t1"));
    assert.ok((await reads.listInventoryWarehouses({ pool }, mine, {})).items.some((w) => w.warehouseId === "wh-t1"));
    assert.ok((await reads.listTransferOrders({ pool }, mine, {})).items.some((i) => i.transferOrderId === taylorTransfer));
    assert.ok((await reads.listTruckRoster({ pool }, mine, {})).trucks.some((x) => x.truckId === "trk-t"));
    assert.equal((await reads.readTruckStock({ pool }, mine, { mobileLocationId: "mob-t" })).truck.mobileLocationId, "mob-t");
    assert.deepEqual((await reads.readInventoryOnHand({ pool }, as(noScope), {})).rows, []);
    assert.deepEqual((await reads.listInventoryWarehouses({ pool }, as(noScope), {})).items, []);
    const nc = as(noCompany);
    for (const [what, fn] of [
      ["readInventoryOnHand", () => reads.readInventoryOnHand({ pool }, nc, {})], ["readInventoryMovements", () => reads.readInventoryMovements({ pool }, nc, {})],
      ["listInventoryWarehouses", () => reads.listInventoryWarehouses({ pool }, nc, {})], ["listInventoryLocations", () => reads.listInventoryLocations({ pool }, nc, {})],
      ["listTransferOrders", () => reads.listTransferOrders({ pool }, nc, {})], ["listTruckRoster", () => reads.listTruckRoster({ pool }, nc, {})],
      ["readTruckStock", () => reads.readTruckStock({ pool }, nc, { mobileLocationId: "mob-t" })], ["listReceipts", () => reads.listReceipts({ pool }, nc, {})],
      ["readReceipt", () => reads.readReceipt({ pool }, nc, { receiptId: taylorReceipt })], ["listReceivingLocationOptions", () => reads.listReceivingLocationOptions({ pool }, nc, { reorderRequestId: "rr-t2" })],
      ["readPartBalance", () => reads.readPartBalance({ pool }, nc, { partId: "PART-A" })],
    ]) assert.equal((await refusal(fn)).code, "COMPANY_AUTHORITY_REQUIRED", what);
    assert.equal((await refusal(() => reads.readInventoryOnHand({ pool }, as(noCompany, []), {}))).code, "CAPABILITY_MISSING", "capability first");
  });

  await t.test("transfer workspace names: companyWide lists every warehouse of the caller's companies (in scope or not), never another company's, and needs a transfer capability", async () => {
    // Scoped at wh-t1 (and at the OTHER company's wh-v): every Taylor warehouse is NAMED with its scope mark, and the other company's is absent.
    const out = await reads.listInventoryWarehouses({ pool }, as(foreignScoped, ["warehouse.transferOrder.read"]), { companyWide: true });
    assert.deepEqual(out.items.map((w) => [w.warehouseId, w.status, w.inScope]), [["wh-t1", "ACTIVE", true], ["wh-t2", "ACTIVE", false]]);
    // A closed warehouse of the caller's own company is not offered (ACTIVE only).
    await q(`INSERT INTO eos_ops.warehouses (id, tenant_id, operating_company_key, name, site_label, status, provenance, created_by, updated_by)
             VALUES ('wh-closed','t1','taylor-co','wh-closed','Sampleton','INACTIVE','NATIVE','fixture','fixture')`);
    const withClosed = await reads.listInventoryWarehouses({ pool }, as(foreignScoped, ["warehouse.transferOrder.read"]), { companyWide: true });
    assert.deepEqual(withClosed.items.map((w) => w.warehouseId), ["wh-t1", "wh-t2"], "an INACTIVE warehouse is not returned");
    const mine = await reads.listInventoryWarehouses({ pool }, as(inCo, ["inventory.transfer.create"]), { companyWide: true });
    assert.deepEqual(mine.items.map((w) => [w.warehouseId, w.inScope]), [["wh-t1", true], ["wh-t2", true]]);
    assert.equal((await refusal(() => reads.listInventoryWarehouses({ pool }, as(inCo, ["warehouse.record.read"]), { companyWide: true }))).code, "CAPABILITY_MISSING");
    assert.equal((await refusal(() => reads.listInventoryWarehouses({ pool }, as(noCompany), { companyWide: true }))).code, "COMPANY_AUTHORITY_REQUIRED");
    assert.equal((await refusal(() => reads.listInventoryWarehouses({ pool }, as(inCo), { companyWide: "yes" }))).code, "COMPANY_WIDE_INVALID");
    // createTransfer accepts exactly this destination: an ACTIVE warehouse of the caller's company where the caller holds NO warehouse scope.
    const nowhere = await person({ scopes: ["wh-t1"] });
    const made = await tr.createEosTransfer(TR, as(nowhere), { partId: "PART-A", quantity: 1, origin: W("wh-t1"), destination: W("wh-t2"), idempotencyKey: "iso-tr-dest" });
    assert.equal(made.outcome, "applied");
  });

  // ════════════════════ IDEMPOTENCY KEYS: a replay or a conflict never answers for another company ════════════════════
  await t.test("transfer create: replaying a transfer whose destination the caller cannot name reads EXACTLY like a fresh key; a key another company holds is the ordinary conflict", async () => {
    const f = as(foreignScoped);
    const body = { partId: "PART-A", quantity: 1, origin: W("wh-t1"), destination: W("wh-v") };
    // A Taylor-origin transfer INTO Ventana's warehouse, made by the actor who reaches both companies, under a known key.
    const made = await tr.createEosTransfer(TR, as(crossActor), { ...body, idempotencyKey: "iso-tr-replay" });
    assert.equal(made.outcome, "applied");
    // The scoped Taylor actor repeats the EXACT body and key: the destination is validated first, so this is the fresh-key refusal -- not 'replayed', no id, no number.
    await noWrite(() => sameAsMissing(() => tr.createEosTransfer(TR, f, { ...body, idempotencyKey: "iso-tr-replay" }),
      () => tr.createEosTransfer(TR, f, { ...body, idempotencyKey: `iso-tr-fresh-${randomUUID()}` }), "replay of a foreign-destination transfer == fresh key"));
    // A key held by a transfer of a company the caller does not reach (the Ventana-only transfer made above): a clean key conflict, never that transfer's data.
    const err = await noWrite(() => refusal(() => tr.createEosTransfer(TR, as(inCo), { partId: "PART-A", quantity: 1, origin: W("wh-t1"), destination: W("wh-t2"), idempotencyKey: "iso-tr-v" })));
    assert.deepEqual([err.code, err.category], ["IDEMPOTENCY_CONFLICT", "CONFLICT"]);
  });

  await t.test("receipt correction: a key another company's correction already holds is refused cleanly BEFORE any work -- for the caller's own valid receipt", async () => {
    const key = "iso-corr-shared-key";
    const voided = await corr.correctReorderReceipt({ pool }, as(crossActor), { receivingId: ventanaReceipt, correction: "VOID", reason: "wrong delivery", idempotencyKey: key });
    assert.equal(voided.outcome, "applied");
    const rrOwn = await chain("rr-t-own", "taylor-co", "wh-t1");
    const own = (await rcv.receiveReorderStock({ pool }, as(inCo), receipt(rrOwn, "wh-t1"))).receivingId;
    const err = await noWrite(() => refusal(() => corr.correctReorderReceipt({ pool }, as(inCo), { receivingId: own, correction: "VOID", reason: "wrong delivery", idempotencyKey: key })));
    assert.deepEqual([err.code, err.category], ["IDEMPOTENCY_CONFLICT", "CONFLICT"], "a governed refusal, not a raw unique violation");
    assert.equal((await q(`SELECT status::text s FROM eos_ops.receiving_orders WHERE id = $1`, [own])).rows[0].s !== "CANCELLED", true, "the caller's own receipt is untouched");
    // Same shape as an ordinary conflict on the caller's OWN key (a different request under it).
    const mineKey = `iso-corr-mine-${randomUUID()}`;
    assert.equal((await corr.correctReorderReceipt({ pool }, as(inCo), { receivingId: own, correction: "VOID", reason: "first", idempotencyKey: mineKey })).outcome, "applied");
    const ordinary = await refusal(() => corr.correctReorderReceipt({ pool }, as(inCo), { receivingId: own, correction: "VOID", reason: "a different reason", idempotencyKey: mineKey }));
    assert.deepEqual([err.code, err.category, err.message], [ordinary.code, ordinary.category, ordinary.message]);
  });

  await t.test("Reorder receipt, cycle count, put-away and relocation: a key another company used is the ordinary key conflict -- never its data, never a lock", async () => {
    // Reorder receipt: the receipt id derives from the key alone, so Ventana's receipt sits under 'idem-rr-v'.
    const rrMine = await chain("rr-t-key", "taylor-co", "wh-t1");
    const r1 = await noWrite(() => refusal(() => rcv.receiveReorderStock({ pool }, as(inCo), receipt(rrMine, "wh-t1", "PART-A", { idempotencyKey: "idem-rr-v" }))));
    assert.deepEqual([r1.code, r1.category], ["IDEMPOTENCY_CONFLICT", "CONFLICT"]);
    // Cycle count: Ventana's sheet holds 'iso-cc-v'.
    const c1 = await noWrite(() => refusal(() => cc.createEosCycleCountSheet(CC, as(inCo), { location: { type: "WAREHOUSE", locationId: "wh-t1" }, idempotencyKey: "iso-cc-v" })));
    assert.deepEqual([c1.code, c1.category], ["IDEMPOTENCY_CONFLICT", "CONFLICT"]);
    // Relocation and put-away: made in Ventana's warehouse by the cross-company actor, then the same keys from Taylor.
    const RL = { pool, postgresState: ACTIVE };
    const PL = { pool, postgresState: ACTIVE };
    assert.equal((await reloc.relocateEosStock(RL, as(crossActor), { partId: "PART-A", source: W("wh-v"), destination: { type: "BIN", locationId: BIN_V }, quantity: 1, idempotencyKey: "iso-rl-x" })).outcome, "relocated");
    const l1 = await noWrite(() => refusal(() => reloc.relocateEosStock(RL, as(inCo), { partId: "PART-B", source: W("wh-t1"), destination: { type: "BIN", locationId: BIN_T }, quantity: 1, idempotencyKey: "iso-rl-x" })));
    assert.deepEqual([l1.code, l1.category], ["IDEMPOTENCY_CONFLICT", "CONFLICT"]);
    assert.equal((await plc.recordEosPutAway(PL, as(crossActor), { warehouseId: "wh-v", partId: "PART-A", binId: BIN_V, quantity: 1, idempotencyKey: "iso-pl-x" })).outcome, "recorded");
    const p1 = await noWrite(() => refusal(() => plc.recordEosPutAway(PL, as(inCo), { warehouseId: "wh-t1", partId: "PART-A", binId: BIN_T, quantity: 1, idempotencyKey: "iso-pl-x" })));
    assert.deepEqual([p1.code, p1.category], ["IDEMPOTENCY_CONFLICT", "CONFLICT"]);
  });

  await t.test("transfer receive: a Technician's truck path is held to the truck's company too (a transfer into another company's truck is refused)", async () => {
    const tech = await person({ eligibility: false, scopes: [] });
    const techEmployee = (await q(`SELECT employee_id FROM eos_policy.employee_principal_links WHERE principal_id = $1`, [tech])).rows[0].employee_id;
    await q(`INSERT INTO eos_workforce.employee_work_eligibility (id, tenant_id, employee_id, qualification_code, effective_from, assigned_by)
             VALUES ('we-iso-tech','t1',$1,'SERVICE_TECHNICIAN', now(), 'fixture')`, [techEmployee]);
    await q(`INSERT INTO eos_workforce.employee_operational_scopes (id, tenant_id, employee_id, scope_type, scope_id, effective_from, assigned_by)
             VALUES ('os-iso-tech-mob','t1',$1,'MOBILE','mob-t', now(), 'fixture')`, [techEmployee]);
    const t0 = as(tech, ["inventory.transfer.receive"]);
    // Taylor stock sent to Ventana's truck by the actor who reaches both: visible to the Taylor technician (its source company), but its destination truck is not theirs.
    const toForeignTruck = (await tr.createEosTransfer(TR, as(crossActor), { partId: "PART-A", quantity: 1, origin: W("wh-t1"), destination: M("mob-v"), idempotencyKey: "iso-tr-tech" })).transferOrderId;
    const e1 = await noWrite(() => refusal(() => tr.receiveEosTransfer(TR, t0, { transferOrderId: toForeignTruck })));
    assert.equal(e1.code, "OUTSIDE_OPERATIONAL_SCOPE");
    // A transfer between Ventana places only (neither company reachable) reads as nonexistent to the technician.
    await noWrite(() => sameAsMissing(() => tr.receiveEosTransfer(TR, t0, { transferOrderId: ventanaTransfer }), () => tr.receiveEosTransfer(TR, t0, { transferOrderId: "trf_does_not_exist" }), "technician, foreign-only transfer"));
    // The technician's own company's truck still works the same path: a transfer into mob-t is refused only for the ordinary reasons (status), not for company.
    const intoOwnTruck = (await tr.createEosTransfer(TR, as(inCo), { partId: "PART-A", quantity: 1, origin: W("wh-t1"), destination: M("mob-t"), idempotencyKey: "iso-tr-own-truck" })).transferOrderId;
    const e2 = await refusal(() => tr.receiveEosTransfer(TR, t0, { transferOrderId: intoOwnTruck }));
    assert.equal(e2.code, "STATUS_INVALID", "past company and scope: only the transfer's state refuses");
  });

  // ════════════════════ ROOT CAUSE OF S1: the Administration command no longer CREATES a cross-company scope ════════════════════
  await t.test("assignEmployeeOperationalScope refuses a WAREHOUSE (and MOBILE) scope in a company the Employee has no company authority in; the picker excludes it; existing rows are untouched", async () => {
    const adminP = await person({ employee: false });
    const grants = (keys) => {
      const caps = new Set(keys);
      return { tenantId: T, principalId: adminP, capabilities: caps,
        entitlements: async () => entitlement.entitlementsFrom([...caps].map((capabilityKey) => ({ grantor: { kind: "ROLE", roleKey: "admin" }, capabilityKey }))) };
    };
    const writer = grants(["admin.employeeOperationalScope.write"]);
    const reader = grants(["employee.record.read"]);
    const employeeOf = async (principalId) => (await q(`SELECT employee_id FROM eos_policy.employee_principal_links WHERE principal_id = $1`, [principalId])).rows[0].employee_id;
    const taylorOnly = await person({});
    const taylorOnlyId = await employeeOf(taylorOnly);
    const assign = (employeeId, scopeType, scopeId) => scopeCommands.assignEmployeeOperationalScope({ pool }, writer, { employeeId, scopeType, scopeId, reason: "iso" });
    const scopeRows = async (employeeId) => Number((await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes WHERE employee_id = $1`, [employeeId])).rows[0].n);

    // The existing cross-company row (the Noor case) is neither changed nor ended by any of this: it is inert, not revoked.
    const foreignEmployee = await employeeOf(foreignScoped);
    const heldBefore = await scopeRows(foreignEmployee);
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes WHERE employee_id = $1 AND scope_id = 'wh-v' AND effective_to IS NULL`, [foreignEmployee])).rows[0].n, 1);

    // The picker, for THIS Employee: Taylor's warehouses only, and no Ventana truck. Without an employee it is unchanged (everything governed).
    const targets = async (input) => (await scopeReads.listOperationalScopeTargets({ pool }, reader, input)).scopeTypes;
    const valuesOf = (types, type) => types.find((x) => x.scopeType === type).values.map((v) => v.value).sort();
    assert.deepEqual(valuesOf(await targets({ employeeId: taylorOnlyId }), "WAREHOUSE"), ["wh-t1", "wh-t2"], "the other company's warehouse is not offered");
    assert.deepEqual(valuesOf(await targets({ employeeId: taylorOnlyId }), "MOBILE"), ["mob-t"], "nor its truck");
    assert.deepEqual(valuesOf(await targets({}), "WAREHOUSE"), ["wh-t1", "wh-t2", "wh-v"], "unchanged without an employee");

    // The command: refused with a stated reason, nothing written.
    const refusedScope = await refusal(() => assign(taylorOnlyId, "WAREHOUSE", "wh-v"));
    assert.equal(refusedScope.code, "WAREHOUSE_COMPANY_NOT_AUTHORIZED");
    assert.equal((await refusal(() => assign(taylorOnlyId, "MOBILE", "mob-v"))).code, "MOBILE_LOCATION_COMPANY_MISMATCH");
    assert.equal(await scopeRows(taylorOnlyId), 0, "no scope row was written");
    assert.equal((await assign(taylorOnlyId, "WAREHOUSE", "wh-t2")).outcome, "ASSIGNED", "the Employee's own company is unchanged");

    // With explicit company authority over Ventana (the same authority reads and commands decide on) the same scope is accepted and offered.
    const cross = await person({});
    await grantSyntheticCompanyAuthority(pool, T, cross, ["taylor", "ventana"]);
    const crossId = await employeeOf(cross);
    assert.deepEqual(valuesOf(await targets({ employeeId: crossId }), "WAREHOUSE"), ["wh-t1", "wh-t2", "wh-v"]);
    assert.equal((await assign(crossId, "WAREHOUSE", "wh-v")).outcome, "ASSIGNED");

    assert.equal(await scopeRows(foreignEmployee), heldBefore, "an existing scope row is never changed or ended");
    assert.equal((await q(`SELECT count(*)::int n FROM eos_workforce.employee_operational_scopes WHERE employee_id = $1 AND scope_id = 'wh-v' AND effective_to IS NULL`, [foreignEmployee])).rows[0].n, 1);
  });
});
