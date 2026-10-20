// The eos_ops inventory COMMITMENT repository: HARD STOCK RESERVATIONS per operating company AND warehouse (S1b),
// and the Work Order inventory-effect REPLAY authority.
//
// ════════════════════ WHAT A HARD RESERVATION IS ════════════════════
//
// A hard reservation is one RESERVED row in `eos_ops.inventory_commitments` that states, explicitly and
// separately, an operating company AND a warehouse (Owner ruling 2026-10-20, S1a OD-2; DECISIONS #165 ruling 4).
//   * Neither is inferred from the other. Both are stated by the caller, and they must AGREE: the stated warehouse
//     must belong to the stated company, otherwise the command refuses (COMPANY_WAREHOUSE_MISMATCH) and the
//     database refuses too (composite foreign key). The demand document (Work Order, or Sales Order line) must
//     belong to the stated company as well (DEMAND_COMPANY_MISMATCH): no cross-company commitment.
//   * Company-wide VISIBILITY of demand is allowed; UNALLOCATED demand is NOT a hard reservation. Nothing here reads
//     a plan, an order quantity or an `allocatedQty`: only RESERVED / RELEASED / CONSUMED rows reduce available stock
//     (DECISIONS #165 ruling 1: ONE commitment pool, no second authority).
//
// ════════════════════ ONE ARITHMETIC ════════════════════
//
//   committed(company, warehouse, part) = max(0, Σ RESERVED − Σ RELEASED − Σ CONSUMED)
//   available(company, warehouse, part) = max(0, sellableOnHand − committed), UNKNOWN whenever sellableOnHand is.
//
// `committedQuantity` / `committedByWarehouse` and `sellableOnHandAtWarehouse` are the ONLY places those are computed;
// the reserve gate and `readPartBalance` both call them, so the read can never disagree with the gate.
// CONSUMED reconciles a promise and moves no stock: the physical removal is a `WORK_ORDER_CONSUMPTION` movement
// written by whoever owns that movement (S1a section 3.1).
//
// ════════════════════ NO OVERSELL: LOCK ORDER ════════════════════
//
// Order everywhere: the DEMAND lock (one per Work Order / Sales Order line) first, then the per-Part locks in sorted order.
// The demand lock makes "release everything" and "cancel" read a claim set that cannot change under them; it never
// serialises different demands against each other. Every writer takes `lockStockLocation(tenant, part, 'WAREHOUSE', warehouse)` for each Part, in sorted Part order
// (deadlock-free), BEFORE it reads on-hand or commitments, and holds it to the end of its transaction. Two concurrent
// reservations of the last unit therefore serialize on the same lock, the second one reads the first one's committed
// row, and is refused INSUFFICIENT_STOCK. It is the same lock family the stock movement writers use.
//
// ════════════════════ REPLAY, DUPLICATES, TRANSITIONS ════════════════════
//
//   * Each row's key derives from the operation key (`<base>:<EVENT>:<warehouse>:<part>`); each row also carries a
//     content FINGERPRINT. Same key + same fingerprint = replay (writes nothing, audits nothing). Same key + different
//     content = IDEMPOTENCY_CONFLICT, never a silent replay. Replay is decided BEFORE the availability gate, so a retry
//     after the stock has since gone still replays.
//   * ONE ACTIVE CLAIM per (demand line, part, warehouse): a second reserve while one is outstanding is DUPLICATE_CLAIM.
//   * Governed transitions: reserve -> (release | consume), each refused unless it fits the outstanding claim at that
//     company+warehouse; cancel releases everything a demand still holds. Release / consume / cancel act on the commitment
//     ROWS, never on the demand document or the warehouse row, so a purged demand or a closed warehouse cannot strand stock. Append-only (the database refuses UPDATE and
//     DELETE); one audit row per APPLIED command, with no free text beyond the reason.
//   * Reserve before the company is activated (`stock_reservation_activation`) is refused RESERVATION_NOT_ACTIVATED.
//
// ════════════════════ SERIAL AND WHOLE-UNIT PARTS ════════════════════
//
// A quantity row cannot name units, so a serial-tracked or whole-unit Part is REFUSED here (TRACKING_MODE_NOT_SUPPORTED)
// before any write. It therefore cannot be quantity-reserved in a way that double-claims a unit: a unit is never claimed
// by this ledger at all. Claiming a NAMED unit on `serialized_custody` needs a custody holder the schema does not have;
// that is a separate, unsettled design (S1a OD-8, deferred) and is not decided here.
//
// ════════════════════ COMMITMENT IS NOT MOVEMENT ════════════════════
//
// RESERVED / RELEASED / CONSUMED are commitment lifecycle facts. They write to `eos_ops.inventory_commitments` and
// NEVER to `eos_ops.inventory_movements`; the three labels are not members of `ops_movement_type`.
//
// NOT WIRED. Like `cycleCountRepository.ts`, nothing calls these commands from an HTTP operation or from the Work Order
// lifecycle yet: dispatch has no warehouse to supply (neither demand family selects one), and which warehouse a
// dispatch reserves from is a selection rule nobody has ratified. The commands take the warehouse explicitly.

import type { Pool, PoolClient } from "pg";
// THE CATALOG ANSWERS WHAT A PART IS. Composed as a repository in this same Render runtime and run on
// this command's own client, so the Part facts belong to the same transaction as the commitment rows.
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority.js";
import { createHash, randomUUID } from "node:crypto";
import { type OperatingCompanyKey, requireOperatingCompanyKey } from "./operatingCompanyCustody.js";
import { lockStockLocation } from "./stockLocationLock.js";
import { withActorAuthority } from "./administrationReach.js";

const SCHEMA = "eos_ops";
const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

/** A `pg` handle that can run a query — the Pool itself, or a client inside an open transaction. */
export type Queryable = Pool | PoolClient;

/** `eos_ops.ops_commitment_event_type`. Disjoint from `ops_movement_type`, by construction. */
export const COMMITMENT_EVENT_TYPES = ["RESERVED", "RELEASED", "CONSUMED"] as const;
export type CommitmentEventType = (typeof COMMITMENT_EVENT_TYPES)[number];

