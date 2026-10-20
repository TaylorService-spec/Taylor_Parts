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
// COMPANY ISOLATION (#235 / #237; ISO inventory, 2026-10-19). A WAREHOUSE scope is not company authority. Every read here decides, in this
// order: the CAPABILITY, then the caller's operating-company AUTHORITY (resolveCompanyAuthority -- none at all is COMPANY_AUTHORITY_REQUIRED,
// before any row is read), then the warehouse scope, narrowed to warehouses OF those companies (scopedWarehouseIds `companyKeys`). Movements,
// receipts, transfers and trucks of a company outside the caller's are absent from every answer -- the filter is in the WHERE -- and a single
// record of such a company (a receipt, a truck) reads EXACTLY as a nonexistent one.
//
// TRUCKS (Controller OD-T3, 2026-10-01). A Technician's current MOBILE scope over a truck is a SECOND, narrower reach for
// the inventory reads: that truck's stock, and nothing else (`mobileLocationIds`, mobileStockAuthority.ts). No Technician
// sees a warehouse, another Employee's truck or a tenant-wide view. Warehouse staff keep seeing a truck only through its
// current binding to a warehouse they are scoped over.
import type { Pool, PoolClient } from "pg";
import { postgresPrincipalDimensionReader } from "./contextualAuthorization.js";
import { REORDER_RECORD_PO, ReorderLifecycleError, type ReorderActor } from "./reorderLifecycleCommands.js";
import { operatingCompanyDisplayName } from "../ownership/operatingCompanyAuthority.js";
import { FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE } from "./syntheticAcceptanceWarehouse.js";
import { currentMobileLocationIds } from "./mobileStockAuthority.js";
import { listTruckViews } from "./truckRegistryAdministration.js";
import { administrationReachTargets } from "./administrationReach.js";
import { resolveInventoryCompanyAuthority } from "./inventoryCompanyAuthority.js";
import { committedByWarehouse } from "./inventoryCommitmentRepository.js";

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

/**
 * The warehouses a caller's READS reach: its Employee's WAREHOUSE Operational Scopes, plus -- for a protected
 * Administrator (DECISIONS #224) -- every ACTIVE warehouse of a company this tenant is authorized to operate as. None
 * without either. Reads only: no command takes its authority from this list.
 */
export async function scopedWarehouseIds(
  c: Pick<PoolClient, "query">, actor: ReorderActor,
  /** `companyKeys` (ISO inventory; REQUIRED by ISO-2): keep only the warehouses OF those operating companies -- a warehouse scope never reaches into another company's warehouse. */
  options: { readonly administrationReach?: boolean; readonly companyKeys: readonly string[] },
): Promise<string[]> {
  if (!Array.isArray(options?.companyKeys)) throw new TypeError("scopedWarehouseIds requires the caller's reachable company keys");
  const reader = postgresPrincipalDimensionReader(c);
  const employeeId = await reader.linkedEmployeeId(actor.tenantId, actor.principalId);
  const own = employeeId === null ? [] : (await reader.listOperationalScopes(actor.tenantId, employeeId))
    .filter((s) => s.scopeType === "WAREHOUSE").map((s) => s.scopeId);
  // An EXECUTION picker passes administrationReach: false -- it must offer only where the caller can act.
  const administered = options.administrationReach === false ? []
    : await administrationReachTargets(c, actor.tenantId, actor.principalId, "WAREHOUSE");
  const all = [...new Set([...own, ...administered])].sort();
  if (all.length === 0) return all;
  const { rows } = await c.query(
    `SELECT id FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = ANY($2::text[]) AND operating_company_key = ANY($3::text[])`,
    [actor.tenantId, all, [...options.companyKeys]]);
  const reachable = new Set(rows.map((r) => String(r.id)));
  return all.filter((id) => reachable.has(id));
}

/** CAPABILITY FIRST (the caller's requireCapability), THEN COMPANY (#235 / #237): the operating-company KEYS the caller reaches; none at all is a refusal, not an empty answer. */
async function reachableCompanyKeys(c: Pick<PoolClient, "query">, actor: ReorderActor, what: string): Promise<readonly string[]> {
  const authority = await resolveInventoryCompanyAuthority(c, actor.tenantId, actor.principalId);
  if (authority.companyKeys.length === 0) refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", `${what} requires operating-company authority; this principal has none`);
  return authority.companyKeys;
}

