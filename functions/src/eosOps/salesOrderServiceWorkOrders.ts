// THE SELLER'S VIEW OF THE SERVICE WORK ORDERS OF ITS SALES ORDER -- a narrow, READ-ONLY, governed projection (Owner DWO-1, 2026-10-21; DECISIONS #DWO-company).
//
// When one company sells and another company PERFORMS the service (the seller's service-provider authorization, FBR-F2 / #206), the Work Order belongs to the servicing
// company. The selling company may see THAT it is being serviced, and how far along it is -- and nothing else. This is deliberately not Work Order detail:
//
//   WHO       a caller who reaches the SALES ORDER (Commercial company authority + the sales-channel narrowing, the one shared decision callerMaySeeSalesOrder) and holds
//             salesOrder.read. The relationship is the governed lineage: the Work Order carries this Sales Order's id AND the seller authorized the Work Order's company
//             on this Sales Order (eos_commercial.sales_order_service_providers). It is never inferred from customer identity, and no company is granted anything.
//   SHOWN     the Work Order reference, the Sales Order, the servicing company, the service type and status, the scheduled window, progress and completion, and the
//             customer-facing outcome (the recorded resolution, only once the job is completed).
//   NEVER     technician identity or notes, labor, parts, rates, costs, attachments, diagnosis, complaint text, equipment custody, or any financial data of the servicing company.
//   NO WRITE  it is a read. The seller cannot modify, schedule, dispatch, reassign, complete or cancel the Work Order: ordinary detail and every command keep the servicing-
//             company checks (workOrderCompanyAuthority.ts), and the seller's company does not reach the Work Order there.
//   UNRELATED a Sales Order the caller does not reach reads exactly as a missing one; a Work Order that is not linked to this Sales Order by an authorization is not listed.
import type { Pool } from "pg";
import { callerMaySeeSalesOrder } from "../eosCommercial/commercialCompanyAuthority";
import { serviceScopeForWorkOrderType } from "../eosCommercial/fulfillment/serviceProviderAuthorization";
import { WorkOrderLifecycleError } from "./workOrderLifecycle";
import { notQuarantined } from "./workOrderQuarantine";
import type { WorkOrderOp } from "./workOrderOperationTypes";

export const SALES_ORDER_READ = "salesOrder.read";
export const SERVICE_WORK_ORDER_LIST_MAX = 100;

const refuse = (code: string, category: WorkOrderLifecycleError["category"], message: string): never => {
  throw new WorkOrderLifecycleError(code, category, message);
};
const ID_SHAPE = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

export const SALES_ORDER_NOT_FOUND_MESSAGE = "the Sales Order does not exist in this tenant";

export interface ServiceWorkOrderProjection {
  readonly workOrderId: string;
  readonly workOrderNumber: string | null;
  readonly salesOrderId: string;
  readonly salesOrderNumber: string | null;
  readonly servicingCompanyKey: string;
  readonly serviceType: string;
  readonly serviceScope: "INSTALLATION" | "SERVICE";
  readonly status: string;
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  readonly progress: Readonly<Record<string, string | null>>;
  readonly completed: boolean;
  readonly outcome: string | null;
}

/**
 * THE projection's columns -- the only Work Order columns the seller's view (this read AND the coordinated-visit read) ever selects. Nothing else of the Work Order leaves the
 * database for a seller: no complaint, diagnosis, notes, labor, parts, costs, attachments, assignee, equipment, customer or site.
 */
export const SERVICE_PROJECTION_COLUMNS = `w.id, w.work_order_number, w.work_order_type::text AS work_order_type, w.status::text AS status, w.operating_company_key,
            w.scheduled_start, w.scheduled_end, w.dispatched_at, w.accepted_at, w.en_route_at, w.arrived_at, w.work_started_at, w.completed_at, w.closed_at, w.resolution`;