/** `eos_ops.ops_work_order_effect_state` — exactly the three keys of `STATE_TRIGGERS`. */
export const WORK_ORDER_EFFECT_STATES = ["DISPATCHED", "COMPLETED", "CANCELLED"] as const;
export type WorkOrderEffectState = (typeof WORK_ORDER_EFFECT_STATES)[number];

/** `eos_ops.ops_work_order_effect_status`. */
export const WORK_ORDER_EFFECT_STATUSES = ["CLAIMED", "PROCESSED", "FAILED"] as const;
export type WorkOrderEffectStatus = (typeof WORK_ORDER_EFFECT_STATUSES)[number];

export class InventoryCommitmentError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "InventoryCommitmentError";
  }
}

/**
 * The same idempotency key was already used for a DIFFERENT commitment.
 *
 * Replay iff the stored row's fingerprint says the same thing, conflict iff it does not. A conflict is never silently
 * treated as a replay, because that would drop a real commitment on the floor.
 */
export class CommitmentIdempotencyConflictError extends InventoryCommitmentError {
  constructor(idempotencyKey: string) {
    super("IDEMPOTENCY_CONFLICT", `idempotencyKey ${idempotencyKey} was already used for a different commitment`);
  }
}

/** The demand document that raised a claim. Exactly one source per row (a database CHECK). */
export type DemandSource =
  | { readonly kind: "WORK_ORDER"; readonly workOrderId: string }
  | { readonly kind: "SALES_ORDER"; readonly salesOrderId: string; readonly lineNumber: number };

/** One row of `eos_ops.inventory_commitments`. */
export interface CommitmentEventRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly warehouseId: string;
  readonly source: DemandSource;
  /** The Work Order id, or null for a Sales Order claim. Kept for the Work Order readers. */
  readonly workOrderId: string | null;
  readonly partId: string;
  readonly eventType: CommitmentEventType;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly fingerprint: string;
}

export interface CommitmentEventInput {
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly warehouseId: string;
  readonly source: DemandSource;
  readonly partId: string;
  readonly eventType: CommitmentEventType;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly actorId: string;
}

export type CommitmentWriteOutcome = "applied" | "replayed";

export interface CommitmentWriteResult {
  readonly outcome: CommitmentWriteOutcome;
  readonly record: CommitmentEventRecord;
}

/** The replay content hash: everything the row asserts except its own id, actor and time. */
export function commitmentFingerprint(input: Pick<CommitmentEventInput, "operatingCompanyKey" | "warehouseId" | "source" | "partId" | "eventType" | "quantity">): string {
  const s = input.source;
  return createHash("sha256").update(JSON.stringify([
    input.operatingCompanyKey, input.warehouseId,
    s.kind, s.kind === "WORK_ORDER" ? s.workOrderId : [s.salesOrderId, s.lineNumber],
    input.partId, input.eventType, input.quantity,
  ])).digest("hex");
}

// ════════════════════ writing commitment events ════════════════════

/**
 * Append exactly ONE commitment event, idempotently. NO availability or transition checks live here: this is the
 * storage primitive. Use `reserve` / `release` / `consume` / `cancel`, which hold the lock and decide first.
 *
 * Append-only: a release is a new row, never an edit to the reservation it releases. This module offers no update and
 * no delete against `inventory_commitments`, the database refuses both, and a static test proves the former.
 */
export async function recordCommitmentEvent(
  db: Queryable,
  input: CommitmentEventInput,
): Promise<CommitmentWriteResult> {
  const companyKey = requireCompany(input.operatingCompanyKey);
  requirePositiveQuantity(input.quantity, input.partId);
  requireNonEmpty(input.idempotencyKey, "idempotencyKey");
  requireWarehouse(input.warehouseId);
  requireSource(input.source);

  const fingerprint = commitmentFingerprint({ ...input, operatingCompanyKey: companyKey });
  const id = newId("cmt");
  const s = input.source;
  const { rows } = await db.query<CommitmentRow>(
    `INSERT INTO ${SCHEMA}.inventory_commitments
       (id, tenant_id, operating_company_key, warehouse_id, work_order_id, sales_order_id, sales_order_line_number,
        part_id, event_type, quantity, idempotency_key, request_fingerprint, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING ${ROW_COLUMNS}`,
    [id, input.tenantId, companyKey, input.warehouseId,
     s.kind === "WORK_ORDER" ? s.workOrderId : null,
     s.kind === "SALES_ORDER" ? s.salesOrderId : null,
     s.kind === "SALES_ORDER" ? s.lineNumber : null,
     input.partId, input.eventType, input.quantity, input.idempotencyKey, fingerprint, input.actorId],
  );

  const inserted = rows[0];
  if (inserted) return { outcome: "applied", record: toRecord(inserted) };

  // The key is taken. Replay only if the stored row says exactly the same thing; otherwise this is a
  // different commitment wearing an already-used identity, and it must not be swallowed.
  const existing = await readByIdempotencyKey(db, input.tenantId, input.idempotencyKey);
  if (!existing) {
    // The conflicting row belongs to another tenant's key space, which this tenant cannot see. The
    // unique index is per-tenant, so this is unreachable in practice; it fails closed regardless.
    throw new InventoryCommitmentError("IDEMPOTENCY_UNREADABLE", "the conflicting commitment is not visible to this tenant");
  }
  if (existing.fingerprint !== fingerprint) throw new CommitmentIdempotencyConflictError(input.idempotencyKey);
  return { outcome: "replayed", record: existing };
}

// ════════════════════ the one arithmetic ════════════════════

/**
 * Σ RESERVED − Σ RELEASED − Σ CONSUMED, floored at 0, for ONE company and ONE warehouse. The single definition of
 * "committed"; the gate and the read both use it.
 */
