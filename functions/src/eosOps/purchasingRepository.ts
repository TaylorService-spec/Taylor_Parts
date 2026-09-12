// The eos_ops PURCHASING repository — Reorder Request, Purchase Order, Receiving Order,
// Transfer Order.
//
// ════════════════════ WHAT THIS IS, AND WHAT IT IS NOT ════════════════════
//
// The persistence + transaction-boundary contract for migration 008, in the same posture as
// cycleCountRepository.ts: it is NOT wired to any HTTP operation, no callable reaches it, and the
// deployed client does not call it. It exists so the boundary the purchasing commands will use is
// written and PROVED before any live contract moves.
//
// No Firebase. No Firestore. `pg` and the eos_ops vocabulary, nothing else.
//
// ════════════════════ THE FIVE PRESERVED RULINGS, AND WHERE EACH ONE LIVES ════════════════════
//
//   1. IMMUTABLE PURCHASE ORDER — there is no updatePurchaseOrder and no deletePurchaseOrder in
//      this module, and there is no generic "patch this table" helper a caller could reach for.
//      Migration 005 established this posture for `inventory_movements` ("the repository that will
//      be written against this table offers no update/delete method, and a static test proves it");
//      the same static test now covers this module, and migration 008 adds the structural half —
//      `purchase_orders` has no column in which a modification could be recorded.
//
//   2. PO id == REQUEST id — `recordPurchaseOrder` takes ONE id, `reorderRequestId`, and uses it as
//      the purchase order's primary key. There is no second parameter for a purchase order id, so a
//      caller cannot supply one that differs. Migration 008 makes that column simultaneously the
//      primary key and the foreign key into `reorder_requests`, so the 1:1 is the schema's, not a
//      convention this module is trusted to keep.
//
//   3. VOID WRITES A VOID RECORD — `voidPurchaseOrder` INSERTs into `purchase_order_voids` and
//      UPDATEs the REQUEST's status to VOIDED. It issues no statement at all against
//      `purchase_orders`. Both writes are in ONE transaction, because a void record with no VOIDED
//      request, or a VOIDED request with no void record, is exactly the half-state the Rules
//      contract's `existsAfter()` pairing was built to prevent.
//
//   4. NO CLIENT OPERATING-COMPANY AUTHORITY — every write takes a governed `operatingCompanyKey`
//      through `requireOperatingCompanyKey`, which refuses a missing one rather than defaulting it.
//      `recordPurchaseOrder` does not accept one at all: it reads the company from the REQUEST ROW
//      inside its own transaction, so a purchase order can only ever carry the company its request
//      already carried. That is ruling R-13/R-15 as a transaction boundary — "the company is
//      INHERITED from the historical request -- not re-derived", and here not suppliable either.
//
//   5. FAIL CLOSED — every function that reads a row it is about to act on refuses when the row is
//      absent or in the wrong state, with a typed code, before any write. Nothing is created
//      implicitly and no state is inferred from a missing value.
//
// ════════════════════ WHY THE TRANSFER LEG PROJECTION IS HERE ════════════════════
//
// `eos_ops.inventory_movements.operating_company_key` is a SCALAR (migration 007) and a transfer
// order carries a directional PAIR (migration 008). Both are correct: a movement row describes ONE
// endpoint at ONE moment, and a transfer spans two. The conversion between them is therefore a real
// function, and it lives here, ONCE — `transferLegOperatingCompanyKey`. If each future caller
// derived it locally, the dispatch path and the receipt path would each get a chance to pick the
// wrong end of the pair, and the ledger would disagree with the order about who owns a leg.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  type OperatingCompanyKey,
  type OpsLocationType,
  requireOperatingCompanyKey,
} from "./operatingCompanyCustody.js";

const SCHEMA = "eos_ops";
const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

export type OpsTrackingMode = "NONE" | "SERIAL";

/** `eos_ops.ops_reorder_request_status` — field-ops-app-vite/src/domain/constants.js, verbatim. */
export const REORDER_REQUEST_STATUSES = [
  "PENDING_REVIEW", "APPROVED", "REJECTED",
  "READY_FOR_PARTS_MANAGER", "ASSIGNED_TO_PARTS_ASSOCIATE", "PURCHASING_IN_PROGRESS",
  "ORDERED", "RECEIVED", "CANCELLED", "VOIDED",
] as const;
export type ReorderRequestStatus = (typeof REORDER_REQUEST_STATUSES)[number];

