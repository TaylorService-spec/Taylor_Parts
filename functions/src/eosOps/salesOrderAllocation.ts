// SALES ORDER ALLOCATION ON EOS (S1c; DECISIONS #S1c; Owner rulings 2026-10-20, S1a OD-2 / OD-9 / OD-11 / OD-12).
//
// An allocation is a HARD RESERVATION (S1b, inventoryCommitmentRepository.ts): one RESERVED row in the ONE commitment pool, sourced to a
// Sales Order LINE, at a warehouse the caller CHOOSES. There is no second authority (no `allocatedQty` on the order, DECISIONS #165 ruling 1).
//
// WHAT THIS FILE IS. The command that EXPOSES `reserve` / `release` to a caller, and therefore the home of the S1b wiring conditions (DECISIONS #S1b, F3):
//
//   capability -> company authority -> WAREHOUSE scope, in that order, and every refusal precedes any write:
//     1. salesOrder.fulfill (the allocation authority; Firebase parity admin / dispatcher / owner, S1a OD-12).
//     2. company: the caller holds company authority (the one inventory resolver); the STATED company is one the caller reaches; the Sales Order is
//        in that company (an order of a company the caller does not reach reads EXACTLY as a missing one); the STATED warehouse belongs to the stated
//        company. Company and warehouse are STATED, never derived from each other or from the order.
//     3. warehouse scope: the caller's WAREHOUSE operational scope over the stated warehouse. A capability holder with no scope there is refused.
//   then the demand and the stock rules:
//     * the order is NON-TERMINAL and still open to allocation (CONFIRMED or IN_FULFILLMENT; a FULFILLED order needs no stock);
//     * the PART and the QUANTITY are bound to the LINE: the line must exist, be a PART line, name exactly this Part, and
//       allocated-at-all-warehouses + quantity <= ordered. A caller cannot name a different Part, more than was ordered, or a line of another order;
//     * the Part is ACTIVE; a serialized or whole-unit Part is refused (TRACKING_MODE_NOT_SUPPORTED, the repository's rule);
//     * the repository then decides activation, ACTIVE warehouse, no oversell under the per-Part lock, DUPLICATE_CLAIM and replay.
//   ONE transaction; the Sales Order row is locked FOR UPDATE first (the same row `transitionSalesOrder` locks), so the order's state, the quantity
//   bound and the claim cannot change under the command. Lock order everywhere: order row, then the line's demand lock, then the Part locks (sorted).
//
// RELEASE (S1a OD-11): `releaseSalesOrderAllocation` (the caller's explicit act, capability + company + warehouse scope, a reason), and
// `releaseSalesOrderClaims`, called by `transitionSalesOrder` INSIDE the order's own transaction when the order is CANCELLED, FULFILLED or CLOSED
// (a ledger has no implicit release). A line-quantity decrease has no command in EOS yet (the order has no line-edit); when one lands it must call
// the same release and is recorded as a condition in DECISIONS #S1c.
//
// CONSUME IS NOT HERE (S1b F5): nothing in this lane delivers or fulfils stock, so there is no removal movement to pair with a consume.
// WORK ORDER DISPATCH IS NOT WIRED: the dispatch warehouse rule is an Owner item.
//
// IDEMPOTENCY. Every command carries the caller's idempotencyKey; the repository derives each row's key from it and fingerprints the content, so
// the same key and request replays (nothing written, nothing audited) and the same key with a different request is IDEMPOTENCY_CONFLICT. A replay is
// recognised BEFORE the state and bound checks, because a retry after the allocation succeeded would otherwise be counted against its own quantity.
//
// AUDIT. One `stock.reserve` / `stock.release` / `stock.cancel` row per APPLIED command, written by the repository (target kind salesOrderLine).
import type { Pool, PoolClient } from "pg";
import { ID_SHAPE, ReceiveStockError, type ReceiveFailureCategory, type ReceivingPrincipalActor } from "./receiveReorderStockCommand.js";
import { resolveInventoryCompanyAuthority } from "./inventoryCompanyAuthority.js";
import { callerMaySeeSalesOrder, type CommercialCompanyResolver } from "../eosCommercial/commercialCompanyAuthority.js";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { scopedWarehouseIds } from "./partsReads.js";
import { FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE } from "./syntheticAcceptanceWarehouse.js";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority.js";
import { lockStockLocation } from "./stockLocationLock.js";
import {
  CommitmentIdempotencyConflictError, InventoryCommitmentError, cancel, derivedKey, release, reserve,
  type CommitmentWriteResult, type DemandSource,
} from "./inventoryCommitmentRepository.js";