export async function committedQuantity(
  db: Queryable,
  tenantId: string,
  operatingCompanyKey: OperatingCompanyKey,
  warehouseId: string,
  partId: string,
): Promise<number> {
  const companyKey = requireCompany(operatingCompanyKey);
  const byWarehouse = await committedByWarehouse(db, tenantId, [companyKey], partId, [warehouseId]);
  return byWarehouse.get(warehouseId) ?? 0;
}

/** The same arithmetic for many warehouses at once (the read path); a warehouse with no row is absent, not 0. */
export async function committedByWarehouse(
  db: Queryable,
  tenantId: string,
  companyKeys: readonly string[],
  partId: string,
  warehouseIds: readonly string[],
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ warehouse_id: string; net: string }>(
    `SELECT warehouse_id,
            SUM(CASE event_type WHEN 'RESERVED' THEN quantity ELSE -quantity END) AS net
       FROM ${SCHEMA}.inventory_commitments
      WHERE tenant_id = $1 AND operating_company_key = ANY($2::text[]) AND part_id = $3
        AND warehouse_id = ANY($4::text[])
      GROUP BY warehouse_id`,
    [tenantId, [...companyKeys], partId, [...warehouseIds]],
  );
  return new Map(rows.map((r) => [r.warehouse_id, Math.max(0, Number(r.net))]));
}

/**
 * Sellable on-hand of one Part at ONE warehouse for ONE company: NONE-tracked WAREHOUSE and BIN movements of that
 * warehouse (a bin is its warehouse's stock), MOBILE/truck excluded, floored at 0. `null` is UNKNOWN: the ledger holds
 * no evidence for the Part there. The caller decides whether the warehouse is ACTIVE.
 */
export async function sellableOnHandAtWarehouse(
  db: Queryable,
  tenantId: string,
  operatingCompanyKey: OperatingCompanyKey,
  warehouseId: string,
  partId: string,
): Promise<number | null> {
  const { rows } = await db.query<{ n: string; total: string | null }>(
    `SELECT count(*) AS n, sum(m.quantity_delta) AS total
       FROM ${SCHEMA}.inventory_movements m
      WHERE m.tenant_id = $1 AND m.operating_company_key = $2 AND m.part_id = $3 AND m.tracking_mode = 'NONE'
        AND ((m.location_type::text = 'WAREHOUSE' AND m.location_id = $4)
          OR (m.location_type::text = 'BIN' AND m.location_id IN
                (SELECT b.id FROM ${SCHEMA}.bins b WHERE b.tenant_id = $1 AND b.warehouse_id = $4)))`,
    [tenantId, requireCompany(operatingCompanyKey), partId, warehouseId],
  );
  if (Number(rows[0]?.n ?? 0) === 0) return null;
  return Math.max(0, Number(rows[0].total ?? 0));
}

// ════════════════════ the governed commands ════════════════════

export interface ReserveLine {
  readonly partId: string;
  readonly quantity: number;
}

/** What EVERY command states explicitly. Nothing here is defaulted or derived from anything else. */
export interface ReservationContext {
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly warehouseId: string;
  readonly source: DemandSource;
  readonly actorId: string;
  /** The replay identity of THIS operation; every row derives its own key from it. */
  readonly idempotencyKey: string;
}

/** Cancel releases at every warehouse the demand holds, so it states the company but no single warehouse. */
export type CancelContext = Omit<ReservationContext, "warehouseId">;

const REASON_MAX = 200;

/**
 * THE PART IS RESOLVED FROM THE CATALOG, IN THE CALLER'S TRANSACTION, BEFORE ANY ROW IS WRITTEN.
 *
 * A serial-tracked or whole-unit Part is refused: a quantity row cannot say WHICH units, so it cannot be
 * quantity-reserved without risking a double claim of one unit. See the header, "SERIAL AND WHOLE-UNIT PARTS".
 * ALL PARTS IN ONE ROUND TRIP, before any write.
 */
async function requireCommittablePartsThroughClient(
  client: PoolClient,
  tenantId: string,
  partIds: readonly string[],
): Promise<void> {
  if (partIds.length === 0) return;
  const policies = await createPostgresPartPolicyAuthority().readPartPolicies(client, tenantId, partIds);
  for (const policy of policies) {
    if (!policy.found) {
      throw new InventoryCommitmentError(
        "PART_NOT_FOUND",
        `part ${policy.partId} is not a Part of this tenant's catalog; a commitment cannot promise an unknown Part`,
      );
    }
    if (policy.trackingMode !== "NONE") {
      throw new InventoryCommitmentError(
        "TRACKING_MODE_NOT_SUPPORTED",
        `part ${policy.partId} is ${String(policy.trackingMode)}-tracked (control type ${String(policy.controlType)}); `
        + "a quantity commitment cannot represent individually tracked units",
      );
    }
  }
}

/**
 * RESERVE ONLY. The stated company, warehouse and demand must all agree, the warehouse must be ACTIVE and the company
 * activated. Release, consume and cancel deliberately do NOT call this: they act on the commitment ROWS (which already
 * carry a company and warehouse that agreed when they were written), so a purged, renumbered or closed demand, or a
 * warehouse that has since been closed, can never strand stock. A transition stated for a company or warehouse the
 * demand holds no claim at finds no claim (NO_ACTIVE_CLAIM).
 */
