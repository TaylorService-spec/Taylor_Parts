// PARTS / PURCHASING / RECEIVING READS -- the PostgreSQL reads that make the authoritative inventory consequence visible to
// employees (Controller PARTS / PURCHASING / RECEIVING RULINGS, 2026-10-01). They replace the journey's Firebase reads:
//
//   readInventoryOnHand            inventory.transaction.read   the on-hand position, DERIVED from eos_ops.inventory_movements
//                                                              ("the sole quantity-mutating record") -- no parallel stock truth
//   listReceipts / readReceipt     receivingOrder.record.read   eos_ops.receiving_orders + lines, the one receipt representation
//   listReceivingLocationOptions   inventory.stock.receive      the governed destinations a Reorder PO may be received into
//   listSuppliers                  supplier.record.read         eos_ops.suppliers, the existing Supplier master
//
// VISIBILITY IS THE CALLER'S GOVERNED WAREHOUSE SCOPE (DQ-017 / DQ-024). A location resolves to its governing warehouse:
// a WAREHOUSE is itself, a BIN is its immutable parent, a MOBILE location only its CURRENT explicit scope binding (never
// inferred). A caller sees a row only when its Employee holds the WAREHOUSE Operational Scope over that warehouse. No
// Employee, or no scope, sees nothing -- fail closed, and the answer says so (`scopedWarehouseIds`). Tenant is always the
// resolved actor's; no tenant, company or scope is accepted from the caller.
import type { Pool, PoolClient } from "pg";
import { postgresPrincipalDimensionReader } from "./contextualAuthorization.js";
import { ReorderLifecycleError, type ReorderActor } from "./reorderLifecycleCommands.js";

export const INVENTORY_ON_HAND_READ = "inventory.transaction.read";
export const RECEIPT_READ = "receivingOrder.record.read";
export const RECEIVE_STOCK = "inventory.stock.receive";
export const SUPPLIER_READ = "supplier.record.read";

const refuse = (code: string, category: "INVALID_INPUT" | "NOT_FOUND" | "FORBIDDEN" | "PRECONDITION_FAILED", message: string): never => {
  throw new ReorderLifecycleError(code, category, message);
};
const ID = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

function acceptOnly(input: Record<string, unknown> | undefined, allowed: readonly string[]): Record<string, unknown> {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const extra = Object.keys(i).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
  return i;
}

function requireCapability(actor: ReorderActor, key: string): void {
  if (!actor || !(actor.capabilities instanceof Set) || !actor.capabilities.has(key)) refuse("CAPABILITY_MISSING", "FORBIDDEN", `this read requires ${key}`);
}

async function withReadSnapshot<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
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

/** The warehouses the caller's Employee holds the WAREHOUSE Operational Scope over. None without an Employee. */
async function scopedWarehouseIds(c: PoolClient, actor: ReorderActor): Promise<string[]> {
  const reader = postgresPrincipalDimensionReader(c);
  const employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
  if (employeeId === null) return [];
  return [...new Set((await reader.listOperationalScopes(actor.tenantId, employeeId))
    .filter((s) => s.scopeType === "WAREHOUSE").map((s) => s.scopeId))].sort();
}

/** SQL resolving (location_type, location_id) to its governing warehouse; MOBILE only through a CURRENT binding. */
const GOVERNING_WAREHOUSE = (t: string, lt: string, li: string) => `CASE ${lt}::text
    WHEN 'WAREHOUSE' THEN ${li}
    WHEN 'BIN' THEN (SELECT b.warehouse_id FROM eos_ops.bins b WHERE b.tenant_id = ${t} AND b.id = ${li})
    WHEN 'MOBILE' THEN (SELECT mb.warehouse_id FROM eos_ops.mobile_location_scope_bindings mb
                         WHERE mb.tenant_id = ${t} AND mb.location_type::text = 'MOBILE' AND mb.location_id = ${li} AND mb.effective_to IS NULL LIMIT 1)
  END`;

// ════════════════════ on-hand ════════════════════

export interface OnHandRow {
  readonly partId: string;
  readonly locationType: string;
  readonly locationId: string;
  readonly warehouseId: string;
  readonly onHand: number;
}