/** `eos_ops.ops_receiving_order_status`. */
export const RECEIVING_ORDER_STATUSES = ["EXPECTED", "CHECKED_IN", "PUTAWAY_COMPLETE", "CANCELLED"] as const;
export type ReceivingOrderStatus = (typeof RECEIVING_ORDER_STATUSES)[number];

/** `eos_ops.ops_receiving_source_kind` — the closed discriminator, never inferred from an id. */
export const RECEIVING_SOURCE_KINDS = ["REORDER_PURCHASE_ORDER", "PURCHASE_ORDER"] as const;
export type ReceivingSourceKind = (typeof RECEIVING_SOURCE_KINDS)[number];

/** `eos_ops.ops_transfer_order_status`. */
export const TRANSFER_ORDER_STATUSES = ["REQUESTED", "IN_TRANSIT", "COMPLETED", "CANCELLED"] as const;
export type TransferOrderStatus = (typeof TRANSFER_ORDER_STATUSES)[number];

/**
 * The state a reorder request must be in for its purchase order to be recorded.
 *
 * Unchanged from reorderCommands.ts's `PO_RECORDABLE_STATUS`, which itself is unchanged from the
 * retired Rules branch. Restating the value is unavoidable here (that module is a Firebase-adjacent
 * command core and this one may not import it), so the constant is named identically and a test
 * pins the two equal rather than leaving the duplication unguarded.
 */
export const PO_RECORDABLE_STATUS: ReorderRequestStatus = "PURCHASING_IN_PROGRESS";

/** The ONLY state a purchase order may be voided from. VOIDED is reachable from ORDERED and nowhere else. */
export const PO_VOIDABLE_STATUS: ReorderRequestStatus = "ORDERED";

export interface LocationRef {
  readonly type: OpsLocationType;
  readonly id: string;
}

/** eos_ops error idiom (see CycleCountRepositoryError): a stable `code` plus a human message. */
export class PurchasingRepositoryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PurchasingRepositoryError";
  }
}

// ════════════════════════════════ Reorder Request ════════════════════════════════

export interface ReorderRequestRecord {
  readonly id: string;
  readonly tenantId: string;
  /** Derived ONCE from the governed Warehouse at creation and never re-derived (ruling R-13). */
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly partId: string;
  readonly warehouseId: string;
  readonly status: ReorderRequestStatus;
  readonly requestedQuantity: number;
  readonly recommendedQuantity: number | null;
  readonly workOrderId: string | null;
  /** RR-YYYY-######, or null on a record created before the allocator existed. Never backfilled. */
  readonly reorderRequestNumber: string | null;
}

export interface CreateReorderRequestRow {
  readonly partId: string;
  readonly warehouseId: string;
  readonly status: ReorderRequestStatus;
  readonly requestedQuantity: number;
  readonly recommendedQuantity?: number | null;
  readonly workOrderId?: string | null;
  readonly reorderRequestNumber?: string | null;
}

export async function createReorderRequest(
  pool: Pool,
  tenantId: string,
  actorId: string,
  operatingCompanyKey: OperatingCompanyKey,
  row: CreateReorderRequestRow,
): Promise<ReorderRequestRecord> {
  // Refused HERE as well as by the NOT NULL column, so a caller that omitted it gets the reason
  // rather than a constraint name — and so no code path can quietly supply a placeholder.
  const companyKey = requireOperatingCompanyKey(operatingCompanyKey);
  const id = newId("rr");
  await pool.query(
    `INSERT INTO ${SCHEMA}.reorder_requests
       (id, tenant_id, operating_company_key, part_id, warehouse_id, status,
        requested_quantity, recommended_quantity, work_order_id, reorder_request_number,
        requested_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
    [
      id, tenantId, companyKey, row.partId, row.warehouseId, row.status,
      row.requestedQuantity, row.recommendedQuantity ?? null, row.workOrderId ?? null,
      row.reorderRequestNumber ?? null, actorId,
    ],
  );
  return {
    id,
    tenantId,
    operatingCompanyKey: companyKey,
    partId: row.partId,
    warehouseId: row.warehouseId,
    status: row.status,
    requestedQuantity: row.requestedQuantity,
    recommendedQuantity: row.recommendedQuantity ?? null,
    workOrderId: row.workOrderId ?? null,
    reorderRequestNumber: row.reorderRequestNumber ?? null,
  };
}

export async function readReorderRequest(
  pool: Pool,
  tenantId: string,
  requestId: string,
): Promise<ReorderRequestRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, operating_company_key, part_id, warehouse_id, status,
            requested_quantity, recommended_quantity, work_order_id, reorder_request_number
       FROM ${SCHEMA}.reorder_requests WHERE tenant_id = $1 AND id = $2`,
    [tenantId, requestId],
  );
  if (rows.length === 0) return null;
  return mapReorderRequestRow(rows[0]);
}