async function requireStatedScope(
  client: PoolClient,
  ctx: Pick<ReservationContext, "tenantId" | "operatingCompanyKey" | "warehouseId" | "source">,
): Promise<void> {
  const wh = await client.query<{ operating_company_key: string; status: string }>(
    `SELECT operating_company_key, status::text AS status FROM ${SCHEMA}.warehouses WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, ctx.warehouseId]);
  if (!wh.rows[0]) throw new InventoryCommitmentError("WAREHOUSE_NOT_FOUND", `warehouse ${ctx.warehouseId} is not a warehouse of this tenant`);
  if (wh.rows[0].operating_company_key !== ctx.operatingCompanyKey) {
    throw new InventoryCommitmentError("COMPANY_WAREHOUSE_MISMATCH",
      "the stated warehouse does not belong to the stated operating company; company is never derived from the warehouse and the two must agree");
  }
  const s = ctx.source;
  const demand = s.kind === "WORK_ORDER"
    ? await client.query<{ operating_company_key: string }>(
        `SELECT operating_company_key FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, s.workOrderId])
    : await client.query<{ operating_company_key: string }>(
        `SELECT so.operating_company_key
           FROM eos_commercial.sales_orders so
           JOIN eos_commercial.sales_order_lines l ON l.tenant_id = so.tenant_id AND l.sales_order_id = so.id
          WHERE so.tenant_id = $1 AND so.id = $2 AND l.line_number = $3`, [ctx.tenantId, s.salesOrderId, s.lineNumber]);
  if (!demand.rows[0]) throw new InventoryCommitmentError("DEMAND_NOT_FOUND", "the demand document (or line) does not exist in this tenant");
  if (demand.rows[0].operating_company_key !== ctx.operatingCompanyKey) {
    throw new InventoryCommitmentError("DEMAND_COMPANY_MISMATCH", "the demand document belongs to a different operating company; a cross-company claim is refused");
  }
  if (wh.rows[0].status !== "ACTIVE") throw new InventoryCommitmentError("WAREHOUSE_NOT_ACTIVE", `warehouse ${ctx.warehouseId} is not ACTIVE; it cannot take a new reservation`);
  const act = await client.query(
    `SELECT 1 FROM ${SCHEMA}.stock_reservation_activation WHERE tenant_id = $1 AND operating_company_key = $2`,
    [ctx.tenantId, ctx.operatingCompanyKey]);
  if (act.rows.length === 0) {
    throw new InventoryCommitmentError("RESERVATION_NOT_ACTIVATED", "hard reservations are not yet activated for this operating company");
  }
}

/** Outstanding of one demand's claim at one company+warehouse, per Part. Negative is returned, not floored. */
async function outstandingAt(
  db: Queryable,
  ctx: Pick<ReservationContext, "tenantId" | "operatingCompanyKey" | "warehouseId" | "source">,
): Promise<Map<string, number>> {
  const s = ctx.source;
  const { rows } = await db.query<{ part_id: string; outstanding: string }>(
    `SELECT part_id, SUM(CASE event_type WHEN 'RESERVED' THEN quantity ELSE -quantity END) AS outstanding
       FROM ${SCHEMA}.inventory_commitments
      WHERE tenant_id = $1 AND operating_company_key = $2 AND warehouse_id = $3 AND ${SOURCE_PREDICATE}
      GROUP BY part_id ORDER BY part_id`,
    [ctx.tenantId, ctx.operatingCompanyKey, ctx.warehouseId, ...sourceParams(s)],
  );
  return new Map(rows.map((r) => [r.part_id, Number(r.outstanding)]));
}

/** Over parameters (workOrderId, salesOrderId, lineNumber) at $4..$6 -- a NULL parameter compares NULL, i.e. never matches. */
const SOURCE_PREDICATE = `(work_order_id = $4 OR (sales_order_id = $5 AND sales_order_line_number = $6))`;
const SOURCE_PREDICATE_AT_3 = `(work_order_id = $3 OR (sales_order_id = $4 AND sales_order_line_number = $5))`;
function sourceParams(s: DemandSource): [string | null, string | null, number | null] {
  return s.kind === "WORK_ORDER" ? [s.workOrderId, null, null] : [null, s.salesOrderId, s.lineNumber];
}

/** One advisory lock per demand (Work Order, or Sales Order line), taken before any Part lock and held to the end of the transaction. */
async function lockDemand(client: PoolClient, ctx: Pick<ReservationContext, "tenantId" | "source">): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [demandLockKey(ctx.tenantId, ctx.source)]);
}

/** The advisory-lock key of one demand. Exported so a test can hold it and prove the commands wait for it. */
export function demandLockKey(tenantId: string, s: DemandSource): string {
  const id = s.kind === "WORK_ORDER" ? `WORK_ORDER:${s.workOrderId}` : `SALES_ORDER:${s.salesOrderId}:${s.lineNumber}`;
  return `eos-commitment-demand:${tenantId}:${id}`;
}

/** Take the pool lock for every Part, in sorted order, BEFORE reading anything the decision rests on. */
async function lockParts(client: PoolClient, ctx: Pick<ReservationContext, "tenantId" | "warehouseId">, partIds: Iterable<string>): Promise<void> {
  for (const partId of [...new Set(partIds)].sort()) {
    await lockStockLocation(client, ctx.tenantId, partId, "WAREHOUSE", ctx.warehouseId);
  }
}

interface PlannedRow { readonly partId: string; readonly eventType: CommitmentEventType; readonly quantity: number; readonly warehouseId: string }

/** All rows of one operation: replayed (every one already there, identical), conflict (any differs / some missing), or null (none yet). */
async function replayOf(
  client: PoolClient,
  ctx: Pick<ReservationContext, "tenantId" | "operatingCompanyKey" | "source" | "idempotencyKey">,
  planned: readonly PlannedRow[],
): Promise<readonly CommitmentWriteResult[] | null> {
  const found: CommitmentWriteResult[] = [];
  for (const row of planned) {
    const key = derivedKey(ctx.idempotencyKey, row.eventType, row.warehouseId, row.partId);
    const existing = await readByIdempotencyKey(client, ctx.tenantId, key);
    if (!existing) continue;
    const fingerprint = commitmentFingerprint({ operatingCompanyKey: ctx.operatingCompanyKey, warehouseId: row.warehouseId, source: ctx.source, partId: row.partId, eventType: row.eventType, quantity: row.quantity });
    if (existing.fingerprint !== fingerprint) throw new CommitmentIdempotencyConflictError(key);
    found.push({ outcome: "replayed", record: existing });
  }
  if (found.length === 0) return null;
  // One transaction writes all rows or none, so "some but not all" is a reused key with different content.
  if (found.length !== planned.length) throw new CommitmentIdempotencyConflictError(ctx.idempotencyKey);
  return found;
}