export async function readInventoryOnHand(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, INVENTORY_ON_HAND_READ);
  const i = acceptOnly(input, ["partIds", "warehouseId"]);
  const partIds = i.partIds === undefined || i.partIds === null ? null : i.partIds;
  if (partIds !== null && (!Array.isArray(partIds) || partIds.length === 0 || partIds.length > 500 || !partIds.every(ID))) {
    refuse("PART_IDS_INVALID", "INVALID_INPUT", "partIds, when stated, is a non-empty list of at most 500 Part ids");
  }
  const warehouseId = i.warehouseId === undefined || i.warehouseId === null ? null : i.warehouseId;
  if (warehouseId !== null && !ID(warehouseId)) refuse("WAREHOUSE_ID_INVALID", "INVALID_INPUT", "warehouseId must be a governed id");
  return withReadSnapshot(deps.pool, async (c) => {
    const scope = await scopedWarehouseIds(c, actor);
    const visible = warehouseId === null ? scope : scope.filter((w) => w === warehouseId);
    if (visible.length === 0) return { scopedWarehouseIds: scope, rows: [] as OnHandRow[], totals: [] as { partId: string; onHand: number }[] };
    const { rows } = await c.query(
      `SELECT part_id, location_type::text AS location_type, location_id, governing_warehouse_id, sum(quantity_delta)::int AS on_hand
         FROM (SELECT m.part_id, m.location_type, m.location_id, m.quantity_delta,
                      ${GOVERNING_WAREHOUSE("m.tenant_id", "m.location_type", "m.location_id")} AS governing_warehouse_id
                 FROM eos_ops.inventory_movements m
                WHERE m.tenant_id = $1 AND ($2::text[] IS NULL OR m.part_id = ANY($2::text[]))) x
        WHERE governing_warehouse_id = ANY($3::text[])
        GROUP BY 1, 2, 3, 4
       HAVING sum(quantity_delta) <> 0
        ORDER BY 1, 4, 2, 3`,
      [actor.tenantId, partIds, visible]);
    const out: OnHandRow[] = rows.map((r) => ({ partId: r.part_id, locationType: r.location_type, locationId: r.location_id,
      warehouseId: r.governing_warehouse_id, onHand: Number(r.on_hand) }));
    const totals = new Map<string, number>();
    for (const r of out) totals.set(r.partId, (totals.get(r.partId) ?? 0) + r.onHand);
    return { scopedWarehouseIds: scope, rows: out, totals: [...totals.entries()].map(([partId, onHand]) => ({ partId, onHand })) };
  });
}

// ════════════════════ receipts ════════════════════

const RECEIPT_COLUMNS = `r.id, r.receiving_order_number, r.status::text AS status, r.source_kind::text AS source_kind,
  r.source_reorder_request_id, r.source_purchase_order_id, r.receiving_location_type::text AS receiving_location_type,
  r.receiving_location_id, r.received_at, r.created_by, r.operating_company_key`;

const receiptOf = (r: Record<string, unknown>) => ({
  receiptId: r.id, receivingOrderNumber: r.receiving_order_number, status: r.status, sourceKind: r.source_kind,
  reorderRequestId: r.source_reorder_request_id ?? null, purchaseOrderId: r.source_purchase_order_id ?? null,
  receivingLocation: { type: r.receiving_location_type, locationId: r.receiving_location_id },
  warehouseId: r.governing_warehouse_id, receivedAt: r.received_at instanceof Date ? r.received_at.toISOString() : r.received_at,
  receivedByPrincipalId: r.created_by,
});

export async function listReceipts(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, RECEIPT_READ);
  const i = acceptOnly(input, ["reorderRequestId", "limit"]);
  const limit = i.limit === undefined ? 50 : i.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 200) refuse("LIMIT_INVALID", "INVALID_INPUT", "limit is 1..200");
  const reorderRequestId = i.reorderRequestId === undefined || i.reorderRequestId === null ? null : i.reorderRequestId;
  if (reorderRequestId !== null && !ID(reorderRequestId)) refuse("REORDER_REQUEST_ID_INVALID", "INVALID_INPUT", "reorderRequestId must be a governed id");
  return withReadSnapshot(deps.pool, async (c) => {
    const scope = await scopedWarehouseIds(c, actor);
    if (scope.length === 0) return { scopedWarehouseIds: scope, items: [] };
    const { rows } = await c.query(
      `SELECT * FROM (SELECT ${RECEIPT_COLUMNS}, ${GOVERNING_WAREHOUSE("r.tenant_id", "r.receiving_location_type", "r.receiving_location_id")} AS governing_warehouse_id
                        FROM eos_ops.receiving_orders r
                       WHERE r.tenant_id = $1 AND ($2::text IS NULL OR r.source_reorder_request_id = $2)) x
        WHERE governing_warehouse_id = ANY($3::text[])
        ORDER BY received_at DESC, id DESC LIMIT $4`,
      [actor.tenantId, reorderRequestId, scope, limit]);
    return { scopedWarehouseIds: scope, items: rows.map(receiptOf) };
  });
}