/** SQL resolving (location_type, location_id) to its governing warehouse; MOBILE only through a CURRENT binding. */
export const GOVERNING_WAREHOUSE = (t: string, lt: string, li: string) => `CASE ${lt}::text
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
    const keys = await reachableCompanyKeys(c, actor, "reading on-hand stock");
    const scope = await scopedWarehouseIds(c, actor, { companyKeys: keys });
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
                  AND ($5::text IS NULL OR (m.location_type::text = 'MOBILE' AND m.location_id = $5))
                  AND m.operating_company_key = ANY($6::text[])) x
        WHERE governing_warehouse_id = ANY($3::text[]) OR (location_type::text = 'MOBILE' AND location_id = ANY($4::text[]))
        GROUP BY 1, 2, 3, 4
       HAVING sum(quantity_delta) <> 0
        ORDER BY 1, 4, 2, 3`,
      [actor.tenantId, partIds, visible, visibleTrucks, mobileLocationId, [...keys]]);
    const out: OnHandRow[] = rows.map((r) => ({ partId: r.part_id, locationType: r.location_type, locationId: r.location_id,
      warehouseId: r.governing_warehouse_id ?? null, onHand: Number(r.on_hand) }));
    const totals = new Map<string, number>();
    for (const r of out) totals.set(r.partId, (totals.get(r.partId) ?? 0) + r.onHand);
    return { scopedWarehouseIds: scope, mobileLocationIds: mine, rows: out, totals: [...totals.entries()].map(([partId, onHand]) => ({ partId, onHand })) };
  });
}

// ════════════════════ part balance (Firebase exit B3-x) ════════════════════
//
// ONE governed read of a Part's on-hand, reserved, available and on-order -- the EOS replacement for the Firebase getPartBalance
// (inventory/partBalanceReadService.ts), with the SAME ratified arithmetic and the SAME three-valued figures:
//   KNOWN                    a number
//   UNKNOWN                  the evidence to answer is missing -- NEVER rendered or computed as 0
//   NOT_COUNTED_BY_QUANTITY  a serial-tracked Part is counted by unit, never by summed quantity
//
//   onHand     Σ signed quantity_delta of NONE-tracked WAREHOUSE / BIN movements at ACTIVE warehouses (a bin is its warehouse's stock; a
//              truck is excluded by design), floored at 0. UNKNOWN when the caller's scope holds no movement evidence for the Part.
//   reserved   HARD reservations (S1b; DECISIONS #165): max(0, RESERVED - RELEASED - CONSUMED) per company AND warehouse, the SAME
//              function the reserve gate uses (inventoryCommitmentRepository.committedByWarehouse). Unallocated demand is not a hard
//              reservation and is never counted. NOT_YET_ACTIVATED until the company is activated for reservations (never a confident 0
//              nobody earned); SCOPE_PARTIAL when stock or claims of the Part sit in a warehouse the caller is not scoped over (the
//              headline would be a wrong number; the per-warehouse figures in byLocation stay exact and in scope).
//   available  max(0, onHand - reserved); UNKNOWN whenever onHand is; follows reserved when that is NOT_YET_ACTIVATED / SCOPE_PARTIAL.
//   onOrder    the Reorder Purchase Orders still ORDERED in the caller's warehouse scope + the remaining quantity of canonical supplier
//              purchase orders in a receivable status (APPROVED / SENT); UNKNOWN when no purchase order mentions the Part.
//   byLocation on-hand by warehouse (warehouses holding nothing are omitted), so a breakdown always adds up to its own total.
//
// SCOPE. Capability first (inventory.transaction.read, the on-hand read's key -- no new capability, no new holder), then company: none at
// all is a refusal. Movements and commitments are filtered to the caller's operating companies IN THE WHERE and warehouses to the caller's
// WAREHOUSE scope, so an out-of-scope row is absent from every figure and nothing about it is disclosed. A read only: nothing may be
// committed on the strength of this projection.
const SERIAL_CONTROL_TYPES: readonly string[] = Object.freeze(["SERIALIZED", "SERIALIZED_LOT"]);
const RECEIVABLE_SUPPLIER_STATUSES: readonly string[] = Object.freeze(["APPROVED", "SENT"]);

export type BalanceFigure = { readonly state: "KNOWN" | "UNKNOWN" | "NOT_COUNTED_BY_QUANTITY" | "NOT_YET_ACTIVATED" | "SCOPE_PARTIAL"; readonly value: number | null };
const KNOWN = (value: number): BalanceFigure => Object.freeze({ state: "KNOWN" as const, value });
const UNKNOWN: BalanceFigure = Object.freeze({ state: "UNKNOWN" as const, value: null });
const NOT_QUANTITY: BalanceFigure = Object.freeze({ state: "NOT_COUNTED_BY_QUANTITY" as const, value: null });
const NOT_YET_ACTIVATED: BalanceFigure = Object.freeze({ state: "NOT_YET_ACTIVATED" as const, value: null });
const SCOPE_PARTIAL: BalanceFigure = Object.freeze({ state: "SCOPE_PARTIAL" as const, value: null });