export const SALES_ORDER_FULFILL_CAPABILITY = "salesOrder.fulfill";
export const SALES_ORDER_READ_CAPABILITY = "salesOrder.read";
/** The states in which an order is still open to allocation. CLOSED and CANCELLED are terminal; FULFILLED needs no stock. */
export const ALLOCATABLE_ORDER_STATES: readonly string[] = Object.freeze(["CONFIRMED", "IN_FULFILLMENT"]);
/** The states that END the order's claim on stock: entering one releases every claim the order holds. */
export const CLAIM_ENDING_ORDER_STATES: readonly string[] = Object.freeze(["CANCELLED", "FULFILLED", "CLOSED"]);

const MAX_QUANTITY = 2_000_000_000;
const MAX_KEY = 150;
const MAX_REASON = 200;
const PRESENTATION_EXCLUDED: readonly string[] = Object.freeze([...FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE.warehouseId]);

type Db = Pick<PoolClient, "query">;
const refuse: (code: string, category: ReceiveFailureCategory, message: string) => never = (code, category, message) => {
  throw new ReceiveStockError(code, category, message);
};
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function acceptOnly(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input as Record<string, unknown>).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  return input as Record<string, unknown>;
}

/** CAPABILITY FIRST, on its own, before a connection is taken. */
function requireCapability(actor: ReceivingPrincipalActor, capabilities: readonly string[]): void {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
  if (!capabilities.some((c) => actor.capabilities.has(c))) {
    refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this requires ${capabilities.join(" or ")}`);
  }
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > MAX_QUANTITY) {
    refuse(`${field.toUpperCase()}_INVALID`, "INVALID_INPUT", `${field} must be a whole number from 1 to ${MAX_QUANTITY}`);
  }
  return value as number;
}
function idField(value: unknown, field: string): string {
  if (!ID_SHAPE(value)) refuse(`${field.toUpperCase()}_INVALID`, "INVALID_INPUT", `${field} must be a governed id`);
  return value as string;
}
function keyField(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > MAX_KEY) {
    refuse("IDEMPOTENCY_KEY_INVALID", "INVALID_INPUT", `idempotencyKey must be a non-empty string of at most ${MAX_KEY} characters`);
  }
  return value as string;
}

interface AllocationRequest {
  readonly salesOrderId: string;
  readonly lineNumber: number;
  readonly operatingCompanyId: string;
  readonly warehouseId: string;
  readonly idempotencyKey: string;
}

function readRequest(i: Record<string, unknown>): AllocationRequest {
  return {
    salesOrderId: idField(i.salesOrderId, "salesOrderId"),
    lineNumber: positiveInt(i.lineNumber, "lineNumber"),
    operatingCompanyId: idField(i.operatingCompanyId, "operatingCompanyId"),
    warehouseId: idField(i.warehouseId, "warehouseId"),
    idempotencyKey: keyField(i.idempotencyKey),
  };
}

async function inTransaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/** The repository's refusals, in the Operations transport's vocabulary. The words are the repository's own. */
function asRefusal(err: unknown): never {
  if (err instanceof CommitmentIdempotencyConflictError) return refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotencyKey was already used for a different allocation");
  if (err instanceof InventoryCommitmentError) {
    const category: ReceiveFailureCategory =
      err.code === "DUPLICATE_CLAIM" ? "CONFLICT"
        : err.code === "PART_NOT_FOUND" || err.code === "WAREHOUSE_NOT_FOUND" || err.code === "DEMAND_NOT_FOUND" ? "NOT_FOUND"
          : err.code === "REASON_REQUIRED" || err.code === "QUANTITY_INVALID" ? "INVALID_INPUT"
            : "PRECONDITION_FAILED";
    if (err.code === "DUPLICATE_CLAIM") return refuse(err.code, category, "this line already holds an allocation at this warehouse; release first to change the quantity here");
    return refuse(err.code, category, err.message);
  }
  throw err;
}

interface Stated {
  readonly companyKey: string;
  readonly companyKeys: readonly string[];
  readonly order: { readonly state: string };
}

/**
 * Steps 2 and 3 of the order (company, then the order, then the warehouse scope), shared by allocate and release. Locks the Sales Order row.
 * Returns the stated company key. The warehouse (and its scope) is decided by `requireWarehouseScope`, which needs the key.
 */
async function requireStatedCompanyAndOrder(db: Db, actor: ReceivingPrincipalActor, r: AllocationRequest, companyReach?: CommercialCompanyResolver): Promise<Stated> {
  const authority = await resolveInventoryCompanyAuthority(db, actor.tenantId, actor.principalId);
  if (authority.companyKeys.length === 0) {
    refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", "allocating stock to a Sales Order requires operating-company authority; this principal has none");
  }
  const { rows: key } = await db.query<{ operating_company_key: string }>(
    `SELECT operating_company_key FROM eos_policy.tenant_operating_company_keys WHERE tenant_id = $1 AND operating_company_id = $2 AND status = 'ACTIVE'`,
    [actor.tenantId, r.operatingCompanyId]);
  const companyKey = key[0]?.operating_company_key;
  // An unknown company and a company the caller does not reach are ONE answer.
  if (!companyKey || !authority.companyKeys.includes(companyKey)) {
    refuse("COMPANY_OUT_OF_AUTHORITY", "FORBIDDEN", "the stated operating company is not one you hold authority over");
  }
  // A PLAIN read first, so the company decision is made before any row lock is taken: a caller outside the order's company must not be able to learn
  // anything about it from how long the lock took (no lock-timing oracle on a foreign order).
  const { rows: peek } = await db.query<{ operating_company_key: string }>(
    `SELECT operating_company_key FROM eos_commercial.sales_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.salesOrderId]);
  // Q-1a: the INTERSECTION of the inventory company check above and the Commercial visibility decision (company authority + channel), the SAME one the
  // Commercial Sales Order reads and commands apply. An order the Commercial side hides reads as nonexistent here too, before any lock (fail closed).
  if (!peek[0] || !authority.companyKeys.includes(peek[0].operating_company_key)
    || !(await callerMaySeeSalesOrder(db, actor, r.salesOrderId, [SALES_ORDER_FULFILL_CAPABILITY], companyReach))) refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", "no such Sales Order");
  if (peek[0].operating_company_key !== companyKey) {
    refuse("COMPANY_MISMATCH", "PRECONDITION_FAILED", "the Sales Order belongs to a different operating company than the one you stated; company is stated, never derived, and the two must agree");
  }
  // Authorised: now lock the row (the one transitionSalesOrder locks) and RE-READ the state under the lock.
  const { rows: so } = await db.query<{ operating_company_key: string; state: string }>(
    `SELECT operating_company_key, state::text AS state FROM eos_commercial.sales_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [actor.tenantId, r.salesOrderId]);
  if (!so[0] || so[0].operating_company_key !== companyKey) refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", "no such Sales Order");
  return { companyKey: companyKey as string, companyKeys: authority.companyKeys, order: { state: so[0].state } };
}

async function requireWarehouseScope(db: Db, actor: ReceivingPrincipalActor, stated: Stated, warehouseId: string): Promise<void> {
  const { rows } = await db.query<{ operating_company_key: string }>(
    `SELECT operating_company_key FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, warehouseId]);
  // A warehouse of a company the caller does not reach reads EXACTLY as a nonexistent one.
  if (!rows[0] || !stated.companyKeys.includes(rows[0].operating_company_key)) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such warehouse");
  if (rows[0].operating_company_key !== stated.companyKey) {
    refuse("COMPANY_WAREHOUSE_MISMATCH", "PRECONDITION_FAILED", "the stated warehouse does not belong to the stated operating company; company is never derived from the warehouse and the two must agree");
  }
  const decision = await authorizeObjectAction(postgresContextualReader(db), {
    actor, capabilityKey: SALES_ORDER_FULFILL_CAPABILITY,
    predicates: [{ kind: "OPERATIONAL_SCOPE", scopeType: "WAREHOUSE", scopeId: warehouseId }],
  });
  if (!decision.allowed) {
    refuse(decision.reason, "FORBIDDEN",
      decision.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this warehouse is outside your operational scope"
        : decision.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee with a warehouse scope can allocate stock" : "not authorized");
  }
}