export async function readReceipt(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, RECEIPT_READ);
  const i = acceptOnly(input, ["receiptId"]);
  if (!ID(i.receiptId)) refuse("RECEIPT_ID_REQUIRED", "INVALID_INPUT", "receiptId is required");
  return withReadSnapshot(deps.pool, async (c) => {
    const scope = await scopedWarehouseIds(c, actor);
    const { rows } = await c.query(
      `SELECT ${RECEIPT_COLUMNS}, ${GOVERNING_WAREHOUSE("r.tenant_id", "r.receiving_location_type", "r.receiving_location_id")} AS governing_warehouse_id
         FROM eos_ops.receiving_orders r WHERE r.tenant_id = $1 AND r.id = $2`, [actor.tenantId, i.receiptId]);
    // Outside scope answers exactly as missing: no existence oracle.
    if (rows.length === 0 || !scope.includes(String(rows[0].governing_warehouse_id))) refuse("RECEIPT_NOT_FOUND", "NOT_FOUND", "no such receipt");
    const lines = await c.query(
      `SELECT line_id, part_id, expected_quantity, received_quantity, serial_numbers FROM eos_ops.receiving_order_lines
        WHERE tenant_id = $1 AND receiving_order_id = $2 ORDER BY line_id`, [actor.tenantId, i.receiptId]);
    return { ...receiptOf(rows[0]), lines: lines.rows.map((l) => ({ lineId: l.line_id, partId: l.part_id,
      expectedQuantity: l.expected_quantity === null ? null : Number(l.expected_quantity), receivedQuantity: Number(l.received_quantity),
      serialNumbers: l.serial_numbers ?? [] })) };
  });
}

// ════════════════════ receiving destinations ════════════════════

/**
 * The governed destinations a Reorder PO may be received into (DQ-C): ITS OWN destination warehouse, and that warehouse's
 * ACTIVE bins -- only when the warehouse is ACTIVE and the caller holds the WAREHOUSE scope over it. Never another
 * warehouse. The receipt command re-decides all of it, so a bypassed picker changes nothing.
 */
export async function listReceivingLocationOptions(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, RECEIVE_STOCK);
  const i = acceptOnly(input, ["reorderRequestId"]);
  if (!ID(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
  return withReadSnapshot(deps.pool, async (c) => {
    const rr = await c.query(`SELECT warehouse_id, status::text AS status FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, i.reorderRequestId]);
    const scope = await scopedWarehouseIds(c, actor);
    if (rr.rows.length === 0 || !scope.includes(String(rr.rows[0].warehouse_id))) refuse("REORDER_NOT_FOUND", "NOT_FOUND", "no receivable Reorder Request in your warehouse scope");
    const wh = await c.query(`SELECT id, name, site_label, status::text AS status FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, rr.rows[0].warehouse_id]);
    if (wh.rows.length === 0 || wh.rows[0].status !== "ACTIVE") return { reorderRequestId: i.reorderRequestId, receivable: rr.rows[0].status === "ORDERED", options: [] };
    const bins = await c.query(`SELECT id, code, name FROM eos_ops.bins WHERE tenant_id = $1 AND warehouse_id = $2 AND status::text = 'ACTIVE' ORDER BY code`, [actor.tenantId, wh.rows[0].id]);
    return {
      reorderRequestId: i.reorderRequestId,
      receivable: rr.rows[0].status === "ORDERED",
      options: [
        { type: "WAREHOUSE", locationId: wh.rows[0].id, label: `${wh.rows[0].name} (${wh.rows[0].site_label})`, warehouseId: wh.rows[0].id },
        ...bins.rows.map((b) => ({ type: "BIN", locationId: b.id, label: b.name ? `${b.code} — ${b.name}` : b.code, warehouseId: wh.rows[0].id })),
      ],
    };
  });
}