async function insertPlanned(
  client: PoolClient,
  ctx: Pick<ReservationContext, "tenantId" | "operatingCompanyKey" | "source" | "idempotencyKey" | "actorId">,
  planned: readonly PlannedRow[],
): Promise<CommitmentWriteResult[]> {
  const written: CommitmentWriteResult[] = [];
  for (const row of planned) {
    written.push(await recordCommitmentEvent(client, {
      tenantId: ctx.tenantId, operatingCompanyKey: ctx.operatingCompanyKey, warehouseId: row.warehouseId, source: ctx.source,
      partId: row.partId, eventType: row.eventType, quantity: row.quantity, actorId: ctx.actorId,
      idempotencyKey: derivedKey(ctx.idempotencyKey, row.eventType, row.warehouseId, row.partId),
    }));
  }
  return written;
}

/** ONE audit row per APPLIED command. `reason` is the only free text. */
async function auditApplied(
  client: PoolClient,
  ctx: Pick<ReservationContext, "tenantId" | "operatingCompanyKey" | "source" | "actorId">,
  action: "stock.reserve" | "stock.release" | "stock.consume" | "stock.cancel",
  rows: readonly PlannedRow[],
  reason: string | null,
): Promise<void> {
  const s = ctx.source;
  await client.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
    [newId("audit"), ctx.tenantId, action, ctx.actorId,
     s.kind === "WORK_ORDER" ? "workOrder" : "salesOrderLine",
     s.kind === "WORK_ORDER" ? s.workOrderId : `${s.salesOrderId}:${s.lineNumber}`,
     JSON.stringify(await withActorAuthority(client, ctx.tenantId, ctx.actorId, {
       operatingCompanyKey: ctx.operatingCompanyKey,
       rows: rows.map((r) => ({ warehouseId: r.warehouseId, partId: r.partId, eventType: r.eventType, quantity: r.quantity })),
     })),
     reason],
  );
}

function sumLines(lines: readonly ReserveLine[]): Map<string, number> {
  const byPart = new Map<string, number>();
  for (const line of lines) {
    requirePositiveQuantity(line.quantity, line.partId);
    requireNonEmpty(line.partId, "partId");
    byPart.set(line.partId, (byPart.get(line.partId) ?? 0) + line.quantity);
  }
  return byPart;
}

function requireContext(ctx: Pick<ReservationContext, "operatingCompanyKey" | "source" | "idempotencyKey"> & { warehouseId?: string }, needWarehouse: boolean): void {
  requireCompany(ctx.operatingCompanyKey);
  requireNonEmpty(ctx.idempotencyKey, "idempotencyKey");
  if (needWarehouse) requireWarehouse(ctx.warehouseId);
  requireSource(ctx.source);
}

function requireReason(reason: unknown): string {
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > REASON_MAX) {
    throw new InventoryCommitmentError("REASON_REQUIRED", `a reason of 1..${REASON_MAX} characters is required`);
  }
  return reason.trim();
}

/**
 * RESERVE. Claim `quantity` of each Part at the stated company AND warehouse for the stated demand, ALL-OR-NOTHING in
 * one transaction. Every refusal happens before any write: UNKNOWN_STOCK (no evidence), INSUFFICIENT_STOCK (known
 * shortage), DUPLICATE_CLAIM, company/warehouse/demand disagreement, serial Part, company not activated.
 *
 * Duplicate lines for one Part are summed first. Stock-dependent checks run under the per-Part lock (see the header).
 */
export async function reserve(
  pool: Pool,
  ctx: ReservationContext,
  lines: readonly ReserveLine[],
): Promise<readonly CommitmentWriteResult[]> {
  requireContext(ctx, true);
  const byPart = sumLines(lines);
  if (byPart.size === 0) return [];
  const planned: PlannedRow[] = [...byPart.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([partId, quantity]) => ({ partId, eventType: "RESERVED" as const, quantity, warehouseId: ctx.warehouseId }));

  return inTransaction(pool, async (client) => {
    await requireCommittablePartsThroughClient(client, ctx.tenantId, [...byPart.keys()]);
    await requireStatedScope(client, ctx);
    await lockDemand(client, ctx);
    await lockParts(client, ctx, byPart.keys());

    const replay = await replayOf(client, ctx, planned);
    if (replay) return replay;

    const outstanding = await outstandingAt(client, ctx);
    for (const row of planned) {
      if ((outstanding.get(row.partId) ?? 0) > 0) {
        throw new InventoryCommitmentError("DUPLICATE_CLAIM",
          `this demand already holds an active claim on ${row.partId} at ${ctx.warehouseId}; release or consume it before claiming again`);
      }
    }
    for (const row of planned) {
      const onHand = await sellableOnHandAtWarehouse(client, ctx.tenantId, ctx.operatingCompanyKey, ctx.warehouseId, row.partId);
      if (onHand === null) {
        throw new InventoryCommitmentError("UNKNOWN_STOCK", `there is no governed stock evidence for ${row.partId} at ${ctx.warehouseId}; unknown is never read as zero or as plenty`);
      }
      const committed = await committedQuantity(client, ctx.tenantId, ctx.operatingCompanyKey, ctx.warehouseId, row.partId);
      const available = Math.max(0, onHand - committed);
      if (row.quantity > available) {
        throw new InventoryCommitmentError("INSUFFICIENT_STOCK", `need ${row.quantity} of ${row.partId} at ${ctx.warehouseId}, available ${available}`);
      }
    }
    const written = await insertPlanned(client, ctx, planned);
    await auditApplied(client, ctx, "stock.reserve", planned, null);
    return written;
  });
}

/**
 * RELEASE. End all or part of a claim without use. `lines` omitted releases everything this demand still holds at the
 * stated company and warehouse. A release larger than the outstanding claim, or against a claim that does not exist at
 * that company+warehouse, is refused before any write.
 */