interface LineFacts { readonly kind: string; readonly ref: string; readonly orderedQty: number }

async function readLine(db: Db, tenantId: string, salesOrderId: string, lineNumber: number): Promise<LineFacts> {
  const { rows } = await db.query<{ kind: string; ref: string; ordered_qty: number }>(
    `SELECT kind::text AS kind, ref, ordered_qty FROM eos_commercial.sales_order_lines WHERE tenant_id = $1 AND sales_order_id = $2 AND line_number = $3`,
    [tenantId, salesOrderId, lineNumber]);
  if (!rows[0]) refuse("LINE_NOT_FOUND", "NOT_FOUND", "this Sales Order has no such line");
  return { kind: rows[0].kind, ref: rows[0].ref, orderedQty: Number(rows[0].ordered_qty) };
}

/** What a line holds per warehouse: RESERVED - RELEASED - CONSUMED. The same arithmetic as the pool, over this demand only. */
async function heldByWarehouse(db: Db, tenantId: string, salesOrderId: string, lineNumber: number | null): Promise<Array<{ lineNumber: number; warehouseId: string; held: number }>> {
  const { rows } = await db.query<{ line: number; warehouse_id: string; held: string }>(
    `SELECT sales_order_line_number AS line, warehouse_id, SUM(CASE event_type WHEN 'RESERVED' THEN quantity ELSE -quantity END) AS held
       FROM eos_ops.inventory_commitments
      WHERE tenant_id = $1 AND sales_order_id = $2 AND ($3::int IS NULL OR sales_order_line_number = $3)
      GROUP BY sales_order_line_number, warehouse_id
     HAVING SUM(CASE event_type WHEN 'RESERVED' THEN quantity ELSE -quantity END) > 0
      ORDER BY sales_order_line_number, warehouse_id`,
    [tenantId, salesOrderId, lineNumber]);
  return rows.map((r) => ({ lineNumber: Number(r.line), warehouseId: r.warehouse_id, held: Number(r.held) }));
}