// ════════════════════ suppliers ════════════════════

export async function listSuppliers(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_READ);
  const i = acceptOnly(input, ["status"]);
  const status = i.status === undefined || i.status === null ? null : i.status;
  if (status !== null && (typeof status !== "string" || !/^[A-Z_]{1,40}$/.test(status))) refuse("STATUS_INVALID", "INVALID_INPUT", "status must be a governed Supplier status");
  return withReadSnapshot(deps.pool, async (c) => {
    const { rows } = await c.query(
      `SELECT supplier_id, name, status::text AS status, vendor_number, contact_name, phone, email, address, payment_terms_ref, notes, version, updated_at
         FROM eos_ops.suppliers WHERE tenant_id = $1 AND ($2::text IS NULL OR status::text = $2) ORDER BY name, supplier_id LIMIT 1000`,
      [actor.tenantId, status]);
    return { items: rows.map((r) => ({ supplierId: r.supplier_id, name: r.name, status: r.status, vendorNumber: r.vendor_number ?? null,
      contactName: r.contact_name ?? null, phone: r.phone ?? null, email: r.email ?? null, address: r.address ?? null,
      paymentTermsRef: r.payment_terms_ref ?? null, notes: r.notes ?? null, version: Number(r.version),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at })) };
  });
}

// ════════════════════ movement history ════════════════════

/**
 * The movement history behind the on-hand position, for a screen that shows a Part's ledger and derives usage from it --
 * the same eos_ops.inventory_movements rows, in the caller's governed warehouse scope, newest first, bounded. Each row
 * carries its SIGNED quantity_delta exactly as recorded; nothing is re-signed client-side.
 */
export async function readInventoryMovements(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, INVENTORY_ON_HAND_READ);
  const i = acceptOnly(input, ["partIds", "limit"]);
  const partIds = i.partIds === undefined || i.partIds === null ? null : i.partIds;
  if (partIds !== null && (!Array.isArray(partIds) || partIds.length === 0 || partIds.length > 500 || !partIds.every(ID))) {
    refuse("PART_IDS_INVALID", "INVALID_INPUT", "partIds, when stated, is a non-empty list of at most 500 Part ids");
  }
  const limit = i.limit === undefined ? 1000 : i.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 5000) refuse("LIMIT_INVALID", "INVALID_INPUT", "limit is 1..5000");
  return withReadSnapshot(deps.pool, async (c) => {
    const scope = await scopedWarehouseIds(c, actor);
    if (scope.length === 0) return { scopedWarehouseIds: scope, items: [], truncated: false };
    const { rows } = await c.query(
      `SELECT * FROM (SELECT m.id, m.part_id, m.movement_type::text AS movement_type, m.quantity_delta, m.location_type::text AS location_type,
                             m.location_id, m.source_kind, m.source_id, m.serial_number, m.occurred_at,
                             ${GOVERNING_WAREHOUSE("m.tenant_id", "m.location_type", "m.location_id")} AS governing_warehouse_id
                        FROM eos_ops.inventory_movements m
                       WHERE m.tenant_id = $1 AND ($2::text[] IS NULL OR m.part_id = ANY($2::text[]))) x
        WHERE governing_warehouse_id = ANY($3::text[])
        ORDER BY occurred_at DESC, id DESC LIMIT $4`,
      [actor.tenantId, partIds, scope, (limit as number) + 1]);
    const truncated = rows.length > (limit as number);
    return {
      scopedWarehouseIds: scope,
      truncated,
      items: rows.slice(0, limit as number).map((r) => ({ movementId: r.id, partId: r.part_id, movementType: r.movement_type,
        quantityDelta: Number(r.quantity_delta), locationType: r.location_type, locationId: r.location_id, warehouseId: r.governing_warehouse_id,
        sourceKind: r.source_kind, sourceId: r.source_id, serialNumber: r.serial_number ?? null,
        occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : r.occurred_at })),
    };
  });
}
