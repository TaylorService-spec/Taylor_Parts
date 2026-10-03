// TAYLOR / VENTANA INTERCOMPANY TRANSACTIONS (DECISIONS #202; #190 §6; target model §11). See migration 1764490000000.
//
// WHERE != WHOSE. A governed INTERNAL purchase -- a Reorder Purchase Order whose supplier is INTERNAL_OPERATING_COMPANY
// (#193: purchasing_operating_company_id = buyer, supplier_operating_company_id = seller, never the same company) -- is a real
// company-to-company transaction. Its buyer and seller come ONLY from that governed identity: never from a warehouse's site,
// never from supplier display text (a text-only PO naming "Ventana" carries no identity and produces nothing here).
//
// The existing Purchasing pipeline is reused: the internal-supplier RECEIPT -- already a governed fact, with its priced
// acquisition-cost evidence owned by the BUYER (counterparty: the seller company, #193) -- writes ONE intercompany CORRELATION
// in its own transaction (buyer, seller, receipt, PO, amount, currency). The correlation is not a financial record.
//
// THE PAIRED OBLIGATIONS (buyer INTERCOMPANY_PAYABLE + seller INTERCOMPANY_RECEIVABLE: two obligations, two companies, one
// correlation, never netted, never CONSOLIDATED-owned) are implemented by establishIntercompanyObligationsOn, and the database
// enforces the exact pair -- but the business event that creates them is NOT yet ruled (#202 §6). It therefore has NO runtime
// caller: every correlation waits in AWAITING_OBLIGATION_TRIGGER until the Owner names the event. No elimination, no netting,
// no settlement, no transport operation, no capability.
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { ensureInternalCounterparty, FinanceFoundationError, openObligationOn, voidObligationOn, type FinanceActor, type FinanceFoundationCategory } from "./financeFoundation";

type Queryable = Pick<PoolClient, "query">;

const refuse = (code: string, category: FinanceFoundationCategory, message: string): never => {
  throw new FinanceFoundationError(code, category, message);
};

export interface IntercompanyCorrelation {
  readonly id: string;
  readonly buyerOperatingCompanyId: string;
  readonly sellerOperatingCompanyId: string;
  readonly sourceKind: "REORDER_RECEIPT";
  readonly sourceRecordId: string;
  readonly purchaseOrderId: string;
  readonly currency: string;
  readonly amountMinor: string | null;
  readonly costEvidenceComplete: boolean;
  readonly status: string;
  readonly buyerObligationId: string | null;
  readonly sellerObligationId: string | null;
}
const correlationOf = (r: Record<string, any>): IntercompanyCorrelation => Object.freeze({
  id: String(r.id), buyerOperatingCompanyId: String(r.buyer_operating_company_id), sellerOperatingCompanyId: String(r.seller_operating_company_id),
  sourceKind: r.source_kind, sourceRecordId: String(r.source_record_id), purchaseOrderId: String(r.purchase_order_id), currency: String(r.currency),
  amountMinor: r.amount_minor === null ? null : String(r.amount_minor), costEvidenceComplete: r.cost_evidence_complete === true, status: String(r.status),
  buyerObligationId: r.buyer_obligation_id ?? null, sellerObligationId: r.seller_obligation_id ?? null,
});

/**
 * THE CORRELATION OF ONE INTERNAL-SUPPLIER RECEIPT, inside the receipt's transaction (idempotent). Returns null for a receipt
 * whose PO is not a governed internal purchase (external supplier, or a legacy text-only PO -- text never manufactures one).
 */
