// THE CANONICAL SUPPLIER PURCHASE ORDER, RECEIVED ON EOS (Firebase exit B3; Owner ruling 4 of the Firebase-exit batch plan, 2026-10-17:
// "Build the EOS replacement with the complete receiving behaviour. Never retire it or substitute 'unavailable'").
//
// It replaces the Firebase callables receiveInventoryStock (source PURCHASE_ORDER), getPurchaseOrderReceivingProgress,
// listReceivablePurchaseOrders and listReceivingLocationOptions, with the SAME behaviour:
//
//   * a multi-line PURCHASE_ORDER, partial receipts over time; received / remaining DERIVED from committed receipts, never stored;
//   * over-receipt measured against REMAINING (the shared receivingBatchValidation.ts -- ONE definition of "is this receipt allowed");
//   * serial cardinality and uniqueness, LOT refused, the caller's expectedQuantity checked, optional expectedVersion;
//   * receipt identity TARGET-SCOPED (canonicalReceivingOrderDocId, the Firestore derivation unchanged), request fingerprint,
//     replay answered before the status gate and writing NOTHING, a different request under a used key refused;
//   * ONE transaction: Receiving Order + lines, a RECEIVED movement per line (per unit when serialized), serialized custody,
//     the PO version increment (concurrency control ONLY), stored status RECEIVED only when every line is satisfied, audit.
//
// THE SERIALIZATION ANCHOR is the purchase order row, locked FOR UPDATE before the replay probe and held to COMMIT (Firestore
// serialized on the PO document's version; two receipts for one order queue here and the second sees the first's receipts).
//
// COST IS UNKNOWN, NEVER ZERO. A canonical line carries no governed price (purchaseOrderNormalization.ts), exactly as in Firebase,
// so a receipt records no cost evidence; its Finance consequence is the visible COST_EVIDENCE_MISSING exception (the same one the
// recovery job would raise), in this transaction. No payable is opened, no intercompany correlation is written.
//
// COMPANY ISOLATION (#235 / #237). A purchase order belongs to one operating company. The caller must reach that company
// (resolveCompanyAuthority) -- a caller with no company authority is refused COMPANY_AUTHORITY_REQUIRED before any row is read,
// and an order of a company outside the caller's reads exactly as a nonexistent one. The destination must be an ACTIVE warehouse
// (or bin) of the SAME company where the receiver holds the WAREHOUSE Operational Scope (DQ-017): a receipt has one destination,
// so one owning company, and the order's company is it.
import type { Pool, PoolClient } from "pg";
import {
  normalizeCanonicalPurchaseOrder,
  deriveReceiptState,
  PurchaseOrderNormalizationError,
  type CommittedReceipt,
  type DerivedPurchaseOrder,
} from "../purchasing/purchaseOrderNormalization.js";
import { validateReceivingBatch, type ResolvedPartAuthority } from "../inventoryReceiving/receivingBatchValidation.js";
import type { ResolvedReceivingSource } from "../inventoryReceiving/receivingSourceResolver.js";
import { canonicalReceivingOrderDocId, fingerprintReceivingOrder } from "../inventoryReceiving/receivingIdentity.js";
import { allocateReceivingOrderNumber } from "./receivingNumbering.js";
import { projectReceiptAcquisitionCostOn, FinanceFoundationError } from "../eosFinance/financeFoundation.js";
import { insertReceivingOrder, type OpsTrackingMode } from "./purchasingRepository.js";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { InventoryScopeError, resolveScopeLocation } from "./inventoryScopeAuthority.js";
import { resolveCompanyAuthority } from "./companyAuthority.js";
import { scopedWarehouseIds } from "./partsReads.js";
import type { OpsLocationType } from "./operatingCompanyCustody.js";
import {
  ID_SHAPE, RECEIVE_STOCK_CAPABILITY, RECEIPT_STATUS, RECEIVED, ReceiveStockError, audit, insertReceivedUnits, perLineResults,
  requireActiveLocation, resolvePart, type ReceiveFailureCategory, type ReceiveLineResult, type ReceivingPrincipalActor,
} from "./receiveReorderStockCommand.js";

