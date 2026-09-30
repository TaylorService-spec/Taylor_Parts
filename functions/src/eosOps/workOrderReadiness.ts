// THE EOS WORK ORDER READINESS CONTEXT -- the source dimensions a screen derives parts readiness from, for ONE
// Work Order.
//
// Owner DECISION 7: "Provide the EOS route/contract. Its Work Order/CRM/Catalog portions must use EOS/PostgreSQL. If
// inventory balance remains unavailable: return a canonical NOT_YET_ACTIVATED at the inventory-readiness boundary.
// Do not read frozen Firestore Catalog. Do not invent PostgreSQL stock balances. The client must never fall back to
// Firebase."
//
// ════════════════════ THE CONTRACT KEPT FROM ai/workOrderReadinessContext.ts ════════════════════
//
// The client's pure projection (domain/workOrderPartsReadiness.js) is the ONE authority that derives READY /
// ATTENTION / UNKNOWN. This read returns SOURCE DIMENSIONS for it and never a second readiness answer:
//
//   schemaVersion, subject, plannedParts[{ partId, name, sku, qtyPlanned, qtyUsed, reservedForJob, warehouse, truck,
//   procurement }], capabilities{ warehouse, truckInventory, purchasing, requestReorder }, limitations[]
//
// and, new, the explicit boundary: inventory { state: NOT_YET_ACTIVATED }.
//
// ════════════════════ WHAT EACH DIMENSION IS, AND WHERE IT COMES FROM ════════════════════
//
//   planned / used     the governed plan + the recorded actuals (PostgreSQL Work Order)           AVAILABLE
//   name / sku         the PostgreSQL Catalog's by-id read (internal part number as the sku)      AVAILABLE
//   subject            the Work Order and its CRM customer                                        AVAILABLE
//   warehouse          stock balance                                                              NOT_YET_ACTIVATED
//   reservedForJob     reservations (dispatch applies none: RESERVE_NOT_APPLIED)                  NOT_YET_ACTIVATED (null)
//   truck              MOBILE stock -- no authority exists                                        UNAVAILABLE
//   procurement        not read by this context (Firebase parity: PROCUREMENT_SOURCE_UNAVAILABLE)  UNAVAILABLE
//
// Every warehouse dimension is { status: "UNAVAILABLE" } and capabilities.warehouse is false, so the projection
// degrades to UNKNOWN honestly -- a guessed zero would send a technician to a job without the part, and an invented
// balance would be the hidden Inventory activation the ruling forbids. Reservation is null, never 0.
//
// AUTHORITY: the entitled per-record Work Order read, exactly as the field context and readWorkOrderDetail use it.
import type { OperationalActor } from "./entitledActionAuthority";
import type { ContextualReader } from "./contextualAuthorization";
import type { Pool } from "pg";
import { INVENTORY_NOT_YET_ACTIVATED, readAuthorizedWorkOrderRow, readPlannedPartLines } from "./workOrderFieldContext";
import type { WorkOrderOp } from "./workOrderOperationTypes";

export const WORK_ORDER_READINESS_LIMITATIONS = Object.freeze([
  "INVENTORY_BALANCE_NOT_YET_ACTIVATED",
  "RESERVATION_NOT_YET_ACTIVATED",
  "TRUCK_INVENTORY_UNAVAILABLE",
  "PROCUREMENT_SOURCE_UNAVAILABLE",
]);

async function assembleReadiness(deps: { readonly pool: Pool; readonly reader: ContextualReader }, actor: OperationalActor,
  input: Record<string, unknown>) {
  const { workOrderId, row } = await readAuthorizedWorkOrderRow(deps, actor, input);
  const lines = await readPlannedPartLines(deps, actor, workOrderId);
  const plannedParts = lines.filter((l) => l.qtyPlanned > 0).map((l) => Object.freeze({
    partId: l.partId,
    name: l.name,
    sku: l.internalPartNumber,
    catalog: l.catalog,
    qtyPlanned: l.qtyPlanned,
    qtyUsed: l.qtyUsed,
    reservedForJob: null,
    warehouse: Object.freeze({ status: "UNAVAILABLE" as const }),
    truck: Object.freeze({ status: "UNAVAILABLE" as const }),
    procurement: Object.freeze({ status: "UNAVAILABLE" as const }),
  }));
  return Object.freeze({
    schemaVersion: 1 as const,
    workOrderId,
    subject: Object.freeze({
      workOrderId,
      reference: (row.work_order_number as string | null) ?? workOrderId,
      status: String(row.status),
      customerName: (row.acct_name as string | null) ?? null,
    }),
    plannedParts: Object.freeze(plannedParts),
    capabilities: Object.freeze({ warehouse: false, truckInventory: false as const, purchasing: false, requestReorder: false }),
    sources: Object.freeze({
      workOrder: "AVAILABLE" as const,
      customer: "AVAILABLE" as const,
      catalog: "AVAILABLE" as const,
      inventory: "NOT_YET_ACTIVATED" as const,
      truckInventory: "NOT_YET_ACTIVATED" as const,
      // Not read by this context (Firebase parity), which is not the same as "no procurement exists".
      procurement: "UNAVAILABLE" as const,
    }),
    inventory: INVENTORY_NOT_YET_ACTIVATED,
    limitations: WORK_ORDER_READINESS_LIMITATIONS,
  });
}

/** readWorkOrderReadiness: the readiness source dimensions for ONE Work Order, behind the entitled record read. */
export const readWorkOrderReadiness: WorkOrderOp = (deps, caller, input) =>
  assembleReadiness({ pool: deps.pool, reader: deps.reader }, caller.operational, (input ?? {}) as Record<string, unknown>);
