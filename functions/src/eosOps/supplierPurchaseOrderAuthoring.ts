// GOVERNED SUPPLIER PURCHASE ORDER AUTHORING (P-1; Owner direction 2026-10-19; resolves OD-B3-1). Creates and moves `eos_ops.supplier_purchase_orders`,
// the multi-line authority Receiving already consumes (supplierPurchaseOrderReceiving.ts). Until now NOTHING in the application wrote one.
//
// THE OWNER RULINGS THIS IMPLEMENTS (DECISIONS #P-1):
//   A  "Linked + closes them". Requests on a supplier PO move to ORDERED; receiving the PO closes them in the receipt's own transaction
//      (supplierPoRequestLinks.ts); a request is on at most ONE active PO of EITHER kind: the active-link unique index here, the guard in
//      recordReorderPurchaseOrder (purchasingRepository.ts), and the check below that refuses a request that already has a Reorder PO.
//   B  "one line each". One PO per (operating company, supplier, receiving warehouse), one line per source request.
//   C  Source requests are PURCHASING_IN_PROGRESS and the actor is the request's ASSIGNED Employee (isCallerTheAssignedEmployee).
//   D  Capabilities: supplier.purchaseOrder.create / .approve / .send / .cancel / .read. Segregation of duties: the creator cannot approve their own
//      order (SELF_APPROVAL_FORBIDDEN), even holding .approve.
//   E  Optional per-line price in integer minor units + currency (NULL is UNKNOWN, never zero); defaulted from the Part's supplier terms only when the
//      caller may read them.
//
// EVERY COMMAND is ONE transaction, in this order, and every refusal precedes any write:
//   capability -> company authority (resolveInventoryCompanyAuthority; none = COMPANY_AUTHORITY_REQUIRED) -> idempotent replay -> the records (a foreign
//   company's request / warehouse / supplier order reads EXACTLY as a nonexistent one) -> warehouse scope (create) -> preconditions -> writes -> ONE audit row.
//
// THE LIFECYCLE: DRAFT -> APPROVED -> SENT; DRAFT | APPROVED | SENT -> CANCELLED (only while nothing has been received). RECEIVED is set only by the
// receipt. Receiving accepts APPROVED and SENT. A cancelled order RELEASES its lines and returns its requests to PURCHASING_IN_PROGRESS.
//
// IDEMPOTENCY: every command carries an idempotencyKey, keyed per actor (eos_ops.supplier_po_commands) with a fingerprint of the request: the same key and
// request replays the stored answer and writes nothing; the same key with a different request is IDEMPOTENCY_CONFLICT.
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ID_SHAPE, ReceiveStockError, type ReceiveFailureCategory, type ReceivingPrincipalActor } from "./receiveReorderStockCommand.js";
import { resolveInventoryCompanyAuthority } from "./inventoryCompanyAuthority.js";
import { authorizeObjectAction, postgresContextualReader } from "./contextualAuthorization.js";
import { isCallerTheAssignedEmployee } from "./reorderAssignmentAuthority.js";
import { scopedWarehouseIds } from "./partsReads.js";
import { withActorAuthority } from "./administrationReach.js";
import { allocateSupplierPoNumber } from "./supplierPoNumbering.js";
import { CATALOG_READ_CAPABILITY, COMMERCIAL_READ_CAPABILITY, SUPPLIER_TERMS_READ_CAPABILITY } from "./partSupplierTerms.js";

const SCHEMA = "eos_ops";

export const SUPPLIER_PO_CREATE = "supplier.purchaseOrder.create";
export const SUPPLIER_PO_APPROVE = "supplier.purchaseOrder.approve";
export const SUPPLIER_PO_SEND = "supplier.purchaseOrder.send";
export const SUPPLIER_PO_CANCEL = "supplier.purchaseOrder.cancel";
export const SUPPLIER_PO_READ = "supplier.purchaseOrder.read";

/** The Reorder status a request must be in to go on a supplier PO (Owner ruling C), and the status it returns to on a cancel. */
export const SOURCE_REQUEST_STATUS = "PURCHASING_IN_PROGRESS";
export const SUPPLIER_PO_STATUSES = Object.freeze(["DRAFT", "APPROVED", "SENT", "RECEIVED", "CANCELLED"] as const);
export const SUPPLIER_PO_LIST_LIMIT = 200;
export const SUPPLIER_PO_MAX_LINES = 50;
const MAX_QUANTITY = 2_000_000_000;
/** Currencies whose minor unit is 1/100: the only ones a supplier-terms cost (a decimal in major units) is converted for. Any other stays UNKNOWN. */
const TWO_DECIMAL_CURRENCIES: readonly string[] = Object.freeze(["USD", "CAD", "EUR", "GBP", "MXN", "AUD", "NZD", "CHF"]);

type Category = ReceiveFailureCategory;
const refuse: (code: string, category: Category, message: string) => never = (code, category, message) => {
  throw new ReceiveStockError(code, category, message);
};
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v));

