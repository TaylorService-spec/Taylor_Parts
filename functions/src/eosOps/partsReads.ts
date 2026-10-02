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
//
// TRUCKS (Controller OD-T3, 2026-10-01). A Technician's current MOBILE scope over a truck is a SECOND, narrower reach for
// the inventory reads: that truck's stock, and nothing else (`mobileLocationIds`, mobileStockAuthority.ts). No Technician
// sees a warehouse, another Employee's truck or a tenant-wide view. Warehouse staff keep seeing a truck only through its
// current binding to a warehouse they are scoped over.
import type { Pool, PoolClient } from "pg";
import { postgresPrincipalDimensionReader } from "./contextualAuthorization.js";
import { ReorderLifecycleError, type ReorderActor } from "./reorderLifecycleCommands.js";
import { FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE } from "./syntheticAcceptanceWarehouse.js";
import { currentMobileLocationIds } from "./mobileStockAuthority.js";
import { listTruckViews } from "./truckRegistryAdministration.js";

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
  /** The governing warehouse; null for a truck reached only through the caller's own MOBILE scope (no binding). */
  readonly warehouseId: string | null;
  readonly onHand: number;
}

export async function readInventoryOnHand(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, INVENTORY_ON_HAND_READ);
  const i = acceptOnly(input, ["partIds", "warehouseId", "mobileLocationId"]);
  const partIds = i.partIds === undefined || i.partIds === null ? null : i.partIds;
  if (partIds !== null && (!Array.isArray(partIds) || partIds.length === 0 || partIds.length > 500 || !partIds.every(ID))) {
    refuse("PART_IDS_INVALID", "INVALID_INPUT", "partIds, when stated, is a non-empty list of at most 500 Part ids");
  }
  const warehouseId = i.warehouseId === undefined || i.warehouseId === null ? null : i.warehouseId;
  if (warehouseId !== null && !ID(warehouseId)) refuse("WAREHOUSE_ID_INVALID", "INVALID_INPUT", "warehouseId must be a governed id");
  const mobileLocationId = i.mobileLocationId === undefined || i.mobileLocationId === null ? null : i.mobileLocationId;
  if (mobileLocationId !== null && !ID(mobileLocationId)) refuse("MOBILE_LOCATION_ID_INVALID", "INVALID_INPUT", "mobileLocationId must be a governed id");
  if (warehouseId !== null && mobileLocationId !== null) refuse("FILTER_CONFLICT", "INVALID_INPUT", "state warehouseId or mobileLocationId, not both");
  return withReadSnapshot(deps.pool, async (c) => {
    const scope = await scopedWarehouseIds(c, actor);
    const mine = await currentMobileLocationIds(c, actor);
    // A truck filter narrows to that truck: reached through the caller's own MOBILE scope, or through its binding to a
    // warehouse the caller is scoped over (checked by the governing-warehouse predicate below).
    const visible = mobileLocationId !== null ? scope : warehouseId === null ? scope : scope.filter((w) => w === warehouseId);
    const visibleTrucks = warehouseId !== null ? [] : mobileLocationId === null ? mine : mine.filter((m) => m === mobileLocationId);
    if (visible.length === 0 && visibleTrucks.length === 0) {
      return { scopedWarehouseIds: scope, mobileLocationIds: mine, rows: [] as OnHandRow[], totals: [] as { partId: string; onHand: number }[] };
    }
    const { rows } = await c.query(
      `SELECT part_id, location_type::text AS location_type, location_id, governing_warehouse_id, sum(quantity_delta)::int AS on_hand
         FROM (SELECT m.part_id, m.location_type, m.location_id, m.quantity_delta,
                      ${GOVERNING_WAREHOUSE("m.tenant_id", "m.location_type", "m.location_id")} AS governing_warehouse_id
                 FROM eos_ops.inventory_movements m
                WHERE m.tenant_id = $1 AND ($2::text[] IS NULL OR m.part_id = ANY($2::text[]))
                  AND ($5::text IS NULL OR (m.location_type::text = 'MOBILE' AND m.location_id = $5))) x
        WHERE governing_warehouse_id = ANY($3::text[]) OR (location_type::text = 'MOBILE' AND location_id = ANY($4::text[]))
        GROUP BY 1, 2, 3, 4
       HAVING sum(quantity_delta) <> 0
        ORDER BY 1, 4, 2, 3`,
      [actor.tenantId, partIds, visible, visibleTrucks, mobileLocationId]);
    const out: OnHandRow[] = rows.map((r) => ({ partId: r.part_id, locationType: r.location_type, locationId: r.location_id,
      warehouseId: r.governing_warehouse_id ?? null, onHand: Number(r.on_hand) }));
    const totals = new Map<string, number>();
    for (const r of out) totals.set(r.partId, (totals.get(r.partId) ?? 0) + r.onHand);
    return { scopedWarehouseIds: scope, mobileLocationIds: mine, rows: out, totals: [...totals.entries()].map(([partId, onHand]) => ({ partId, onHand })) };
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

// ════════════════════ INVENTORY / WAREHOUSE reads (Controller INVENTORY / WAREHOUSE COMPLETION RULINGS, 2026-10-01) ════════════════════
//
// The employee screens cut over to EOS (Put-Away, Move Stock, Cycle Counts, Transfers, Warehouse list) need the governed
// warehouses and locations they may work in, and the transfer orders they may see -- from eos_ops, never a Firestore list
// merged with a PostgreSQL one. They are not a second stock read model: no quantity is here (stock stays readInventoryOnHand).
//
//   listInventoryWarehouses   the caller's WAREHOUSE-scoped governed warehouses (fixture identities never presented)
//   listInventoryLocations    those warehouses and their bins, for the location pickers
//   listTransferOrders        transfer orders whose origin OR destination governs into the caller's scope
//
// Fixture identities (FORBIDDEN_WAREHOUSE_IDS and the synthetic acceptance warehouse) are excluded from these employee
// presentations even where a fixture scope exists, per the existing fixture rule (syntheticAcceptanceWarehouse.ts).


export const WAREHOUSE_READ = "warehouse.record.read";
export const TRANSFER_ORDER_READ = "warehouse.transferOrder.read";
const TRANSFER_ACT_CAPABILITIES = ["inventory.transfer.create", "inventory.transfer.dispatch", "inventory.transfer.receive", "inventory.transfer.cancel"];
const PRESENTATION_EXCLUDED: readonly string[] = Object.freeze([...FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE.warehouseId]);

function requireAnyCapability(actor: ReorderActor, keys: readonly string[]): void {
  if (!actor || !(actor.capabilities instanceof Set) || !keys.some((k) => actor.capabilities.has(k))) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `this read requires one of ${keys.join(", ")}`);
  }
}