function mapReorderRequestRow(r: Record<string, unknown>): ReorderRequestRecord {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    operatingCompanyKey: r.operating_company_key as string,
    partId: r.part_id as string,
    warehouseId: r.warehouse_id as string,
    status: r.status as ReorderRequestStatus,
    requestedQuantity: r.requested_quantity as number,
    recommendedQuantity: (r.recommended_quantity as number | null) ?? null,
    workOrderId: (r.work_order_id as string | null) ?? null,
    reorderRequestNumber: (r.reorder_request_number as string | null) ?? null,
  };
}

// ════════════════════════════════ Purchase Order ════════════════════════════════

export interface PurchaseOrderRecord {
  /** IS the reorder request id. There is no second identity (ruling R-16). */
  readonly purchaseOrderId: string;
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly partId: string;
  readonly supplierName: string;
  readonly externalPoNumber: string;
  readonly orderedQuantity: number;
  /** ISO yyyy-mm-dd. A real DATE in the database; rendered back as the calendar day, not a instant. */
  readonly orderedDate: string;
  readonly expectedArrivalDate: string | null;
  /** Integer MINOR units, or null for UNKNOWN. Null is never zero. */
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
  /** Null marks a purchase order recorded before the price authority existed. Still receivable. */
  readonly priceAuthorityVersion: number | null;
}

export interface RecordPurchaseOrderInput {
  readonly supplierName: string;
  readonly externalPoNumber: string;
  readonly orderedQuantity: number;
  /** yyyy-mm-dd. */
  readonly orderedDate: string;
  readonly expectedArrivalDate?: string | null;
  readonly unitPriceMinor?: number | null;
  readonly currency?: string | null;
  readonly priceAuthorityVersion?: number | null;
}

/**
 * Record the purchase order for a reorder request, and move the request to ORDERED — BOTH HALVES,
 * ONE TRANSACTION, OR NEITHER (ruling R-16).
 *
 * There is no `purchaseOrderId` parameter and no `operatingCompanyKey` parameter, and both omissions
 * are the point:
 *
 *   · the purchase order's id IS `reorderRequestId`, so a caller has nothing to get wrong;
 *   · the company is read from the request row inside this transaction, so it is INHERITED and
 *     cannot be supplied, overridden, or re-derived from a warehouse that may since have moved.
 *
 * Fail-closed refusals, all before any write: REQUEST_NOT_FOUND, REQUEST_STATE_INVALID,
 * PO_ALREADY_EXISTS. The last one is also the schema's (the primary key), and is checked here so the
 * caller gets the domain reason rather than a unique-violation.
 */
