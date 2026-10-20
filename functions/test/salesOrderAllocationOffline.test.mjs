// SALES ORDER ALLOCATION -- the parts that need no database (S1c; DECISIONS #S1c): the closed vocabulary, the operations' place on the Operations
// transport, capability FIRST, every shape refusal before the first query, and the structural boundaries of the lane (consume is not here, Work
// Order dispatch is not wired, nothing writes the movement ledger, a Sales Order cancel releases in its own transaction). The transactional behaviour
// -- company / warehouse / scope, the line and quantity bound, no oversell, replay, release, audit -- is salesOrderAllocationPostgres.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "..", "src");
const alloc = require("../lib/eosOps/salesOrderAllocation.js");
const http = require("../lib/eosOps/eosOpsHttp.js");

// A pool that must never be touched: every refusal asserted below happens before the first query.
const untouchable = { connect() { throw new Error("the database must not be reached"); }, query() { throw new Error("the database must not be reached"); } };
const actor = (caps) => ({ tenantId: "t1", principalId: "p1", capabilities: new Set(caps) });
const refusal = async (fn) => { try { await fn(); } catch (err) { return err; } assert.fail("expected a refusal"); };
const FULFILL = "salesOrder.fulfill";
const ok = { salesOrderId: "so-1", lineNumber: 1, operatingCompanyId: "co-a-id", warehouseId: "wh-1", partId: "P-1", quantity: 2, idempotencyKey: "k-1" };

test("the capability is salesOrder.fulfill; an order is open to allocation in CONFIRMED and IN_FULFILLMENT only; a claim ends in CANCELLED, FULFILLED, CLOSED", () => {
  assert.equal(alloc.SALES_ORDER_FULFILL_CAPABILITY, "salesOrder.fulfill");
  assert.deepEqual([...alloc.ALLOCATABLE_ORDER_STATES], ["CONFIRMED", "IN_FULFILLMENT"]);
  assert.deepEqual([...alloc.CLAIM_ENDING_ORDER_STATES], ["CANCELLED", "FULFILLED", "CLOSED"]);
  for (const live of alloc.ALLOCATABLE_ORDER_STATES) assert.ok(!alloc.CLAIM_ENDING_ORDER_STATES.includes(live), `${live} must not end the claim`);
});

test("the three operations are served on /operations/inventory, behind the Reorder activation boundary", () => {
  for (const op of ["allocateSalesOrderLine", "releaseSalesOrderAllocation"]) {
    assert.ok(http.OPERATIONS_MUTATION_OPERATIONS.includes(op), op);
    assert.equal(http.OPERATIONS_ROUTE_BY_OPERATION[op], "/operations/inventory", op);
  }
  assert.ok(http.OPERATIONS_READ_OPERATIONS.includes("readSalesOrderAllocations"));
  assert.equal(http.OPERATIONS_ROUTE_BY_OPERATION.readSalesOrderAllocations, "/operations/inventory");
  assert.deepEqual(Object.keys(alloc.EOS_SALES_ORDER_ALLOCATION_OPERATIONS).sort(), ["allocateSalesOrderLine", "readSalesOrderAllocations", "releaseSalesOrderAllocation"]);
});

test("capability first: allocate and release refuse a caller without salesOrder.fulfill before the database is touched", async () => {
  for (const caps of [[], ["salesOrder.read"], ["salesOrder.write"], ["inventory.stock.receive"]]) {
    for (const fn of [
      () => alloc.allocateSalesOrderLine({ pool: untouchable }, actor(caps), ok),
      () => alloc.releaseSalesOrderAllocation({ pool: untouchable }, actor(caps), { ...ok, reason: "r", partId: undefined, quantity: undefined }),
    ]) {
      const err = await refusal(fn);
      assert.deepEqual([err.code, err.category], ["CAPABILITY_REQUIRED", "FORBIDDEN"]);
    }
  }
  // The read is open to salesOrder.fulfill OR salesOrder.read; a holder of neither is refused first.
  const err = await refusal(() => alloc.readSalesOrderAllocations({ pool: untouchable }, actor(["salesOrder.write"]), { salesOrderId: "so-1" }));
  assert.deepEqual([err.code, err.category], ["CAPABILITY_REQUIRED", "FORBIDDEN"]);
});

test("an actor without a resolved tenant, principal and capability SET is refused before anything else", async () => {
  for (const bad of [null, {}, { tenantId: "t1", principalId: "p1", capabilities: [FULFILL] }, { tenantId: "", principalId: "p1", capabilities: new Set([FULFILL]) }]) {
    assert.equal((await refusal(() => alloc.allocateSalesOrderLine({ pool: untouchable }, bad, ok))).code, "ACTOR_CONTEXT_REQUIRED");
  }
});

