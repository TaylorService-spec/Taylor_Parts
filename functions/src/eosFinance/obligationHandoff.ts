// OBLIGATION-ANCHORED ACCOUNTING HANDOFFS (Finance Closure, DECISIONS #206; FBR-F3 + the vendor payable consequence).
//
// The Accounting Delivery Control Plane (#198) anchored a handoff on a READY billing package. A company-side INTERCOMPANY
// obligation, and a vendor PAYABLE, have no billing package: each is handed to ITS OWN company's accounting destination,
// anchored on the obligation itself -- one handoff per obligation, the same transitions, attempts, acknowledgement and provider
// reference per side. A Taylor purchase from Ventana therefore yields TWO handoffs (Taylor's INTERCOMPANY_PAYABLE to Taylor's
// destination, Ventana's INTERCOMPANY_RECEIVABLE to Ventana's), correlated by the intercompany transaction, never netted, never
// CONSOLIDATED. No provider is hard-coded; with no destination the handoff waits in PENDING_DESTINATION.
import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { FinanceFoundationError, resolveAccountingDestination, type FinanceActor, type FinanceFoundationCategory } from "./financeFoundation";
import { businessDateOn } from "../eosOps/operatingCompanyBusinessTime";

type Queryable = Pick<PoolClient, "query">;

export const OBLIGATION_PAYLOAD_CONTRACT = "eos.accounting.operational-obligation";
export const OBLIGATION_PAYLOAD_CONTRACT_VERSION = 1;
export type ObligationPayloadKind = "INTERCOMPANY_OBLIGATION" | "VENDOR_PAYABLE";

const refuse = (code: string, category: FinanceFoundationCategory, message: string): never => {
  throw new FinanceFoundationError(code, category, message);
};
const dateOnly = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Contract version 1 of the obligation payload. Money is integer minor units as decimal STRINGS. */
export interface ObligationPayloadV1 {
  readonly contract: { readonly name: typeof OBLIGATION_PAYLOAD_CONTRACT; readonly version: 1 };
  readonly semantics: "OPERATIONAL_OBLIGATION_NOT_AN_ACCOUNTING_DOCUMENT";
  readonly handoff: { readonly id: string; readonly idempotencyKey: string; readonly correlationId: string | null };
  readonly operatingCompany: { readonly id: string };
  readonly destination: { readonly id: string; readonly externalCompanyRef: string | null };
  readonly obligation: {
    readonly id: string; readonly kind: string; readonly amountMinor: string; readonly currency: string;
    readonly obligationDate: string | null; readonly dueOn: string | null; readonly sourceDomain: string; readonly sourceRecordId: string;
  };
  readonly counterparty: {
    readonly counterpartyId: string; readonly kind: string; readonly crmAccountId: string | null; readonly operatingCompanyId: string | null; readonly name: string | null;
  };
  /** Present for an intercompany side: the correlation and the OTHER side, which is its own company's record (never netted). */
  readonly intercompany?: {
    readonly correlationId: string; readonly buyerOperatingCompanyId: string; readonly sellerOperatingCompanyId: string;
    readonly side: "BUYER_PAYABLE" | "SELLER_RECEIVABLE"; readonly otherSideObligationId: string | null; readonly purchaseOrderId: string | null; readonly receivingId: string;
  };
  /** Present for a vendor payable: the receipt and purchase order it came from (received-not-invoiced). */
  readonly purchase?: { readonly receivingId: string; readonly purchaseOrderId: string | null; readonly supplierId: string | null };
}