const sum = (rows: ReadonlyArray<{ held: number }>) => rows.reduce((a, r) => a + r.held, 0);
const wasReplay = (results: readonly CommitmentWriteResult[]) => results.length > 0 && results.every((r) => r.outcome === "replayed");

// ════════════════════ allocate ════════════════════

export async function allocateSalesOrderLine(deps: { readonly pool: Pool; readonly companyReach?: CommercialCompanyResolver }, actor: ReceivingPrincipalActor, input: unknown) {
  requireCapability(actor, [SALES_ORDER_FULFILL_CAPABILITY]);
  const i = acceptOnly(input, ["salesOrderId", "lineNumber", "operatingCompanyId", "warehouseId", "partId", "quantity", "idempotencyKey"]);
  const r = readRequest(i);
  const partId = idField(i.partId, "partId");
  const quantity = positiveInt(i.quantity, "quantity");

  return inTransaction(deps.pool, async (db) => {
    const stated = await requireStatedCompanyAndOrder(db, actor, r, deps.companyReach);
    await requireWarehouseScope(db, actor, stated, r.warehouseId);

    const base = `soAlloc:${r.idempotencyKey}`;
    const source: DemandSource = { kind: "SALES_ORDER", salesOrderId: r.salesOrderId, lineNumber: r.lineNumber };
    const prior = await db.query(
      `SELECT 1 FROM eos_ops.inventory_commitments WHERE tenant_id = $1 AND idempotency_key = $2`,
      [actor.tenantId, derivedKey(base, "RESERVED", r.warehouseId, partId)]);

    // A RETRY of an allocation that already committed is decided by the repository (replay, or IDEMPOTENCY_CONFLICT), not re-counted below.
    if (prior.rows.length === 0) {
      if (!ALLOCATABLE_ORDER_STATES.includes(stated.order.state)) {
        refuse("ORDER_NOT_ALLOCATABLE", "PRECONDITION_FAILED", `a Sales Order that is ${stated.order.state} cannot take new allocations`);
      }
      const line = await readLine(db, actor.tenantId, r.salesOrderId, r.lineNumber);
      if (line.kind !== "PART") refuse("LINE_NOT_A_PART", "PRECONDITION_FAILED", "only a PART line can be allocated stock");
      if (line.ref !== partId) refuse("PART_NOT_ON_LINE", "PRECONDITION_FAILED", "the Part is not the Part this line orders; an allocation is bound to its line");
      const [policy] = await createPostgresPartPolicyAuthority().readPartPolicies(db as PoolClient, actor.tenantId, [partId]);
      if (!policy?.found) refuse("PART_NOT_FOUND", "NOT_FOUND", "no such Part");
      if (policy.status !== "ACTIVE") refuse("PART_NOT_ACTIVE", "PRECONDITION_FAILED", "the Part is not ACTIVE; stock of it cannot be allocated");
      const heldNow = await heldByWarehouse(db, actor.tenantId, r.salesOrderId, r.lineNumber);
      const already = sum(heldNow);
      if (quantity > line.orderedQty - already) {
        // A second claim at the SAME warehouse is refused (one active claim per line and warehouse): say how to change the quantity there.
        const here = heldNow.find((h) => h.warehouseId === r.warehouseId)?.held ?? 0;
        refuse("QUANTITY_EXCEEDS_ORDER", "PRECONDITION_FAILED",
          `the line orders ${line.orderedQty} and already holds ${already}; at most ${Math.max(0, line.orderedQty - already)} more can be allocated`
          + (here > 0 ? `. It already holds ${here} at this warehouse: release first to change the quantity here.` : ""));
      }
    }

    let written: readonly CommitmentWriteResult[];
    try {
      written = await reserve(db as PoolClient, {
        tenantId: actor.tenantId, operatingCompanyKey: stated.companyKey as never, warehouseId: r.warehouseId, source,
        actorId: actor.principalId, idempotencyKey: base,
      }, [{ partId, quantity }]);
    } catch (err) {
      return asRefusal(err);
    }
    const held = await heldByWarehouse(db, actor.tenantId, r.salesOrderId, r.lineNumber);
    return {
      outcome: wasReplay(written) ? ("replayed" as const) : ("allocated" as const),
      salesOrderId: r.salesOrderId, lineNumber: r.lineNumber, partId, warehouseId: r.warehouseId, quantity,
      allocatedAtWarehouse: held.find((h) => h.warehouseId === r.warehouseId)?.held ?? 0,
      allocatedTotal: sum(held),
    };
  });
}

