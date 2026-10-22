// PARTS-404 / RO-02 (Owner ruling, 2026-10-21): offline guards for the Warehouse Manager reorder-read authorization.
//   - the grant is ONE Administration operation, to ONE Role, for the existing capability, with the ruling cited;
//   - the additive WAREHOUSE read reach is one rule (in memory and as SQL) and fails closed;
//   - the management commands and the Purchase Order measure were NOT widened (static, so a later edit cannot do it quietly).
// The behaviour against a real database is warehouseManagerReorderReadPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(join(FN, "src", rel), "utf8");
const delta = require("../lib/adminPolicy/warehouseManagerReorderReadDelta.js");
const reach = require("../lib/eosOps/reorderQueueReach.js");

test("the grant: one operation, Warehouse Manager, reorder.request.read, the ruling cited, no migration", () => {
  const ops = delta.warehouseManagerReorderReadOperations();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].operation, "grantObjectActionToRole");
  assert.deepEqual({ ...ops[0].input, reason: undefined }, { roleKey: "warehouseManager", objectKey: "reorderRequest", actionKey: "read", reason: undefined });
  assert.match(ops[0].input.reason, /PARTS-404 \/ RO-02/);
  // The Object/Action is the one migration 1761696000000 registered for reorder.request.read.
  const migration = readFileSync(join(FN, "migrations", "1761696000000_parts-associate-eligibility-and-reorder-queue-scope.sql"), "utf8");
  assert.match(migration, /'reorder\.request\.read',[\s\S]*?'reorderRequest', 'read'/);
});

test("queue read reach: company reach OR a scoped, in-authority warehouse of the same company -- nothing else", () => {
  const r = { companyKeys: ["taylor"], warehouseIds: ["wh-a"], warehouseCompanyKeys: ["taylor"] };
  assert.equal(reach.reorderInReadReach(r, "taylor", "wh-b"), true, "the company queue reaches every warehouse of its company (unchanged)");
  const wh = { companyKeys: [], warehouseIds: ["wh-a"], warehouseCompanyKeys: ["taylor"] };
  assert.equal(reach.reorderInReadReach(wh, "taylor", "wh-a"), true);
  assert.equal(reach.reorderInReadReach(wh, "taylor", "wh-b"), false, "a sibling warehouse of the same company");
  assert.equal(reach.reorderInReadReach(wh, "ventana", "wh-a"), false, "a request whose company is outside the authority the warehouses were restricted to");
  assert.equal(reach.reorderInReadReach(wh, "taylor", null), false);
  assert.equal(reach.reorderInReadReach({ companyKeys: [], warehouseIds: [], warehouseCompanyKeys: [] }, "taylor", "wh-a"), false, "no scope, no authority: nothing");
});

test("the SQL form binds the same three lists", () => {
  const sql = reach.reorderReadReachSql("r", { company: 7, warehouse: 8, warehouseCompany: 9 });
  assert.match(sql, /r\.operating_company_key = ANY\(\$7::text\[\]\)/);
  assert.match(sql, /r\.warehouse_id = ANY\(\$8::text\[\]\) AND r\.operating_company_key = ANY\(\$9::text\[\]\)/);
});

test("the management commands and the Purchase Order measure were NOT widened (static)", () => {
  const lifecycle = src("eosOps/reorderLifecycleCommands.ts");
  // Review / cancel / assign / void decide on queueReachKeys, exactly as before.
  const lock = lifecycle.slice(lifecycle.indexOf("async function lockReorderInQueueReach"), lifecycle.indexOf("async function audit("));
  assert.match(lock, /queueReachKeys\(client, actor\)/);
  assert.doesNotMatch(lock, /queueReadReach/);
  assert.match(src("eosOps/reorderAssignmentAuthority.ts"), /queueReachKeys\(client, actor\)/);
  assert.doesNotMatch(src("eosOps/reorderAssignmentAuthority.ts"), /queueReadReach/);
  const voidFn = lifecycle.slice(lifecycle.indexOf("OUTSIDE_VOID_REACH") - 600, lifecycle.indexOf("OUTSIDE_VOID_REACH") + 100);
  assert.match(voidFn, /queueReachKeys\(deps\.pool, actor\)/);
  // The READ of a request's Purchase Orders is not among the five reads the ruling lists.
  const poRead = lifecycle.slice(lifecycle.indexOf("export async function readReorderPurchaseOrders"), lifecycle.indexOf("SELECT p.id, p.part_id, p.supplier_name"));
  assert.match(poRead, /queueReachKeys\(deps\.pool, actor\)/);
  // Only the Reorder REQUEST measure carries warehouseReach.
  const measures = src("eosAnalysis/measures.ts");
  assert.equal((measures.match(/warehouseReach: true/g) ?? []).length, 1);
  assert.match(measures, /id: "purchasing\.reorders\.open"[\s\S]*?warehouseReach: true/);
  assert.doesNotMatch(measures.slice(measures.indexOf('id: "purchasing.orders.placed"'), measures.indexOf('id: "purchasing.receipts.received"')), /warehouseReach/);
});

test("the warehouse basis is earned by reorder.request.read alone, decided inside the helper (static + pure)", async () => {
  const text = src("eosOps/reorderQueueReach.ts");
  const fn = text.slice(text.indexOf("export async function warehouseReadReach"), text.indexOf("export async function queueReadReach"));
  assert.ok(fn.includes("capabilities.has(REORDER_READ_CAPABILITY)"));
  // A db that must never be touched: with no read capability the helper returns before any query.
  const db = { query: async () => { throw new Error("queried"); } };
  for (const capabilities of [undefined, new Set(), new Set(["reorder.purchaseOrder.read"])]) {
    const r = await reach.warehouseReadReach(db, { tenantId: "t", principalId: "p", capabilities });
    assert.deepEqual([r.warehouseIds, r.warehouseCompanyKeys], [[], []]);
  }
});