/** The one mapping from a row of SERVICE_PROJECTION_COLUMNS to what a seller sees. */
export function projectServiceWorkOrder(r: Record<string, unknown>, salesOrderId: string, salesOrderNumber: string | null): ServiceWorkOrderProjection {
  const completed = r.completed_at !== null && r.completed_at !== undefined;
  return Object.freeze({
    workOrderId: String(r.id), workOrderNumber: (r.work_order_number as string | null) ?? null,
    salesOrderId, salesOrderNumber,
    servicingCompanyKey: String(r.operating_company_key), serviceType: String(r.work_order_type),
    serviceScope: serviceScopeForWorkOrderType(String(r.work_order_type)), status: String(r.status),
    scheduledStart: iso(r.scheduled_start), scheduledEnd: iso(r.scheduled_end),
    progress: Object.freeze({ dispatchedAt: iso(r.dispatched_at), acceptedAt: iso(r.accepted_at), enRouteAt: iso(r.en_route_at), arrivedAt: iso(r.arrived_at),
      workStartedAt: iso(r.work_started_at), completedAt: iso(r.completed_at), closedAt: iso(r.closed_at) }),
    completed,
    // The customer-facing outcome: the recorded resolution, shown only once the job is completed.
    outcome: completed ? ((r.resolution as string | null) ?? null) : null,
  });
}

export async function readSalesOrderServiceWorkOrders(deps: { readonly pool: Pool }, caller: Parameters<WorkOrderOp>[1], input: Record<string, unknown>) {
  const extra = Object.keys(input ?? {}).filter((k) => k !== "salesOrderId");
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
  const salesOrderId = input?.salesOrderId;
  if (!ID_SHAPE(salesOrderId)) refuse("SALES_ORDER_ID_INVALID", "INVALID_INPUT", "a salesOrderId is required");
  const { tenantId, principalId } = caller.actor;
  // CAPABILITY FIRST (flat, or held within a sales-channel scope): a caller with neither learns nothing else.
  const scoped = caller.operational.scopedHeld ?? [];
  if (!caller.actor.capabilities.has(SALES_ORDER_READ) && !scoped.some((h) => h.capabilityKey === SALES_ORDER_READ)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `viewing the service on a Sales Order requires ${SALES_ORDER_READ}`);
  }
  // THEN the Sales Order, by the one shared Commercial decision: company authority, then channel. Not reached == missing.
  const mayStart = await callerMaySeeSalesOrder(deps.pool, { tenantId, principalId, capabilities: caller.actor.capabilities, scopedHeld: scoped },
    salesOrderId as string, [SALES_ORDER_READ]);
  if (!mayStart) refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", SALES_ORDER_NOT_FOUND_MESSAGE);
  const so = await deps.pool.query(`SELECT sales_order_number, operating_company_key FROM eos_commercial.sales_orders WHERE tenant_id = $1 AND id = $2`, [tenantId, salesOrderId]);
  if (so.rows.length === 0) refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", SALES_ORDER_NOT_FOUND_MESSAGE);
  const sellerKey = String(so.rows[0].operating_company_key);
  const salesOrderNumber = (so.rows[0].sales_order_number as string | null) ?? null;
  // The governed lineage: the Work Order carries THIS Sales Order and the seller authorized its company on THIS Sales Order; it is another company's (the seller's own
  // Work Orders are read through ordinary detail).
  const { rows } = await deps.pool.query(
    `SELECT ${SERVICE_PROJECTION_COLUMNS}
       FROM eos_ops.work_orders w
       JOIN eos_commercial.sales_order_service_providers p
         ON p.tenant_id = w.tenant_id AND p.sales_order_id = w.sales_order_id AND p.service_operating_company_key = w.operating_company_key
        AND p.status = 'ACTIVE' AND (CASE WHEN w.work_order_type = 'INSTALL' THEN 'INSTALLATION' ELSE 'SERVICE' END) = ANY(p.scopes)
      WHERE w.tenant_id = $1 AND w.sales_order_id = $2 AND w.operating_company_key <> $3 AND ${notQuarantined("w")}
      ORDER BY w.created_at, w.id
      LIMIT ${SERVICE_WORK_ORDER_LIST_MAX + 1}`,
    [tenantId, salesOrderId, sellerKey]);
  const items = rows.slice(0, SERVICE_WORK_ORDER_LIST_MAX).map((r) => projectServiceWorkOrder(r, salesOrderId as string, salesOrderNumber));
  return Object.freeze({ salesOrderId: salesOrderId as string, salesOrderNumber, sellingCompanyKey: sellerKey, items: Object.freeze(items), truncated: rows.length > SERVICE_WORK_ORDER_LIST_MAX });
}

export const readSalesOrderServiceWorkOrdersOp: WorkOrderOp = (deps, caller, input) => readSalesOrderServiceWorkOrders({ pool: deps.pool }, caller, input);
