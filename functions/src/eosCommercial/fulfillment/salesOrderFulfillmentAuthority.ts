// THE COMMERCIAL FULFILLMENT AUTHORITY (DQ-015; Controller COMMERCIAL FINANCE ACTIVATION, 2026-10-02; DECISIONS #195).
//
// Commercial owns Commercial fulfillment state. This module is the ONLY writer of eos_commercial.sales_order_fulfillments,
// and it is reached ONLY server-side, from Work Order completion, inside the completion's own transaction
// (workOrderScheduling.completeWorkOrder). The technician completing their assigned work gains NO Commercial authority:
// the server composes this governed consequence of the already-authorized completion. No transport operation names it.
//
// WHAT COUNTS (only governed operational evidence, and only for Sales Order lines the Work Order was EXPLICITLY linked to
// at creation -- eos_ops.work_order_sales_order_lines):
//   PART            the Work Order's recorded Part actuals (work_order_execution_records PART_USAGE, summed) for the line's
//                   Part -- the Owner-ratified P1 rule (fulfilled from qtyUsed). Nothing is consumed here: the usage /
//                   truck consumption already happened through the Work Order / Inventory authority.
//   EQUIPMENT_MODEL the units this Work Order INSTALLED (eos_ops.equipment_events INSTALLED) whose Equipment is of the line's
//                   model, with their Equipment ids and serial numbers. Custody, the ledger movement and the Equipment
//                   record stay the Equipment / Inventory authority's facts.
//   SERVICE         the completion of the Work Order the SERVICE line was linked to establishes that the AGREED service was
//                   performed -- the line's remaining ordered quantity, at its existing commercial price. Never a price or a
//                   quantity derived from labor time.
// A linked line with no evidence stays unfulfilled. Matching and overage reuse the Owner-ratified pure core
// (salesOrderFulfillmentWriteBack.applyFulfillmentAcceptance): additive, matched by the stable line id, and an OVERAGE
// FAILS CLOSED -- the whole completion is refused rather than fulfilled past what was ordered.
//
// FAIL CLOSED, all inside the completion transaction: a Sales Order that does not exist, a Work Order of another operating
// company / customer / site, an unbound or CONSOLIDATED company, a Sales Order that cannot take fulfillment, a linked Work
// Order with no linked lines. Idempotent: COMPLETED is one-way and every row is unique per (Work Order, line).
import { serviceProviderAuthorized } from "./serviceProviderAuthorization";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { applyFulfillmentAcceptance, FulfillmentWriteBackError, type FulfillmentAcceptance } from "../../salesOrder/salesOrderFulfillmentWriteBack";
import { computeBillingEligibility, type BillingEligibility } from "../../fulfillment/billingEligibility";

type Queryable = Pick<PoolClient, "query">;

export type CommercialFulfillmentCategory = "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT";

export class CommercialFulfillmentError extends Error {
  constructor(readonly code: string, readonly category: CommercialFulfillmentCategory, message: string) {
    super(message);
    this.name = "CommercialFulfillmentError";
  }
}
const refuse = (code: string, category: CommercialFulfillmentCategory, message: string): never => {
  throw new CommercialFulfillmentError(code, category, message);
};

/** Sales Order states that may take fulfillment evidence. FULFILLED / CLOSED / CANCELLED take none. */
export const FULFILLABLE_SALES_ORDER_STATES = Object.freeze(["CONFIRMED", "IN_FULFILLMENT"] as const);

export interface RecordedFulfillment {
  readonly lineNumber: number;
  readonly kind: string;
  readonly ref: string;
  readonly quantity: number;
  readonly evidenceKind: "PART_USAGE" | "EQUIPMENT_INSTALLATION" | "SERVICE_PERFORMED";
  readonly equipmentIds: readonly string[];
  readonly serialNumbers: readonly string[];
}

export type WorkOrderFulfillmentOutcome =
  | { readonly status: "NOT_APPLICABLE" }
  | { readonly status: "RECORDED"; readonly salesOrderId: string; readonly operatingCompanyId: string; readonly fulfillments: readonly RecordedFulfillment[] };

interface Evidence { quantity: number; kind: RecordedFulfillment["evidenceKind"]; recordIds: string[]; equipmentIds: string[]; serials: string[] }

/**
 * Record the Commercial fulfillment a Work Order's completion proves. Call ONLY inside the completion transaction, after the
 * completion has been authorized and the Work Order locked.
 */