export async function release(
  pool: Pool,
  ctx: ReservationContext,
  options: { readonly reason: string; readonly lines?: readonly ReserveLine[] },
): Promise<readonly CommitmentWriteResult[]> {
  requireContext(ctx, true);
  const reason = requireReason(options.reason);
  const requested = options.lines === undefined ? null : sumLines(options.lines);

  return inTransaction(pool, async (client) => {
    const plan = await planDecrease(client, ctx, "RELEASED", requested);
    if (plan.replayed) return plan.replayed;
    if (plan.rows.length === 0) return [];
    const written = await insertPlanned(client, ctx, plan.rows);
    await auditApplied(client, ctx, "stock.release", plan.rows, reason);
    return written;
  });
}

/** CONSUME. The claim ended because the quantity was used. Moves no stock: the physical removal is a separate movement. */
export async function consume(
  pool: Pool,
  ctx: ReservationContext,
  lines: readonly ReserveLine[],
): Promise<readonly CommitmentWriteResult[]> {
  requireContext(ctx, true);
  const requested = sumLines(lines);
  if (requested.size === 0) return [];
  return inTransaction(pool, async (client) => {
    const plan = await planDecrease(client, ctx, "CONSUMED", requested);
    if (plan.replayed) return plan.replayed;
    const written = await insertPlanned(client, ctx, plan.rows);
    await auditApplied(client, ctx, "stock.consume", plan.rows, null);
    return written;
  });
}

/**
 * CANCEL. The demand ended: release EVERYTHING it still holds at every warehouse of the stated company, derived from
 * the commitment LEDGER rather than from a plan (the #165 orphan fix), in one transaction, with ONE audit row. Nothing
 * outstanding writes nothing. No catalog check: a deactivated Part must not strand stock.
 */
export async function cancel(
  pool: Pool,
  ctx: CancelContext,
  options: { readonly reason: string },
): Promise<readonly CommitmentWriteResult[]> {
  requireContext(ctx, false);
  const reason = requireReason(options.reason);
  return inTransaction(pool, async (client) => {
    await lockDemand(client, ctx);
    const { rows: held } = await client.query<{ warehouse_id: string }>(
      `SELECT DISTINCT warehouse_id FROM ${SCHEMA}.inventory_commitments
        WHERE tenant_id = $1 AND operating_company_key = $2 AND ${SOURCE_PREDICATE_AT_3}
        ORDER BY warehouse_id`,
      [ctx.tenantId, ctx.operatingCompanyKey, ...sourceParams(ctx.source)]);
    const replayed: CommitmentWriteResult[] = [];
    const planned: PlannedRow[] = [];
    for (const { warehouse_id: warehouseId } of held) {
      const wctx: ReservationContext = { ...ctx, warehouseId };
      const plan = await planDecrease(client, wctx, "RELEASED", null);
      if (plan.replayed) replayed.push(...plan.replayed);
      else planned.push(...plan.rows);
    }
    if (planned.length === 0) return replayed;
    const written = await insertPlanned(client, ctx, planned);
    await auditApplied(client, ctx, "stock.cancel", planned, reason);
    return written.concat(replayed);
  });
}

/**
 * Plan a RELEASED or CONSUMED set under the Part locks. `requested === null` means "everything outstanding".
 * Returns the rows to write, or the already-written rows of this very operation (a replay).
 */
async function planDecrease(
  client: PoolClient,
  ctx: ReservationContext,
  eventType: "RELEASED" | "CONSUMED",
  requested: Map<string, number> | null,
): Promise<{ readonly rows: PlannedRow[]; readonly replayed: readonly CommitmentWriteResult[] | null }> {
  // The DEMAND lock first: every writer of this demand's claims (reserve, release, consume, cancel) takes it before any Part
  // lock, so the set of Parts this demand holds cannot change between the read below and the Part locks (no pre-lock read
  // can go stale), and the order demand -> Parts (sorted) is the same everywhere, so it cannot deadlock.
  await lockDemand(client, ctx);
  const outstandingBefore = await outstandingAt(client, ctx);
  await lockParts(client, ctx, requested ? requested.keys() : outstandingBefore.keys());

  if (requested === null) {
    // A "release everything" has no requested quantities to fingerprint: recognised by its key prefix.
    const prior = await replayByPrefix(client, ctx, eventType);
    if (prior.length > 0) return { rows: [], replayed: prior };
  } else {
    const sortedLines = [...requested.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const replay = await replayOf(client, ctx, sortedLines.map(([partId, quantity]) => ({ partId, eventType, quantity, warehouseId: ctx.warehouseId })));
    if (replay) return { rows: [], replayed: replay };
  }

  const outstanding = await outstandingAt(client, ctx);
  const rows: PlannedRow[] = [];
  const parts = requested ? [...requested.keys()].sort() : [...outstanding.keys()].sort();
  for (const partId of parts) {
    const have = outstanding.get(partId) ?? 0;
    if (requested && have <= 0) throw new InventoryCommitmentError("NO_ACTIVE_CLAIM", `this demand holds no active claim on ${partId} at ${ctx.warehouseId} for the stated company`);
    const want = requested ? (requested.get(partId) as number) : have;
    if (want > have) {
      throw new InventoryCommitmentError(eventType === "RELEASED" ? "RELEASE_EXCEEDS_OUTSTANDING" : "CONSUME_EXCEEDS_OUTSTANDING",
        `${eventType === "RELEASED" ? "release" : "consume"} of ${want} exceeds the outstanding ${have} of ${partId} at ${ctx.warehouseId}`);
    }
    if (want > 0) rows.push({ partId, eventType, quantity: want, warehouseId: ctx.warehouseId });
  }
  return { rows, replayed: null };
}

async function replayByPrefix(client: PoolClient, ctx: ReservationContext, eventType: CommitmentEventType): Promise<CommitmentWriteResult[]> {
  const prefix = `${ctx.idempotencyKey}:${eventType}:${ctx.warehouseId}:`;
  const { rows } = await client.query<CommitmentRow>(
    `SELECT ${ROW_COLUMNS} FROM ${SCHEMA}.inventory_commitments
      WHERE tenant_id = $1 AND left(idempotency_key, $3) = $2 ORDER BY part_id`,
    [ctx.tenantId, prefix, prefix.length]);
  const out = rows.map(toRecord);
  for (const r of out) {
    const same = r.operatingCompanyKey === ctx.operatingCompanyKey && r.warehouseId === ctx.warehouseId && sameSource(r.source, ctx.source);
    if (!same) throw new CommitmentIdempotencyConflictError(r.idempotencyKey);
  }
  return out.map((record) => ({ outcome: "replayed" as const, record }));
}

const sameSource = (a: DemandSource, b: DemandSource): boolean => a.kind === b.kind && (a.kind === "WORK_ORDER"
  ? a.workOrderId === (b as typeof a).workOrderId
  : a.salesOrderId === (b as typeof a).salesOrderId && a.lineNumber === (b as typeof a).lineNumber);

// ════════════════════ reads over the ledger ════════════════════

/**
 * What ONE Work Order still holds, per Part, across its warehouses: `RESERVED − RELEASED − CONSUMED`. A negative value
 * is returned as-is rather than floored, because a negative outstanding would be evidence of a real accounting fault.
 */
export async function outstandingByPart(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ part_id: string; outstanding: string }>(
    `SELECT part_id,
            SUM(CASE event_type WHEN 'RESERVED' THEN quantity ELSE -quantity END) AS outstanding
       FROM ${SCHEMA}.inventory_commitments
      WHERE tenant_id = $1 AND work_order_id = $2
      GROUP BY part_id
      ORDER BY part_id`,
    [tenantId, workOrderId],
  );
  return new Map(rows.map((row) => [row.part_id, Number(row.outstanding)]));
}