async function presentableScope(c: PoolClient, actor: ReorderActor): Promise<string[]> {
  return (await scopedWarehouseIds(c, actor)).filter((w) => !PRESENTATION_EXCLUDED.includes(w));
}

export async function listInventoryWarehouses(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireAnyCapability(actor, [WAREHOUSE_READ, INVENTORY_ON_HAND_READ]);
  acceptOnly(input, []);
  return withReadSnapshot(deps.pool, async (c) => {
    const scope = await presentableScope(c, actor);
    if (scope.length === 0) return { items: [] };
    const { rows } = await c.query(
      `SELECT w.id, w.name, w.site_label, w.status::text AS status, k.operating_company_id,
              (SELECT count(*)::int FROM eos_ops.bins b WHERE b.tenant_id = w.tenant_id AND b.warehouse_id = w.id AND b.status = 'ACTIVE') AS bin_count
         FROM eos_ops.warehouses w
         LEFT JOIN eos_policy.tenant_operating_company_keys k
           ON k.tenant_id = w.tenant_id AND k.operating_company_key = w.operating_company_key AND k.status = 'ACTIVE'
        WHERE w.tenant_id = $1 AND w.id = ANY($2::text[]) ORDER BY w.name, w.id`, [actor.tenantId, scope]);
    return { items: rows.map((r) => ({ warehouseId: r.id, name: r.name, siteLabel: r.site_label, status: r.status,
      operatingCompanyId: r.operating_company_id ?? null, binCount: Number(r.bin_count) })) };
  });
}