function requireCapability(actor: ReceivingPrincipalActor, capability: string): void {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
  if (!actor.capabilities.has(capability)) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this requires ${capability}`);
}

function acceptOnly(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input as Record<string, unknown>).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  return input as Record<string, unknown>;
}

async function reachableCompanyKeys(db: Pick<PoolClient, "query">, actor: ReceivingPrincipalActor): Promise<readonly string[]> {
  const authority = await resolveInventoryCompanyAuthority(db, actor.tenantId, actor.principalId);
  if (authority.companyKeys.length === 0) {
    refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", "supplier purchase orders require operating-company authority; this principal has none");
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

const fingerprintOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function requireIdempotencyKey(v: unknown): string {
  if (typeof v !== "string" || v.trim() === "" || v.trim() !== v || v.length > 200) {
    refuse("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "idempotencyKey is required (a trimmed, non-empty string of at most 200 characters)");
  }
  return v as string;
}

/** The replay probe. A stored command of THIS actor under this key: same fingerprint = replay (the stored answer); a different one = conflict. */
async function probeReplay(c: PoolClient, actor: ReceivingPrincipalActor, key: string, fingerprint: string, command: string): Promise<Record<string, unknown> | null> {
  const { rows } = await c.query(
    `SELECT command, request_fingerprint, result FROM ${SCHEMA}.supplier_po_commands
      WHERE tenant_id = $1 AND actor_principal_id = $2 AND idempotency_key = $3`, [actor.tenantId, actor.principalId, key]);
  if (rows.length === 0) return null;
  if (rows[0].command !== command || rows[0].request_fingerprint !== fingerprint) {
    refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotency key was already used for a DIFFERENT request");
  }
  return rows[0].result as Record<string, unknown>;
}

async function recordCommand(c: PoolClient, actor: ReceivingPrincipalActor, key: string, command: string, purchaseOrderId: string, fingerprint: string, result: unknown): Promise<void> {
  await c.query(
    `INSERT INTO ${SCHEMA}.supplier_po_commands (tenant_id, actor_principal_id, idempotency_key, command, purchase_order_id, request_fingerprint, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [actor.tenantId, actor.principalId, key, command, purchaseOrderId, fingerprint, JSON.stringify(result)]);
}

async function writeAudit(
  c: PoolClient, actor: ReceivingPrincipalActor, action: string, purchaseOrderId: string, before: unknown, after: unknown, at: Date, reason: string,
): Promise<void> {
  await c.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, 'supplier_purchase_order', $5, $6::jsonb, $7::jsonb, $8, $9)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, purchaseOrderId, before === null ? null : JSON.stringify(before),
      JSON.stringify(await withActorAuthority(c, actor.tenantId, actor.principalId, after)), at, reason]);
}

// ════════════════════ CREATE ════════════════════

interface LineInput {
  readonly reorderRequestId: string;
  readonly orderedQuantity: number | null;
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
}