export async function recordPurchaseOrder(
  pool: Pool,
  tenantId: string,
  actorId: string,
  reorderRequestId: string,
  input: RecordPurchaseOrderInput,
): Promise<PurchaseOrderRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE: the state check and the write must see the same row. Without it, two concurrent
    // recordings could both observe PURCHASING_IN_PROGRESS and one would then fail on the primary
    // key with an opaque error instead of the domain refusal.
    const { rows } = await client.query(
      `SELECT operating_company_key, part_id, status
         FROM ${SCHEMA}.reorder_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, reorderRequestId],
    );
    if (rows.length === 0) {
      throw new PurchasingRepositoryError("REQUEST_NOT_FOUND", `no reorder request ${reorderRequestId}`);
    }
    const request = rows[0] as { operating_company_key: string; part_id: string; status: string };
    if (request.status !== PO_RECORDABLE_STATUS) {
      throw new PurchasingRepositoryError(
        "REQUEST_STATE_INVALID",
        `reorder request is ${request.status}, not ${PO_RECORDABLE_STATUS}`,
      );
    }
    const existing = await client.query(
      `SELECT 1 FROM ${SCHEMA}.purchase_orders WHERE id = $1`,
      [reorderRequestId],
    );
    if (existing.rowCount !== 0) {
      throw new PurchasingRepositoryError("PO_ALREADY_EXISTS", "this reorder request already has a purchase order");
    }

    // INHERITED, not supplied. Still passed through the authority gate, because a request row that
    // somehow carried a blank key must not become a purchase order that claims one.
    const companyKey = requireOperatingCompanyKey(request.operating_company_key);

    const priced = input.unitPriceMinor ?? null;
    const currency = input.currency ?? null;
    await client.query(
      `INSERT INTO ${SCHEMA}.purchase_orders
         (id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number,
          ordered_quantity, ordered_date, expected_arrival_date,
          unit_price_minor, currency, price_authority_version, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11, $12, $13)`,
      [
        reorderRequestId, tenantId, companyKey, request.part_id,
        input.supplierName, input.externalPoNumber, input.orderedQuantity,
        input.orderedDate, input.expectedArrivalDate ?? null,
        priced, currency, input.priceAuthorityVersion ?? null, actorId,
      ],
    );
    await client.query(
      `UPDATE ${SCHEMA}.reorder_requests
          SET status = 'ORDERED', updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, reorderRequestId, actorId],
    );

    await client.query("COMMIT");
    return {
      purchaseOrderId: reorderRequestId,
      tenantId,
      operatingCompanyKey: companyKey,
      partId: request.part_id,
      supplierName: input.supplierName,
      externalPoNumber: input.externalPoNumber,
      orderedQuantity: input.orderedQuantity,
      orderedDate: input.orderedDate,
      expectedArrivalDate: input.expectedArrivalDate ?? null,
      unitPriceMinor: priced,
      currency,
      priceAuthorityVersion: input.priceAuthorityVersion ?? null,
    };
  } catch (err) {
    await rollbackQuietly(client);
    throw err;
  } finally {
    client.release();
  }
}

export async function readPurchaseOrder(
  pool: Pool,
  tenantId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, operating_company_key, part_id, supplier_name, external_po_number,
            ordered_quantity, to_char(ordered_date, 'YYYY-MM-DD') AS ordered_date,
            to_char(expected_arrival_date, 'YYYY-MM-DD') AS expected_arrival_date,
            unit_price_minor, currency, price_authority_version
       FROM ${SCHEMA}.purchase_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, purchaseOrderId],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    purchaseOrderId: r.id as string,
    tenantId: r.tenant_id as string,
    operatingCompanyKey: r.operating_company_key as string,
    partId: r.part_id as string,
    supplierName: r.supplier_name as string,
    externalPoNumber: r.external_po_number as string,
    orderedQuantity: r.ordered_quantity as number,
    orderedDate: r.ordered_date as string,
    expectedArrivalDate: (r.expected_arrival_date as string | null) ?? null,
    // BIGINT arrives as a string from `pg`. Parsed once, here, so no caller has to remember —
    // and money that silently stayed a string would compare and sum wrongly everywhere downstream.
    unitPriceMinor: r.unit_price_minor === null ? null : Number(r.unit_price_minor),
    currency: (r.currency as string | null) ?? null,
    priceAuthorityVersion: (r.price_authority_version as number | null) ?? null,
  };
}

// ════════════════════════════════ Purchase Order Void ════════════════════════════════

export interface PurchaseOrderVoidRecord {
  readonly purchaseOrderId: string;
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly partId: string;
  readonly reason: string;
  readonly voidedBy: string;
}