const SCHEMA = "eos_ops";

/** The only source authority this module owns. */
export const SUPPLIER_PO_SOURCE_KIND = "PURCHASE_ORDER";
/** Stored lifecycle states a receipt may be taken against (the Firebase RECEIVABLE_CANONICAL_STATUSES). */
export const RECEIVABLE_SUPPLIER_PO_STATUSES = Object.freeze(["APPROVED", "SENT"] as const);
/** The bound on the receivable list (the Firebase RECEIVABLE_LIST_LIMIT). */
export const RECEIVABLE_LIST_LIMIT = 100;

const refuse: (code: string, category: ReceiveFailureCategory, message: string) => never = (code, category, message) => {
  throw new ReceiveStockError(code, category, message);
};
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function requireActor(actor: ReceivingPrincipalActor): void {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
  if (!actor.capabilities.has(RECEIVE_STOCK_CAPABILITY)) {
    refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this requires ${RECEIVE_STOCK_CAPABILITY}`);
  }
}

/** The operating-company KEYS the caller reaches. Capability first, then company: none at all is a refusal, not an empty answer. */
async function reachableCompanyKeys(db: Pick<PoolClient, "query">, actor: ReceivingPrincipalActor): Promise<readonly string[]> {
  const authority = await resolveCompanyAuthority(db, actor.tenantId, actor.principalId);
  if (authority.companyKeys.length === 0) {
    refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", "receiving stock requires operating-company authority; this principal has none");
  }
  return authority.companyKeys;
}

async function inTransaction<T>(pool: Pool, mode: "write" | "snapshot", fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(mode === "snapshot" ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
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

interface PurchaseOrderRow {
  readonly id: string;
  readonly operatingCompanyKey: string;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly externalPoNumber: string | null;
  readonly status: string;
  readonly version: number;
  readonly lines: ReadonlyArray<{ readonly lineId: string; readonly partId: string; readonly quantity: number }>;
}

/** One purchase order and its lines. `lock` takes the serialization anchor. Absent or outside `companyKeys` = NOT_FOUND. */
async function readPurchaseOrder(
  c: PoolClient, tenantId: string, id: string, companyKeys: readonly string[], lock: boolean,
): Promise<PurchaseOrderRow> {
  const { rows } = await c.query(
    `SELECT p.id, p.operating_company_key, p.supplier_id, p.external_po_number, p.status, p.version, s.name AS supplier_name
       FROM ${SCHEMA}.supplier_purchase_orders p
       LEFT JOIN ${SCHEMA}.suppliers s ON s.tenant_id = p.tenant_id AND s.supplier_id = p.supplier_id
      WHERE p.tenant_id = $1 AND p.id = $2 AND p.operating_company_key = ANY($3::text[]) ${lock ? "FOR UPDATE OF p" : ""}`,
    [tenantId, id, [...companyKeys]]);
  // The company filter is IN the WHERE, so the FOR UPDATE never locks (or waits on) a foreign-company row. Outside the caller's companies
  // reads EXACTLY as a missing order: the same code and message, so no existence oracle, in the result and in the timing.
  if (rows.length === 0) {
    refuse("PURCHASE_ORDER_NOT_FOUND", "NOT_FOUND", "purchase order not found");
  }
  const lines = await c.query(
    `SELECT line_id, part_id, ordered_quantity FROM ${SCHEMA}.supplier_purchase_order_lines
      WHERE tenant_id = $1 AND purchase_order_id = $2 ORDER BY line_id`, [tenantId, id]);
  const r = rows[0];
  return {
    id: String(r.id), operatingCompanyKey: String(r.operating_company_key),
    supplierId: (r.supplier_id as string | null) ?? null, supplierName: (r.supplier_name as string | null) ?? null,
    externalPoNumber: (r.external_po_number as string | null) ?? null, status: String(r.status), version: Number(r.version),
    lines: lines.rows.map((l) => ({ lineId: String(l.line_id), partId: String(l.part_id), quantity: Number(l.ordered_quantity) })),
  };
}

/** The canonical PO exactly as the shared normalizer reads it (it was written for a document; the shape is the contract). */
function normalized(po: PurchaseOrderRow) {
  try {
    return normalizeCanonicalPurchaseOrder(po.id, {
      supplierId: po.supplierId ?? undefined, supplierName: po.supplierName ?? undefined, status: po.status,
      items: po.lines.map((l) => ({ lineId: l.lineId, partId: l.partId, quantity: l.quantity })),
    });
  } catch (err) {
    if (err instanceof PurchaseOrderNormalizationError) refuse(err.code, "PRECONDITION_FAILED", `the purchase order cannot be received: ${err.message}`);
    throw err;
  }
}

/** Every COMMITTED receipt against this order except the one being decided (so a replay validates against the state it did originally). */
async function committedReceipts(c: PoolClient, tenantId: string, purchaseOrderId: string, exceptReceivingId: string): Promise<CommittedReceipt[]> {
  const { rows } = await c.query(
    `SELECT o.id AS receiving_id, l.line_id, l.received_quantity
       FROM ${SCHEMA}.receiving_orders o
       JOIN ${SCHEMA}.receiving_order_lines l ON l.receiving_order_id = o.id AND l.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1 AND o.source_kind = $2 AND o.source_purchase_order_id = $3 AND o.status <> 'CANCELLED' AND o.id <> $4
      ORDER BY o.id, l.line_id`, [tenantId, SUPPLIER_PO_SOURCE_KIND, purchaseOrderId, exceptReceivingId]);
  const byReceipt = new Map<string, { receivingId: string; lines: Array<{ lineId: string; receivedQuantity: number }> }>();
  for (const r of rows) {
    const entry = byReceipt.get(String(r.receiving_id)) ?? { receivingId: String(r.receiving_id), lines: [] };
    entry.lines.push({ lineId: String(r.line_id), receivedQuantity: Number(r.received_quantity) });
    byReceipt.set(entry.receivingId, entry);
  }
  return [...byReceipt.values()];
}

const derivedStateOf = (lines: readonly ReceiveLineResult[]): string =>
  lines.every((l) => l.remainingQuantity === 0) ? RECEIVED
    : lines.every((l) => l.previouslyReceived + l.receivedNow === 0) ? "NOT_RECEIVED" : "PARTIALLY_RECEIVED";

const ALLOWED_TOP_KEYS = ["source", "receivingLocation", "lines", "idempotencyKey", "expectedVersion"];

// ════════════════════ READS ════════════════════

/** The canonical purchase orders that may currently be received, of the companies the caller reaches. Bounded. */
export async function listReceivableSupplierPurchaseOrders(deps: { readonly pool: Pool }, actor: ReceivingPrincipalActor, input: Record<string, unknown>) {
  requireActor(actor);
  if (isPlainObject(input) && Object.keys(input).length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", "this read accepts no input");
  return inTransaction(deps.pool, "snapshot", async (c) => {
    const keys = await reachableCompanyKeys(c, actor);
    const { rows } = await c.query(
      `SELECT p.id, p.supplier_id, p.external_po_number, p.status, s.name AS supplier_name,
              (SELECT count(*)::int FROM ${SCHEMA}.supplier_purchase_order_lines l WHERE l.tenant_id = p.tenant_id AND l.purchase_order_id = p.id) AS line_count
         FROM ${SCHEMA}.supplier_purchase_orders p
         LEFT JOIN ${SCHEMA}.suppliers s ON s.tenant_id = p.tenant_id AND s.supplier_id = p.supplier_id
        WHERE p.tenant_id = $1 AND p.status = ANY($2::text[]) AND p.operating_company_key = ANY($3::text[])
        ORDER BY p.created_at, p.id LIMIT $4`,
      [actor.tenantId, [...RECEIVABLE_SUPPLIER_PO_STATUSES], [...keys], RECEIVABLE_LIST_LIMIT]);
    return {
      purchaseOrders: rows.map((r) => ({
        purchaseOrderId: String(r.id), supplierId: (r.supplier_id as string | null) ?? null, supplierName: (r.supplier_name as string | null) ?? null,
        externalPoNumber: (r.external_po_number as string | null) ?? null, storedStatus: String(r.status), lineCount: Number(r.line_count),
      })),
    };
  });
}

/** One order's lines with SERVER-DERIVED received / remaining quantities and each Part's tracking mode (UNKNOWN, never defaulted). */
export async function readSupplierPurchaseOrderProgress(deps: { readonly pool: Pool }, actor: ReceivingPrincipalActor, input: Record<string, unknown>) {
  requireActor(actor);
  if (!isPlainObject(input) || Object.keys(input).some((k) => k !== "purchaseOrderId")) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", "this read accepts only purchaseOrderId");
  if (!ID_SHAPE(input.purchaseOrderId)) refuse("PURCHASE_ORDER_ID_REQUIRED", "INVALID_INPUT", "purchaseOrderId is required");
  return inTransaction(deps.pool, "snapshot", async (c) => {
    const keys = await reachableCompanyKeys(c, actor);
    const po = await readPurchaseOrder(c, actor.tenantId, input.purchaseOrderId as string, keys, false);
    const canonical = normalized(po);
    const derived = deriveReceiptState(canonical, await committedReceipts(c, actor.tenantId, po.id, ""));
    const modes = new Map<string, string>();
    for (const partId of new Set(canonical.lines.map((l) => l.partId))) {
      const { rows } = await c.query(`SELECT control_type::text AS control_type FROM ${SCHEMA}.parts WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, partId]);
      modes.set(partId, rows.length === 0 ? "UNKNOWN" : rows[0].control_type === "SERIALIZED" ? "SERIAL" : rows[0].control_type === "STANDARD" ? "NONE" : "UNKNOWN");
    }
    return {
      purchaseOrderId: po.id, supplierId: po.supplierId, supplierName: po.supplierName, externalPoNumber: po.externalPoNumber,
      storedStatus: po.status, derivedState: derived.state,
      receivable: (RECEIVABLE_SUPPLIER_PO_STATUSES as readonly string[]).includes(po.status), version: po.version,
      lines: derived.lines.map((l) => ({
        lineId: l.lineId, partId: l.partId, trackingMode: modes.get(l.partId) ?? "UNKNOWN", orderedQuantity: l.orderedQuantity,
        receivedQuantity: l.receivedQuantity, remainingQuantity: l.remainingQuantity, state: l.state,
      })),
    };
  });
}