export async function recordIntercompanyCorrelationForReceiptOn(c: Queryable, actor: FinanceActor, receivingId: string): Promise<IntercompanyCorrelation | null> {
  const { rows: rcv } = await c.query(
    `SELECT r.id, r.source_purchase_order_id, po.supplier_kind, po.supplier_operating_company_id, po.purchasing_operating_company_id, po.currency AS po_currency
       FROM eos_ops.receiving_orders r JOIN eos_ops.purchase_orders po ON po.tenant_id = r.tenant_id AND po.id = r.source_purchase_order_id
      WHERE r.tenant_id = $1 AND r.id = $2`, [actor.tenantId, receivingId]);
  const r = rcv[0];
  if (!r || r.supplier_kind !== "INTERNAL_OPERATING_COMPANY") return null;
  const buyer = String(r.purchasing_operating_company_id);
  const seller = String(r.supplier_operating_company_id);
  if (buyer === seller) refuse("SELF_PURCHASE_REFUSED", "PRECONDITION_FAILED", "an operating company cannot purchase from itself");
  const { rows: existing } = await c.query(
    `SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id = $1 AND source_kind = 'REORDER_RECEIPT' AND source_record_id = $2`, [actor.tenantId, receivingId]);
  if (existing[0]) return correlationOf(existing[0]);
  const { rows: lines } = await c.query(`SELECT line_id FROM eos_ops.receiving_order_lines WHERE tenant_id = $1 AND receiving_order_id = $2`, [actor.tenantId, receivingId]);
  const { rows: evidence } = await c.query(
    `SELECT receiving_line_id, operating_company_id, currency, extended_cost_minor FROM eos_finance.inventory_acquisition_costs WHERE tenant_id = $1 AND receiving_id = $2`,
    [actor.tenantId, receivingId]);
  // The buyer's cost evidence must be the buyer's -- company-correct, never the seller's or the site's.
  for (const e of evidence) {
    if (e.operating_company_id !== buyer) refuse("INTERCOMPANY_COMPANY_MISMATCH", "PRECONDITION_FAILED", "the receipt's cost evidence is not the buyer company's");
  }
  const currencies = new Set(evidence.map((e) => String(e.currency)));
  if (currencies.size > 1) refuse("INTERCOMPANY_CURRENCY_MIXED", "PRECONDITION_FAILED", "one intercompany transaction carries one currency");
  const complete = lines.length > 0 && evidence.length === lines.length;
  const amount = evidence.reduce((n, e) => n + BigInt(e.extended_cost_minor), 0n);
  const currency = [...currencies][0] ?? String(r.po_currency ?? "USD");
  const id = `ict_${randomUUID()}`;
  const { rows } = await c.query(
    `INSERT INTO eos_finance.intercompany_transactions (id, tenant_id, buyer_operating_company_id, seller_operating_company_id, source_kind, source_record_id,
        purchase_order_id, currency, amount_minor, cost_evidence_complete, status, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,'REORDER_RECEIPT',$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (tenant_id, source_kind, source_record_id) DO NOTHING RETURNING *`,
    [id, actor.tenantId, buyer, seller, receivingId, r.source_purchase_order_id, currency, amount > 0n ? amount.toString() : null, complete,
      complete ? "AWAITING_OBLIGATION_TRIGGER" : "COST_EVIDENCE_MISSING", `ict:rcv:${receivingId}`, actor.principalId]);
  if (rows[0]) return correlationOf(rows[0]);
  const { rows: again } = await c.query(
    `SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id = $1 AND source_kind = 'REORDER_RECEIPT' AND source_record_id = $2`, [actor.tenantId, receivingId]);
  return correlationOf(again[0]);
}

/**
 * THE PAIRED INTERCOMPANY OBLIGATIONS of ONE correlation, inside the caller's transaction (idempotent):
 *   buyer  -> INTERCOMPANY_PAYABLE    toward the seller company's internal counterparty;
 *   seller -> INTERCOMPANY_RECEIVABLE toward the buyer company's internal counterparty;
 * each for the correlation's exact amount and currency, each owned by its own company, linked only by the correlation.
 *
 * HELD AT THE GOVERNED BOUNDARY (#202 §6): the Owner has not yet ruled which business event creates them, so NOTHING in the
 * runtime calls this. `trigger` must name that ruled event when it is wired.
 */