/**
 * Void a purchase order — by WRITING A VOID RECORD, never by touching the purchase order.
 *
 * This function issues no statement against `purchase_orders` at all. What it does is insert the
 * append-only void record and move the REQUEST to VOIDED, in one transaction, which is the same
 * atomic pairing firestore.rules enforced with `existsAfter()`/`getAfter()` across the two documents.
 *
 * The void record's company and part are copied from the PURCHASE ORDER row read inside this
 * transaction — not supplied, and not re-derived — so a void can never attribute itself to a company
 * or a part the purchase order it voids did not carry.
 */
export async function voidPurchaseOrder(
  pool: Pool,
  tenantId: string,
  actorId: string,
  purchaseOrderId: string,
  reason: string,
): Promise<PurchaseOrderVoidRecord> {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new PurchasingRepositoryError("VOID_REASON_REQUIRED", "a void records why, or it records nothing");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const req = await client.query(
      `SELECT status FROM ${SCHEMA}.reorder_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, purchaseOrderId],
    );
    if (req.rows.length === 0) {
      throw new PurchasingRepositoryError("REQUEST_NOT_FOUND", `no reorder request ${purchaseOrderId}`);
    }
    if ((req.rows[0] as { status: string }).status !== PO_VOIDABLE_STATUS) {
      throw new PurchasingRepositoryError(
        "REQUEST_STATE_INVALID",
        `a purchase order is voidable only from ${PO_VOIDABLE_STATUS}`,
      );
    }
    const po = await client.query(
      `SELECT operating_company_key, part_id FROM ${SCHEMA}.purchase_orders WHERE tenant_id = $1 AND id = $2`,
      [tenantId, purchaseOrderId],
    );
    if (po.rows.length === 0) {
      throw new PurchasingRepositoryError("PO_NOT_FOUND", `no purchase order ${purchaseOrderId}`);
    }
    const already = await client.query(
      `SELECT 1 FROM ${SCHEMA}.purchase_order_voids WHERE purchase_order_id = $1`,
      [purchaseOrderId],
    );
    if (already.rowCount !== 0) {
      throw new PurchasingRepositoryError("PO_ALREADY_VOIDED", "this purchase order already has a void record");
    }

    const source = po.rows[0] as { operating_company_key: string; part_id: string };
    const companyKey = requireOperatingCompanyKey(source.operating_company_key);
    await client.query(
      `INSERT INTO ${SCHEMA}.purchase_order_voids
         (purchase_order_id, tenant_id, operating_company_key, part_id, reason, voided_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [purchaseOrderId, tenantId, companyKey, source.part_id, reason, actorId],
    );
    await client.query(
      `UPDATE ${SCHEMA}.reorder_requests
          SET status = 'VOIDED', updated_by = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, purchaseOrderId, actorId],
    );

    await client.query("COMMIT");
    return {
      purchaseOrderId,
      tenantId,
      operatingCompanyKey: companyKey,
      partId: source.part_id,
      reason,
      voidedBy: actorId,
    };
  } catch (err) {
    await rollbackQuietly(client);
    throw err;
  } finally {
    client.release();
  }
}

export async function readPurchaseOrderVoid(
  pool: Pool,
  tenantId: string,
  purchaseOrderId: string,
): Promise<PurchaseOrderVoidRecord | null> {
  const { rows } = await pool.query(
    `SELECT purchase_order_id, tenant_id, operating_company_key, part_id, reason, voided_by
       FROM ${SCHEMA}.purchase_order_voids WHERE tenant_id = $1 AND purchase_order_id = $2`,
    [tenantId, purchaseOrderId],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    purchaseOrderId: r.purchase_order_id as string,
    tenantId: r.tenant_id as string,
    operatingCompanyKey: r.operating_company_key as string,
    partId: r.part_id as string,
    reason: r.reason as string,
    voidedBy: r.voided_by as string,
  };
}

// ════════════════════════════════ Receiving Order ════════════════════════════════

export interface ReceivingLineRow {
  readonly lineId: string;
  readonly partId: string;
  readonly trackingMode: OpsTrackingMode;
  readonly expectedQuantity: number;
  readonly receivedQuantity: number;
  readonly serialNumbers?: readonly string[];
}

export interface CreateReceivingOrderRow {
  readonly sourceKind: ReceivingSourceKind;
  readonly purchaseOrderId: string;
  /**
   * LEGACY ONLY. Omitted — not blank-filled — for a canonical purchase order, which has no reorder
   * request; the schema refuses the wrong combination in both directions. For the legacy chain it is
   * supplied by the caller AND checked here against the purchase order id, so the identity equation
   * fails with a reason rather than a constraint name.
   */
  readonly reorderRequestId?: string | null;
  readonly receivingLocation: LocationRef;
  readonly status: ReceivingOrderStatus;
  readonly receivingOrderNumber?: string | null;
  readonly idempotencyKey: string;
  readonly lines: readonly ReceivingLineRow[];
}

export interface ReceivingOrderRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly sourceKind: ReceivingSourceKind;
  readonly purchaseOrderId: string;
  readonly reorderRequestId: string | null;
  readonly receivingLocation: LocationRef;
  readonly status: ReceivingOrderStatus;
  readonly receivingOrderNumber: string | null;
  readonly lines: readonly ReceivingLineRow[];
}

/**
 * Create a receiving order and its lines — ONE transaction.
 *
 * An order without its lines is a receipt that received nothing, and lines without their order are
 * quantities attributed to no receipt. Neither is a legal intermediate state, so neither is
 * reachable: both writes commit together or not at all.
 */
export async function createReceivingOrder(
  pool: Pool,
  tenantId: string,
  actorId: string,
  operatingCompanyKey: OperatingCompanyKey,
  row: CreateReceivingOrderRow,
): Promise<ReceivingOrderRecord> {
  const companyKey = requireOperatingCompanyKey(operatingCompanyKey);
  if (!Array.isArray(row.lines) || row.lines.length === 0) {
    throw new PurchasingRepositoryError("RECEIPT_NO_LINES", "a receiving order records at least one line");
  }
  const legacy = row.sourceKind === "REORDER_PURCHASE_ORDER";
  const reorderRequestId = row.reorderRequestId ?? null;
  if (legacy && reorderRequestId !== row.purchaseOrderId) {
    // The legacy chain's identity equation (receivingTypes.ts: "legacy: == reorderRequestId").
    // Refused here so the caller learns WHICH rule it broke.
    throw new PurchasingRepositoryError(
      "SOURCE_IDENTITY_MISMATCH",
      "a legacy receipt's reorderRequestId IS its purchaseOrderId",
    );
  }
  if (!legacy && reorderRequestId !== null) {
    throw new PurchasingRepositoryError(
      "SOURCE_IDENTITY_MISMATCH",
      "a canonical purchase order has no reorder request; absence is the true statement",
    );
  }

  const id = newId("rcv");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ${SCHEMA}.receiving_orders
         (id, tenant_id, operating_company_key, source_kind, source_purchase_order_id,
          source_reorder_request_id, receiving_location_type, receiving_location_id,
          status, receiving_order_number, idempotency_key, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      [
        id, tenantId, companyKey, row.sourceKind, row.purchaseOrderId, reorderRequestId,
        row.receivingLocation.type, row.receivingLocation.id, row.status,
        row.receivingOrderNumber ?? null, row.idempotencyKey, actorId,
      ],
    );
    for (const line of row.lines) {
      await client.query(
        `INSERT INTO ${SCHEMA}.receiving_order_lines
           (id, tenant_id, receiving_order_id, line_id, part_id, tracking_mode,
            expected_quantity, received_quantity, serial_numbers)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          newId("rcvl"), tenantId, id, line.lineId, line.partId, line.trackingMode,
          line.expectedQuantity, line.receivedQuantity, [...(line.serialNumbers ?? [])],
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await rollbackQuietly(client);
    throw err;
  } finally {
    client.release();
  }

  return {
    id,
    tenantId,
    operatingCompanyKey: companyKey,
    sourceKind: row.sourceKind,
    purchaseOrderId: row.purchaseOrderId,
    reorderRequestId,
    receivingLocation: row.receivingLocation,
    status: row.status,
    receivingOrderNumber: row.receivingOrderNumber ?? null,
    lines: row.lines,
  };
}

export interface ReceivedByLine {
  readonly lineId: string;
  readonly receivedQuantity: number;
}

/**
 * How much of a purchase order has arrived — the SUM OF COMMITTED RECEIPTS, per line.
 *
 * DERIVED, never stored. This is purchaseOrderNormalization.ts's ruling as the only query the schema
 * permits: `purchase_orders` has no counter to read instead, so "concurrent receipts cannot lose an
 * update, an immutable document stays immutable, and every quantity traces to a receipt".
 *
 * CANCELLED receipts are excluded. A cancelled receipt is a receipt that did not happen, and summing
 * it would report stock as arrived that nothing put away.
 */
export async function readReceivedQuantities(
  pool: Pool,
  tenantId: string,
  sourceKind: ReceivingSourceKind,
  purchaseOrderId: string,
): Promise<readonly ReceivedByLine[]> {
  const { rows } = await pool.query(
    `SELECT l.line_id, SUM(l.received_quantity)::int AS received
       FROM ${SCHEMA}.receiving_order_lines l
       JOIN ${SCHEMA}.receiving_orders o
         ON o.id = l.receiving_order_id AND o.tenant_id = l.tenant_id
      WHERE l.tenant_id = $1 AND o.source_kind = $2 AND o.source_purchase_order_id = $3
        AND o.status <> 'CANCELLED'
      GROUP BY l.line_id
      ORDER BY l.line_id`,
    [tenantId, sourceKind, purchaseOrderId],
  );
  return rows.map((r) => ({ lineId: r.line_id as string, receivedQuantity: r.received as number }));
}

// ════════════════════════════════ Transfer Order ════════════════════════════════

/**
 * The two participating companies of a transfer. NEITHER is the owner.
 *
 * Both are required even when equal: a same-company transfer states the same key twice, which is a
 * fact, whereas one nullable column would make "Taylor to Taylor" and "nobody decided" the same row.
 */
export interface ParticipatingCompanies {
  readonly source: OperatingCompanyKey;
  readonly destination: OperatingCompanyKey;
}

export interface CreateTransferOrderRow {
  readonly partId: string;
  readonly trackingMode: OpsTrackingMode;
  readonly quantity: number;
  readonly origin: LocationRef;
  readonly destination: LocationRef;
  readonly serialNumbers?: readonly string[];
  readonly status: TransferOrderStatus;
  readonly transferOrderNumber?: string | null;
  readonly idempotencyKey: string;
}

export interface TransferOrderRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly companies: ParticipatingCompanies;
  /** DERIVED by the database from the pair beside it. Never written, never accepted from a caller. */
  readonly isCrossCompany: boolean;
  readonly partId: string;
  readonly trackingMode: OpsTrackingMode;
  readonly quantity: number;
  readonly origin: LocationRef;
  readonly destination: LocationRef;
  readonly serialNumbers: readonly string[];
  readonly status: TransferOrderStatus;
  readonly transferOrderNumber: string | null;
}