export async function recordWorkOrderFulfillmentOn(
  c: Queryable,
  actor: { readonly tenantId: string; readonly principalId: string },
  input: { readonly workOrderId: string; readonly completedAt: Date },
): Promise<WorkOrderFulfillmentOutcome> {
  const { rows: woRows } = await c.query(
    `SELECT id, operating_company_key, customer_id, location_id, sales_order_id, work_order_type FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`,
    [actor.tenantId, input.workOrderId]);
  const wo = woRows[0];
  if (!wo) return refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "no such Work Order");
  const { rows: links } = await c.query(
    `SELECT sales_order_id, sales_order_line_id FROM eos_ops.work_order_sales_order_lines WHERE tenant_id = $1 AND work_order_id = $2
      ORDER BY sales_order_line_id`, [actor.tenantId, input.workOrderId]);
  if (wo.sales_order_id === null && links.length === 0) return Object.freeze({ status: "NOT_APPLICABLE" as const });

  const salesOrderId = String(wo.sales_order_id ?? links[0].sales_order_id);
  if (links.some((l) => l.sales_order_id !== salesOrderId)) {
    refuse("SALES_ORDER_LINK_INCONSISTENT", "PRECONDITION_FAILED", "the Work Order's linked lines name a different Sales Order than the Work Order");
  }
  // THE SERIALIZATION ANCHOR: concurrent completions against one Sales Order apply one after the other.
  const { rows: soRows } = await c.query(
    `SELECT id, state::text AS state, operating_company_key, account_id, location_id FROM eos_commercial.sales_orders
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, salesOrderId]);
  const so = soRows[0];
  if (!so) return refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order names a Sales Order that does not exist in PostgreSQL Commercial");
  if (links.length === 0) {
    refuse("SALES_ORDER_LINES_UNLINKED", "PRECONDITION_FAILED",
      "the Work Order is linked to a Sales Order but to none of its lines, so its completion cannot state what it fulfilled");
  }
  if (!(FULFILLABLE_SALES_ORDER_STATES as readonly string[]).includes(so.state)) {
    refuse("SALES_ORDER_NOT_FULFILLABLE", "PRECONDITION_FAILED", `the Sales Order is ${so.state}; it takes no fulfillment`);
  }
  // ONE GOVERNED COMPANY. The Work Order and the Sales Order must be the same company; the company is the binding's, never
  // the site's, and never CONSOLIDATED.
  // ONE governed company -- or (FBR-F2, #206) a service-performing company the seller ACTIVELY authorized for this Work Order's
  // type. The fulfillment record keeps the SELLER's company; the service company is stated beside it.
  const crossCompany = wo.operating_company_key !== so.operating_company_key;
  if (crossCompany && !(await serviceProviderAuthorized(c, actor.tenantId, salesOrderId, String(wo.operating_company_key), String(wo.work_order_type)))) {
    refuse("SALES_ORDER_COMPANY_MISMATCH", "PRECONDITION_FAILED", "the Work Order and the Sales Order belong to different operating companies");
  }
  const operatingCompanyId = await resolveCompany(c, actor.tenantId, String(so.operating_company_key));
  if (wo.customer_id !== so.account_id) refuse("SALES_ORDER_CUSTOMER_MISMATCH", "PRECONDITION_FAILED", "the Work Order is for a different customer than the Sales Order");
  if (so.location_id !== null && wo.location_id !== so.location_id) {
    refuse("SALES_ORDER_SITE_MISMATCH", "PRECONDITION_FAILED", "the Work Order is at a different site than the Sales Order");
  }

  const lineNumbers = links.map((l) => Number(l.sales_order_line_id));
  if (lineNumbers.some((n) => !Number.isSafeInteger(n) || n <= 0)) refuse("SALES_ORDER_LINE_INVALID", "PRECONDITION_FAILED", "a linked line id is not a line number");
  const { rows: lines } = await c.query(
    `SELECT line_number, kind::text AS kind, ref, ordered_qty, fulfilled_qty FROM eos_commercial.sales_order_line_fulfillment
      WHERE tenant_id = $1 AND sales_order_id = $2 ORDER BY line_number`, [actor.tenantId, salesOrderId]);
  const linked = lines.filter((l) => lineNumbers.includes(Number(l.line_number)));
  if (linked.length !== lineNumbers.length) refuse("SALES_ORDER_LINE_NOT_FOUND", "PRECONDITION_FAILED", "a linked line does not exist on the Sales Order");

  // The evidence, per linked line.
  const evidence = new Map<number, Evidence>();
  for (const l of linked) {
    const n = Number(l.line_number);
    if (l.kind === "PART") {
      const { rows } = await c.query(
        `SELECT COALESCE(SUM(applied_delta), 0)::int AS used, COALESCE(array_agg(id ORDER BY id), '{}') AS ids
           FROM eos_ops.work_order_execution_records WHERE tenant_id = $1 AND work_order_id = $2 AND kind = 'PART_USAGE' AND part_id = $3`,
        [actor.tenantId, input.workOrderId, l.ref]);
      const used = Number(rows[0].used);
      if (used > 0) evidence.set(n, { quantity: used, kind: "PART_USAGE", recordIds: rows[0].ids, equipmentIds: [], serials: [] });
    } else if (l.kind === "EQUIPMENT_MODEL") {
      const { rows } = await c.query(
        `SELECT ev.id, ev.equipment_id, ev.serial_number FROM eos_ops.equipment_events ev
           JOIN eos_ops.equipment e ON e.tenant_id = ev.tenant_id AND e.id = ev.equipment_id
          WHERE ev.tenant_id = $1 AND ev.work_order_id = $2 AND ev.event_type = 'INSTALLED' AND e.equipment_model_id = $3
          ORDER BY ev.equipment_id`, [actor.tenantId, input.workOrderId, l.ref]);
      if (rows.length > 0) {
        evidence.set(n, { quantity: rows.length, kind: "EQUIPMENT_INSTALLATION", recordIds: rows.map((r) => String(r.id)),
          equipmentIds: rows.map((r) => String(r.equipment_id)), serials: rows.map((r) => String(r.serial_number)) });
      }
    } else if (l.kind === "SERVICE") {
      const remaining = Number(l.ordered_qty) - Number(l.fulfilled_qty);
      if (remaining > 0) evidence.set(n, { quantity: remaining, kind: "SERVICE_PERFORMED", recordIds: [input.workOrderId], equipmentIds: [], serials: [] });
    }
  }

  // The Owner-ratified matching / overage core.
  const acceptances: FulfillmentAcceptance[] = [...evidence.entries()].map(([n, e]) => {
    const l = linked.find((x) => Number(x.line_number) === n);
    return { lineId: String(n), kind: String(l.kind), ref: String(l.ref), qty: e.quantity };
  });
  try {
    applyFulfillmentAcceptance(linked.map((l) => ({ lineId: String(l.line_number), kind: String(l.kind), ref: String(l.ref),
      orderedQty: Number(l.ordered_qty), fulfilledQty: Number(l.fulfilled_qty) })), acceptances);
  } catch (err) {
    if (err instanceof FulfillmentWriteBackError) {
      refuse(err.code === "OVERAGE" ? "FULFILLMENT_OVERAGE" : "FULFILLMENT_INVALID", "PRECONDITION_FAILED",
        `the completion would fulfil more than the Sales Order line ordered: ${err.message}`);
    }
    throw err;
  }

  const recorded: RecordedFulfillment[] = [];
  for (const [n, e] of evidence) {
    const l = linked.find((x) => Number(x.line_number) === n);
    await c.query(
      `INSERT INTO eos_commercial.sales_order_fulfillments (id, tenant_id, sales_order_id, line_number, line_kind, line_ref, quantity, source_kind,
          source_work_order_id, evidence_kind, evidence_record_ids, equipment_ids, serial_numbers, operating_company_key, operating_company_id,
          account_id, location_id, fulfilled_at, recorded_by, service_operating_company_key)
       VALUES ($1,$2,$3,$4,$5::eos_commercial.commercial_line_kind,$6,$7,'WORK_ORDER_COMPLETION',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (tenant_id, source_work_order_id, sales_order_id, line_number) DO NOTHING`,
      [`sof_${randomUUID()}`, actor.tenantId, salesOrderId, n, l.kind, l.ref, e.quantity, input.workOrderId, e.kind, e.recordIds,
        e.equipmentIds, e.serials, so.operating_company_key, operatingCompanyId, so.account_id, wo.location_id ?? null, input.completedAt,
        actor.principalId, crossCompany ? String(wo.operating_company_key) : null]);
    recorded.push(Object.freeze({ lineNumber: n, kind: String(l.kind), ref: String(l.ref), quantity: e.quantity, evidenceKind: e.kind,
      equipmentIds: Object.freeze(e.equipmentIds), serialNumbers: Object.freeze(e.serials) }));
  }
  await c.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, 'commercial.salesOrder.fulfillment', $3, 'sales_order', $4, NULL, $5::jsonb, $6, $7)`,
    [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, salesOrderId,
      JSON.stringify({ workOrderId: input.workOrderId, operatingCompanyId, fulfillments: recorded }), input.completedAt,
      "fulfillment proven by the governed Work Order completion (DQ-015)"]);
  return Object.freeze({ status: "RECORDED" as const, salesOrderId, operatingCompanyId, fulfillments: Object.freeze(recorded) });
}