/** Every commitment event this Work Order has raised, oldest first. The evidence behind the sums. */
export async function readCommitmentHistory(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
): Promise<readonly CommitmentEventRecord[]> {
  const { rows } = await db.query<CommitmentRow>(
    `SELECT ${ROW_COLUMNS}
       FROM ${SCHEMA}.inventory_commitments
      WHERE tenant_id = $1 AND work_order_id = $2
      ORDER BY created_at, id`,
    [tenantId, workOrderId],
  );
  return rows.map(toRecord);
}


// ════════════════════ the Work Order replay authority ════════════════════

export interface WorkOrderEffectRecord {
  readonly tenantId: string;
  readonly workOrderId: string;
  readonly state: WorkOrderEffectState;
  readonly status: WorkOrderEffectStatus;
  readonly claimedBy: string;
  readonly failureMessage: string | null;
  readonly attempts: number;
}

/**
 * Claim (workOrderId, state) for processing. `true` means this caller owns the attempt.
 *
 * ONE STATEMENT, NOT A READ FOLLOWED BY A WRITE. The primary key is the serialization: the INSERT
 * claims an unseen state; the ON CONFLICT re-claims only a FAILED one; a CLAIMED or PROCESSED row
 * matches neither and the statement returns no row, which is the refusal. Two concurrent callers
 * cannot both be told `true` — the second's statement finds the first's row already committed.
 *
 * This replaces `claimStateForProcessing()`'s Firestore transaction (`inventoryService.ts:465-476`)
 * with the same guarantee and no check-then-act window at all.
 *
 * A CLAIMED row whose process died is NOT reclaimable, exactly as a Firestore `claims[state]`
 * survives a crash today. Preserved deliberately; a lease would be new behaviour, not a migration.
 */
export async function claimWorkOrderEffect(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
  state: WorkOrderEffectState,
  actorId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    // Aliased `AS effect` so the DO UPDATE clause can name the EXISTING row's columns unambiguously
    // beside EXCLUDED's (the proposed row's).
    `INSERT INTO ${SCHEMA}.work_order_inventory_effects AS effect
       (tenant_id, work_order_id, state, status, claimed_by)
     VALUES ($1, $2, $3, 'CLAIMED', $4)
     ON CONFLICT (tenant_id, work_order_id, state) DO UPDATE
        SET status = 'CLAIMED',
            claimed_by = EXCLUDED.claimed_by,
            claimed_at = now(),
            attempts = effect.attempts + 1,
            failure_message = NULL,
            failed_at = NULL,
            updated_at = now()
      WHERE effect.status = 'FAILED'
     RETURNING effect.work_order_id`,
    [tenantId, workOrderId, state, actorId],
  );
  return rows.length === 1;
}

/**
 * The effect succeeded. Marks it PROCESSED and clears the recorded failure, exactly as
 * `markStateProcessed()` deletes `failures[state]` on success.
 *
 * Only a CLAIMED row may be marked processed. A caller that never claimed cannot declare an effect
 * applied, and a PROCESSED row cannot be re-marked — both refuse rather than write.
 */
