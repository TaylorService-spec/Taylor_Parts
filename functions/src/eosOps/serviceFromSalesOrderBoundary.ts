// THE SALES ORDER -> SERVICE BOUNDARY, in PostgreSQL.
//
// ════════════════════ WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ════════════════════
//
// The Firestore seam (salesOrder/createServiceForSalesOrder.ts) states the invariant: a Sales Order NEVER
// authors Work Order state, assignment or schedule. It produces governed service DEMAND through the Work
// Order authority, and Dispatch picks it up through its own surfaces. That boundary is preserved exactly.
//
// This module carries the HANDOFF and nothing else:
//
//   * it READS the PostgreSQL Sales Order directly, in the caller's transaction, because Commercial and
//     Work Order live in the same database and the same Render runtime. No HTTP call between Render
//     handlers, and emphatically no Firestore read from a Render command.
//   * it COMPUTES, purely, what a service Work Order would be seeded with.
//   * it WRITES NOTHING. Work Order creation is the Work Order authority's job, not Commercial's and not
//     this module's.
//
// Keeping the computation pure is what lets the boundary be proved without a Work Order create path
// existing yet -- and a boundary nobody can test is how a migration discovers, at cutover, that it was
// carrying the wrong fields.
//
// ════════════════════ THE BLOCKER THIS MODULE MAKES EXECUTABLE ════════════════════
//
// The legacy seam seeds each PART line's qtyPlanned from `allocatedQty` -- NEVER from `orderedQty` -- and
// gates the whole operation on allocation having run at least once. Its own header says why: a Work Order
// created before allocation has ever run "would seed every PART line's qtyPlanned from unbacked demand".
//
// PostgreSQL Commercial does not have allocation. That is not an oversight to work around; migration
// 1759449600000 says so in the schema itself: "allocated/fulfilled/billed quantities are D2 execution
// fields and are NOT here."
//
// So there are exactly three things this could do with a PART line, and two of them are wrong:
//
//   seed from ordered_qty   the unbacked-demand defect, by name. A technician is dispatched to fit four
//                           compressors when one was allocated.
//   drop the gate           the same defect with no refusal to notice it.
//   REFUSE, and say why     ALLOCATION_AUTHORITY_UNAVAILABLE.
//
// The third is the same shape Commercial already established with CATALOG_AUTHORITY_UNAVAILABLE: a missing
// authority is refused as missing, never silently skipped. A Sales Order with NO part lines has nothing to
// back and is therefore NOT gated -- exactly as the legacy seam skips the gate for that case -- so the
// boundary is fully usable for service-only orders today and becomes fully usable for the rest the moment
// the D2 allocation authority exists.
import type { PoolClient } from "pg";
import type { PartPolicy } from "../catalogAuthority/postgresPartPolicyAuthority.js";

/** Already in the Role catalog; this boundary does not invent a capability. */
export const SALES_ORDER_SERVICE = "salesOrder.service";

/** The line kinds eos_commercial.sales_order_lines can carry. */
export const SALES_ORDER_LINE_KINDS = Object.freeze(["EQUIPMENT_MODEL", "PART", "SERVICE"] as const);
export type SalesOrderLineKind = (typeof SALES_ORDER_LINE_KINDS)[number];

/**
 * The states a Sales Order may raise service from.
 *
 * CANCELLED and CLOSED are excluded for the reason the parts-plan terminal rule gives: dispatching a
 * technician for an order that is finished or called off is not a handoff, it is a mistake with a van.
 */
export const SERVICEABLE_SALES_ORDER_STATES = Object.freeze([
  "CONFIRMED", "IN_FULFILLMENT", "FULFILLED",
] as const);

export type ServiceBoundaryCategory = "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "UNAVAILABLE";

export class ServiceBoundaryError extends Error {
  constructor(readonly code: string, readonly category: ServiceBoundaryCategory, message: string) {
    super(message);
    this.name = "ServiceBoundaryError";
  }
}
const refuse = (code: string, category: ServiceBoundaryCategory, message: string): never => {
  throw new ServiceBoundaryError(code, category, message);
};

export interface SalesOrderLineHandoff {
  readonly lineNumber: number;
  readonly kind: SalesOrderLineKind;
  /** PART -> a Part id; EQUIPMENT_MODEL -> an equipment model id; SERVICE -> a service ref. Opaque here. */
  readonly ref: string;
  readonly orderedQty: number;
}

/** Everything that crosses the boundary today, and nothing that does not. */
export interface SalesOrderHandoff {
  readonly salesOrderId: string;
  readonly salesOrderNumber: string;
  readonly state: string | null;
  readonly accountId: string;
  readonly locationId: string | null;
  readonly operatingCompanyKey: string;
  readonly lines: readonly SalesOrderLineHandoff[];
}