test("shape: every malformed allocate is refused before the database, with its own code (company and warehouse are STATED, never defaulted)", async () => {
  const a = actor([FULFILL]);
  const code = async (over) => (await refusal(() => alloc.allocateSalesOrderLine({ pool: untouchable }, a, { ...ok, ...over }))).code;
  assert.equal(await code({ operatingCompanyId: undefined }), "OPERATINGCOMPANYID_INVALID", "no company");
  assert.equal(await code({ warehouseId: undefined }), "WAREHOUSEID_INVALID", "no warehouse");
  assert.equal(await code({ warehouseId: "" }), "WAREHOUSEID_INVALID");
  assert.equal(await code({ partId: undefined }), "PARTID_INVALID");
  assert.equal(await code({ salesOrderId: "a/b" }), "SALESORDERID_INVALID");
  for (const lineNumber of [0, -1, 1.5, "1", null, undefined]) assert.equal(await code({ lineNumber }), "LINENUMBER_INVALID", String(lineNumber));
  for (const quantity of [0, -3, 1.5, "2", null, undefined, 2_000_000_001]) assert.equal(await code({ quantity }), "QUANTITY_INVALID", String(quantity));
  for (const idempotencyKey of [undefined, "", "  ", " k", "x".repeat(151), 7]) assert.equal(await code({ idempotencyKey }), "IDEMPOTENCY_KEY_INVALID", String(idempotencyKey));
  assert.equal(await code({ allocatedQty: 5 }), "INPUT_FIELD_NOT_ACCEPTED", "the order's own allocatedQty (the retired second authority) is not an input");
  assert.equal(await code({ operatingCompanyKey: "co-a" }), "INPUT_FIELD_NOT_ACCEPTED", "a company KEY is not an input either");
  assert.equal((await refusal(() => alloc.allocateSalesOrderLine({ pool: untouchable }, a, "so-1"))).code, "INPUT_INVALID");
});

test("shape: release needs a reason and the same stated company and warehouse; read needs the order", async () => {
  const a = actor([FULFILL]);
  const rel = { salesOrderId: "so-1", lineNumber: 1, operatingCompanyId: "co-a-id", warehouseId: "wh-1", idempotencyKey: "k-1", reason: "customer changed the order" };
  const code = async (over) => (await refusal(() => alloc.releaseSalesOrderAllocation({ pool: untouchable }, a, { ...rel, ...over }))).code;
  for (const reason of [undefined, "", "   ", "x".repeat(201), 5]) assert.equal(await code({ reason }), "REASON_REQUIRED", String(reason));
  assert.equal(await code({ warehouseId: undefined }), "WAREHOUSEID_INVALID");
  assert.equal(await code({ operatingCompanyId: undefined }), "OPERATINGCOMPANYID_INVALID");
  assert.equal(await code({ quantity: 0 }), "QUANTITY_INVALID");
  assert.equal(await code({ partId: "P-1" }), "INPUT_FIELD_NOT_ACCEPTED", "a release names the line, not a Part");
  assert.equal((await refusal(() => alloc.readSalesOrderAllocations({ pool: untouchable }, a, {}))).code, "SALESORDERID_INVALID");
  assert.equal((await refusal(() => alloc.readSalesOrderAllocations({ pool: untouchable }, a, { salesOrderId: "so-1", warehouseId: "w" }))).code, "INPUT_FIELD_NOT_ACCEPTED");
});

test("releaseSalesOrderClaims is a no-op, with no query, for a state that does not end the claim", async () => {
  for (const toState of ["CONFIRMED", "IN_FULFILLMENT", undefined, "BOGUS"]) {
    const n = await alloc.releaseSalesOrderClaims(untouchable, { tenantId: "t1", salesOrderId: "so-1", toState, actorId: "p1" });
    assert.equal(n, 0, String(toState));
  }
});

// ════════════════════ the boundaries of the lane, proven on the source ════════════════════