export async function listInventoryLocations(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireAnyCapability(actor, [WAREHOUSE_READ, INVENTORY_ON_HAND_READ]);
  const i = acceptOnly(input, ["warehouseId"]);
  const warehouseId = i.warehouseId === undefined || i.warehouseId === null ? null : i.warehouseId;
  if (warehouseId !== null && !ID(warehouseId)) refuse("WAREHOUSE_ID_INVALID", "INVALID_INPUT", "warehouseId must be a governed id");
  return withReadSnapshot(deps.pool, async (c) => {
    const scope = await presentableScope(c, actor);
    const visible = warehouseId === null ? scope : scope.filter((w) => w === warehouseId);
    // OD-T3 / Package G: trucks are resolvable locations -- the caller's own scoped trucks, and the trucks currently bound
    // to a warehouse the caller is scoped over (a transfer destination). Nothing else.
    const mine = warehouseId === null ? await currentMobileLocationIds(c, actor) : [];
    if (visible.length === 0 && mine.length === 0) return { items: [] };
    const wh = (await c.query(`SELECT id, name, status::text AS status FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY name, id`,
      [actor.tenantId, visible])).rows;
    const bins = (await c.query(
      `SELECT b.id, b.warehouse_id, b.name, b.code, b.status::text AS status
         FROM eos_ops.bins b WHERE b.tenant_id = $1 AND b.warehouse_id = ANY($2::text[]) ORDER BY b.warehouse_id, b.id`, [actor.tenantId, visible])).rows;
    const trucks = (await c.query(
      `SELECT m.location_id, m.display_label, m.active, t.vehicle_number, sb.warehouse_id
         FROM eos_ops.mobile_locations m
         LEFT JOIN eos_ops.trucks t ON t.tenant_id = m.tenant_id AND t.mobile_location_type = m.location_type AND t.mobile_location_id = m.location_id
         LEFT JOIN eos_ops.mobile_location_scope_bindings sb ON sb.tenant_id = m.tenant_id AND sb.location_type = 'MOBILE'
                                                            AND sb.location_id = m.location_id AND sb.effective_to IS NULL
        WHERE m.tenant_id = $1 AND m.location_type = 'MOBILE' AND (sb.warehouse_id = ANY($2::text[]) OR m.location_id = ANY($3::text[]))
        ORDER BY m.display_label, m.location_id`, [actor.tenantId, visible, mine])).rows;
    return { items: [
      ...wh.map((w) => ({ type: "WAREHOUSE", locationId: w.id, warehouseId: w.id, code: null, name: w.name, status: w.status })),
      ...bins.map((b) => ({ type: "BIN", locationId: b.id, warehouseId: b.warehouse_id, code: b.code ?? null, name: b.name ?? null, status: b.status })),
      ...trucks.map((t) => ({ type: "MOBILE", locationId: t.location_id, warehouseId: t.warehouse_id ?? null, code: t.vehicle_number ?? null,
        name: t.display_label, status: t.active ? "ACTIVE" : "INACTIVE", mine: mine.includes(t.location_id) })),
    ] };
  });
}

const TRANSFER_STATUSES = ["REQUESTED", "IN_TRANSIT", "COMPLETED", "CANCELLED"];

export async function listTransferOrders(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireAnyCapability(actor, [TRANSFER_ORDER_READ, ...TRANSFER_ACT_CAPABILITIES]);
  const i = acceptOnly(input, ["status", "limit"]);
  const status = i.status === undefined || i.status === null ? null : i.status;
  if (status !== null && !TRANSFER_STATUSES.includes(status as string)) refuse("STATUS_INVALID", "INVALID_INPUT", `status is one of ${TRANSFER_STATUSES.join(", ")}`);
  const limit = i.limit === undefined || i.limit === null ? 200 : i.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500) refuse("LIMIT_INVALID", "INVALID_INPUT", "limit is an integer 1..500");
  return withReadSnapshot(deps.pool, async (c) => {
    const scope = await scopedWarehouseIds(c, actor);
    // OD-T3: a Technician sees the transfers INTO a truck it holds MOBILE scope over (to receive them), and no others.
    const mine = actor.capabilities.has("inventory.transfer.receive") ? await currentMobileLocationIds(c, actor) : [];
    if (scope.length === 0 && mine.length === 0) return { items: [] };
    const { rows } = await c.query(
      `SELECT * FROM (
         SELECT t.id, t.transfer_order_number, t.status::text AS status, t.part_id, t.tracking_mode::text AS tracking_mode, t.quantity,
                t.serial_numbers, t.origin_location_type::text AS ot, t.origin_location_id AS oi,
                t.destination_location_type::text AS dt, t.destination_location_id AS di, t.created_at, t.created_by,
                ${GOVERNING_WAREHOUSE("t.tenant_id", "t.origin_location_type", "t.origin_location_id")} AS ow,
                ${GOVERNING_WAREHOUSE("t.tenant_id", "t.destination_location_type", "t.destination_location_id")} AS dw
           FROM eos_ops.transfer_orders t WHERE t.tenant_id = $1 AND ($2::text IS NULL OR t.status::text = $2)) x
        WHERE ow = ANY($3::text[]) OR dw = ANY($3::text[]) OR (dt = 'MOBILE' AND di = ANY($5::text[]))
        ORDER BY created_at DESC, id LIMIT $4`, [actor.tenantId, status, scope, limit, mine]);
    return { items: rows.map((r) => ({
      transferOrderId: r.id, transferOrderNumber: r.transfer_order_number, status: r.status, partId: r.part_id, trackingMode: r.tracking_mode,
      quantity: Number(r.quantity), serialNumbers: r.serial_numbers ?? [],
      origin: { type: r.ot, locationId: r.oi, warehouseId: r.ow ?? null }, destination: { type: r.dt, locationId: r.di, warehouseId: r.dw ?? null },
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, createdBy: r.created_by,
      canReceive: r.status === "IN_TRANSIT" && ((r.dw !== null && scope.includes(r.dw)) || (r.dt === "MOBILE" && mine.includes(r.di))),
    })) };
  });
}

