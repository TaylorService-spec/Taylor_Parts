// THE FINANCE OPERATIONS TABLE (Finance Closure, DECISIONS #206) -- served on /operations/finance by the Operations transport,
// resolved exactly like the Work Order and Equipment routes (verified token -> Principal -> tenant -> capabilities).
//
// AUTHORITY, separated as the Controller requires (and nothing here grants anything):
//   view        finance.payment.read                (the existing Finance read: obligations, settlements, the workspace)
//   record      finance.settlement.record
//   apply       finance.settlement.apply
//   correct     finance.settlement.correct          (reverse an application, void a settlement)
//   reconcile   finance.reconciliation.record
//   cost        inventory.receipt.correct + WAREHOUSE scope (late cost evidence -- costEvidenceSupplyCommand.ts)
//   relief      inventory.transfer.dispatch + WAREHOUSE scope (intercompany inventory relief -- intercompanyInventoryRelief.ts)
// Configuration stays finance.configuration.manage on /admin/policy. A Sales or Technician principal holds none of the
// transaction keys, so it cannot manufacture a settlement fact.
//
// THE WORKSPACE is exception-first and company-scoped: Taylor, Ventana, or the CONSOLIDATED reporting PROJECTION (a read
// across companies -- it owns nothing and is never written). Overdue is DERIVED from each obligation's governed due date and
// its company's business date; missing data is never zero.
import type { Pool } from "pg";
import { FinanceFoundationError } from "./financeFoundation";
import {
  applyFinancialSettlement, readSettlement, reconcileFinancialSettlement, recordFinancialSettlement, reverseSettlementApplication, voidFinancialSettlement,
} from "./settlement";
import { supplyReceiptCostEvidence } from "../eosOps/costEvidenceSupplyCommand";
import { relieveIntercompanySaleInventory } from "../eosOps/intercompanyInventoryRelief";
import type { WorkOrderCaller, WorkOrderOperationDeps } from "../eosOps/workOrderOperationTypes";

export const FINANCE_ROUTE = "/operations/finance";
export const FINANCE_VIEW_CAPABILITY = "finance.payment.read";
export const SETTLEMENT_RECORD_CAPABILITY = "finance.settlement.record";
export const SETTLEMENT_APPLY_CAPABILITY = "finance.settlement.apply";
export const SETTLEMENT_CORRECT_CAPABILITY = "finance.settlement.correct";
export const RECONCILIATION_RECORD_CAPABILITY = "finance.reconciliation.record";

