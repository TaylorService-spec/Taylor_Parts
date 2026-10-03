// THE VENDOR PAYABLE OF A PURCHASE RECEIPT (Finance Closure, DECISIONS #206; governed by the Finance target model §11 / §12:
// "VENDOR_PURCHASE -- vendor -> company on receipt -- company payable"; "vendor obligation from receipt (received-not-
// invoiced); payable consequence to the company's outbox").
//
// A governed EXTERNAL purchase receipt whose cost evidence is COMPLETE opens ONE PAYABLE of the receiving (buying) company
// toward the supplier's organization, for the receipt's evidenced acquisition cost, dated at the receipt's business date and due
// by the company's governed terms with that organization (never assumed), and hands it to the company's accounting destination.
// An incomplete receipt opens nothing -- missing cost is not zero; governed late cost evidence (costEvidenceCompletion.ts)
// opens it once. An internal-supplier receipt is intercompany (#202), never a vendor payable. A legacy supplier with no governed
// organization opens nothing and says so. A corrected receipt VOIDS its payable (refused once settled or handed off).
import type { PoolClient } from "pg";
import { counterpartyForSupplier, FinanceFoundationError, openObligationOn, voidObligationOn, type FinanceActor } from "./financeFoundation";
import { ensureObligationHandoffOn, supersedeObligationHandoffOn } from "./obligationHandoff";

type Queryable = Pick<PoolClient, "query">;

export type ReceiptPayableStatus = "ESTABLISHED" | "COST_EVIDENCE_MISSING" | "NOT_VENDOR_PURCHASE" | "SUPPLIER_ORGANIZATION_UNGOVERNED" | "NOT_REQUIRED_ZERO_AMOUNT";

const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function establishReceiptPayableOn(c: Queryable, actor: FinanceActor, receivingId: string): Promise<{ status: ReceiptPayableStatus; obligationId?: string; dueOn?: string | null }> {
  const { rows: rcv } = await c.query(
    `SELECT r.id, r.status::text AS status, r.received_at, r.source_purchase_order_id, po.supplier_kind, po.supplier_id, po.purchasing_operating_company_id
       FROM eos_ops.receiving_orders r LEFT JOIN eos_ops.purchase_orders po ON po.tenant_id = r.tenant_id AND po.id = r.source_purchase_order_id
      WHERE r.tenant_id = $1 AND r.id = $2`, [actor.tenantId, receivingId]);
  const r = rcv[0];
  if (!r || r.status === "CANCELLED" || r.supplier_kind !== "EXTERNAL_ORGANIZATION") return { status: "NOT_VENDOR_PURCHASE" };
  const { rows: lines } = await c.query(`SELECT line_id FROM eos_ops.receiving_order_lines WHERE tenant_id = $1 AND receiving_order_id = $2`, [actor.tenantId, receivingId]);
  const { rows: ev } = await c.query(`SELECT operating_company_id, extended_cost_minor, currency FROM eos_finance.inventory_acquisition_costs WHERE tenant_id = $1 AND receiving_id = $2`,
    [actor.tenantId, receivingId]);
  if (lines.length === 0 || ev.length !== lines.length) return { status: "COST_EVIDENCE_MISSING" };
  const currencies = new Set(ev.map((e) => e.currency));
  const companies = new Set(ev.map((e) => e.operating_company_id));
  if (currencies.size !== 1 || companies.size !== 1) {
    throw new FinanceFoundationError("RECEIPT_PAYABLE_MIXED", "PRECONDITION_FAILED", "one receipt's payable carries one company and one currency");
  }
  const amount = ev.reduce((n, e) => n + BigInt(e.extended_cost_minor), 0n);
  if (amount === 0n) return { status: "NOT_REQUIRED_ZERO_AMOUNT" };
  const company = String(ev[0].operating_company_id);
  const supplier = await counterpartyForSupplier(c, actor, r.supplier_id ?? null);
  if (!supplier) return { status: "SUPPLIER_ORGANIZATION_UNGOVERNED" };
  const { rows: bd } = await c.query(`SELECT to_char(eos_policy.operating_company_business_date($1, $2, $3::timestamptz), 'YYYY-MM-DD') AS d`,
    [actor.tenantId, company, r.received_at]);
  const businessDate = String(bd[0].d);
  const { rows: terms } = await c.query(`SELECT payment_terms_net_days FROM eos_finance.counterparty_company_profiles
    WHERE tenant_id = $1 AND counterparty_id = $2 AND operating_company_id = $3 AND status = 'ACTIVE'`, [actor.tenantId, supplier.id, company]);
  const netDays = terms[0]?.payment_terms_net_days ?? null;
  const dueOn = netDays === null ? null : addDays(businessDate, Number(netDays));
  const opened = await openObligationOn(c, actor, {
    operatingCompanyId: company, counterpartyId: supplier.id, kind: "PAYABLE", currency: String(ev[0].currency), sourceDomain: "RECEIVING",
    sourceRecordId: receivingId, originationAmountMinor: amount, basis: "VENDOR_PURCHASE_RECEIVED_NOT_INVOICED",
    effectiveAt: new Date(`${businessDate}T00:00:00Z`), idempotencyKey: `ap:rcv:${receivingId}`, correlationId: r.source_purchase_order_id ?? null, dueOn,
  });
  await ensureObligationHandoffOn(c, actor, { obligationId: opened.obligationId, payloadKind: "VENDOR_PAYABLE", correlationId: r.source_purchase_order_id ?? null });
  return { status: "ESTABLISHED", obligationId: opened.obligationId, dueOn };
}

/** A corrected / cancelled receipt voids its payable (reversing facts) and supersedes its handoff -- refused once settled or delivered. */
export async function retireReceiptPayableOn(c: Queryable, actor: FinanceActor, input: { receivingId: string; correctionId: string; reason: string }) {
  const { rows } = await c.query(`SELECT id, status FROM eos_finance.obligations WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, `ap:rcv:${input.receivingId}`]);
  const o = rows[0];
  if (!o || o.status === "VOID") return null;
  await supersedeObligationHandoffOn(c, actor, String(o.id));
  await voidObligationOn(c, actor, { obligationId: String(o.id), reason: input.reason, idempotencyKey: `ap:void:${input.correctionId}` });
  return Object.freeze({ obligationId: String(o.id) });
}