function parseLines(raw: unknown): LineInput[] {
  if (!Array.isArray(raw) || raw.length === 0) refuse("LINES_REQUIRED", "INVALID_INPUT", "at least one source Reorder Request is required");
  const list = raw as unknown[];
  if (list.length > SUPPLIER_PO_MAX_LINES) refuse("TOO_MANY_LINES", "INVALID_INPUT", `a supplier purchase order carries at most ${SUPPLIER_PO_MAX_LINES} lines`);
  const seen = new Set<string>();
  return list.map((item) => {
    const l = acceptOnly(item, ["reorderRequestId", "orderedQuantity", "unitPriceMinor", "currency"]);
    if (!ID_SHAPE(l.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "every line names its source reorderRequestId");
    if (seen.has(l.reorderRequestId as string)) refuse("DUPLICATE_REQUEST", "INVALID_INPUT", "a Reorder Request appears on one line only");
    seen.add(l.reorderRequestId as string);
    const qty = l.orderedQuantity === undefined || l.orderedQuantity === null ? null : l.orderedQuantity;
    if (qty !== null && (!Number.isSafeInteger(qty) || (qty as number) <= 0 || (qty as number) > MAX_QUANTITY)) {
      refuse("QUANTITY_INVALID", "INVALID_INPUT", "orderedQuantity must be a whole number greater than zero");
    }
    // An amount without a currency, or a currency without an amount, is not a price (FIN-BLOCK-003A).
    const hasAmount = l.unitPriceMinor !== undefined && l.unitPriceMinor !== null;
    const hasCurrency = l.currency !== undefined && l.currency !== null;
    if (hasAmount !== hasCurrency) refuse("PRICE_INVALID", "INVALID_INPUT", "a price states both an amount and its currency, or neither");
    if (hasAmount && (!Number.isSafeInteger(l.unitPriceMinor) || (l.unitPriceMinor as number) < 0)) {
      refuse("PRICE_INVALID", "INVALID_INPUT", "unitPriceMinor must be a whole number of minor units (zero or more)");
    }
    if (hasCurrency && !(typeof l.currency === "string" && /^[A-Z]{3}$/.test(l.currency))) refuse("PRICE_INVALID", "INVALID_INPUT", "currency must be a three-letter code");
    return {
      reorderRequestId: l.reorderRequestId as string, orderedQuantity: qty as number | null,
      unitPriceMinor: hasAmount ? (l.unitPriceMinor as number) : null, currency: hasCurrency ? (l.currency as string) : null,
    };
  });
}

/** The Part's ACTIVE supplier terms as a default price, ONLY for a caller who may read them; otherwise (or with no terms) UNKNOWN. */
async function defaultPrice(c: PoolClient, actor: ReceivingPrincipalActor, partId: string, supplierId: string): Promise<{ minor: number; currency: string } | null> {
  const mayRead = [SUPPLIER_TERMS_READ_CAPABILITY, CATALOG_READ_CAPABILITY, COMMERCIAL_READ_CAPABILITY].every((k) => actor.capabilities.has(k));
  if (!mayRead) return null;
  const { rows } = await c.query(
    `SELECT round(cost * 100)::bigint AS minor, currency FROM ${SCHEMA}.supplier_catalog_items
      WHERE tenant_id = $1 AND part_id = $2 AND supplier_id = $3 AND status::text = 'ACTIVE'`, [actor.tenantId, partId, supplierId]);
  if (rows.length === 0 || !TWO_DECIMAL_CURRENCIES.includes(String(rows[0].currency))) return null;
  const minor = Number(rows[0].minor);
  return Number.isSafeInteger(minor) && minor >= 0 ? { minor, currency: String(rows[0].currency) } : null;
}

export interface SupplierPoLineView {
  readonly lineId: string;
  readonly reorderRequestId: string | null;
  readonly partId: string;
  readonly orderedQuantity: number;
  readonly unitPriceMinor: number | null;
  readonly currency: string | null;
}

export interface CreateSupplierPurchaseOrderResult {
  readonly outcome: "applied" | "replayed";
  readonly purchaseOrderId: string;
  readonly externalPoNumber: string;
  readonly status: "DRAFT";
  readonly version: number;
  readonly operatingCompanyKey: string;
  readonly supplierId: string;
  readonly receivingWarehouseId: string;
  readonly lines: readonly SupplierPoLineView[];
}

/**
 * Raise a DRAFT supplier purchase order from the caller's own PURCHASING_IN_PROGRESS Reorder Requests, for one supplier and one receiving warehouse.
 * The operating company is the WAREHOUSE'S, server-authored: the client never states it.
 */
export async function createSupplierPurchaseOrder(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReceivingPrincipalActor,
  input: Record<string, unknown>,
): Promise<CreateSupplierPurchaseOrderResult> {
  requireCapability(actor, SUPPLIER_PO_CREATE);
  const i = acceptOnly(input, ["supplierId", "receivingWarehouseId", "lines", "idempotencyKey"]);
  if (!ID_SHAPE(i.supplierId)) refuse("SUPPLIER_ID_REQUIRED", "INVALID_INPUT", "supplierId is required");
  if (!ID_SHAPE(i.receivingWarehouseId)) refuse("WAREHOUSE_ID_REQUIRED", "INVALID_INPUT", "receivingWarehouseId is required");
  const supplierId = i.supplierId as string;
  const warehouseId = i.receivingWarehouseId as string;
  const lines = parseLines(i.lines);
  const key = requireIdempotencyKey(i.idempotencyKey);
  const fingerprint = fingerprintOf({
    supplierId, warehouseId,
    lines: [...lines].sort((a, b) => a.reorderRequestId.localeCompare(b.reorderRequestId)),
  });

  return inTransaction(deps.pool, "write", async (c) => {
    // ---- 1. COMPANY AUTHORITY: none at all is refused before any row is read ----
    const companyKeys = await reachableCompanyKeys(c, actor);

    // ---- 2. REPLAY, writing nothing ----
    const replay = await probeReplay(c, actor, key, fingerprint, "CREATE");
    if (replay !== null) return { ...(replay as unknown as CreateSupplierPurchaseOrderResult), outcome: "replayed" as const };

    // ---- 3. THE RECEIVING WAREHOUSE: ACTIVE, of a company the caller reaches (a foreign one reads as nonexistent), in the caller's WAREHOUSE scope ----
    const wh = await c.query(
      `SELECT operating_company_key, status::text AS status FROM ${SCHEMA}.warehouses
        WHERE tenant_id = $1 AND id = $2 AND operating_company_key = ANY($3::text[])`, [actor.tenantId, warehouseId, [...companyKeys]]);
    if (wh.rows.length === 0) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such warehouse");
    if (wh.rows[0].status !== "ACTIVE") refuse("WAREHOUSE_NOT_ACTIVE", "PRECONDITION_FAILED", "the receiving warehouse is not active");
    const companyKey = String(wh.rows[0].operating_company_key);
    const scoped = await authorizeObjectAction(postgresContextualReader(c), {
      actor, capabilityKey: SUPPLIER_PO_CREATE, predicates: [{ kind: "OPERATIONAL_SCOPE" as const, scopeType: "WAREHOUSE", scopeId: warehouseId }],
    });
    if (!scoped.allowed) {
      refuse(scoped.reason, "FORBIDDEN", scoped.reason === "OUTSIDE_OPERATIONAL_SCOPE" ? "this warehouse is outside your warehouse scope"
        : scoped.reason === "EMPLOYEE_LINK_REQUIRED" ? "only an Employee can raise a supplier purchase order" : "not authorized to raise a purchase order here");
    }

    // ---- 4. THE SUPPLIER: a governed, ACTIVE external supplier ----
    const sup = await c.query(`SELECT status::text AS status FROM ${SCHEMA}.suppliers WHERE tenant_id = $1 AND supplier_id = $2`, [actor.tenantId, supplierId]);
    if (sup.rows.length === 0) refuse("SUPPLIER_NOT_FOUND", "NOT_FOUND", "no such supplier");
    if (sup.rows[0].status !== "ACTIVE") refuse("SUPPLIER_INACTIVE", "PRECONDITION_FAILED", "the supplier is not active");

    // ---- 5. THE SOURCE REQUESTS, locked in id order (no deadlock between two creates). A foreign or missing one reads identically. ----
    const ids = lines.map((l) => l.reorderRequestId);
    const found = await c.query(
      `SELECT id, part_id, warehouse_id, operating_company_key, status::text AS status, requested_quantity FROM ${SCHEMA}.reorder_requests
        WHERE tenant_id = $1 AND id = ANY($2::text[]) AND operating_company_key = ANY($3::text[]) ORDER BY id FOR UPDATE`,
      [actor.tenantId, ids, [...companyKeys]]);
    if (found.rows.length !== ids.length) refuse("REORDER_NOT_FOUND", "NOT_FOUND", "no such Reorder Request");
    const byId = new Map(found.rows.map((r) => [String(r.id), r]));
    const onPos = await c.query(
      `SELECT l.source_request_id, p.external_po_number FROM ${SCHEMA}.supplier_purchase_order_lines l
         JOIN ${SCHEMA}.supplier_purchase_orders p ON p.tenant_id = l.tenant_id AND p.id = l.purchase_order_id
        WHERE l.tenant_id = $1 AND l.source_request_id = ANY($2::text[]) AND l.link_released_at IS NULL`, [actor.tenantId, ids]);
    const reorderPos = await c.query(`SELECT id FROM ${SCHEMA}.purchase_orders WHERE tenant_id = $1 AND id = ANY($2::text[])`, [actor.tenantId, ids]);
    const priced: Array<LineInput & { partId: string; quantity: number; minor: number | null; ccy: string | null }> = [];
    for (const line of lines) {
      const r = byId.get(line.reorderRequestId) as Record<string, unknown>;
      if (onPos.rows.some((x) => x.source_request_id === line.reorderRequestId)) {
        refuse("REQUEST_ALREADY_ON_PURCHASE_ORDER", "CONFLICT", "this Reorder Request is already on a supplier purchase order");
      }
      if (reorderPos.rows.some((x) => x.id === line.reorderRequestId)) {
        refuse("REQUEST_HAS_REORDER_PURCHASE_ORDER", "CONFLICT", "this Reorder Request already has a recorded purchase order");
      }
      if (r.status !== SOURCE_REQUEST_STATUS) {
        refuse("REQUEST_NOT_ORDERABLE", "PRECONDITION_FAILED", `a Reorder Request in ${String(r.status)} cannot go on a purchase order; purchasing must be in progress`);
      }
      if (r.operating_company_key !== companyKey) refuse("REQUEST_COMPANY_MISMATCH", "PRECONDITION_FAILED", "every request on a purchase order belongs to the receiving warehouse's operating company");
      if (r.warehouse_id !== warehouseId) refuse("REQUEST_WAREHOUSE_MISMATCH", "PRECONDITION_FAILED", "every request on a purchase order is for the receiving warehouse");
      if (!(await isCallerTheAssignedEmployee(c, actor.tenantId, actor.principalId, line.reorderRequestId))) {
        refuse("NOT_THE_ASSIGNEE", "FORBIDDEN", "only the Employee a Reorder Request is assigned to may put it on a purchase order");
      }
      const quantity = line.orderedQuantity ?? Number(r.requested_quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) refuse("QUANTITY_REQUIRED", "INVALID_INPUT", "this request carries no quantity; state orderedQuantity");
      let minor = line.unitPriceMinor;
      let ccy = line.currency;
      if (minor === null) {
        const d = await defaultPrice(c, actor, String(r.part_id), supplierId);
        minor = d?.minor ?? null;
        ccy = d?.currency ?? null;
      }
      priced.push({ ...line, partId: String(r.part_id), quantity, minor, ccy });
    }

    // ---- 6. WRITES: the number (gap-safe, only on this apply path), the order, its lines, the requests -> ORDERED, the command record, ONE audit row ----
    const at = deps.now?.() ?? new Date();
    const externalPoNumber = await allocateSupplierPoNumber(c, actor.tenantId, at.getUTCFullYear());
    const purchaseOrderId = `spo-${randomUUID()}`;
    await c.query(
      `INSERT INTO ${SCHEMA}.supplier_purchase_orders
         (tenant_id, id, operating_company_key, supplier_id, external_po_number, status, version, provenance, created_by, updated_by, receiving_warehouse_id)
       VALUES ($1,$2,$3,$4,$5,'DRAFT',0,'NATIVE',$6,$6,$7)`,
      [actor.tenantId, purchaseOrderId, companyKey, supplierId, externalPoNumber, actor.principalId, warehouseId]);
    const views: SupplierPoLineView[] = [];
    for (const [n, p] of priced.entries()) {
      const lineId = `L${n + 1}`;
      await c.query(
        `INSERT INTO ${SCHEMA}.supplier_purchase_order_lines
           (tenant_id, purchase_order_id, line_id, part_id, ordered_quantity, source_request_id, unit_price_minor, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [actor.tenantId, purchaseOrderId, lineId, p.partId, p.quantity, p.reorderRequestId, p.minor, p.ccy]);
      const moved = await c.query(
        `UPDATE ${SCHEMA}.reorder_requests SET status = 'ORDERED', updated_by = $3, updated_at = $4
          WHERE tenant_id = $1 AND id = $2 AND status::text = $5`, [actor.tenantId, p.reorderRequestId, actor.principalId, at, SOURCE_REQUEST_STATUS]);
      if (moved.rowCount !== 1) refuse("REQUEST_NOT_ORDERABLE", "CONFLICT", "a Reorder Request changed while the order was raised");
      views.push({ lineId, reorderRequestId: p.reorderRequestId, partId: p.partId, orderedQuantity: p.quantity, unitPriceMinor: p.minor, currency: p.ccy });
    }
    const result: CreateSupplierPurchaseOrderResult = {
      outcome: "applied", purchaseOrderId, externalPoNumber, status: "DRAFT", version: 0, operatingCompanyKey: companyKey, supplierId,
      receivingWarehouseId: warehouseId, lines: views,
    };
    await recordCommand(c, actor, key, "CREATE", purchaseOrderId, fingerprint, result);
    await writeAudit(c, actor, "supplier.purchaseOrder.create", purchaseOrderId, null, {
      status: "DRAFT", externalPoNumber, operatingCompanyKey: companyKey, supplierId, receivingWarehouseId: warehouseId, lines: views,
    }, at, "supplier purchase order raised from purchasing requests");
    return result;
  });
}

// ════════════════════ TRANSITIONS ════════════════════

export const SUPPLIER_PO_TRANSITIONS = Object.freeze({
  APPROVE: Object.freeze({ capability: SUPPLIER_PO_APPROVE, from: Object.freeze(["DRAFT"]), to: "APPROVED" }),
  SEND: Object.freeze({ capability: SUPPLIER_PO_SEND, from: Object.freeze(["APPROVED"]), to: "SENT" }),
  CANCEL: Object.freeze({ capability: SUPPLIER_PO_CANCEL, from: Object.freeze(["DRAFT", "APPROVED", "SENT"]), to: "CANCELLED" }),
} as const);
type TransitionAction = keyof typeof SUPPLIER_PO_TRANSITIONS;

export interface TransitionSupplierPurchaseOrderResult {
  readonly outcome: "applied" | "replayed";
  readonly purchaseOrderId: string;
  readonly action: TransitionAction;
  readonly statusBefore: string;
  readonly status: string;
  readonly version: number;
  /** CANCEL only: the requests returned to PURCHASING_IN_PROGRESS. */
  readonly releasedRequestIds: readonly string[];
}

/** Approve, send or cancel a supplier purchase order. The capability is the ACTION'S own; `expectedVersion` guards a concurrent change. */
export async function transitionSupplierPurchaseOrder(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: ReceivingPrincipalActor,
  input: Record<string, unknown>,
): Promise<TransitionSupplierPurchaseOrderResult> {
  const i = acceptOnly(input, ["purchaseOrderId", "action", "expectedVersion", "reason", "idempotencyKey"]);
  const action = i.action;
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(SUPPLIER_PO_TRANSITIONS, action)) {
    refuse("ACTION_INVALID", "INVALID_INPUT", "action is APPROVE, SEND or CANCEL");
  }
  const rule = SUPPLIER_PO_TRANSITIONS[action as TransitionAction];
  requireCapability(actor, rule.capability);
  if (!ID_SHAPE(i.purchaseOrderId)) refuse("PURCHASE_ORDER_ID_REQUIRED", "INVALID_INPUT", "purchaseOrderId is required");
  if (!Number.isSafeInteger(i.expectedVersion) || (i.expectedVersion as number) < 0) refuse("EXPECTED_VERSION_REQUIRED", "INVALID_INPUT", "expectedVersion is required");
  let reason: string | null = null;
  if (i.reason !== undefined && i.reason !== null) {
    if (typeof i.reason !== "string" || i.reason.trim() === "" || i.reason.trim() !== i.reason || i.reason.length > 2000) {
      refuse("REASON_INVALID", "INVALID_INPUT", "reason must be a trimmed, non-empty string of at most 2000 characters");
    }
    reason = i.reason as string;
  }
  if (action === "CANCEL" && reason === null) refuse("CANCELLATION_REASON_REQUIRED", "INVALID_INPUT", "a cancellation states why");
  if (action !== "CANCEL" && reason !== null) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", "this command does not accept: reason");
  const key = requireIdempotencyKey(i.idempotencyKey);
  const purchaseOrderId = i.purchaseOrderId as string;
  const expectedVersion = i.expectedVersion as number;
  const fingerprint = fingerprintOf({ purchaseOrderId, action, expectedVersion, reason });

  return inTransaction(deps.pool, "write", async (c) => {
    const companyKeys = await reachableCompanyKeys(c, actor);
    const replay = await probeReplay(c, actor, key, fingerprint, action as string);
    if (replay !== null) return { ...(replay as unknown as TransitionSupplierPurchaseOrderResult), outcome: "replayed" as const };

    // The company filter is IN the WHERE: a foreign order is never locked, never waited on and reads exactly as a missing one.
    const po = await c.query(
      `SELECT status, version, created_by FROM ${SCHEMA}.supplier_purchase_orders
        WHERE tenant_id = $1 AND id = $2 AND operating_company_key = ANY($3::text[]) FOR UPDATE`, [actor.tenantId, purchaseOrderId, [...companyKeys]]);
    if (po.rows.length === 0) refuse("PURCHASE_ORDER_NOT_FOUND", "NOT_FOUND", "purchase order not found");
    const before = { status: String(po.rows[0].status), version: Number(po.rows[0].version) };
    if (before.version !== expectedVersion) refuse("PURCHASE_ORDER_VERSION_CONFLICT", "PRECONDITION_FAILED", "the purchase order changed since it was read");
    // SEGREGATION OF DUTIES (Owner ruling D): whoever raised an order does not approve it, even holding .approve.
    if (action === "APPROVE" && po.rows[0].created_by === actor.principalId) {
      refuse("SELF_APPROVAL_FORBIDDEN", "FORBIDDEN", "the Employee who raised a purchase order cannot approve it");
    }
    if (!(rule.from as readonly string[]).includes(before.status)) {
      refuse("STATUS_TRANSITION_NOT_ALLOWED", "PRECONDITION_FAILED", `a purchase order in ${before.status} cannot be ${rule.to.toLowerCase()}`);
    }
    if (action === "CANCEL") {
      const receipts = await c.query(
        `SELECT 1 FROM ${SCHEMA}.receiving_orders WHERE tenant_id = $1 AND source_kind::text = 'PURCHASE_ORDER' AND source_purchase_order_id = $2
            AND status::text <> 'CANCELLED' LIMIT 1`, [actor.tenantId, purchaseOrderId]);
      if (receipts.rows.length > 0) refuse("PURCHASE_ORDER_HAS_RECEIPTS", "PRECONDITION_FAILED", "stock has been received against this purchase order; correct the receipts first");
    }

    const at = deps.now?.() ?? new Date();
    const stamp = action === "APPROVE" ? "approved" : action === "SEND" ? "sent" : "cancelled";
    await c.query(
      `UPDATE ${SCHEMA}.supplier_purchase_orders
          SET status = $3, version = version + 1, updated_by = $4, updated_at = $5, ${stamp}_by = $4, ${stamp}_at = $5
              ${action === "CANCEL" ? ", cancellation_reason = $6" : ""}
        WHERE tenant_id = $1 AND id = $2`,
      action === "CANCEL" ? [actor.tenantId, purchaseOrderId, rule.to, actor.principalId, at, reason] : [actor.tenantId, purchaseOrderId, rule.to, actor.principalId, at]);

    const released: string[] = [];
    if (action === "CANCEL") {
      // RELEASE the lines (the request may be ordered again) and return each ORDERED request to purchasing. A request that is not ORDERED is left alone.
      const lines = await c.query(
        `UPDATE ${SCHEMA}.supplier_purchase_order_lines SET link_released_at = $3
          WHERE tenant_id = $1 AND purchase_order_id = $2 AND source_request_id IS NOT NULL AND link_released_at IS NULL
          RETURNING source_request_id`, [actor.tenantId, purchaseOrderId, at]);
      for (const l of [...lines.rows].sort((a, b) => String(a.source_request_id).localeCompare(String(b.source_request_id)))) {
        const back = await c.query(
          `UPDATE ${SCHEMA}.reorder_requests SET status = $5, updated_by = $3, updated_at = $4
            WHERE tenant_id = $1 AND id = $2 AND status::text = 'ORDERED'`, [actor.tenantId, l.source_request_id, actor.principalId, at, SOURCE_REQUEST_STATUS]);
        if (back.rowCount === 1) released.push(String(l.source_request_id));
      }
    }
    const result: TransitionSupplierPurchaseOrderResult = {
      outcome: "applied", purchaseOrderId, action: action as TransitionAction, statusBefore: before.status, status: rule.to, version: before.version + 1, releasedRequestIds: released,
    };
    await recordCommand(c, actor, key, action as string, purchaseOrderId, fingerprint, result);
    await writeAudit(c, actor, `supplier.purchaseOrder.${(action as string).toLowerCase()}`, purchaseOrderId, before,
      { status: rule.to, version: before.version + 1, releasedRequestIds: released }, at, reason ?? `supplier purchase order ${rule.to.toLowerCase()}`);
    return result;
  });
}

// ════════════════════ READS ════════════════════

/** Received per PO line, DERIVED from committed receipts (cancelled receipts excluded) -- never stored. */
const RECEIVED_LATERAL = `LEFT JOIN LATERAL (
    SELECT sum(rl.received_quantity)::int AS received FROM ${SCHEMA}.receiving_orders ro
      JOIN ${SCHEMA}.receiving_order_lines rl ON rl.tenant_id = ro.tenant_id AND rl.receiving_order_id = ro.id
     WHERE ro.tenant_id = l.tenant_id AND ro.source_kind::text = 'PURCHASE_ORDER' AND ro.source_purchase_order_id = l.purchase_order_id
       AND ro.status::text <> 'CANCELLED' AND rl.line_id = l.line_id) rc ON TRUE`;

export interface SupplierPoSummary {
  readonly purchaseOrderId: string;
  readonly externalPoNumber: string | null;
  readonly status: string;
  readonly version: number;
  readonly operatingCompanyKey: string;
  readonly supplierId: string | null;
  readonly supplierName: string | null;
  readonly receivingWarehouseId: string | null;
  /** The warehouse's own name, for display; null when none is stated or it cannot be named. */
  readonly receivingWarehouseName: string | null;
  readonly lineCount: number;
  readonly orderedQuantity: number;
  readonly receivedQuantity: number;
  readonly createdBy: string;
  readonly createdAt: string | null;
}

/** The supplier purchase orders of the companies the caller reaches, in every status. Bounded; filtered by status in the SQL. */
export async function listSupplierPurchaseOrders(deps: { readonly pool: Pool }, actor: ReceivingPrincipalActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_PO_READ);
  const i = acceptOnly(input ?? {}, ["statuses"]);
  let statuses: string[] | null = null;
  if (i.statuses !== undefined && i.statuses !== null) {
    if (!Array.isArray(i.statuses) || i.statuses.length === 0 || i.statuses.some((s) => !(SUPPLIER_PO_STATUSES as readonly string[]).includes(s as string))) {
      refuse("STATUSES_INVALID", "INVALID_INPUT", `statuses is a non-empty list of ${SUPPLIER_PO_STATUSES.join(", ")}`);
    }
    statuses = i.statuses as string[];
  }
  return inTransaction(deps.pool, "snapshot", async (c) => {
    const keys = await reachableCompanyKeys(c, actor);
    const { rows } = await c.query(
      `SELECT p.id, p.external_po_number, p.status, p.version, p.operating_company_key, p.supplier_id, s.name AS supplier_name, p.receiving_warehouse_id, w.name AS receiving_warehouse_name,
              p.created_by, p.created_at,
              (SELECT count(*)::int FROM ${SCHEMA}.supplier_purchase_order_lines l WHERE l.tenant_id = p.tenant_id AND l.purchase_order_id = p.id) AS line_count,
              (SELECT COALESCE(sum(l.ordered_quantity), 0)::int FROM ${SCHEMA}.supplier_purchase_order_lines l WHERE l.tenant_id = p.tenant_id AND l.purchase_order_id = p.id) AS ordered_quantity,
              (SELECT COALESCE(sum(rc.received), 0)::int FROM ${SCHEMA}.supplier_purchase_order_lines l ${RECEIVED_LATERAL}
                WHERE l.tenant_id = p.tenant_id AND l.purchase_order_id = p.id) AS received_quantity
         FROM ${SCHEMA}.supplier_purchase_orders p
         LEFT JOIN ${SCHEMA}.suppliers s ON s.tenant_id = p.tenant_id AND s.supplier_id = p.supplier_id
         LEFT JOIN ${SCHEMA}.warehouses w ON w.tenant_id = p.tenant_id AND w.id = p.receiving_warehouse_id AND w.operating_company_key = p.operating_company_key
        WHERE p.tenant_id = $1 AND p.operating_company_key = ANY($2::text[]) AND ($3::text[] IS NULL OR p.status = ANY($3::text[]))
        ORDER BY p.created_at DESC, p.id DESC LIMIT $4`, [actor.tenantId, [...keys], statuses, SUPPLIER_PO_LIST_LIMIT]);
    return {
      purchaseOrders: rows.map((r): SupplierPoSummary => ({
        purchaseOrderId: String(r.id), externalPoNumber: (r.external_po_number as string | null) ?? null, status: String(r.status), version: Number(r.version),
        operatingCompanyKey: String(r.operating_company_key), supplierId: (r.supplier_id as string | null) ?? null, supplierName: (r.supplier_name as string | null) ?? null,
        receivingWarehouseId: (r.receiving_warehouse_id as string | null) ?? null, receivingWarehouseName: (r.receiving_warehouse_name as string | null) ?? null,
        lineCount: Number(r.line_count), orderedQuantity: Number(r.ordered_quantity),
        receivedQuantity: Number(r.received_quantity), createdBy: String(r.created_by), createdAt: iso(r.created_at),
      })),
    };
  });
}

/** One supplier purchase order with its lines and what THIS caller may do with it now (the screen offers exactly these). */
export async function readSupplierPurchaseOrder(deps: { readonly pool: Pool }, actor: ReceivingPrincipalActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_PO_READ);
  const i = acceptOnly(input, ["purchaseOrderId"]);
  if (!ID_SHAPE(i.purchaseOrderId)) refuse("PURCHASE_ORDER_ID_REQUIRED", "INVALID_INPUT", "purchaseOrderId is required");
  return inTransaction(deps.pool, "snapshot", async (c) => {
    const keys = await reachableCompanyKeys(c, actor);
    const po = await c.query(
      `SELECT p.id, p.external_po_number, p.status, p.version, p.operating_company_key, p.supplier_id, s.name AS supplier_name, p.receiving_warehouse_id, w.name AS receiving_warehouse_name,
              p.created_by, p.created_at, p.approved_by, p.approved_at, p.sent_by, p.sent_at, p.cancelled_by, p.cancelled_at, p.cancellation_reason
         FROM ${SCHEMA}.supplier_purchase_orders p
         LEFT JOIN ${SCHEMA}.suppliers s ON s.tenant_id = p.tenant_id AND s.supplier_id = p.supplier_id
         LEFT JOIN ${SCHEMA}.warehouses w ON w.tenant_id = p.tenant_id AND w.id = p.receiving_warehouse_id AND w.operating_company_key = p.operating_company_key
        WHERE p.tenant_id = $1 AND p.id = $2 AND p.operating_company_key = ANY($3::text[])`, [actor.tenantId, i.purchaseOrderId, [...keys]]);
    if (po.rows.length === 0) refuse("PURCHASE_ORDER_NOT_FOUND", "NOT_FOUND", "purchase order not found");
    const lines = await c.query(
      `SELECT l.line_id, l.part_id, l.ordered_quantity, l.source_request_id, l.unit_price_minor, l.currency, l.link_released_at, COALESCE(rc.received, 0) AS received,
              r.reorder_request_number
         FROM ${SCHEMA}.supplier_purchase_order_lines l ${RECEIVED_LATERAL}
         LEFT JOIN ${SCHEMA}.reorder_requests r ON r.tenant_id = l.tenant_id AND r.id = l.source_request_id
        WHERE l.tenant_id = $1 AND l.purchase_order_id = $2 ORDER BY l.line_id`, [actor.tenantId, i.purchaseOrderId]);
    const p = po.rows[0];
    const status = String(p.status);
    const mayAct = (action: TransitionAction): boolean =>
      actor.capabilities.has(SUPPLIER_PO_TRANSITIONS[action].capability) && (SUPPLIER_PO_TRANSITIONS[action].from as readonly string[]).includes(status)
      && !(action === "APPROVE" && p.created_by === actor.principalId);
    return {
      purchaseOrderId: String(p.id), externalPoNumber: (p.external_po_number as string | null) ?? null, status, version: Number(p.version),
      operatingCompanyKey: String(p.operating_company_key), supplierId: (p.supplier_id as string | null) ?? null, supplierName: (p.supplier_name as string | null) ?? null,
      receivingWarehouseId: (p.receiving_warehouse_id as string | null) ?? null, receivingWarehouseName: (p.receiving_warehouse_name as string | null) ?? null,
      createdBy: String(p.created_by), createdAt: iso(p.created_at),
      approvedBy: (p.approved_by as string | null) ?? null, approvedAt: iso(p.approved_at), sentBy: (p.sent_by as string | null) ?? null, sentAt: iso(p.sent_at),
      cancelledBy: (p.cancelled_by as string | null) ?? null, cancelledAt: iso(p.cancelled_at), cancellationReason: (p.cancellation_reason as string | null) ?? null,
      receivable: status === "APPROVED" || status === "SENT",
      allowed: { approve: mayAct("APPROVE"), send: mayAct("SEND"), cancel: mayAct("CANCEL") },
      lines: lines.rows.map((l) => ({
        lineId: String(l.line_id), partId: String(l.part_id), orderedQuantity: Number(l.ordered_quantity), receivedQuantity: Number(l.received),
        reorderRequestId: (l.source_request_id as string | null) ?? null, reorderRequestNumber: (l.reorder_request_number as string | null) ?? null,
        unitPriceMinor: l.unit_price_minor === null || l.unit_price_minor === undefined ? null : Number(l.unit_price_minor), currency: (l.currency as string | null) ?? null,
        linkReleased: l.link_released_at !== null && l.link_released_at !== undefined,
      })),
    };
  });
}

/**
 * The buyer's picker: the caller's OWN requests that may go on a purchase order now (PURCHASING_IN_PROGRESS, assigned to the caller, on no PO of either
 * kind, in a warehouse of the caller's WAREHOUSE scope), the active suppliers, and -- when `supplierId` is stated and the caller may read supplier terms --
 * each request's default unit price from the Part's terms. The create command re-decides all of it.
 */
export async function listPurchasableReorderRequests(deps: { readonly pool: Pool }, actor: ReceivingPrincipalActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_PO_CREATE);
  const i = acceptOnly(input ?? {}, ["supplierId"]);
  if (i.supplierId !== undefined && i.supplierId !== null && !ID_SHAPE(i.supplierId)) refuse("SUPPLIER_ID_INVALID", "INVALID_INPUT", "supplierId must be a governed supplier id");
  const supplierId = (i.supplierId as string | undefined) ?? null;
  return inTransaction(deps.pool, "snapshot", async (c) => {
    const keys = await reachableCompanyKeys(c, actor);
    const scope = await scopedWarehouseIds(c, actor, { administrationReach: false, companyKeys: keys });
    const suppliers = await c.query(
      `SELECT supplier_id, name FROM ${SCHEMA}.suppliers WHERE tenant_id = $1 AND status::text = 'ACTIVE' ORDER BY name, supplier_id LIMIT 1000`, [actor.tenantId]);
    const { rows } = scope.length === 0 ? { rows: [] as Array<Record<string, unknown>> } : await c.query(
      `SELECT r.id, r.part_id, r.warehouse_id, r.operating_company_key, r.requested_quantity, r.reorder_request_number, w.name AS warehouse_name
         FROM ${SCHEMA}.reorder_requests r
         JOIN ${SCHEMA}.warehouses w ON w.tenant_id = r.tenant_id AND w.id = r.warehouse_id
         JOIN eos_policy.employee_principal_links lk ON lk.tenant_id = r.tenant_id AND lk.principal_id = $2 AND lk.status = 'active'
         JOIN ${SCHEMA}.reorder_request_assignments a ON a.tenant_id = r.tenant_id AND a.reorder_request_id = r.id AND a.effective_to IS NULL
                                                     AND a.assigned_employee_id = lk.employee_id
        WHERE r.tenant_id = $1 AND r.status::text = '${SOURCE_REQUEST_STATUS}' AND r.operating_company_key = ANY($3::text[]) AND r.warehouse_id = ANY($4::text[])
          AND w.status::text = 'ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.supplier_purchase_order_lines l WHERE l.tenant_id = r.tenant_id AND l.source_request_id = r.id AND l.link_released_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.purchase_orders po WHERE po.tenant_id = r.tenant_id AND po.id = r.id)
        ORDER BY r.created_at, r.id LIMIT 500`, [actor.tenantId, actor.principalId, [...keys], scope]);
    const requests = [] as Array<Record<string, unknown>>;
    for (const r of rows) {
      const d = supplierId === null ? null : await defaultPrice(c, actor, String(r.part_id), supplierId);
      requests.push({
        reorderRequestId: String(r.id), reorderRequestNumber: (r.reorder_request_number as string | null) ?? null, partId: String(r.part_id),
        warehouseId: String(r.warehouse_id), warehouseName: String(r.warehouse_name), operatingCompanyKey: String(r.operating_company_key),
        requestedQuantity: Number(r.requested_quantity), defaultUnitPriceMinor: d?.minor ?? null, defaultCurrency: d?.currency ?? null,
      });
    }
    return { requests, suppliers: suppliers.rows.map((s) => ({ supplierId: String(s.supplier_id), name: String(s.name) })) };
  });
}