export class FinanceOperationError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN", message: string) {
    super(message);
    this.name = "FinanceOperationError";
  }
}
const refuse = (code: string, category: FinanceOperationError["category"], message: string): never => {
  throw new FinanceOperationError(code, category, message);
};
const requireCapability = (caller: WorkOrderCaller, key: string): void => {
  if (!caller.actor.capabilities.has(key)) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${key}`);
};
const actorOf = (caller: WorkOrderCaller) => ({ tenantId: caller.actor.tenantId, principalId: caller.actor.principalId });

/** The company selector: one operating company, or the CONSOLIDATED projection (read-only). */
async function companyScope(pool: Pool, tenantId: string, raw: unknown): Promise<{ consolidated: boolean; companies: string[] }> {
  const { rows } = await pool.query(`SELECT operating_company_id FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY 1`, [tenantId]);
  const all = rows.map((r) => String(r.operating_company_id));
  if (raw === undefined || raw === null || raw === "consolidated" || raw === "CONSOLIDATED") return { consolidated: true, companies: all };
  if (typeof raw !== "string" || !all.includes(raw)) refuse("OPERATING_COMPANY_UNKNOWN", "INVALID_INPUT", "operatingCompanyId is an active operating company, or consolidated");
  return { consolidated: false, companies: [raw as string] };
}

const OPEN_KINDS = ["RECEIVABLE", "FUNDING_RECEIVABLE", "PAYABLE", "INTERCOMPANY_RECEIVABLE", "INTERCOMPANY_PAYABLE"];
const dateText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function obligationRows(pool: Pool, tenantId: string, companies: string[], where = "TRUE", params: unknown[] = [], limit = 200) {
  const { rows } = await pool.query(
    `SELECT o.id, o.operating_company_id, o.kind, o.currency, o.status, o.source_domain, o.source_record_id, o.due_on, o.created_at,
            b.originated_minor, b.settled_minor, b.outstanding_minor, cp.kind AS counterparty_kind, cp.crm_account_id, cp.operating_company_id AS counterparty_company,
            a.name AS counterparty_name,
            (o.due_on IS NOT NULL AND o.status IN ('OPEN','PARTIAL') AND o.due_on < eos_policy.operating_company_business_date(o.tenant_id, o.operating_company_id, now())) AS overdue
       FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
       JOIN eos_finance.financial_counterparties cp ON cp.tenant_id = o.tenant_id AND cp.id = o.counterparty_id
       LEFT JOIN eos_crm.accounts a ON a.tenant_id = cp.tenant_id AND a.id = cp.crm_account_id
      WHERE o.tenant_id = $1 AND o.operating_company_id = ANY($2) AND ${where}
      ORDER BY o.due_on NULLS LAST, o.created_at DESC, o.id LIMIT ${Number(limit)}`, [tenantId, companies, ...params]);
  return rows.map((r) => Object.freeze({
    id: String(r.id), operatingCompanyId: String(r.operating_company_id), kind: String(r.kind), currency: String(r.currency), status: String(r.status),
    sourceDomain: String(r.source_domain), sourceRecordId: String(r.source_record_id), dueOn: dateText(r.due_on), overdue: r.overdue === true,
    originatedMinor: String(r.originated_minor), settledMinor: String(r.settled_minor), outstandingMinor: String(r.outstanding_minor),
    counterparty: r.counterparty_kind === "INTERNAL_OPERATING_COMPANY" ? { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: r.counterparty_company }
      : { kind: "EXTERNAL_ORGANIZATION", crmAccountId: r.crm_account_id, name: r.counterparty_name ?? null },
  }));
}

type Op = (deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;

async function readFinanceWorkspace(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireCapability(caller, FINANCE_VIEW_CAPABILITY);
  const scope = await companyScope(deps.pool, caller.actor.tenantId, input.operatingCompanyId);
  const t = caller.actor.tenantId;
  const open = await obligationRows(deps.pool, t, scope.companies, `o.status IN ('OPEN','PARTIAL')`, [], 500);
  const summarize = (kind: string) => {
    const items = open.filter((o) => o.kind === kind);
    const byCurrency: Record<string, string> = {};
    for (const o of items) byCurrency[o.currency] = (BigInt(byCurrency[o.currency] ?? "0") + BigInt(o.outstandingMinor)).toString();
    return Object.freeze({ count: items.length, outstandingByCurrency: byCurrency, items: items.slice(0, 25) });
  };
  const { rows: unapplied } = await deps.pool.query(
    `SELECT s.id, s.operating_company_id, s.kind, s.currency, s.amount_minor, b.unapplied_minor, s.business_date, s.source_reference
       FROM eos_finance.settlements s JOIN eos_finance.settlement_balances b ON b.tenant_id = s.tenant_id AND b.settlement_id = s.id
      WHERE s.tenant_id = $1 AND s.operating_company_id = ANY($2) AND s.status = 'RECORDED' AND b.unapplied_minor > 0 ORDER BY s.business_date, s.id LIMIT 100`,
    [t, scope.companies]);
  const { rows: handoffs } = await deps.pool.query(
    `SELECT h.id, h.operating_company_id, h.payload_kind, h.status, h.readiness_exceptions, h.failure_reason, h.obligation_id, h.billing_package_id,
            (SELECT count(*)::int FROM eos_finance.accounting_handoff_exceptions x WHERE x.tenant_id = h.tenant_id AND x.handoff_id = h.id AND x.status = 'OPEN') AS open_exceptions
       FROM eos_finance.accounting_handoffs h
      WHERE h.tenant_id = $1 AND h.operating_company_id = ANY($2) AND h.status IN ('PENDING_DESTINATION', 'READY_FOR_DELIVERY', 'REJECTED', 'FAILED_RETRYABLE', 'FAILED_FINAL')
      ORDER BY h.created_at, h.id LIMIT 200`, [t, scope.companies]);
  const { rows: recon } = await deps.pool.query(
    `SELECT s.id, s.operating_company_id, s.kind, s.amount_minor, s.currency, latest.outcome, latest.external_amount_minor, latest.reason
       FROM eos_finance.settlements s
       LEFT JOIN LATERAL (SELECT outcome, external_amount_minor, reason FROM eos_finance.settlement_reconciliations r
                           WHERE r.tenant_id = s.tenant_id AND r.settlement_id = s.id ORDER BY recorded_at DESC, id DESC LIMIT 1) latest ON TRUE
      WHERE s.tenant_id = $1 AND s.operating_company_id = ANY($2) AND s.status = 'RECORDED' AND (latest.outcome IS NULL OR latest.outcome = 'MISMATCH')
      ORDER BY s.business_date, s.id LIMIT 200`, [t, scope.companies]);
  const { rows: missing } = await deps.pool.query(
    `SELECT x.id, x.operating_company_id, x.receiving_id, x.receiving_line_id, x.purchase_order_id, x.part_id, x.received_quantity, x.detected_at
       FROM eos_finance.cost_evidence_exceptions x
      WHERE x.tenant_id = $1 AND x.operating_company_id = ANY($2) AND NOT EXISTS (SELECT 1 FROM eos_finance.cost_evidence_exception_resolutions z WHERE z.exception_id = x.id)
      ORDER BY x.detected_at, x.id LIMIT 200`, [t, scope.companies]);
  const { rows: relief } = await deps.pool.query(
    `SELECT t.id, t.seller_operating_company_id, t.buyer_operating_company_id, l.line_id, l.part_id, l.received_quantity
       FROM eos_finance.intercompany_transactions t JOIN eos_ops.receiving_order_lines l ON l.tenant_id = t.tenant_id AND l.receiving_order_id = t.source_record_id
      WHERE t.tenant_id = $1 AND t.seller_operating_company_id = ANY($2) AND t.status IN ('ESTABLISHED', 'AWAITING_OBLIGATION_TRIGGER', 'COST_EVIDENCE_MISSING')
        AND NOT EXISTS (SELECT 1 FROM eos_ops.intercompany_inventory_reliefs r WHERE r.tenant_id = t.tenant_id AND r.intercompany_transaction_id = t.id AND r.receiving_line_id = l.line_id)
      ORDER BY t.created_at, t.id LIMIT 200`, [t, scope.companies]);
  const exceptionCounts = {
    overdueObligations: open.filter((o) => o.overdue).length,
    partiallyPaidObligations: open.filter((o) => o.status === "PARTIAL").length,
    unappliedSettlements: unapplied.length,
    accountingHandoffExceptions: handoffs.filter((h) => h.status !== "READY_FOR_DELIVERY" || Number(h.open_exceptions) > 0).length,
    reconciliationMismatches: recon.filter((r) => r.outcome === "MISMATCH").length,
    unreconciledSettlements: recon.filter((r) => r.outcome === null).length,
    missingCostEvidence: missing.length,
    intercompanyReliefPending: relief.length,
  };
  return Object.freeze({
    scope: { operatingCompanyId: scope.consolidated ? "consolidated" : scope.companies[0], projection: scope.consolidated ? "CONSOLIDATED_REPORTING_PROJECTION" : "OPERATING_COMPANY",
      companies: scope.companies },
    exceptionCounts,
    receivables: summarize("RECEIVABLE"), fundingReceivables: summarize("FUNDING_RECEIVABLE"), payables: summarize("PAYABLE"),
    intercompanyReceivables: summarize("INTERCOMPANY_RECEIVABLE"), intercompanyPayables: summarize("INTERCOMPANY_PAYABLE"),
    overdue: open.filter((o) => o.overdue).slice(0, 50),
    partiallyPaid: open.filter((o) => o.status === "PARTIAL").slice(0, 50),
    unappliedSettlements: unapplied.map((s) => ({ id: String(s.id), operatingCompanyId: String(s.operating_company_id), kind: String(s.kind), currency: String(s.currency),
      amountMinor: String(s.amount_minor), unappliedMinor: String(s.unapplied_minor), businessDate: dateText(s.business_date), sourceReference: String(s.source_reference) })),
    accountingHandoffs: handoffs.map((h) => ({ id: String(h.id), operatingCompanyId: String(h.operating_company_id), payloadKind: String(h.payload_kind), status: String(h.status),
      readinessExceptions: [...(h.readiness_exceptions ?? [])], failureReason: h.failure_reason ?? null, obligationId: String(h.obligation_id),
      billingPackageId: h.billing_package_id ?? null, openExceptions: Number(h.open_exceptions) })),
    reconciliation: recon.map((r) => ({ settlementId: String(r.id), operatingCompanyId: String(r.operating_company_id), kind: String(r.kind), amountMinor: String(r.amount_minor),
      currency: String(r.currency), status: r.outcome ?? "UNRECONCILED", externalAmountMinor: r.external_amount_minor === null ? null : String(r.external_amount_minor), reason: r.reason ?? null })),
    missingCostEvidence: missing.map((x) => ({ exceptionId: String(x.id), operatingCompanyId: String(x.operating_company_id), receivingId: String(x.receiving_id),
      receivingLineId: String(x.receiving_line_id), purchaseOrderId: String(x.purchase_order_id), partId: String(x.part_id), receivedQuantity: Number(x.received_quantity) })),
    intercompanyReliefPending: relief.map((r) => ({ intercompanyTransactionId: String(r.id), sellerOperatingCompanyId: String(r.seller_operating_company_id),
      buyerOperatingCompanyId: String(r.buyer_operating_company_id), receivingLineId: String(r.line_id), partId: String(r.part_id), quantity: Number(r.received_quantity) })),
  });
}

async function listObligations(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireCapability(caller, FINANCE_VIEW_CAPABILITY);
  const scope = await companyScope(deps.pool, caller.actor.tenantId, input.operatingCompanyId);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.kind !== undefined) {
    if (!OPEN_KINDS.includes(String(input.kind))) refuse("KIND_INVALID", "INVALID_INPUT", `kind is one of ${OPEN_KINDS.join(", ")}`);
    params.push(input.kind); clauses.push(`o.kind = $${params.length + 2}`);
  }
  if (input.status !== undefined) {
    if (!["OPEN", "PARTIAL", "SETTLED", "VOID"].includes(String(input.status))) refuse("STATUS_INVALID", "INVALID_INPUT", "status is OPEN, PARTIAL, SETTLED or VOID");
    params.push(input.status); clauses.push(`o.status = $${params.length + 2}`);
  }
  return Object.freeze({ scope: scope.consolidated ? "consolidated" : scope.companies[0],
    items: await obligationRows(deps.pool, caller.actor.tenantId, scope.companies, clauses.length ? clauses.join(" AND ") : "TRUE", params, 200) });
}

async function readObligation(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireCapability(caller, FINANCE_VIEW_CAPABILITY);
  if (typeof input.obligationId !== "string" || input.obligationId.trim() === "") refuse("OBLIGATION_REQUIRED", "INVALID_INPUT", "obligationId is required");
  const scope = await companyScope(deps.pool, caller.actor.tenantId, undefined);
  const [o] = await obligationRows(deps.pool, caller.actor.tenantId, scope.companies, `o.id = $3`, [input.obligationId], 1);
  if (!o) return refuse("OBLIGATION_NOT_FOUND", "NOT_FOUND", "no obligation with that id");
  const t = caller.actor.tenantId;
  const { rows: facts } = await deps.pool.query(`SELECT id, fact_class, fact_type, amount_minor, effective_at, source_domain, source_record_id, reverses_fact_id, reason
    FROM eos_finance.financial_facts WHERE tenant_id = $1 AND obligation_id = $2 ORDER BY created_at, id`, [t, input.obligationId]);
  const { rows: apps } = await deps.pool.query(`SELECT a.id, a.settlement_id, a.amount_minor, a.status, s.kind, s.source_reference, s.business_date
    FROM eos_finance.settlement_applications a JOIN eos_finance.settlements s ON s.tenant_id = a.tenant_id AND s.id = a.settlement_id
    WHERE a.tenant_id = $1 AND a.obligation_id = $2 ORDER BY a.applied_at, a.id`, [t, input.obligationId]);
  const { rows: hs } = await deps.pool.query(`SELECT id, status, payload_kind, provider_document_reference FROM eos_finance.accounting_handoffs
    WHERE tenant_id = $1 AND obligation_id = $2 ORDER BY created_at`, [t, input.obligationId]);
  return Object.freeze({ ...o,
    facts: facts.map((f) => ({ id: String(f.id), factClass: String(f.fact_class), factType: String(f.fact_type), amountMinor: String(f.amount_minor),
      effectiveAt: new Date(f.effective_at).toISOString(), sourceDomain: String(f.source_domain), sourceRecordId: String(f.source_record_id), reversesFactId: f.reverses_fact_id ?? null, reason: f.reason ?? null })),
    applications: apps.map((a) => ({ id: String(a.id), settlementId: String(a.settlement_id), amountMinor: String(a.amount_minor), status: String(a.status),
      settlementKind: String(a.kind), sourceReference: String(a.source_reference), businessDate: dateText(a.business_date) })),
    accountingHandoffs: hs.map((h) => ({ id: String(h.id), status: String(h.status), payloadKind: String(h.payload_kind), providerDocumentReference: h.provider_document_reference ?? null })),
  });
}

async function listSettlements(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireCapability(caller, FINANCE_VIEW_CAPABILITY);
  const scope = await companyScope(deps.pool, caller.actor.tenantId, input.operatingCompanyId);
  const { rows } = await deps.pool.query(
    `SELECT s.id FROM eos_finance.settlements s WHERE s.tenant_id = $1 AND s.operating_company_id = ANY($2) ORDER BY s.business_date DESC, s.recorded_at DESC, s.id LIMIT 100`,
    [caller.actor.tenantId, scope.companies]);
  return Object.freeze({ scope: scope.consolidated ? "consolidated" : scope.companies[0],
    items: await Promise.all(rows.map((r) => readSettlement(deps.pool, caller.actor.tenantId, String(r.id)))) });
}

const consolidatedRefused = (input: Record<string, unknown>) => {
  if (typeof input.operatingCompanyId === "string" && input.operatingCompanyId.toLowerCase() === "consolidated") {
    refuse("CONSOLIDATED_NOT_A_COMPANY", "INVALID_INPUT", "CONSOLIDATED is a reporting projection; it owns no settlement");
  }
};

export const EOS_FINANCE_OPERATIONS: Readonly<Record<string, Op>> = Object.freeze({
  readFinanceWorkspace,
  listObligations,
  readObligation,
  listSettlements,
  readSettlement: async (deps, caller, input) => {
    requireCapability(caller, FINANCE_VIEW_CAPABILITY);
    return readSettlement(deps.pool, caller.actor.tenantId, input.settlementId);
  },
  recordSettlement: async (deps, caller, input) => {
    requireCapability(caller, SETTLEMENT_RECORD_CAPABILITY);
    consolidatedRefused(input);
    return recordFinancialSettlement(deps.pool, actorOf(caller), input as never);
  },
  applySettlement: async (deps, caller, input) => {
    requireCapability(caller, SETTLEMENT_APPLY_CAPABILITY);
    return applyFinancialSettlement(deps.pool, actorOf(caller), input as never);
  },
  reverseSettlementApplication: async (deps, caller, input) => {
    requireCapability(caller, SETTLEMENT_CORRECT_CAPABILITY);
    return reverseSettlementApplication(deps.pool, actorOf(caller), input as never);
  },
  voidSettlement: async (deps, caller, input) => {
    requireCapability(caller, SETTLEMENT_CORRECT_CAPABILITY);
    return voidFinancialSettlement(deps.pool, actorOf(caller), input as never);
  },
  reconcileSettlement: async (deps, caller, input) => {
    requireCapability(caller, RECONCILIATION_RECORD_CAPABILITY);
    return reconcileFinancialSettlement(deps.pool, actorOf(caller), input as never);
  },
  supplyReceiptCostEvidence: async (deps, caller, input) => supplyReceiptCostEvidence({ pool: deps.pool }, caller.actor, input),
  relieveIntercompanySaleInventory: async (deps, caller, input) => relieveIntercompanySaleInventory({ pool: deps.pool }, caller.actor, input),
});
export const FINANCE_OPERATIONS = Object.freeze(Object.keys(EOS_FINANCE_OPERATIONS));
export const isFinanceOperation = (name: unknown): name is string => typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_FINANCE_OPERATIONS, name);
export { FinanceFoundationError };