async function resolveCompany(c: Queryable, tenantId: string, key: string): Promise<string> {
  const { rows } = await c.query(
    `SELECT k.operating_company_id FROM eos_policy.tenant_operating_company_keys k
       JOIN eos_policy.tenant_operating_companies co ON co.tenant_id = k.tenant_id AND co.operating_company_id = k.operating_company_id
      WHERE k.tenant_id = $1 AND k.operating_company_key = $2 AND k.status = 'ACTIVE' AND co.status = 'ACTIVE'`, [tenantId, key]);
  if (rows.length !== 1) return refuse("OPERATING_COMPANY_UNRESOLVED", "PRECONDITION_FAILED", `key "${key}" is not bound to exactly one ACTIVE operating company`);
  const id = String(rows[0].operating_company_id);
  if (id.toLowerCase() === "consolidated") refuse("CONSOLIDATED_NOT_A_COMPANY", "PRECONDITION_FAILED", "CONSOLIDATED owns no fulfillment");
  return id;
}

/** A Sales Order's lines with their DERIVED fulfilled quantity, in the shape the Owner-ratified lifecycle gate reads. */
export async function salesOrderFulfillmentLines(c: Queryable, tenantId: string, salesOrderId: string)
  : Promise<{ kind: string; ref: string; orderedQty: number; fulfilledQty: number }[]> {
  const { rows } = await c.query(
    `SELECT kind::text AS kind, ref, ordered_qty, fulfilled_qty FROM eos_commercial.sales_order_line_fulfillment
      WHERE tenant_id = $1 AND sales_order_id = $2 ORDER BY line_number`, [tenantId, salesOrderId]);
  return rows.map((r) => ({ kind: String(r.kind), ref: String(r.ref), orderedQty: Number(r.ordered_qty), fulfilledQty: Number(r.fulfilled_qty) }));
}