// ════════════════════ release ════════════════════

export async function releaseSalesOrderAllocation(deps: { readonly pool: Pool; readonly companyReach?: CommercialCompanyResolver }, actor: ReceivingPrincipalActor, input: unknown) {
  requireCapability(actor, [SALES_ORDER_FULFILL_CAPABILITY]);
  const i = acceptOnly(input, ["salesOrderId", "lineNumber", "operatingCompanyId", "warehouseId", "quantity", "reason", "idempotencyKey"]);
  const r = readRequest(i);
  const quantity = i.quantity === undefined ? null : positiveInt(i.quantity, "quantity");
  if (typeof i.reason !== "string" || i.reason.trim() === "" || i.reason.length > MAX_REASON) {
    refuse("REASON_REQUIRED", "INVALID_INPUT", `a reason of 1 to ${MAX_REASON} characters is required`);
  }

  return inTransaction(deps.pool, async (db) => {
    const stated = await requireStatedCompanyAndOrder(db, actor, r, deps.companyReach);
    await requireWarehouseScope(db, actor, stated, r.warehouseId);
    const line = await readLine(db, actor.tenantId, r.salesOrderId, r.lineNumber);
    let written: readonly CommitmentWriteResult[];
    try {
      written = await release(db as PoolClient, {
        tenantId: actor.tenantId, operatingCompanyKey: stated.companyKey as never, warehouseId: r.warehouseId,
        source: { kind: "SALES_ORDER", salesOrderId: r.salesOrderId, lineNumber: r.lineNumber },
        actorId: actor.principalId, idempotencyKey: `soRelease:${r.idempotencyKey}`,
      }, { reason: (i.reason as string).trim(), ...(quantity === null ? {} : { lines: [{ partId: line.ref, quantity }] }) });
    } catch (err) {
      return asRefusal(err);
    }
    // Releasing everything where nothing is held writes nothing; say so rather than reporting a release that did not happen.
    if (written.length === 0) refuse("NO_ACTIVE_CLAIM", "PRECONDITION_FAILED", "this line holds no allocation at that warehouse");
    const held = await heldByWarehouse(db, actor.tenantId, r.salesOrderId, r.lineNumber);
    return {
      outcome: wasReplay(written) ? ("replayed" as const) : ("released" as const),
      salesOrderId: r.salesOrderId, lineNumber: r.lineNumber, warehouseId: r.warehouseId,
      releasedQuantity: written.reduce((a, w) => a + w.record.quantity, 0),
      allocatedAtWarehouse: held.find((h) => h.warehouseId === r.warehouseId)?.held ?? 0,
      allocatedTotal: sum(held),
    };
  });
}