/** One handoff for ONE obligation, toward its own company's destination (idempotent). */
export async function ensureObligationHandoffOn(c: Queryable, actor: FinanceActor, input: {
  obligationId: string; payloadKind: ObligationPayloadKind; correlationId: string | null;
}) {
  const { rows: ob } = await c.query(`SELECT o.*, b.originated_minor FROM eos_finance.obligations o
    JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id WHERE o.tenant_id = $1 AND o.id = $2`, [actor.tenantId, input.obligationId]);
  const o = ob[0] ?? refuse("OBLIGATION_NOT_FOUND", "NOT_FOUND", "no obligation with that id");
  const destination = await resolveAccountingDestination(c, actor.tenantId, o.operating_company_id);
  // The handoff's identity fingerprint: what is handed off (the payload adds the destination at delivery time).
  const fingerprint = createHash("sha256").update(JSON.stringify([o.id, o.kind, String(o.originated_minor), o.currency, o.operating_company_id, o.counterparty_id])).digest("hex");
  await c.query(
    `INSERT INTO eos_finance.accounting_handoffs (id, tenant_id, operating_company_id, billing_package_id, obligation_id, accounting_destination_id,
        payload_kind, payload_version, payload_fingerprint, status, readiness_exceptions, idempotency_key, correlation_id, created_by)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
    [`aho_${randomUUID()}`, actor.tenantId, o.operating_company_id, o.id, destination?.id ?? null, input.payloadKind, OBLIGATION_PAYLOAD_CONTRACT_VERSION,
      fingerprint, destination ? "READY_FOR_DELIVERY" : "PENDING_DESTINATION", destination ? [] : ["ACCOUNTING_DESTINATION_MISSING"],
      `handoff:obl:${o.id}`, input.correlationId, actor.principalId]);
  const { rows: h } = await c.query(`SELECT id, status, readiness_exceptions FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND idempotency_key = $2`,
    [actor.tenantId, `handoff:obl:${o.id}`]);
  return Object.freeze({ id: String(h[0].id), status: String(h[0].status), readinessExceptions: Object.freeze([...h[0].readiness_exceptions] as string[]) });
}

/**
 * The obligation's source was superseded: its handoff is SUPERSEDED (open delivery exceptions resolved). FAILS CLOSED once the
 * handoff is in delivery or ACKNOWLEDGED -- the provider may hold a document, and reversing that is a provider act.
 */
export async function supersedeObligationHandoffOn(c: Queryable, actor: FinanceActor, obligationId: string): Promise<void> {
  const { rows } = await c.query(`SELECT id, status FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND obligation_id = $2 AND billing_package_id IS NULL FOR UPDATE`,
    [actor.tenantId, obligationId]);
  const h = rows[0];
  if (!h) return;
  if (h.status === "DELIVERY_IN_PROGRESS" || h.status === "ACKNOWLEDGED") {
    refuse("ACCOUNTING_HANDOFF_DELIVERED", "CONFLICT", `the obligation's accounting handoff is ${h.status}; it cannot be superseded without a provider-side correction`);
  }
  await c.query(`UPDATE eos_finance.accounting_handoff_exceptions SET status = 'RESOLVED', resolved_by = $3, resolved_at = now(), resolution = 'SUPERSEDED_BY_CORRECTED_PACKAGE'
    WHERE tenant_id = $1 AND handoff_id = $2 AND status = 'OPEN'`, [actor.tenantId, h.id, actor.principalId]);
  if (h.status !== "SUPERSEDED") {
    await c.query(`UPDATE eos_finance.accounting_handoffs SET status = 'SUPERSEDED', updated_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, h.id]);
  }
}

/** The provider-neutral payload of an obligation-anchored handoff, fail closed (the obligation is the handoff's own, not VOID). */
export async function buildObligationPayload(db: Queryable, tenantId: string, h: Record<string, any>, d: Record<string, any>): Promise<ObligationPayloadV1> {
  const { rows: or } = await db.query(`SELECT o.*, b.originated_minor FROM eos_finance.obligations o
    JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id WHERE o.tenant_id = $1 AND o.id = $2`, [tenantId, h.obligation_id]);
  const o = or[0];
  const expected = h.payload_kind === "INTERCOMPANY_OBLIGATION" ? ["INTERCOMPANY_PAYABLE", "INTERCOMPANY_RECEIVABLE"] : ["PAYABLE"];
  if (!o || o.status === "VOID" || !expected.includes(o.kind) || o.operating_company_id !== h.operating_company_id) {
    refuse("PAYLOAD_OBLIGATION_MISMATCH", "PRECONDITION_FAILED", "the handoff's obligation is not exactly its own, live obligation -- nothing is delivered");
  }
  const { rows: cr } = await db.query(
    `SELECT c.id, c.kind, c.crm_account_id, c.operating_company_id, a.name FROM eos_finance.financial_counterparties c
       LEFT JOIN eos_crm.accounts a ON a.tenant_id = c.tenant_id AND a.id = c.crm_account_id WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, o.counterparty_id]);
  const cp = cr[0];
  // The obligation date is the ORIGINATING company's business date of its first origination fact (the governed business-time
  // resolver, never a hardcoded zone or a UTC calendar cut).
  const { rows: oi } = await db.query(`SELECT min(effective_at) AS at FROM eos_finance.financial_facts
    WHERE tenant_id = $1 AND obligation_id = $2 AND fact_class = 'OBLIGATION' AND reverses_fact_id IS NULL`, [tenantId, o.id]);
  const obligationDate = oi[0]?.at ? await businessDateOn(db, tenantId, String(o.operating_company_id), oi[0].at) : null;
  const base = {
    contract: { name: OBLIGATION_PAYLOAD_CONTRACT as typeof OBLIGATION_PAYLOAD_CONTRACT, version: 1 as const },
    semantics: "OPERATIONAL_OBLIGATION_NOT_AN_ACCOUNTING_DOCUMENT" as const,
    handoff: { id: String(h.id), idempotencyKey: String(h.idempotency_key), correlationId: h.correlation_id ?? null },
    operatingCompany: { id: String(h.operating_company_id) },
    destination: { id: String(d.id), externalCompanyRef: d.external_company_ref ?? null },
    obligation: { id: String(o.id), kind: String(o.kind), amountMinor: BigInt(o.originated_minor).toString(), currency: String(o.currency),
      obligationDate, dueOn: dateOnly(o.due_on), sourceDomain: String(o.source_domain), sourceRecordId: String(o.source_record_id) },
    counterparty: { counterpartyId: String(cp.id), kind: String(cp.kind), crmAccountId: cp.crm_account_id ?? null, operatingCompanyId: cp.operating_company_id ?? null, name: cp.name ?? null },
  };
  if (h.payload_kind === "INTERCOMPANY_OBLIGATION") {
    const { rows: tr } = await db.query(`SELECT * FROM eos_finance.intercompany_transactions WHERE tenant_id = $1 AND id = $2`, [tenantId, o.source_record_id]);
    const t = tr[0] ?? refuse("PAYLOAD_OBLIGATION_MISMATCH", "PRECONDITION_FAILED", "the intercompany correlation is missing");
    const buyer = o.kind === "INTERCOMPANY_PAYABLE";
    return Object.freeze({ ...base, intercompany: { correlationId: String(t.id), buyerOperatingCompanyId: String(t.buyer_operating_company_id),
      sellerOperatingCompanyId: String(t.seller_operating_company_id), side: buyer ? "BUYER_PAYABLE" as const : "SELLER_RECEIVABLE" as const,
      otherSideObligationId: (buyer ? t.seller_obligation_id : t.buyer_obligation_id) ?? null, purchaseOrderId: t.purchase_order_id ?? null, receivingId: String(t.source_record_id) } });
  }
  const { rows: rr } = await db.query(`SELECT r.id, r.source_purchase_order_id, po.supplier_id FROM eos_ops.receiving_orders r
    LEFT JOIN eos_ops.purchase_orders po ON po.tenant_id = r.tenant_id AND po.id = r.source_purchase_order_id WHERE r.tenant_id = $1 AND r.id = $2`, [tenantId, o.source_record_id]);
  return Object.freeze({ ...base, purchase: { receivingId: String(o.source_record_id), purchaseOrderId: rr[0]?.source_purchase_order_id ?? null, supplierId: rr[0]?.supplier_id ?? null } });
}