/**
 * The destinations one order may be received into: every ACTIVE warehouse of the ORDER'S company where the caller holds the WAREHOUSE
 * scope (execution reach only, never administration reach). The DTO is the shape the client adapter validates ({ value, label, type }).
 * The receipt command re-decides all of it, so a bypassed picker changes nothing.
 */
export async function listSupplierReceivingLocationOptions(deps: { readonly pool: Pool }, actor: ReceivingPrincipalActor, input: Record<string, unknown>) {
  requireActor(actor);
  if (!isPlainObject(input) || Object.keys(input).some((k) => k !== "purchaseOrderId")) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", "this read accepts only purchaseOrderId");
  if (!ID_SHAPE(input.purchaseOrderId)) refuse("PURCHASE_ORDER_ID_REQUIRED", "INVALID_INPUT", "purchaseOrderId is required");
  return inTransaction(deps.pool, "snapshot", async (c) => {
    const keys = await reachableCompanyKeys(c, actor);
    const po = await readPurchaseOrder(c, actor.tenantId, input.purchaseOrderId as string, keys, false);
    const scope = await scopedWarehouseIds(c, actor, { administrationReach: false });
    const { rows } = scope.length === 0 ? { rows: [] as Array<Record<string, unknown>> } : await c.query(
      `SELECT id, name, site_label FROM ${SCHEMA}.warehouses
        WHERE tenant_id = $1 AND status::text = 'ACTIVE' AND operating_company_key = $2 AND id = ANY($3::text[]) ORDER BY name, id`,
      [actor.tenantId, po.operatingCompanyKey, scope]);
    return {
      purchaseOrderId: po.id,
      receivable: (RECEIVABLE_SUPPLIER_PO_STATUSES as readonly string[]).includes(po.status),
      options: rows.map((w) => ({ value: String(w.id), label: `${String(w.name)} (${String(w.site_label)})`, type: "WAREHOUSE" as const })),
    };
  });
}