export async function establishIntercompanyObligationsOn(c: Queryable, actor: FinanceActor, input: { correlationId: string; trigger: string }) {
  if (typeof input.trigger !== "string" || input.trigger.trim() === "") refuse("INTERCOMPANY_TRIGGER_REQUIRED", "INVALID_INPUT", "the ruled obligation trigger is stated");
  const { rows } = await c.query(`SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, input.correlationId]);
  const t = rows[0] ?? refuse("INTERCOMPANY_TRANSACTION_NOT_FOUND", "NOT_FOUND", "no intercompany transaction with that id");
  if (t.status === "ESTABLISHED") {
    return Object.freeze({ outcome: "replayed" as const, correlation: correlationOf(t) });
  }
  if (t.status !== "AWAITING_OBLIGATION_TRIGGER") {
    refuse("INTERCOMPANY_NOT_ESTABLISHABLE", "PRECONDITION_FAILED", `an intercompany transaction in ${t.status} establishes no obligations`);
  }
  const amount = BigInt(t.amount_minor);
  const sellerAsCounterparty = await ensureInternalCounterparty(c, actor, t.seller_operating_company_id);
  const buyerAsCounterparty = await ensureInternalCounterparty(c, actor, t.buyer_operating_company_id);
  const effectiveAt = new Date(t.created_at);
  const payable = await openObligationOn(c, actor, {
    operatingCompanyId: t.buyer_operating_company_id, counterpartyId: sellerAsCounterparty.id, kind: "INTERCOMPANY_PAYABLE", currency: t.currency,
    sourceDomain: "INTERCOMPANY", sourceRecordId: t.id, originationAmountMinor: amount, basis: "INTERCOMPANY_PURCHASE",
    effectiveAt, idempotencyKey: `icp:${t.id}`, correlationId: t.id,
  });
  const receivable = await openObligationOn(c, actor, {
    operatingCompanyId: t.seller_operating_company_id, counterpartyId: buyerAsCounterparty.id, kind: "INTERCOMPANY_RECEIVABLE", currency: t.currency,
    sourceDomain: "INTERCOMPANY", sourceRecordId: t.id, originationAmountMinor: amount, basis: "INTERCOMPANY_SALE",
    effectiveAt, idempotencyKey: `icr:${t.id}`, correlationId: t.id,
  });
  const { rows: done } = await c.query(
    `UPDATE eos_finance.intercompany_transactions SET status = 'ESTABLISHED', buyer_obligation_id = $3, seller_obligation_id = $4,
        established_trigger = $5, established_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [actor.tenantId, t.id, payable.obligationId, receivable.obligationId, input.trigger.trim()]);
  return Object.freeze({ outcome: "recorded" as const, correlation: correlationOf(done[0]) });
}

/**
 * A corrected / cancelled internal receipt (#193) retires its correlation; an established pair is VOIDED on both sides with
 * reversing facts (history kept). The replacement receipt writes its own correlation through the ordinary receipt path.
 */
export async function retireIntercompanyCorrelationForReceiptOn(c: Queryable, actor: FinanceActor, input: { receivingId: string; correctionId: string; reason: string }) {
  const { rows } = await c.query(
    `SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id = $1 AND source_kind = 'REORDER_RECEIPT' AND source_record_id = $2 FOR UPDATE`,
    [actor.tenantId, input.receivingId]);
  const t = rows[0];
  if (!t || t.status === "SUPERSEDED_BY_RECEIPT_CORRECTION") return null;
  if (t.status === "ESTABLISHED") {
    for (const [obligationId, side] of [[t.buyer_obligation_id, "payable"], [t.seller_obligation_id, "receivable"]] as const) {
      await voidObligationOn(c, actor, { obligationId: String(obligationId), reason: input.reason, idempotencyKey: `ic:void:${side}:${input.correctionId}` });
    }
  }
  await c.query(`UPDATE eos_finance.intercompany_transactions SET status = 'SUPERSEDED_BY_RECEIPT_CORRECTION', superseded_reason = $3, updated_at = now()
                  WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, t.id, input.reason]);
  return Object.freeze({ correlationId: String(t.id), previousStatus: String(t.status) });
}

/** Read one correlation with both sides (for Analysis provenance: each side is its own company's record). */
export async function readIntercompanyTransaction(db: Queryable, tenantId: string, id: string) {
  const { rows } = await db.query(`SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
  return rows[0] ? correlationOf(rows[0]) : null;
}