const read = (rel) => readFileSync(join(SRC, rel), "utf8");
const ALLOC = read("eosOps/salesOrderAllocation.ts");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("S1b F3: the command checks capability, then company, then warehouse scope, in that order, before any stock rule", () => {
  const src = code(ALLOC);
  const body = src.slice(src.indexOf("export async function allocateSalesOrderLine"), src.indexOf("export async function releaseSalesOrderAllocation"));
  const order = ["requireCapability(actor", "requireStatedCompanyAndOrder(", "requireWarehouseScope(", "ALLOCATABLE_ORDER_STATES.includes", "PART_NOT_ON_LINE", "QUANTITY_EXCEEDS_ORDER", "reserve("];
  let at = -1;
  for (const needle of order) {
    const i = body.indexOf(needle);
    assert.ok(i > at, `${needle} must come after the previous step (found at ${i}, previous ${at})`);
    at = i;
  }
  // The scope check is the WAREHOUSE operational scope, decided by the one contextual authority, for THIS capability.
  assert.match(src, /OPERATIONAL_SCOPE[\s\S]{0,80}scopeType: "WAREHOUSE"/);
  assert.match(src, /capabilityKey: SALES_ORDER_FULFILL_CAPABILITY/);
});

test("S1b F5: consume is not wired here (nothing delivers stock in this lane), and nothing writes the movement ledger or the commitment table directly", () => {
  const src = code(ALLOC);
  assert.doesNotMatch(src, /\bconsume\b/, "no consume");
  assert.doesNotMatch(src, /recordCommitmentEvent/, "only the repository writes commitment rows");
  assert.doesNotMatch(src, /INSERT\s+INTO\s+eos_ops\.inventory_(movements|commitments)/i);
  assert.doesNotMatch(src, /UPDATE\s+eos_ops\.inventory_/i);
  assert.doesNotMatch(src, /DELETE\s+FROM\s+eos_ops\.inventory_/i);
});

test("the dispatch warehouse rule is an Owner item: no Work Order file reaches the allocation command, and the allocation command reaches no Work Order", () => {
  const offenders = [];
  for (const dir of ["eosOps", "workOrder", "eosCommercial"]) {
    let files = [];
    try { files = readdirSync(join(SRC, dir), { recursive: true }).filter((f) => String(f).endsWith(".ts")); } catch { /* absent */ }
    for (const f of files) {
      const text = code(read(join(dir, String(f))));
      if (/^workOrder|\/workOrder/i.test(String(f)) && /salesOrderAllocation/.test(text)) offenders.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(code(ALLOC), /work_orders|WORK_ORDER|workOrder/, "the allocation command touches no Work Order");
});

test("a Sales Order cancel / fulfil / close releases its claims in the order's OWN transaction (S1a OD-11)", () => {
  const svc = code(read("eosCommercial/commands/salesOrderCommandService.ts"));
  const at = svc.indexOf("export function transitionSalesOrder");
  const body = svc.slice(at, svc.indexOf("export function authorizeSalesOrderServiceProvider"));
  const update = body.indexOf("UPDATE eos_commercial.sales_orders SET state");
  const release = body.indexOf("releaseSalesOrderClaims(db,");
  assert.ok(update > 0 && release > update, "the release comes after the state change, on the same `db` (the command's transaction client)");
  assert.match(body, /releaseSalesOrderClaims\(db, \{[^}]*toState: patch\.state/);
  // The repository joins the caller's transaction when handed a client; it never opens another one for it.
  const repo = code(read("eosOps/inventoryCommitmentRepository.ts"));
  assert.match(repo, /typeof \(pool as PoolClient\)\.release === "function"\) return run\(pool as PoolClient\)/);
});

test("releaseSalesOrderClaims: every (warehouse, Part) lock in ONE sorted pass before any per-line cancel, and a post-condition that nothing is still held", () => {
  const src = code(ALLOC);
  const body = src.slice(src.indexOf("export async function releaseSalesOrderClaims"), src.indexOf("export async function readSalesOrderAllocations"));
  const pass = body.indexOf("lockStockLocation(db");
  const loop = body.indexOf("await cancel(db");
  const post = body.indexOf("CLAIMS_NOT_RELEASED");
  assert.ok(pass > 0 && loop > pass, "the locks are all taken before the first per-line cancel");
  assert.ok(post > loop, "the post-condition follows the release loop");
  assert.match(body, /\.sort\(\(\[wa, pa\], \[wb, pb\]\)/, "warehouse-major, then Part: the order every other writer uses");
  assert.doesNotMatch(body, /catch\s*\(/, "no try/catch: a failed release must roll the transition back");
});

test("the order row is locked only AFTER the company decision (no lock-timing oracle on a foreign order)", () => {
  const src = code(ALLOC);
  const fn = src.slice(src.indexOf("async function requireStatedCompanyAndOrder"), src.indexOf("async function requireWarehouseScope"));
  const peek = fn.indexOf("COMPANY_MISMATCH");
  const lock = fn.indexOf("FOR UPDATE");
  assert.ok(peek > 0 && lock > peek, "the plain read and the company/authority checks come before FOR UPDATE");
  assert.equal(fn.split("FOR UPDATE").length, 2, "exactly one FOR UPDATE");
});