export async function readPartBalance(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, INVENTORY_ON_HAND_READ);
  const i = acceptOnly(input, ["partId"]);
  if (!ID(i.partId)) refuse("PART_ID_REQUIRED", "INVALID_INPUT", "partId is required");
  const partId = i.partId as string;
  return withReadSnapshot(deps.pool, async (c) => {
    const keys = [...(await reachableCompanyKeys(c, actor, "reading stock balances"))];
    const part = await c.query(`SELECT control_type::text AS control_type FROM eos_ops.parts WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, partId]);
    if (part.rows.length === 0) refuse("PART_NOT_FOUND", "NOT_FOUND", "no such Part");
    const serialTracked = SERIAL_CONTROL_TYPES.includes(String(part.rows[0].control_type));
    const scope = await presentableScope(c, actor, keys);

    // ---- on order: Reorder POs (warehouse scope + company) and canonical supplier POs (company) ----
    const reorderPos = scope.length === 0 ? { rows: [] as Array<Record<string, unknown>> } : await c.query(
      `SELECT r.status::text AS status, po.ordered_quantity
         FROM eos_ops.reorder_requests r
         JOIN eos_ops.purchase_orders po ON po.tenant_id = r.tenant_id AND po.id = r.id
        WHERE r.tenant_id = $1 AND r.part_id = $2 AND r.operating_company_key = ANY($3::text[]) AND r.warehouse_id = ANY($4::text[])`,
      [actor.tenantId, partId, keys, scope]);
    const supplierLines = await c.query(
      `SELECT p.status AS status, GREATEST(l.ordered_quantity - COALESCE(rc.received, 0), 0)::int AS remaining
         FROM eos_ops.supplier_purchase_order_lines l
         JOIN eos_ops.supplier_purchase_orders p ON p.tenant_id = l.tenant_id AND p.id = l.purchase_order_id
         LEFT JOIN LATERAL (
           SELECT sum(rl.received_quantity) AS received
             FROM eos_ops.receiving_orders ro
             JOIN eos_ops.receiving_order_lines rl ON rl.tenant_id = ro.tenant_id AND rl.receiving_order_id = ro.id
            WHERE ro.tenant_id = p.tenant_id AND ro.source_kind::text = 'PURCHASE_ORDER' AND ro.source_purchase_order_id = p.id
              AND ro.status::text <> 'CANCELLED' AND rl.line_id = l.line_id) rc ON TRUE
        WHERE l.tenant_id = $1 AND l.part_id = $2 AND p.operating_company_key = ANY($3::text[])`,
      [actor.tenantId, partId, keys]);
    const sawOrder = reorderPos.rows.length + supplierLines.rows.length > 0;
    const outstanding =
      reorderPos.rows.filter((r) => r.status === "ORDERED").reduce((n, r) => n + Number(r.ordered_quantity), 0)
      + supplierLines.rows.filter((r) => RECEIVABLE_SUPPLIER_STATUSES.includes(String(r.status))).reduce((n, r) => n + Number(r.remaining), 0);
    const onOrder = sawOrder ? KNOWN(outstanding) : UNKNOWN;

    if (serialTracked) {
      return { partId, trackingMode: "SERIAL", scopedWarehouseIds: scope, onHand: NOT_QUANTITY, reserved: NOT_QUANTITY, available: NOT_QUANTITY, onOrder,
        byLocation: [] as Array<{ warehouseId: string; quantity: number }> };
    }

    // ---- on hand, by governing warehouse ----
    const stock = scope.length === 0 ? { rows: [] as Array<Record<string, unknown>> } : await c.query(
      `SELECT x.warehouse_id, sum(x.quantity_delta)::int AS quantity, (w.status::text = 'ACTIVE') AS active
         FROM (SELECT m.quantity_delta, ${GOVERNING_WAREHOUSE("m.tenant_id", "m.location_type", "m.location_id")} AS warehouse_id
                 FROM eos_ops.inventory_movements m
                WHERE m.tenant_id = $1 AND m.part_id = $2 AND m.tracking_mode = 'NONE' AND m.location_type::text IN ('WAREHOUSE', 'BIN')
                  AND m.operating_company_key = ANY($3::text[])) x
         JOIN eos_ops.warehouses w ON w.tenant_id = $1 AND w.id = x.warehouse_id
        WHERE x.warehouse_id = ANY($4::text[])
        GROUP BY x.warehouse_id, w.status
        ORDER BY x.warehouse_id`,
      [actor.tenantId, partId, keys, scope]);
    const sawStock = stock.rows.length > 0;
    const activeRows = stock.rows.filter((r) => r.active === true);
    const onHandValue = Math.max(0, activeRows.reduce((n, r) => n + Number(r.quantity), 0));
    const onHand = sawStock ? KNOWN(onHandValue) : UNKNOWN;

    // ---- reserved: HARD reservations per company AND warehouse (S1b) ----
    // Only RESERVED - RELEASED - CONSUMED rows count; unallocated demand never does. The arithmetic is the reserve gate's own.
    const whs = scope.length === 0 ? { rows: [] as Array<Record<string, unknown>> } : await c.query(
      `SELECT w.id, (w.status::text = 'ACTIVE') AS active, (a.tenant_id IS NOT NULL) AS activated
         FROM eos_ops.warehouses w
         LEFT JOIN eos_ops.stock_reservation_activation a
           ON a.tenant_id = w.tenant_id AND a.operating_company_key = w.operating_company_key
        WHERE w.tenant_id = $1 AND w.id = ANY($2::text[])`,
      [actor.tenantId, scope]);
    const activeScoped = whs.rows.filter((r) => r.active === true);
    const activated = new Set(activeScoped.filter((r) => r.activated === true).map((r) => String(r.id)));
    const allActivated = activeScoped.length > 0 && activeScoped.every((r) => activated.has(String(r.id)));
    const committed = await committedByWarehouse(c, actor.tenantId, keys, partId, scope);
    // Does the Part have stock or claims in an ACTIVE warehouse of a reachable company that the caller is NOT scoped over?
    // Only that fact is disclosed (SCOPE_PARTIAL), never a quantity or a warehouse.
    const outside = await c.query(
      `SELECT EXISTS (
         SELECT 1 FROM eos_ops.warehouses w
          WHERE w.tenant_id = $1 AND w.operating_company_key = ANY($2::text[]) AND w.status::text = 'ACTIVE' AND NOT (w.id = ANY($3::text[]))
            AND (EXISTS (SELECT 1 FROM eos_ops.inventory_commitments k
                          WHERE k.tenant_id = w.tenant_id AND k.warehouse_id = w.id AND k.part_id = $4)
              OR EXISTS (SELECT 1 FROM eos_ops.inventory_movements m
                          WHERE m.tenant_id = w.tenant_id AND m.part_id = $4 AND m.tracking_mode = 'NONE'
                            AND m.operating_company_key = w.operating_company_key
                            AND ((m.location_type::text = 'WAREHOUSE' AND m.location_id = w.id)
                              OR (m.location_type::text = 'BIN' AND m.location_id IN
                                    (SELECT b.id FROM eos_ops.bins b WHERE b.tenant_id = w.tenant_id AND b.warehouse_id = w.id)))))
       ) AS partial`,
      [actor.tenantId, keys, scope, partId]);
    const scopePartial = outside.rows[0]?.partial === true;

    const reservedAt = (warehouseId: string): BalanceFigure =>
      activated.has(warehouseId) ? KNOWN(committed.get(warehouseId) ?? 0) : NOT_YET_ACTIVATED;
    const availableAt = (warehouseId: string, quantity: number): BalanceFigure => {
      const r = reservedAt(warehouseId);
      return r.state === "KNOWN" ? KNOWN(Math.max(0, quantity - (r.value ?? 0))) : r;
    };
    const reserved: BalanceFigure =
      activeScoped.length === 0 ? UNKNOWN
      : !allActivated ? NOT_YET_ACTIVATED
      : scopePartial ? SCOPE_PARTIAL
      : KNOWN(activeScoped.reduce((n, r) => n + (committed.get(String(r.id)) ?? 0), 0));
    // available = the sum of the per-warehouse figures (never one warehouse's surplus hiding another's shortage).
    const available: BalanceFigure =
      onHand.state !== "KNOWN" ? UNKNOWN
      : reserved.state !== "KNOWN" ? reserved
      : KNOWN(activeRows.reduce((n, r) => n + (availableAt(String(r.warehouse_id), Number(r.quantity)).value ?? 0), 0));
    const byLocation = activeRows.filter((r) => Number(r.quantity) > 0)
      .map((r) => ({ warehouseId: String(r.warehouse_id), quantity: Number(r.quantity),
        reserved: reservedAt(String(r.warehouse_id)), available: availableAt(String(r.warehouse_id), Number(r.quantity)) }))
      .sort((a, b) => (b.quantity - a.quantity) || a.warehouseId.localeCompare(b.warehouseId));
    return { partId, trackingMode: "NONE", scopedWarehouseIds: scope, onHand, reserved, available, onOrder, byLocation };
  });
}

// ════════════════════ receipts ════════════════════

const RECEIPT_COLUMNS = `r.id, r.receiving_order_number, r.status::text AS status, r.source_kind::text AS source_kind,
  r.source_reorder_request_id, r.source_purchase_order_id, r.receiving_location_type::text AS receiving_location_type,
  r.receiving_location_id, r.received_at, r.created_by, r.operating_company_key,
  (SELECT count(*)::int FROM eos_ops.receiving_order_lines l WHERE l.tenant_id = r.tenant_id AND l.receiving_order_id = r.id) AS line_count,
  (SELECT COALESCE(sum(l.received_quantity), 0)::int FROM eos_ops.receiving_order_lines l WHERE l.tenant_id = r.tenant_id AND l.receiving_order_id = r.id) AS total_quantity,
  CASE r.source_kind::text
    WHEN 'PURCHASE_ORDER' THEN (SELECT p.external_po_number FROM eos_ops.supplier_purchase_orders p WHERE p.tenant_id = r.tenant_id AND p.id = r.source_purchase_order_id)
    ELSE (SELECT po.external_po_number FROM eos_ops.purchase_orders po WHERE po.tenant_id = r.tenant_id AND po.id = r.source_purchase_order_id)
  END AS external_po_number,
  EXISTS (SELECT 1 FROM eos_ops.receiving_corrections k WHERE k.tenant_id = r.tenant_id AND k.receiving_order_id = r.id) AS corrected`;

/** The SQL condition (over alias `r`, company keys at `param`): a receipt belongs to one company and is visible only to callers who reach it (ISO inventory: Reorder receipts too). */
const RECEIPT_COMPANY_SQL = (param: number) => `r.operating_company_key = ANY($${param}::text[])`;

const receiptOf = (r: Record<string, unknown>) => ({
  receiptId: r.id, receivingOrderNumber: r.receiving_order_number, status: r.status, sourceKind: r.source_kind,
  reorderRequestId: r.source_reorder_request_id ?? null, purchaseOrderId: r.source_purchase_order_id ?? null,
  // B3-x: the order's business number (external PO number), the size of the receipt and whether a correction was recorded against it.
  orderNumber: (r.external_po_number as string | null) ?? null, lineCount: Number(r.line_count ?? 0), totalQuantity: Number(r.total_quantity ?? 0),
  corrected: r.corrected === true,
  receivingLocation: { type: r.receiving_location_type, locationId: r.receiving_location_id },
  warehouseId: r.governing_warehouse_id, receivedAt: r.received_at instanceof Date ? r.received_at.toISOString() : r.received_at,
  receivedByPrincipalId: r.created_by,
});

/** Receipt history. Every receipt follows the caller's warehouse scope AND operating companies (#235/#237; Reorder receipts since ISO inventory, supplier-PO receipts since B3-x). */
export async function listReceipts(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, RECEIPT_READ);
  const i = acceptOnly(input, ["reorderRequestId", "limit"]);
  const limit = i.limit === undefined ? 50 : i.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 200) refuse("LIMIT_INVALID", "INVALID_INPUT", "limit is 1..200");
  const reorderRequestId = i.reorderRequestId === undefined || i.reorderRequestId === null ? null : i.reorderRequestId;
  if (reorderRequestId !== null && !ID(reorderRequestId)) refuse("REORDER_REQUEST_ID_INVALID", "INVALID_INPUT", "reorderRequestId must be a governed id");
  return withReadSnapshot(deps.pool, async (c) => {
    const companyKeys = [...(await reachableCompanyKeys(c, actor, "reading receipts"))];
    const scope = await scopedWarehouseIds(c, actor, { companyKeys });
    if (scope.length === 0) return { scopedWarehouseIds: scope, items: [] };
    const { rows } = await c.query(
      `SELECT * FROM (SELECT ${RECEIPT_COLUMNS}, ${GOVERNING_WAREHOUSE("r.tenant_id", "r.receiving_location_type", "r.receiving_location_id")} AS governing_warehouse_id
                        FROM eos_ops.receiving_orders r
                       WHERE r.tenant_id = $1 AND ($2::text IS NULL OR r.source_reorder_request_id = $2) AND ${RECEIPT_COMPANY_SQL(5)}) x
        WHERE governing_warehouse_id = ANY($3::text[])
        ORDER BY received_at DESC, id DESC LIMIT $4`,
      [actor.tenantId, reorderRequestId, scope, limit, companyKeys]);
    return { scopedWarehouseIds: scope, items: rows.map(receiptOf) };
  });
}

export async function readReceipt(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, RECEIPT_READ);
  const i = acceptOnly(input, ["receiptId"]);
  if (!ID(i.receiptId)) refuse("RECEIPT_ID_REQUIRED", "INVALID_INPUT", "receiptId is required");
  return withReadSnapshot(deps.pool, async (c) => {
    const companyKeys = [...(await reachableCompanyKeys(c, actor, "reading a receipt"))];
    const scope = await scopedWarehouseIds(c, actor, { companyKeys });
    const { rows } = await c.query(
      `SELECT ${RECEIPT_COLUMNS}, ${GOVERNING_WAREHOUSE("r.tenant_id", "r.receiving_location_type", "r.receiving_location_id")} AS governing_warehouse_id
         FROM eos_ops.receiving_orders r WHERE r.tenant_id = $1 AND r.id = $2 AND ${RECEIPT_COMPANY_SQL(3)}`, [actor.tenantId, i.receiptId, companyKeys]);
    // Outside scope (warehouse or company) answers exactly as missing: no existence oracle.
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
    const keys = await reachableCompanyKeys(c, actor, "listing receiving destinations");
    const rr = await c.query(
      `SELECT warehouse_id, status::text AS status FROM eos_ops.reorder_requests WHERE tenant_id = $1 AND id = $2 AND operating_company_key = ANY($3::text[])`,
      [actor.tenantId, i.reorderRequestId, [...keys]]);
    // The RECEIVING picker offers only where the caller can receive: execution, never administration reach (G2).
    const scope = await scopedWarehouseIds(c, actor, { administrationReach: false, companyKeys: keys });
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

/**
 * THE GOVERNED SUPPLIER SELECTION for a new Purchase Order (DECISIONS #193; Owner ruling 2026-10-02). What the purchasing
 * employee picks FROM, by human-readable name -- never a free-text supplier and never an id they must know:
 *   EXTERNAL_ORGANIZATION       every ACTIVE governed supplier (eos_ops.suppliers -- the one Supplier master);
 *   INTERNAL_OPERATING_COMPANY  every ACTIVE operating company of this tenant EXCEPT the Reorder's own buying company
 *                               (a company never buys from itself; CONSOLIDATED is a reporting projection, never a row).
 * The command re-validates every choice in its own transaction; this read only offers the valid ones. Requires
 * supplier.record.read AND reorder.request.recordPurchaseOrder (the people who record a PO).
 */
export async function listPurchaseOrderSupplierOptions(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireCapability(actor, SUPPLIER_READ);
  requireCapability(actor, REORDER_RECORD_PO);
  const i = acceptOnly(input, ["reorderRequestId"]);
  if (!ID(i.reorderRequestId)) refuse("REORDER_REQUEST_ID_REQUIRED", "INVALID_INPUT", "reorderRequestId is required");
  return withReadSnapshot(deps.pool, async (c) => {
    const { rows: rr } = await c.query(
      `SELECT k.operating_company_id FROM eos_ops.reorder_requests r
         LEFT JOIN eos_policy.tenant_operating_company_keys k
           ON k.tenant_id = r.tenant_id AND k.operating_company_key = r.operating_company_key AND k.status = 'ACTIVE'
        WHERE r.tenant_id = $1 AND r.id = $2`, [actor.tenantId, i.reorderRequestId]);
    if (rr.length === 0) refuse("REORDER_NOT_FOUND", "NOT_FOUND", "no Reorder Request with that id");
    const buyer = (rr[0].operating_company_id as string | null) ?? null;
    if (buyer === null) refuse("PURCHASING_COMPANY_UNRESOLVED", "PRECONDITION_FAILED", "the Reorder's company is not bound to an ACTIVE operating company");
    const { rows: suppliers } = await c.query(
      `SELECT supplier_id, name, vendor_number FROM eos_ops.suppliers WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY name, supplier_id LIMIT 1000`,
      [actor.tenantId]);
    const { rows: companies } = await c.query(
      `SELECT operating_company_id FROM eos_policy.tenant_operating_companies
        WHERE tenant_id = $1 AND status = 'ACTIVE' AND operating_company_id <> $2 AND operating_company_id <> 'consolidated'
        ORDER BY operating_company_id`, [actor.tenantId, buyer]);
    return {
      items: [
        ...suppliers.map((r) => ({ optionId: `EXTERNAL_ORGANIZATION:${r.supplier_id}`, kind: "EXTERNAL_ORGANIZATION" as const,
          supplierId: String(r.supplier_id), operatingCompanyId: null, name: String(r.name), vendorNumber: (r.vendor_number as string | null) ?? null })),
        ...companies.map((r) => ({ optionId: `INTERNAL_OPERATING_COMPANY:${r.operating_company_id}`, kind: "INTERNAL_OPERATING_COMPANY" as const,
          supplierId: null, operatingCompanyId: String(r.operating_company_id),
          name: operatingCompanyDisplayName(r.operating_company_id) ?? String(r.operating_company_id), vendorNumber: null })),
      ],
    };
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
    const keys = await reachableCompanyKeys(c, actor, "reading movements");
    const scope = await scopedWarehouseIds(c, actor, { companyKeys: keys });
    if (scope.length === 0) return { scopedWarehouseIds: scope, items: [], truncated: false };
    const { rows } = await c.query(
      `SELECT * FROM (SELECT m.id, m.part_id, m.movement_type::text AS movement_type, m.quantity_delta, m.location_type::text AS location_type,
                             m.location_id, m.source_kind, m.source_id, m.serial_number, m.occurred_at,
                             ${GOVERNING_WAREHOUSE("m.tenant_id", "m.location_type", "m.location_id")} AS governing_warehouse_id
                        FROM eos_ops.inventory_movements m
                       WHERE m.tenant_id = $1 AND ($2::text[] IS NULL OR m.part_id = ANY($2::text[]))
                         AND m.operating_company_key = ANY($5::text[])) x
        WHERE governing_warehouse_id = ANY($3::text[])
        ORDER BY occurred_at DESC, id DESC LIMIT $4`,
      [actor.tenantId, partIds, scope, (limit as number) + 1, [...keys]]);
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

async function presentableScope(c: PoolClient, actor: ReorderActor, companyKeys: readonly string[]): Promise<string[]> {
  return (await scopedWarehouseIds(c, actor, { companyKeys })).filter((w) => !PRESENTATION_EXCLUDED.includes(w));
}

/**
 * The caller's governed warehouses. Default: those in the caller's WAREHOUSE scope, of the caller's companies (the pickers where the caller WORKS).
 *
 * `companyWide: true` (ISO inventory): EVERY warehouse of the caller's operating companies, in scope or not, each carrying `inScope`. It exists for the
 * Transfers workspace, which must (a) offer a destination the way createTransfer accepts one -- any ACTIVE warehouse of a company the caller reaches, no
 * warehouse scope needed at the far end -- and (b) NAME every endpoint a transfer shows. It names warehouses only (no quantity, no bin list), is held to a
 * transfer capability, and never reaches a company the caller has no authority over. ACTIVE warehouses only: a closed warehouse is neither a destination nor
 * needed to name a transfer's endpoint that matters to the open work (a closed one falls back to its id).
 */
export async function listInventoryWarehouses(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  const i = acceptOnly(input, ["companyWide"]);
  if (i.companyWide !== undefined && typeof i.companyWide !== "boolean") refuse("COMPANY_WIDE_INVALID", "INVALID_INPUT", "companyWide must be true or false");
  const companyWide = i.companyWide === true;
  if (companyWide) requireAnyCapability(actor, [TRANSFER_ORDER_READ, ...TRANSFER_ACT_CAPABILITIES]);
  else requireAnyCapability(actor, [WAREHOUSE_READ, INVENTORY_ON_HAND_READ]);
  return withReadSnapshot(deps.pool, async (c) => {
    const keys = await reachableCompanyKeys(c, actor, "listing warehouses");
    const scope = await presentableScope(c, actor, keys);
    if (!companyWide && scope.length === 0) return { items: [] };
    const { rows } = await c.query(
      `SELECT w.id, w.name, w.site_label, w.status::text AS status, k.operating_company_id,
              (SELECT count(*)::int FROM eos_ops.bins b WHERE b.tenant_id = w.tenant_id AND b.warehouse_id = w.id AND b.status = 'ACTIVE') AS bin_count
         FROM eos_ops.warehouses w
         LEFT JOIN eos_policy.tenant_operating_company_keys k
           ON k.tenant_id = w.tenant_id AND k.operating_company_key = w.operating_company_key AND k.status = 'ACTIVE'
        WHERE w.tenant_id = $1 AND (CASE WHEN $4::boolean THEN w.operating_company_key = ANY($3::text[]) AND w.id <> ALL($5::text[]) AND w.status::text = 'ACTIVE' ELSE w.id = ANY($2::text[]) END)
        ORDER BY w.name, w.id`, [actor.tenantId, scope, [...keys], companyWide, [...PRESENTATION_EXCLUDED]]);
    return { items: rows.map((r) => ({ warehouseId: r.id, name: r.name, siteLabel: r.site_label, status: r.status,
      operatingCompanyId: r.operating_company_id ?? null, binCount: Number(r.bin_count), inScope: scope.includes(String(r.id)) })) };
  });
}

export async function listInventoryLocations(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireAnyCapability(actor, [WAREHOUSE_READ, INVENTORY_ON_HAND_READ]);
  const i = acceptOnly(input, ["warehouseId"]);
  const warehouseId = i.warehouseId === undefined || i.warehouseId === null ? null : i.warehouseId;
  if (warehouseId !== null && !ID(warehouseId)) refuse("WAREHOUSE_ID_INVALID", "INVALID_INPUT", "warehouseId must be a governed id");
  return withReadSnapshot(deps.pool, async (c) => {
    const keys = await reachableCompanyKeys(c, actor, "listing locations");
    const scope = await presentableScope(c, actor, keys);
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
          AND m.operating_company_key = ANY($4::text[])
        ORDER BY m.display_label, m.location_id`, [actor.tenantId, visible, mine, [...keys]])).rows;
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
    const keys = await reachableCompanyKeys(c, actor, "listing transfers");
    const scope = await scopedWarehouseIds(c, actor, { companyKeys: keys });
    // `canReceive` is an EXECUTION hint: only the caller's OWN warehouse scope, never administration reach (#224).
    const receivable = await scopedWarehouseIds(c, actor, { administrationReach: false, companyKeys: keys });
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
           FROM eos_ops.transfer_orders t WHERE t.tenant_id = $1 AND ($2::text IS NULL OR t.status::text = $2)
            AND (t.source_operating_company_key = ANY($6::text[]) OR t.destination_operating_company_key = ANY($6::text[]))) x
        WHERE ow = ANY($3::text[]) OR dw = ANY($3::text[]) OR (dt = 'MOBILE' AND di = ANY($5::text[]))
        ORDER BY created_at DESC, id LIMIT $4`, [actor.tenantId, status, scope, limit, mine, [...keys]]);
    return { items: rows.map((r) => ({
      transferOrderId: r.id, transferOrderNumber: r.transfer_order_number, status: r.status, partId: r.part_id, trackingMode: r.tracking_mode,
      quantity: Number(r.quantity), serialNumbers: r.serial_numbers ?? [],
      origin: { type: r.ot, locationId: r.oi, warehouseId: r.ow ?? null }, destination: { type: r.dt, locationId: r.di, warehouseId: r.dw ?? null },
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at, createdBy: r.created_by,
      canReceive: r.status === "IN_TRANSIT" && ((r.dw !== null && receivable.includes(r.dw)) || (r.dt === "MOBILE" && mine.includes(r.di))),
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
    if (!tenantWide && mine.length === 0 && !actor.capabilities.has(INVENTORY_ON_HAND_READ)) {
      refuse("CAPABILITY_MISSING", "FORBIDDEN", `this read requires one of ${TRUCK_ROSTER_READERS.join(", ")}`);
    }
    const keys = await reachableCompanyKeys(c, actor, "reading the truck roster");
    if (!tenantWide && mine.length === 0) return { scope: "OWN", mobileLocationIds: mine, trucks: [] };
    const trucks = await listTruckViews(c, actor.tenantId, { ...(tenantWide ? {} : { mobileLocationIds: mine }), companyKeys: keys });
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
    const keys = await reachableCompanyKeys(c, actor, "reading truck stock");
    const mine = await currentMobileLocationIds(c, actor);
    const scope = await scopedWarehouseIds(c, actor, { companyKeys: keys });
    const { rows: loc } = await c.query(
      `SELECT m.display_label, m.active, m.operating_company_key, t.truck_id, t.vehicle_number, t.status::text AS truck_status,
              ${GOVERNING_WAREHOUSE("m.tenant_id", "m.location_type", "m.location_id")} AS bound_warehouse_id
         FROM eos_ops.mobile_locations m
         LEFT JOIN eos_ops.trucks t ON t.tenant_id = m.tenant_id AND t.mobile_location_type = m.location_type AND t.mobile_location_id = m.location_id
        WHERE m.tenant_id = $1 AND m.location_type = 'MOBILE' AND m.location_id = $2`, [actor.tenantId, locationId]);
    // A truck of a company outside the caller's reads EXACTLY as a missing one.
    const l = loc[0] && keys.includes(String(loc[0].operating_company_key)) ? loc[0] : undefined;
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