/** What a service Work Order would be created with. Data, not a Work Order. */
export interface ServiceWorkOrderSeed {
  readonly salesOrderId: string;
  /** work_orders.customer_id. The Sales Order's account, carried opaquely. */
  readonly customerId: string;
  /** work_orders.location_id, which is NOT NULL -- so an unsited Sales Order cannot raise service. */
  readonly locationId: string;
  /** The complaint a technician reads. Names the Sales Order the way a person says it. */
  readonly complaint: string;
  /** Rows for eos_ops.work_order_sales_order_lines -- the bidirectional trace. */
  readonly lineRefs: readonly { readonly salesOrderId: string; readonly salesOrderLineId: string }[];
  /** Rows for eos_ops.work_order_parts_plan. EMPTY until the allocation authority exists. */
  readonly plannedParts: readonly { readonly partId: string; readonly qtyPlanned: number }[];
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

/**
 * Read one Sales Order's handoff from PostgreSQL Commercial, on the caller's client.
 *
 * DIRECT COMPOSITION, not a bridge: same database, same runtime, same transaction as whatever the caller
 * goes on to write, so the Work Order cannot be created from a Sales Order that changed underneath it.
 */
export async function readSalesOrderHandoff(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  salesOrderId: string,
): Promise<SalesOrderHandoff> {
  if (!ID_SHAPE(tenantId) || !ID_SHAPE(salesOrderId)) {
    refuse("INPUT_INVALID", "INVALID_INPUT", "a Sales Order is only readable by id within a tenant");
  }
  const order = await db.query(
    `SELECT id, sales_order_number, state::text AS state, account_id, location_id, operating_company_key
       FROM eos_commercial.sales_orders
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, salesOrderId],
  );
  if (order.rows.length === 0) {
    refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", `no sales order ${salesOrderId} in this tenant`);
  }
  const o = order.rows[0] as Record<string, unknown>;
  const lines = await db.query(
    `SELECT line_number, kind::text AS kind, ref, ordered_qty
       FROM eos_commercial.sales_order_lines
      WHERE tenant_id = $1 AND sales_order_id = $2
      ORDER BY line_number`,
    [tenantId, salesOrderId],
  );
  return Object.freeze({
    salesOrderId: String(o.id),
    salesOrderNumber: String(o.sales_order_number),
    state: o.state === null || o.state === undefined ? null : String(o.state),
    accountId: String(o.account_id),
    locationId: o.location_id === null || o.location_id === undefined ? null : String(o.location_id),
    operatingCompanyKey: String(o.operating_company_key),
    lines: Object.freeze((lines.rows as Record<string, unknown>[]).map((r) => Object.freeze({
      lineNumber: Number(r.line_number),
      kind: String(r.kind) as SalesOrderLineKind,
      ref: String(r.ref),
      orderedQty: Number(r.ordered_qty),
    }))),
  });
}

/**
 * Compute the service Work Order seed for a Sales Order. PURE -- no database, no writes.
 *
 * `partPolicies` is the Catalog's answer for every PART line's ref, from the PostgreSQL Part policy
 * authority. It is passed in rather than fetched so this stays pure and so the Part facts and the Sales
 * Order facts come from the SAME transaction as the caller's write.
 */
export function buildServiceWorkOrderSeed(
  handoff: SalesOrderHandoff,
  partPolicies: readonly PartPolicy[],
): ServiceWorkOrderSeed {
  if (handoff.state !== null && !(SERVICEABLE_SALES_ORDER_STATES as readonly string[]).includes(handoff.state)) {
    refuse("SALES_ORDER_NOT_SERVICEABLE", "PRECONDITION_FAILED",
      `a ${handoff.state} sales order cannot raise service`);
  }
  // work_orders.location_id is NOT NULL, and PostgreSQL sales_orders.location_id is nullable. An unsited
  // order cannot become a visit: refusing is the only honest answer, because there is nowhere to send anyone.
  if (!ID_SHAPE(handoff.locationId)) {
    refuse("SALES_ORDER_HAS_NO_LOCATION", "PRECONDITION_FAILED",
      `sales order ${handoff.salesOrderId} has no service location; a Work Order must have somewhere to go`);
  }

  const partLines = handoff.lines.filter((l) => l.kind === "PART");
  const byRef = new Map(partPolicies.map((p) => [p.partId, p]));
  for (const line of partLines) {
    const policy = byRef.get(line.ref);
    // Fail closed on identity, exactly as the legacy seam does: never fabricate a Part.
    if (!policy || !policy.found) {
      refuse("PART_NOT_FOUND", "NOT_FOUND",
        `sales order line ${line.lineNumber} references part ${line.ref}, which is not a Part of this tenant's catalog`);
    }
  }

  // THE GATE. Not "allocation has not run" -- the authority that would run it does not exist here.
  if (partLines.length > 0) {
    refuse("ALLOCATION_AUTHORITY_UNAVAILABLE", "UNAVAILABLE",
      `sales order ${handoff.salesOrderId} has ${partLines.length} PART line(s), and PostgreSQL Commercial carries no `
      + "allocated quantity (a D2 execution field). Seeding a parts plan from ordered quantity would plan "
      + "unbacked demand, so service from a Sales Order with PART lines is refused until the allocation authority exists");
  }

  return Object.freeze({
    salesOrderId: handoff.salesOrderId,
    customerId: handoff.accountId,
    locationId: handoff.locationId as string,
    complaint: `Service for Sales Order ${handoff.salesOrderNumber}`,
    lineRefs: Object.freeze(handoff.lines.map((l) => Object.freeze({
      salesOrderId: handoff.salesOrderId,
      salesOrderLineId: String(l.lineNumber),
    }))),
    // Empty by construction while the gate above stands. Stated rather than omitted so the shape of the
    // finished handoff is visible and testable now.
    plannedParts: Object.freeze([]),
  });
}