/** The two legs of a transfer, and the only two. */
export const TRANSFER_LEGS = ["OUT", "IN"] as const;
export type TransferLeg = (typeof TRANSFER_LEGS)[number];

/**
 * THE PAIR → SCALAR PROJECTION. The one place a transfer's directional company pair becomes the
 * single `operating_company_key` an `eos_ops.inventory_movements` row carries.
 *
 * A movement row is one-sided by construction: TRANSFER_OUT is staged at the ORIGIN when the goods
 * leave, TRANSFER_IN at the DESTINATION when they arrive. So the OUT leg belongs to the source
 * company and the IN leg to the destination company — and for a same-company transfer both resolve
 * to the same key, which is correct rather than a special case.
 *
 * This is why migration 007's scalar column is not a gap and is not widened here: widening it would
 * put the destination's authority on a row describing the origin, before the destination had
 * received anything, in a second place the destination's own row already states it.
 */
export function transferLegOperatingCompanyKey(
  companies: ParticipatingCompanies,
  leg: TransferLeg,
): OperatingCompanyKey {
  // Both are gated, not just the one selected: a pair with a blank half is not a pair, and letting
  // the OUT leg succeed on a half-pair would import a transfer whose IN leg can never be written.
  const source = requireOperatingCompanyKey(companies?.source);
  const destination = requireOperatingCompanyKey(companies?.destination);
  return leg === "OUT" ? source : destination;
}