export async function markWorkOrderEffectProcessed(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
  state: WorkOrderEffectState,
): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE ${SCHEMA}.work_order_inventory_effects
        SET status = 'PROCESSED', processed_at = now(),
            failure_message = NULL, failed_at = NULL, updated_at = now()
      WHERE tenant_id = $1 AND work_order_id = $2 AND state = $3 AND status = 'CLAIMED'`,
    [tenantId, workOrderId, state],
  );
  if (rowCount !== 1) {
    throw new InventoryCommitmentError("EFFECT_NOT_CLAIMED", `${workOrderId}/${state} is not claimed by anyone; it cannot be marked processed`);
  }
}

/**
 * The effect failed. Records why, and RELEASES the claim in the same statement.
 *
 * Firestore needs two calls for this (`recordFailure()` then `clearClaim()`,
 * `inventoryService.ts:539-547`) because the failure and the claim live in different map fields. Here
 * FAILED *is* "not claimed": one status column cannot hold both, so a retry's
 * `claimWorkOrderEffect()` sees a claimable row with no second write to depend on.
 */
export async function recordWorkOrderEffectFailure(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
  state: WorkOrderEffectState,
  failureMessage: string,
): Promise<void> {
  requireNonEmpty(failureMessage, "failureMessage");
  const { rowCount } = await db.query(
    `UPDATE ${SCHEMA}.work_order_inventory_effects
        SET status = 'FAILED', failure_message = $4, failed_at = now(), updated_at = now()
      WHERE tenant_id = $1 AND work_order_id = $2 AND state = $3 AND status = 'CLAIMED'`,
    [tenantId, workOrderId, state, failureMessage],
  );
  if (rowCount !== 1) {
    throw new InventoryCommitmentError("EFFECT_NOT_CLAIMED", `${workOrderId}/${state} is not claimed by anyone; there is no attempt to fail`);
  }
}

/**
 * Has this (workOrderId, state) effect already been applied?
 *
 * The Postgres form of `hasAppliedReservation()` (`inventoryService.ts:377-382`), which asks the
 * same question of `processedStates.DISPATCHED`. An unseen Work Order is `false`, never an error:
 * "never processed" is the honest answer for a Work Order that has had no effect yet.
 */
export async function hasProcessedWorkOrderEffect(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
  state: WorkOrderEffectState,
): Promise<boolean> {
  const { rows } = await db.query<{ status: WorkOrderEffectStatus }>(
    `SELECT status FROM ${SCHEMA}.work_order_inventory_effects
      WHERE tenant_id = $1 AND work_order_id = $2 AND state = $3`,
    [tenantId, workOrderId, state],
  );
  return rows[0]?.status === "PROCESSED";
}

/** Every recorded effect for one Work Order — the operator/runbook read. */
export async function readWorkOrderEffects(
  db: Queryable,
  tenantId: string,
  workOrderId: string,
): Promise<readonly WorkOrderEffectRecord[]> {
  const { rows } = await db.query<{
    tenant_id: string; work_order_id: string; state: WorkOrderEffectState;
    status: WorkOrderEffectStatus; claimed_by: string; failure_message: string | null; attempts: number;
  }>(
    `SELECT tenant_id, work_order_id, state, status, claimed_by, failure_message, attempts
       FROM ${SCHEMA}.work_order_inventory_effects
      WHERE tenant_id = $1 AND work_order_id = $2
      ORDER BY state`,
    [tenantId, workOrderId],
  );
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    workOrderId: row.work_order_id,
    state: row.state,
    status: row.status,
    claimedBy: row.claimed_by,
    failureMessage: row.failure_message,
    attempts: Number(row.attempts),
  }));
}


// ════════════════════ internals ════════════════════

const ROW_COLUMNS = `id, tenant_id, operating_company_key, warehouse_id, work_order_id, sales_order_id,
       sales_order_line_number, part_id, event_type, quantity, idempotency_key, request_fingerprint`;

interface CommitmentRow {
  id: string;
  tenant_id: string;
  operating_company_key: string;
  warehouse_id: string;
  work_order_id: string | null;
  sales_order_id: string | null;
  sales_order_line_number: number | null;
  part_id: string;
  event_type: CommitmentEventType;
  quantity: number;
  idempotency_key: string;
  request_fingerprint: string;
}

function toRecord(row: CommitmentRow): CommitmentEventRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    operatingCompanyKey: row.operating_company_key,
    warehouseId: row.warehouse_id,
    source: row.work_order_id !== null
      ? { kind: "WORK_ORDER", workOrderId: row.work_order_id }
      : { kind: "SALES_ORDER", salesOrderId: row.sales_order_id as string, lineNumber: Number(row.sales_order_line_number) },
    workOrderId: row.work_order_id,
    partId: row.part_id,
    eventType: row.event_type,
    quantity: Number(row.quantity),
    idempotencyKey: row.idempotency_key,
    fingerprint: row.request_fingerprint,
  };
}

async function readByIdempotencyKey(
  db: Queryable,
  tenantId: string,
  idempotencyKey: string,
): Promise<CommitmentEventRecord | null> {
  const { rows } = await db.query<CommitmentRow>(
    `SELECT ${ROW_COLUMNS} FROM ${SCHEMA}.inventory_commitments WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, idempotencyKey],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Refused HERE as well as by the NOT NULL column, so a caller that omitted it gets the reason rather
 * than a constraint name — the same posture `createSheet` takes in `cycleCountRepository.ts`.
 */
function requireCompany(value: unknown): OperatingCompanyKey {
  return requireOperatingCompanyKey(value);
}

/** A hard reservation without an explicit warehouse is refused; there is no default and no derivation. */
function requireWarehouse(value: unknown): void {
  if (typeof value !== "string" || value.trim() === "" || value.trim() !== value || value.length > 200 || value.includes("/")) {
    throw new InventoryCommitmentError("WAREHOUSE_REQUIRED", "an explicit warehouse (inventory location) is required; it is never defaulted or derived from the company");
  }
}

function requireSource(source: unknown): void {
  const s = source as DemandSource | null | undefined;
  const ok = s !== null && typeof s === "object" && (
    (s.kind === "WORK_ORDER" && typeof s.workOrderId === "string" && s.workOrderId.trim() !== "")
    || (s.kind === "SALES_ORDER" && typeof s.salesOrderId === "string" && s.salesOrderId.trim() !== ""
        && Number.isInteger(s.lineNumber) && s.lineNumber > 0));
  if (!ok) throw new InventoryCommitmentError("DEMAND_REQUIRED", "exactly one demand source is required: a Work Order id, or a Sales Order id with a line number");
}

function requirePositiveQuantity(quantity: unknown, partId: string): void {
  if (!Number.isInteger(quantity) || (quantity as number) <= 0) {
    throw new InventoryCommitmentError(
      "QUANTITY_INVALID",
      `commitment quantity for ${partId} must be a positive integer; direction is carried by the event type, never by a sign`,
    );
  }
}

function requireNonEmpty(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InventoryCommitmentError("FIELD_REQUIRED", `${field} is required`);
  }
}

/** Deterministic per-row replay identity, so replaying an operation replays each row it wrote. */
function derivedKey(base: string, eventType: CommitmentEventType, warehouseId: string, partId: string): string {
  return `${base}:${eventType}:${warehouseId}:${partId}`;
}

/**
 * One transaction around a whole operation. All-or-nothing: a demand must never end up holding
 * half a reservation, which is the same rule `reserveParts()` states ("no partial reservations ever
 * land"). Never split these writes across round trips outside a transaction.
 */
async function inTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