// ════════════════════ trucks (OD-T3 / OD-T7, 2026-10-01) ════════════════════

export const TRUCK_ROSTER_READERS = Object.freeze([WAREHOUSE_READ, "workOrder.lifecycle.dispatch", "inventory.truckRegistry.manage"]);

/**
 * The operational truck roster: each truck, its MOBILE location, its current warehouse binding and the Employees holding
 * MOBILE scope over it. Warehouse readers, dispatchers and registry administrators read the tenant's roster (registry facts,
 * not stock); anyone else -- a Technician -- reads only the trucks it is currently scoped to. Read-only.
 */
export async function listTruckRoster(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  if (!actor || !(actor.capabilities instanceof Set)) refuse("CAPABILITY_MISSING", "FORBIDDEN", "a resolved actor is required");
  acceptOnly(input, []);
  return withReadSnapshot(deps.pool, async (c) => {
    const mine = await currentMobileLocationIds(c, actor);
    const tenantWide = TRUCK_ROSTER_READERS.some((k) => actor.capabilities.has(k));
    if (!tenantWide && mine.length === 0) {
      if (!actor.capabilities.has(INVENTORY_ON_HAND_READ)) refuse("CAPABILITY_MISSING", "FORBIDDEN", `this read requires one of ${TRUCK_ROSTER_READERS.join(", ")}`);
      return { scope: "OWN", mobileLocationIds: mine, trucks: [] };
    }
    const trucks = await listTruckViews(c, actor.tenantId, tenantWide ? {} : { mobileLocationIds: mine });
    return { scope: tenantWide ? "TENANT" : "OWN", mobileLocationIds: mine, trucks };
  });
}

/**
 * One truck's stock: quantity on hand per Part (from the movement ledger) and the serialized units in its custody. Reached
 * through the caller's own current MOBILE scope, or through the truck's current binding to a warehouse the caller is
 * scoped over. Anything else is NOT_FOUND -- the existence of another Employee's truck stock is not disclosed.
 */
export async function readTruckStock(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, INVENTORY_ON_HAND_READ);
  const i = acceptOnly(input, ["mobileLocationId"]);
  if (!ID(i.mobileLocationId)) refuse("MOBILE_LOCATION_ID_INVALID", "INVALID_INPUT", "mobileLocationId is required");
  const locationId = i.mobileLocationId as string;
  return withReadSnapshot(deps.pool, async (c) => {
    const mine = await currentMobileLocationIds(c, actor);
    const scope = await scopedWarehouseIds(c, actor);
    const { rows: loc } = await c.query(
      `SELECT m.display_label, m.active, m.operating_company_key, t.truck_id, t.vehicle_number, t.status::text AS truck_status,
              ${GOVERNING_WAREHOUSE("m.tenant_id", "m.location_type", "m.location_id")} AS bound_warehouse_id
         FROM eos_ops.mobile_locations m
         LEFT JOIN eos_ops.trucks t ON t.tenant_id = m.tenant_id AND t.mobile_location_type = m.location_type AND t.mobile_location_id = m.location_id
        WHERE m.tenant_id = $1 AND m.location_type = 'MOBILE' AND m.location_id = $2`, [actor.tenantId, locationId]);
    const l = loc[0];
    const reach = !l ? null : mine.includes(locationId) ? "MOBILE_SCOPE" : l.bound_warehouse_id && scope.includes(l.bound_warehouse_id) ? "WAREHOUSE_SCOPE" : null;
    if (!reach) refuse("TRUCK_NOT_FOUND", "NOT_FOUND", "no truck you can see has that location");
    const { rows: qty } = await c.query(
      `SELECT part_id, sum(quantity_delta)::int AS on_hand FROM eos_ops.inventory_movements
        WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2 AND tracking_mode = 'NONE'
        GROUP BY part_id HAVING sum(quantity_delta) <> 0 ORDER BY part_id`, [actor.tenantId, locationId]);
    const { rows: units } = await c.query(
      `SELECT part_id, serial_number, status::text AS status FROM eos_ops.serialized_custody
        WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2 ORDER BY part_id, serial_number`, [actor.tenantId, locationId]);
    return {
      truck: { mobileLocationId: locationId, displayLabel: l.display_label, active: l.active === true, truckId: l.truck_id ?? null,
        vehicleNumber: l.vehicle_number ?? null, truckStatus: l.truck_status ?? null, boundWarehouseId: l.bound_warehouse_id ?? null },
      reach,
      quantities: qty.map((r) => ({ partId: r.part_id, onHand: Number(r.on_hand) })),
      serializedUnits: units.map((r) => ({ partId: r.part_id, serialNumber: r.serial_number, status: r.status })),
    };
  });
}