export async function createTransferOrder(
  pool: Pool,
  tenantId: string,
  actorId: string,
  companies: ParticipatingCompanies,
  row: CreateTransferOrderRow,
): Promise<TransferOrderRecord> {
  // BOTH, never one. `requireOperatingCompanyKey` refuses a missing key rather than defaulting it,
  // so a half-pair fails here with the reason and never reaches the NOT NULL columns.
  const source = requireOperatingCompanyKey(companies?.source);
  const destination = requireOperatingCompanyKey(companies?.destination);
  const id = newId("trf");
  const serials = [...(row.serialNumbers ?? [])];
  // `is_cross_company` is deliberately absent from this INSERT: it is GENERATED ALWAYS and the
  // database refuses to be told what it is. The value below is read back, not computed here.
  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.transfer_orders
       (id, tenant_id, source_operating_company_key, destination_operating_company_key,
        part_id, tracking_mode, quantity,
        origin_location_type, origin_location_id,
        destination_location_type, destination_location_id,
        serial_numbers, status, transfer_order_number, idempotency_key, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
     RETURNING is_cross_company`,
    [
      id, tenantId, source, destination,
      row.partId, row.trackingMode, row.quantity,
      row.origin.type, row.origin.id,
      row.destination.type, row.destination.id,
      serials, row.status, row.transferOrderNumber ?? null, row.idempotencyKey, actorId,
    ],
  );
  return {
    id,
    tenantId,
    companies: { source, destination },
    isCrossCompany: (rows[0] as { is_cross_company: boolean }).is_cross_company,
    partId: row.partId,
    trackingMode: row.trackingMode,
    quantity: row.quantity,
    origin: row.origin,
    destination: row.destination,
    serialNumbers: serials,
    status: row.status,
    transferOrderNumber: row.transferOrderNumber ?? null,
  };
}

export async function readTransferOrder(
  pool: Pool,
  tenantId: string,
  transferOrderId: string,
): Promise<TransferOrderRecord | null> {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, source_operating_company_key, destination_operating_company_key,
            is_cross_company, part_id, tracking_mode, quantity,
            origin_location_type, origin_location_id,
            destination_location_type, destination_location_id,
            serial_numbers, status, transfer_order_number
       FROM ${SCHEMA}.transfer_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, transferOrderId],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    companies: {
      source: r.source_operating_company_key as string,
      destination: r.destination_operating_company_key as string,
    },
    isCrossCompany: r.is_cross_company as boolean,
    partId: r.part_id as string,
    trackingMode: r.tracking_mode as OpsTrackingMode,
    quantity: r.quantity as number,
    origin: { type: r.origin_location_type as OpsLocationType, id: r.origin_location_id as string },
    destination: {
      type: r.destination_location_type as OpsLocationType,
      id: r.destination_location_id as string,
    },
    serialNumbers: (r.serial_numbers as string[]) ?? [],
    status: r.status as TransferOrderStatus,
    transferOrderNumber: (r.transfer_order_number as string | null) ?? null,
  };
}

/**
 * Count the cross-company transfers — the RECONCILIATION read.
 *
 * Reads the generated column rather than recomputing the comparison, so what is reported is exactly
 * what the database stored, and an import's cross-company share can be checked against the source
 * census without a second opinion about what "cross-company" means.
 */
export async function countTransferOrdersByCompanyDirection(
  pool: Pool,
  tenantId: string,
): Promise<{ readonly total: number; readonly crossCompany: number; readonly sameCompany: number }> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE is_cross_company)::int AS cross_company
       FROM ${SCHEMA}.transfer_orders WHERE tenant_id = $1`,
    [tenantId],
  );
  const r = rows[0] as { total: number; cross_company: number };
  return { total: r.total, crossCompany: r.cross_company, sameCompany: r.total - r.cross_company };
}

// ════════════════════════════════ internals ════════════════════════════════

/**
 * Roll back without replacing the caller's error.
 *
 * A ROLLBACK that itself throws (a dead connection, most often) would otherwise surface INSTEAD of
 * the domain refusal that caused it, and the caller would be told the connection failed rather than
 * that its reorder request was in the wrong state.
 */
async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* the original error is the one worth reporting */
  }
}