// ════════════════════ release on cancel / fulfil / close ════════════════════

/**
 * Release EVERY claim a Sales Order holds, in the CALLER'S open transaction (S1a OD-11). Called by `transitionSalesOrder` after the order
 * enters CANCELLED, FULFILLED or CLOSED, so the state change and the release commit or roll back together. The claims are read from the LEDGER
 * (never from a plan), per line, with the repository's `cancel` (one `stock.cancel` audit row per line that held something). Returns the lines released.
 * No catalog or warehouse check: a deactivated Part or a closed warehouse must never strand stock.
 */
export async function releaseSalesOrderClaims(
  db: PoolClient,
  args: { readonly tenantId: string; readonly salesOrderId: string; readonly toState: string; readonly actorId: string },
): Promise<number> {
  if (!CLAIM_ENDING_ORDER_STATES.includes(args.toState)) return 0;
  const held = await heldByWarehouse(db, args.tenantId, args.salesOrderId, null);
  if (held.length === 0) return 0;
  const { rows } = await db.query<{ operating_company_key: string }>(
    `SELECT operating_company_key FROM eos_commercial.sales_orders WHERE tenant_id = $1 AND id = $2`, [args.tenantId, args.salesOrderId]);
  if (!rows[0]) return 0;
  // NO DEADLOCK BETWEEN TWO ORDERS. `cancel` takes the Part locks of one line at a time, so two orders whose lines hold the same Parts in opposite order
  // could each hold the other's next lock (40P01). Take EVERY (warehouse, Part) lock this order holds up front, in ONE globally sorted pass -- the order
  // every other writer of the pool uses (a warehouse, then Parts sorted) -- and the per-line `cancel` calls below only re-take locks already held.
  const { rows: locks } = await db.query<{ warehouse_id: string; part_id: string }>(
    `SELECT DISTINCT warehouse_id, part_id FROM eos_ops.inventory_commitments WHERE tenant_id = $1 AND sales_order_id = $2`,
    [args.tenantId, args.salesOrderId]);
  const sorted = locks.map((l) => [l.warehouse_id, l.part_id] as const)
    .sort(([wa, pa], [wb, pb]) => (wa < wb ? -1 : wa > wb ? 1 : pa < pb ? -1 : pa > pb ? 1 : 0));
  for (const [warehouseId, partId] of sorted) await lockStockLocation(db, args.tenantId, partId, "WAREHOUSE", warehouseId);

  const lines = [...new Set(held.map((h) => h.lineNumber))].sort((a, b) => a - b);
  for (const lineNumber of lines) {
    await cancel(db, {
      tenantId: args.tenantId, operatingCompanyKey: rows[0].operating_company_key as never, actorId: args.actorId,
      source: { kind: "SALES_ORDER", salesOrderId: args.salesOrderId, lineNumber },
      idempotencyKey: `soEnd:${args.salesOrderId}:${lineNumber}:${args.toState}`,
    }, { reason: `Sales Order ${args.toState.toLowerCase()}` });
  }
  // POST-CONDITION: an order that has ended holds nothing. If anything is still held the transition must not commit.
  const left = await heldByWarehouse(db, args.tenantId, args.salesOrderId, null);
  if (left.length > 0) {
    throw new InventoryCommitmentError("CLAIMS_NOT_RELEASED", `${left.length} claim(s) of Sales Order ${args.salesOrderId} are still held after the release; the transition is not committed`);
  }
  return lines.length;
}

// ════════════════════ read ════════════════════