// ════════════════════ THE RECEIPT ════════════════════

export interface ReceiveSupplierPurchaseOrderResult {
  readonly outcome: "applied" | "replayed";
  readonly receivingId: string;
  readonly receivingOrderNumber: string | null;
  readonly sourceKind: typeof SUPPLIER_PO_SOURCE_KIND;
  readonly purchaseOrderId: string;
  /** The receipt's governed business event time, ISO-8601. A replay returns the ORIGINAL. */
  readonly receivedAt: string;
  /** The first RECEIVED movement of the receipt: the Firebase `ledgerEventId`. */
  readonly ledgerEventId: string;
  readonly movementIds: readonly string[];
  readonly serializedCustodyIds: readonly string[];
  readonly lines: readonly ReceiveLineResult[];
  readonly derivedState: string;
  /** The order's stored lifecycle AFTER this receipt: RECEIVED only when every line is satisfied, otherwise unchanged. */
  readonly storedStatus: string;
  readonly version: number;
}

/**
 * Receive stock against a canonical supplier purchase order. ONE transaction, all of it or none of it.
 * `deps.now` is the receipt's business clock (a test supplies it).
 */
export async function receiveSupplierPurchaseOrder(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReceivingPrincipalActor,
  input: Record<string, unknown>,
): Promise<ReceiveSupplierPurchaseOrderResult> {
  requireActor(actor);
  if (!isPlainObject(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input).filter((k) => !ALLOWED_TOP_KEYS.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  const source = input.source;
  if (!isPlainObject(source)) refuse("SOURCE_REQUIRED", "INVALID_INPUT", "source is required");
  const src = source as Record<string, unknown>;
  if (src.type !== SUPPLIER_PO_SOURCE_KIND) {
    // NO FALLBACK between purchasing authorities: a Reorder PO is received by receiveReorderStock, and a request that names the
    // wrong one is refused, never redirected.
    refuse("SOURCE_TYPE_NOT_OWNED", "INVALID_INPUT", `this authority receives ${SUPPLIER_PO_SOURCE_KIND} only; a Reorder Purchase Order is received by receiveReorderStock`);
  }
  if (src.reorderRequestId !== undefined) refuse("SOURCE_IDENTITY_MISMATCH", "INVALID_INPUT", "a supplier purchase order source must not carry a reorderRequestId");
  if (!ID_SHAPE(src.purchaseOrderId)) refuse("PURCHASE_ORDER_ID_REQUIRED", "INVALID_INPUT", "source.purchaseOrderId is required");
  const purchaseOrderId = src.purchaseOrderId as string;
  const rawKey = input.idempotencyKey;
  if (typeof rawKey !== "string" || rawKey.trim() === "") refuse("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "idempotencyKey is required");

  return inTransaction(deps.pool, "write", async (client) => {
    // ---- 0. CAPABILITY FIRST, THEN COMPANY: none at all is refused before any row is read ----
    const companyKeys = await reachableCompanyKeys(client, actor);

    // ---- 1. THE SERIALIZATION ANCHOR. Locked first, held to COMMIT. Out-of-company == nonexistent. ----
    const po = await readPurchaseOrder(client, actor.tenantId, purchaseOrderId, companyKeys, true);
    const canonical = normalized(po);

    // ---- 2. RECEIPT IDENTITY (target-scoped), before anything is measured: it says which committed receipt to leave out ----
    const receivingId = canonicalReceivingOrderDocId({
      operation: "receiveInventoryStock", sourceType: SUPPLIER_PO_SOURCE_KIND, purchaseOrderId, actorId: actor.principalId, idempotencyKey: rawKey as string,
    });
    const derived: DerivedPurchaseOrder = deriveReceiptState(canonical, await committedReceipts(client, actor.tenantId, purchaseOrderId, receivingId));
    const resolved = {
      sourceType: SUPPLIER_PO_SOURCE_KIND, purchaseOrderId, canonical, derived, storedStatus: po.status, version: po.version, isCanonical: true,
    } as unknown as ResolvedReceivingSource;

    // ---- 3. THE PART AUTHORITY, once per distinct part ON THE ORDER'S OWN LINES (not the caller's claim) ----
    const submittedLineIds = Array.isArray(input.lines)
      ? (input.lines as unknown[]).map((l) => (isPlainObject(l) && typeof l.lineId === "string" ? l.lineId : null)).filter((v): v is string => v !== null)
      : [];
    const partsByPartId = new Map<string, ResolvedPartAuthority>();
    for (const partId of new Set(derived.lines.filter((l) => submittedLineIds.includes(l.lineId)).map((l) => l.partId))) {
      partsByPartId.set(partId, await resolvePart(client, actor.tenantId, partId));
    }

    // ---- 4. THE DESTINATION: an ACTIVE governed location of the ORDER'S company, in the receiver's warehouse scope ----
    const loc = input.receivingLocation;
    if (!isPlainObject(loc) || typeof loc.type !== "string" || !ID_SHAPE(loc.locationId)) {
      refuse("DESTINATION_INVALID", "INVALID_INPUT", "receivingLocation must name a type and a locationId");
    }
    const locationRef = { type: (loc as Record<string, unknown>).type as string, locationId: (loc as Record<string, unknown>).locationId as string };
    const destination = await requireActiveLocation(client, actor.tenantId, locationRef, companyKeys);
    // Reachable but not the order's company is the ONLY mismatch left to name; an unreachable company was already refused as nonexistent above.
    if (destination.operatingCompanyKey !== po.operatingCompanyKey) {
      refuse("DESTINATION_COMPANY_MISMATCH", "PRECONDITION_FAILED", "a purchase order is received into a warehouse of its own operating company");
    }
    let scopeWarehouseId: string;
    try {
      scopeWarehouseId = (await resolveScopeLocation(client, actor.tenantId, locationRef)).scopeWarehouseId;
    } catch (err) {
      if (err instanceof InventoryScopeError) refuse(err.code, "PRECONDITION_FAILED", `the receiving location has no governing warehouse: ${err.message}`);
      throw err;
    }
    const scoped = await authorizeObjectAction(postgresContextualReader(client), {
      actor, capabilityKey: RECEIVE_STOCK_CAPABILITY,
      predicates: [{ kind: "OPERATIONAL_SCOPE" as const, scopeType: "WAREHOUSE", scopeId: scopeWarehouseId }],
    });
    if (!scoped.allowed) {
      refuse(scoped.reason, "FORBIDDEN", scoped.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this receiving location is outside your warehouse scope"
        : scoped.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee can receive stock" : "not authorized to receive here");
    }

    // ---- 5. VALIDATE THE WHOLE BATCH, before any write (the shared validator) ----
    // A same-key RETRY of a receipt that already committed is a REPLAY (decided in step 6, writing nothing). The `expectedVersion` it carries is the
    // order's version BEFORE that receipt; the receipt itself moved the version, so checking it here would answer a lost-response retry (the offline
    // queue's normal case) with a false 412 although nothing is received twice. The replay is decided before the version check: the concurrency token
    // guards a NEW apply only. (Firebase exit B3-x, Logan's receiving proof.)
    const priorReceipt = (await client.query(
      `SELECT 1 FROM ${SCHEMA}.receiving_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, receivingId])).rows.length > 0;
    const validated = validateReceivingBatch(priorReceipt ? { ...input, expectedVersion: undefined } : input, { resolved, partsByPartId });
    if (!validated.valid) {
      const category: ReceiveFailureCategory =
        validated.reason === "over_receipt" || validated.reason === "line_already_satisfied" || validated.reason === "part_inactive"
          || validated.reason === "tracking_mode_unsupported" || validated.reason === "expected_quantity_mismatch" || validated.reason === "version_conflict"
          ? "PRECONDITION_FAILED" : "INVALID_INPUT";
      refuse(`RECEIPT_${validated.reason.toUpperCase()}`, category, `receiving input invalid: ${validated.reason}`);
    }
    const value = validated.value;
    const fingerprint = fingerprintReceivingOrder(value);

    // ---- 6. REPLAY, decided BEFORE the status gate and writing NOTHING ----
    // The receipts table is unique per (tenant, idempotency key) too: the same raw key under another actor or order would collide
    // at INSERT, so it is refused here, legibly, as a different receipt under a used key.
    const existing = await client.query(
      `SELECT id, receiving_order_number, received_at, request_fingerprint FROM ${SCHEMA}.receiving_orders
        WHERE tenant_id = $1 AND (id = $2 OR idempotency_key = $3)`, [actor.tenantId, receivingId, value.idempotencyKey]);
    const receivedNowByLine = new Map<string, number>(value.lines.map((l) => [l.lineId, l.receivedQuantity]));
    if (existing.rows.length > 0) {
      const row = existing.rows.find((r) => r.id === receivingId);
      if (row === undefined) {
        refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotency key was already used for a DIFFERENT receipt");
      }
      if ((row as Record<string, unknown>).request_fingerprint === null) {
        refuse("RECEIPT_FINGERPRINT_UNKNOWN", "CONFLICT", "this idempotency key resolves to a receipt recorded without a request fingerprint, so a replay cannot be proved");
      }
      if ((row as Record<string, unknown>).request_fingerprint !== fingerprint) {
        refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotency key was already used for a DIFFERENT receipt");
      }
      const lines = perLineResults(derived, receivedNowByLine, false);
      const moved = await client.query(
        `SELECT id FROM ${SCHEMA}.inventory_movements WHERE tenant_id = $1 AND source_kind = 'RECEIVING_ORDER' AND source_id = $2 ORDER BY id`,
        [actor.tenantId, receivingId]);
      const movementIds = moved.rows.map((m) => String(m.id));
      return {
        outcome: "replayed", receivingId, receivingOrderNumber: ((row as Record<string, unknown>).receiving_order_number as string | null) ?? null,
        sourceKind: SUPPLIER_PO_SOURCE_KIND, purchaseOrderId,
        receivedAt: ((row as Record<string, unknown>).received_at as Date).toISOString(),
        ledgerEventId: movementIds[0] ?? receivingId, movementIds, serializedCustodyIds: [],
        lines, derivedState: derivedStateOf(lines), storedStatus: po.status, version: po.version,
      } satisfies ReceiveSupplierPurchaseOrderResult;
    }

    // ---- 7. THE STATUS GATE. Only a NEW receipt is held to it. ----
    if (!(RECEIVABLE_SUPPLIER_PO_STATUSES as readonly string[]).includes(po.status)) {
      refuse("STATUS_NOT_RECEIVABLE", "PRECONDITION_FAILED", "purchase order is not in a receivable state");
    }

    // ---- 8. THE RECEIPT'S BUSINESS TIME, once; THE REFERENCE NUMBER, only on the genuine apply path ----
    const receivedAt = deps.now?.() ?? new Date();
    const receivingOrderNumber = await allocateReceivingOrderNumber(client, actor.tenantId, receivedAt.getUTCFullYear());

    await insertReceivingOrder(client, actor.tenantId, actor.principalId, po.operatingCompanyKey, {
      id: receivingId, sourceKind: SUPPLIER_PO_SOURCE_KIND, purchaseOrderId,
      receivingLocation: { type: locationRef.type as OpsLocationType, id: locationRef.locationId },
      status: RECEIPT_STATUS, receivingOrderNumber, idempotencyKey: value.idempotencyKey, requestFingerprint: fingerprint, receivedAt,
      lines: value.lines.map((l) => ({
        lineId: l.lineId, partId: l.partId, trackingMode: l.trackingMode as OpsTrackingMode,
        expectedQuantity: l.expectedQuantity, receivedQuantity: l.receivedQuantity,
        ...(l.serialNumbers === undefined ? {} : { serialNumbers: l.serialNumbers }),
      })),
    });

    const movementIds: string[] = [];
    const serializedCustodyIds: string[] = [];
    for (const line of value.lines) {
      const staged = await insertReceivedUnits(client, {
        tenantId: actor.tenantId, principalId: actor.principalId, operatingCompanyKey: po.operatingCompanyKey,
        receivingId, receivedAt, location: locationRef,
      }, line);
      movementIds.push(...staged.movementIds);
      serializedCustodyIds.push(...staged.serializedCustodyIds);
    }

    // ---- 9. THE FINANCIAL CONSEQUENCE: no price, so a visible COST_EVIDENCE_MISSING exception per line (never a zero cost) ----
    try {
      await projectReceiptAcquisitionCostOn(client, { tenantId: actor.tenantId, principalId: actor.principalId }, { receivingId });
    } catch (err) {
      if (err instanceof FinanceFoundationError) refuse(err.code, "PRECONDITION_FAILED", `the receipt's financial consequence could not be recorded: ${err.message}`);
      throw err;
    }

    // ---- 10. THE LIFECYCLE: the version increment is written on EVERY receipt (concurrency control ONLY); RECEIVED only when complete ----
    const lines = perLineResults(derived, receivedNowByLine, false);
    const fullyReceived = lines.every((l) => l.remainingQuantity === 0);
    const storedStatus = fullyReceived ? RECEIVED : po.status;
    await client.query(
      `UPDATE ${SCHEMA}.supplier_purchase_orders SET version = version + 1, status = $3, updated_by = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, purchaseOrderId, storedStatus, actor.principalId]);

    // ---- 11. AUDIT ----
    await audit(client, actor.tenantId, actor.principalId, receivingId, {
      receivingId, sourceKind: SUPPLIER_PO_SOURCE_KIND, purchaseOrderId, lineCount: value.lines.length,
      totalQuantity: value.lines.reduce((sum, l) => sum + l.receivedQuantity, 0), locationType: locationRef.type, locationId: locationRef.locationId,
      movementCount: movementIds.length, serialCount: serializedCustodyIds.length, storedStatus,
    }, receivedAt, "stock received against a supplier purchase order");

    return {
      outcome: "applied", receivingId, receivingOrderNumber, sourceKind: SUPPLIER_PO_SOURCE_KIND, purchaseOrderId,
      receivedAt: receivedAt.toISOString(), ledgerEventId: movementIds[0], movementIds, serializedCustodyIds,
      lines, derivedState: derivedStateOf(lines), storedStatus, version: po.version + 1,
    } satisfies ReceiveSupplierPurchaseOrderResult;
  });
}