/** True when every line of the Sales Order is fully fulfilled -- the governed gate for IN_FULFILLMENT -> FULFILLED. */
export async function salesOrderFullyFulfilled(c: Queryable, tenantId: string, salesOrderId: string): Promise<boolean> {
  const lines = await salesOrderFulfillmentLines(c, tenantId, salesOrderId);
  return lines.length > 0 && lines.every((l) => l.fulfilledQty >= l.orderedQty);
}

export interface SalesOrderBillingEligibility {
  readonly salesOrderId: string;
  readonly eligibility: BillingEligibility;
  readonly reasons: readonly string[];
  readonly lines: readonly Record<string, unknown>[];
}

/**
 * THE BILLING-ELIGIBILITY READ (server-side; consumed by the future billing package). Lines come from the derived view; the
 * Sales Order answer is the Owner-ratified pure projection over the same lines. Not an invoice, receivable or posting.
 */
export async function readSalesOrderBillingEligibility(c: Queryable, tenantId: string, salesOrderId: string): Promise<SalesOrderBillingEligibility> {
  const { rows } = await c.query(
    `SELECT * FROM eos_commercial.sales_order_line_billing_eligibility WHERE tenant_id = $1 AND sales_order_id = $2 ORDER BY line_number`,
    [tenantId, salesOrderId]);
  if (rows.length === 0) return refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", "no Sales Order lines with that id");
  const order = computeBillingEligibility({ salesOrderState: String(rows[0].sales_order_state),
    lines: rows.map((r) => ({ ref: String(r.ref), orderedQty: Number(r.ordered_qty), fulfilledQty: Number(r.fulfilled_qty) })) });
  return Object.freeze({ salesOrderId, eligibility: order.eligibility, reasons: Object.freeze(order.reasons), lines: Object.freeze(rows) });
}