/**
 * What the Sales Order screen shows: per line, what is allocated (all warehouses the caller's company reaches) and, for the warehouses in the
 * CALLER'S scope, how much is held where; plus the warehouses the caller may allocate from and whether they may. The server decides every flag.
 * A claim at a warehouse outside the caller's scope is counted in the line's total and in `heldOutsideYourScope`, and named nowhere.
 */
export async function readSalesOrderAllocations(deps: { readonly pool: Pool; readonly companyReach?: CommercialCompanyResolver }, actor: ReceivingPrincipalActor, input: unknown) {
  requireCapability(actor, [SALES_ORDER_FULFILL_CAPABILITY, SALES_ORDER_READ_CAPABILITY]);
  const i = acceptOnly(input, ["salesOrderId"]);
  const salesOrderId = idField(i.salesOrderId, "salesOrderId");
  const c = await deps.pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const authority = await resolveInventoryCompanyAuthority(c, actor.tenantId, actor.principalId);
    if (authority.companyKeys.length === 0) {
      refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", "reading allocations requires operating-company authority; this principal has none");
    }
    const { rows: so } = await c.query<{ operating_company_key: string; state: string; operating_company_id: string | null }>(
      `SELECT so.operating_company_key, so.state::text AS state, k.operating_company_id
         FROM eos_commercial.sales_orders so
         LEFT JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = so.tenant_id AND k.operating_company_key = so.operating_company_key AND k.status = 'ACTIVE'
        WHERE so.tenant_id = $1 AND so.id = $2`, [actor.tenantId, salesOrderId]);
    if (!so[0] || !authority.companyKeys.includes(so[0].operating_company_key)
      || !(await callerMaySeeSalesOrder(c, actor, salesOrderId, [SALES_ORDER_FULFILL_CAPABILITY, SALES_ORDER_READ_CAPABILITY], deps.companyReach))) refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", "no such Sales Order");
    const holdsFulfill = actor.capabilities.has(SALES_ORDER_FULFILL_CAPABILITY);
    const scope = holdsFulfill
      ? (await scopedWarehouseIds(c, actor, { administrationReach: false, companyKeys: [so[0].operating_company_key] })).filter((w) => !PRESENTATION_EXCLUDED.includes(w))
      : [];
    const { rows: wh } = scope.length === 0 ? { rows: [] as Array<{ id: string; name: string; status: string }> }
      : await c.query<{ id: string; name: string; status: string }>(
        `SELECT id, name, status::text AS status FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = ANY($2::text[]) AND operating_company_key = $3 ORDER BY name, id`,
        [actor.tenantId, scope, so[0].operating_company_key]);
    const { rows: lines } = await c.query<{ line_number: number; kind: string; ref: string; ordered_qty: number }>(
      `SELECT line_number, kind::text AS kind, ref, ordered_qty FROM eos_commercial.sales_order_lines WHERE tenant_id = $1 AND sales_order_id = $2 ORDER BY line_number`,
      [actor.tenantId, salesOrderId]);
    const held = await heldByWarehouse(c, actor.tenantId, salesOrderId, null);
    await c.query("COMMIT");
    const open = ALLOCATABLE_ORDER_STATES.includes(so[0].state);
    return {
      salesOrderId, operatingCompanyId: so[0].operating_company_id, state: so[0].state,
      canAllocate: holdsFulfill && open && wh.some((w) => w.status === "ACTIVE"),
      canRelease: holdsFulfill,
      warehouses: wh.map((w) => ({ warehouseId: w.id, name: w.name, active: w.status === "ACTIVE" })),
      lines: lines.map((l) => {
        const mine = held.filter((h) => h.lineNumber === Number(l.line_number));
        const visible = mine.filter((h) => scope.includes(h.warehouseId));
        return {
          lineNumber: Number(l.line_number), kind: l.kind, partId: l.kind === "PART" ? l.ref : null, orderedQty: Number(l.ordered_qty),
          allocatedTotal: sum(mine),
          byWarehouse: visible.map((h) => ({ warehouseId: h.warehouseId, allocated: h.held })),
          heldOutsideYourScope: sum(mine) - sum(visible),
        };
      }),
    };
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export const EOS_SALES_ORDER_ALLOCATION_OPERATIONS = Object.freeze({
  allocateSalesOrderLine, releaseSalesOrderAllocation, readSalesOrderAllocations,
} as const);
