// THE FINANCE OPERATIONS TABLE (Finance Closure, DECISIONS #206) -- served on /operations/finance by the Operations transport,
// resolved exactly like the Work Order and Equipment routes (verified token -> Principal -> tenant -> capabilities).
//
// AUTHORITY, separated as the Controller requires (and nothing here grants anything):
//   view        finance.payment.read                (the existing Finance read: obligations, settlements, the workspace)
//   record      finance.settlement.record
//   apply       finance.settlement.apply
//   correct     finance.settlement.correct          (reverse an application, void a settlement)
//   reconcile   finance.reconciliation.record
//   invoice     finance.invoice.issue               (F-1a: issueInvoice -- the invoice document over a READY package's receivable; invoiceIssue.ts);
//               FU-2: prepareBillingPackage -- the SAME key (preparing the package is the first half of issuing): the rebill trigger after an approved void (billingPackage.ts)
//   correction  F-1b: requestInvoiceCorrection -- finance.adjustment.record (credit, write-off, debit, void) or finance.refund.record (refund); decideInvoiceCorrection --
//               finance.adjustment.approve / finance.refund.approve / finance.invoice.void.approve by kind (WITHDRAW: the requester, with the request key). A SEPARATE
//               Employee approves, at a $0 threshold (invoiceCorrection.ts). Reads: listInvoiceCorrections, readInvoiceCorrection (finance.payment.read, FULL reach).
//   cost       inventory.receipt.correct + WAREHOUSE scope (late cost evidence -- costEvidenceSupplyCommand.ts)
//   relief      inventory.transfer.dispatch + WAREHOUSE scope (intercompany inventory relief -- intercompanyInventoryRelief.ts)
//   balance     finance.accountBalance.read         (A6: readAccountBalanceSummary -- five numbers per company and currency for ONE customer; no ids, no rows)
//   policy      finance.policy.read / .prepare / .approve / .activate -- the Financial Policy lifecycle (financialPolicy.ts, #232),
//               plus readMyFinancialPolicyAuthority (finance.policy.read): the caller's own reach, for the Administration screen
// Configuration stays finance.configuration.manage on /admin/policy. A Sales or Technician principal holds none of the
// transaction keys, so it cannot manufacture a settlement fact.
//
// THE WORKSPACE is exception-first and company-scoped: Taylor, Ventana, or the CONSOLIDATED reporting PROJECTION (a read
// across companies -- it owns nothing and is never written). Overdue is DERIVED from each obligation's governed due date and
// its company's business date; missing data is never zero.
//
// COMPANY ASSIGNMENT IS MANDATORY (Owner ruling 2026-10-13; Financials Workspace P0 correction 2026-10-14). Every read and
// settlement command is decided against the caller's EXPLICIT operatingCompany-scoped assignments (financeCompanyAccess.ts):
// the key AND a company assignment; a global Role or Administrator standing alone reaches no company; CONSOLIDATED only when
// every active company is reached; a record or company outside the caller's companies answers like a missing / unknown one.
//
// INNER REACH (Firebase exit B1, DECISIONS #B1; financeVisibility.ts): INSIDE a reached company a principal that holds only
// finance.visibility.self / .team (INACTIVE, mirrored from Firebase -- D-249-0) or only .businessUnit reads NOTHING, and once
// self / team are activated reads only the RECEIVABLES credited to it (or its team) through their source Sales Order. The
// restriction is applied in every projection of this file -- workspace, lists, details, totals, the overview aggregate -- and
// nowhere else decides it. A restricted reader sees funding / payable / intercompany sections as WITHHELD (named, never zero),
// sees a settlement only when every application ever recorded on it is to a visible receivable, and is refused every command.
import type { Pool } from "pg";
import { FinanceFoundationError, readObligationBalance } from "./financeFoundation";
import {
  applyFinancialSettlement, readSettlement, reconcileFinancialSettlement, recordFinancialSettlement, reverseSettlementApplication, voidFinancialSettlement,
} from "./settlement";
import { INVOICE_ISSUE_CAPABILITY, issueBlocker, issueFinancialInvoice } from "./invoiceIssue";
import { prepareBillingPackageCommand } from "./billingPackage";
import {
  CORRECTION_APPROVAL_CAPABILITIES, CORRECTION_APPROVE_CAPABILITY, CORRECTION_REQUEST_CAPABILITIES, CORRECTION_REQUEST_CAPABILITY, INVOICE_CORRECTION_KINDS,
  correctionScope, decideInvoiceCorrection, invoiceCompany, listInvoiceCorrections, readInvoiceCorrectionOn, requestInvoiceCorrection, type InvoiceCorrectionKind,
} from "./invoiceCorrection";
import { supplyReceiptCostEvidence } from "../eosOps/costEvidenceSupplyCommand";
import { relieveIntercompanySaleInventory } from "../eosOps/intercompanyInventoryRelief";
import { defineFieldGroups, projectForCaller } from "../eosOps/governedFieldGroups";
import type { WorkOrderCaller, WorkOrderOperationDeps } from "../eosOps/workOrderOperationTypes";
import { EOS_FINANCIAL_POLICY_OPERATIONS } from "./financialPolicy";
import { decideFinanceScope, financeCompanyReach, financeReachesCompany } from "./financeCompanyAccess";
import {
  financeVisibilityModeAt, obligationVisibilityClause, resolveFinanceVisibility, RESTRICTED_WITHHELD_REASON, settlementVisibilityClause,
  type FinanceVisibility,
} from "./financeVisibility";
import { operatingCompanyDisplayName } from "../ownership/operatingCompanyAuthority";
import { resolveInventoryCompanyAuthority } from "../eosOps/inventoryCompanyAuthority";

export const FINANCE_ROUTE = "/operations/finance";
export const FINANCE_VIEW_CAPABILITY = "finance.payment.read";
export const SETTLEMENT_RECORD_CAPABILITY = "finance.settlement.record";
export const SETTLEMENT_APPLY_CAPABILITY = "finance.settlement.apply";
export const SETTLEMENT_CORRECT_CAPABILITY = "finance.settlement.correct";
export const RECONCILIATION_RECORD_CAPABILITY = "finance.reconciliation.record";
/** F-1a: issue an invoice against a READY billing package's receivable (invoiceIssue.ts). The Firebase key, already registered and granted (migration 1761609600000). */
export { INVOICE_ISSUE_CAPABILITY };
/**
 * F-1b: request / decide a credit, write-off, debit, refund or void of an ISSUED invoice (invoiceCorrection.ts). The request keys are the existing Firebase keys; the
 * three APPROVAL keys are new (migration 1764712000000) and are held by a different Employee than the requester.
 */
export { CORRECTION_APPROVE_CAPABILITY, CORRECTION_REQUEST_CAPABILITY };
/**
 * A6: the customer-balance SUMMARY key (migration 1764680000000, PostgreSQL-native). It opens ONE operation, readAccountBalanceSummary, and nothing else: no
 * obligation, settlement, handoff or package row, no payable / funding / intercompany section, and no write path. The full receivable detail stays on
 * FINANCE_VIEW_CAPABILITY.
 */
export const ACCOUNT_BALANCE_READ_CAPABILITY = "finance.accountBalance.read";
/** The existing cost-read authority (inventory.catalog.cost.read, DECISIONS #230; excluded from Protected Administrator standing). */
export const COST_READ_CAPABILITY = "inventory.catalog.cost.read";

/**
 * THE INTERCOMPANY-RELIEF ROW of the workspace (Owner ruling MUST-2), through the generic governed field-group evaluator
 * (eosOps/governedFieldGroups.ts) -- the same projectForCaller the Part Supplier Terms COMMERCIAL group uses:
 *   RELIEF_REFERENCE  the transaction, the two companies and the receiving line   governed by the workspace's own gate
 *                                                                                 (finance.payment.read, checked first)
 *   RELIEF_INVENTORY  the part and the quantity awaiting relief                   inventory.catalog.cost.read
 * Without the cost read, partId and quantity are ABSENT (never null -- a null would itself be a value) and the row's
 * `withheld` names the group, its fields and the key it requires; never a value. The capability Set is the resolved one,
 * so Protected Administrator standing never supplies the cost read (PROTECTED_ADMINISTRATOR_EXCLUSIONS, #230). The
 * projection is read-only: nothing writes through it, so create / edit restate the read requirement.
 * exceptionCounts.intercompanyReliefPending counts rows and is the same for every caller.
 */
export const INTERCOMPANY_RELIEF_PENDING_FIELD_GROUPS = defineFieldGroups({
  objectKey: "payment",
  record: { read: FINANCE_VIEW_CAPABILITY },
  groups: [
    { key: "RELIEF_REFERENCE", label: "Intercompany relief reference", sensitive: false, read: null, create: null, edit: null,
      fields: ["intercompanyTransactionId", "sellerOperatingCompanyId", "buyerOperatingCompanyId", "receivingLineId"] },
    { key: "RELIEF_INVENTORY", label: "Part and quantity awaiting relief", sensitive: true,
      read: COST_READ_CAPABILITY, create: COST_READ_CAPABILITY, edit: COST_READ_CAPABILITY, fields: ["partId", "quantity"] },
  ],
});

/**
 * THE MISSING-COST-EVIDENCE ROW of the workspace, the same rule as the relief row (#2084 path B). Its part and quantity
 * are a unit-cost INPUT: once the evidence arrives, the vendor payable (or the intercompany obligation) opens on the SAME
 * receipt at the at-cost total, so (part, quantity) seen here plus that later amount reconstructs the unit cost of a
 * single-line receipt. Without inventory.catalog.cost.read they are ABSENT and `withheld` names the group; the receipt,
 * line, purchase order and company stay (the exception must remain actionable and countable).
 */
export const MISSING_COST_EVIDENCE_FIELD_GROUPS = defineFieldGroups({
  objectKey: "payment",
  record: { read: FINANCE_VIEW_CAPABILITY },
  groups: [
    { key: "MISSING_COST_REFERENCE", label: "Missing cost evidence reference", sensitive: false, read: null, create: null, edit: null,
      fields: ["exceptionId", "operatingCompanyId", "receivingId", "receivingLineId", "purchaseOrderId"] },
    { key: "MISSING_COST_INVENTORY", label: "Part and quantity missing cost evidence", sensitive: true,
      read: COST_READ_CAPABILITY, create: COST_READ_CAPABILITY, edit: COST_READ_CAPABILITY, fields: ["partId", "receivedQuantity"] },
  ],
});

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

async function activeCompanies(pool: Pool, tenantId: string): Promise<string[]> {
  const { rows } = await pool.query(`SELECT operating_company_id FROM eos_policy.tenant_operating_companies WHERE tenant_id = $1 AND status = 'ACTIVE' ORDER BY 1`, [tenantId]);
  return rows.map((r) => String(r.operating_company_id));
}
const reachActor = (caller: WorkOrderCaller) => ({ capabilities: caller.actor.capabilities, scopedHeld: caller.operational?.scopedHeld,
  conditionallyHeld: caller.operational?.conditionallyHeld, inertScoped: caller.operational?.inertScoped });
/**
 * The Finance view gate: finance.payment.read held FLAT or through a company-scoped assignment (a scoped holding IS the key
 * and the company assignment at once). Held nowhere: CAPABILITY_REQUIRED. Where it applies is decided per company after.
 */
const requireView = (caller: WorkOrderCaller): void => {
  if (financeCompanyReach(reachActor(caller), FINANCE_VIEW_CAPABILITY) === null) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${FINANCE_VIEW_CAPABILITY}`);
};
const outsideScope = (key: string): never => refuse("OUTSIDE_OPERATING_COMPANY_SCOPE", "FORBIDDEN",
  `${key} is not held for the requested operating company (the consolidated view needs every company)`);

/**
 * The company selector: one operating company, or the CONSOLIDATED projection (read-only) -- decided against the caller's
 * COMPANY ASSIGNMENTS (financeCompanyAccess.ts): capability AND an explicit operatingCompany-scoped assignment; consolidated
 * only when every active company is reached. Out of scope == unknown == inactive: the same refusal.
 */
async function companyScope(pool: Pool, caller: WorkOrderCaller, key: string, raw: unknown): Promise<{ consolidated: boolean; companies: string[] }> {
  const d = decideFinanceScope(reachActor(caller), key, await activeCompanies(pool, caller.actor.tenantId), raw);
  if (!d.ok) return d.code === "CAPABILITY_REQUIRED" ? refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${key}`) : outsideScope(key);
  return { consolidated: d.consolidated, companies: [...d.companies] };
}
/** The active companies `key` reaches for the caller (never consolidated): the reach of a read or command that names a record. */
async function reachedCompanies(pool: Pool, caller: WorkOrderCaller, key: string): Promise<string[]> {
  const reach = financeCompanyReach(reachActor(caller), key) ?? refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${key}`);
  return (await activeCompanies(pool, caller.actor.tenantId)).filter((c) => reach.includes(c));
}
/** A settlement's company, or null; a record outside the caller's reach answers exactly like a missing one. */
async function settlementCompany(pool: Pool, tenantId: string, settlementId: unknown): Promise<string | null> {
  if (typeof settlementId !== "string" || settlementId.trim() === "") return null;
  const { rows } = await pool.query(`SELECT operating_company_id FROM eos_finance.settlements WHERE tenant_id = $1 AND id = $2`, [tenantId, settlementId]);
  return rows[0] ? String(rows[0].operating_company_id) : null;
}

// ── INNER REACH (financeVisibility.ts) ──
const selfTeamActive = (deps: WorkOrderOperationDeps): boolean => deps.financeSelfTeamVisibilityActive === true;
/** The inner reach of the caller over `companies` (already admitted by the outer company rule). */
async function visibilityOver(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, companies: readonly string[]): Promise<FinanceVisibility> {
  try {
    return await resolveFinanceVisibility(deps.pool,
      { ...reachActor(caller), tenantId: caller.actor.tenantId, principalId: caller.actor.principalId, financeSelfTeamActive: selfTeamActive(deps) }, companies);
  } catch (err) {
    if ((err as { code?: string })?.code === "FINANCE_VISIBILITY_TOO_WIDE") refuse("FINANCE_VISIBILITY_TOO_WIDE", "PRECONDITION_FAILED", (err as Error).message);
    throw err;
  }
}
/**
 * The companies at which `key` reaches the caller AND the caller reads everything (FULL). A COMMAND is decided against these: a
 * restricted or empty reader is refused every settlement command, exactly like a record outside its companies.
 */
async function fullReachedCompanies(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, key: string): Promise<string[]> {
  return (await reachedCompanies(deps.pool, caller, key)).filter((c) => financeVisibilityModeAt(reachActor(caller), c, selfTeamActive(deps)) === "FULL");
}
async function requireSettlementInFullReach(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, key: string, settlementId: unknown): Promise<void> {
  const company = await settlementCompany(deps.pool, caller.actor.tenantId, settlementId);
  if (company === null) return; // the command's own SETTLEMENT_NOT_FOUND / input refusal answers
  if (!(await fullReachedCompanies(deps, caller, key)).includes(company)) refuse("SETTLEMENT_NOT_FOUND", "NOT_FOUND", "no settlement with that id");
}
/** A READ of one settlement: visible only when its company is FULL, or (restricted) every application ever recorded is to a visible receivable. */
async function requireSettlementVisible(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, settlementId: unknown): Promise<void> {
  if (typeof settlementId !== "string" || settlementId.trim() === "") return; // the read's own input refusal answers
  const vis = await visibilityOver(deps, caller, await reachedCompanies(deps.pool, caller, FINANCE_VIEW_CAPABILITY));
  const params: unknown[] = [caller.actor.tenantId, settlementId];
  const { rows } = await deps.pool.query(`SELECT 1 FROM eos_finance.settlements s WHERE s.tenant_id = $1 AND s.id = $2 AND ${settlementVisibilityClause(vis, "s", params)}`, params);
  if (rows.length === 0) refuse("SETTLEMENT_NOT_FOUND", "NOT_FOUND", "no settlement with that id");
}

const OPEN_KINDS = ["RECEIVABLE", "FUNDING_RECEIVABLE", "PAYABLE", "INTERCOMPANY_RECEIVABLE", "INTERCOMPANY_PAYABLE"];
const dateText = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** FU-2: the Issue offer for one receivable row -- the package/receivable predicate the issueInvoice command itself uses. */
function issuableOf(r: Record<string, any>): { readonly eligible: boolean; readonly reason: string | null } {
  const pkg = r.bp_id ? { source_kind: r.bp_source_kind, tax_evidence_status: r.bp_tax_evidence_status, tax_minor: r.bp_tax_minor, status: r.bp_status,
    readiness_exceptions: r.bp_readiness_exceptions, obligor_basis: r.bp_obligor_basis, counterparty_id: r.bp_counterparty_id,
    operating_company_id: r.bp_operating_company_id, currency: r.bp_currency } : null;
  const receivable = r.kind === "RECEIVABLE" ? { status: String(r.status), operating_company_id: String(r.operating_company_id), currency: String(r.currency) } : null;
  const blocker = issueBlocker(pkg, receivable, r.invoice_number ?? null);
  return Object.freeze({ eligible: blocker === null, reason: blocker?.code ?? null });
}
/** FU-2: the rebill offer for a VOIDED invoice's row: its Sales Order is ELIGIBLE in full, has no current (HELD / READY) package, and this is the order's latest voided invoice. */
function rebillOf(r: Record<string, any>): { readonly eligible: boolean; readonly reason: string | null } {
  const reason = !r.source_sales_order_id ? "NO_SALES_ORDER" : r.order_fully_eligible !== true ? "SALES_ORDER_NOT_ELIGIBLE"
    : r.order_has_current_package === true ? "BILLING_PACKAGE_ALREADY_PREPARED" : r.is_latest_voided_invoice !== true ? "NOT_LATEST_VOIDED_INVOICE" : null;
  return Object.freeze({ eligible: reason === null, reason });
}

/** An open obligation past its due date on the company's own business calendar (alias `o`). */
const OVERDUE_SQL = `o.due_on IS NOT NULL AND o.status IN ('OPEN','PARTIAL') AND o.due_on < eos_policy.operating_company_business_date(o.tenant_id, o.operating_company_id, now())`;

/**
 * Obligation rows over the caller's INNER reach (`vis`): every row of a FULL company, and only the visible attributed receivables
 * of a restricted one. `build` receives `bind(value)` -> its `$n` placeholder, so a caller's own filters share one parameter list.
 */
async function obligationRows(pool: Pool, tenantId: string, vis: FinanceVisibility, build: (bind: (v: unknown) => string) => string = () => "TRUE", limit = 200, withSource = false) {
  const params: unknown[] = [tenantId];
  const bind = (v: unknown): string => { params.push(v); return `$${params.length}`; };
  const visible = obligationVisibilityClause(vis, "o", params);
  const where = build(bind);
  const { rows } = await pool.query(
    `SELECT o.id, o.operating_company_id, o.kind, o.currency, o.status, o.source_domain, o.source_record_id, o.due_on, o.created_at,
            b.originated_minor, b.settled_minor, b.outstanding_minor, cp.kind AS counterparty_kind, cp.crm_account_id, cp.operating_company_id AS counterparty_company,
            a.name AS counterparty_name,
            (${OVERDUE_SQL}) AS overdue${withSource ? `, bp.sales_order_id AS source_sales_order_id, so.sales_order_number AS source_sales_order_number, inv.id AS invoice_id, inv.invoice_number, inv.issued_at AS invoice_issued_at, inv.accounting_reference AS invoice_accounting_reference, inv.voided_at AS invoice_voided_at,
            bp.id AS bp_id, bp.source_kind AS bp_source_kind, bp.tax_evidence_status AS bp_tax_evidence_status, bp.tax_minor AS bp_tax_minor, bp.status AS bp_status,
            bp.readiness_exceptions AS bp_readiness_exceptions, bp.obligor_basis AS bp_obligor_basis, bp.counterparty_id AS bp_counterparty_id,
            bp.operating_company_id AS bp_operating_company_id, bp.currency AS bp_currency,
            CASE WHEN inv.voided_at IS NOT NULL AND bp.sales_order_id IS NOT NULL THEN
              (SELECT count(*) > 0 AND count(*) = count(*) FILTER (WHERE e.eligibility = 'ELIGIBLE') FROM eos_commercial.sales_order_line_billing_eligibility e
                WHERE e.tenant_id = o.tenant_id AND e.sales_order_id = bp.sales_order_id) END AS order_fully_eligible,
            CASE WHEN inv.voided_at IS NOT NULL AND bp.sales_order_id IS NOT NULL THEN
              EXISTS (SELECT 1 FROM eos_finance.billing_packages cp WHERE cp.tenant_id = o.tenant_id AND cp.source_kind = 'SALES_ORDER' AND cp.sales_order_id = bp.sales_order_id
                AND cp.status IN ('HELD', 'READY')) END AS order_has_current_package,
            CASE WHEN inv.voided_at IS NOT NULL THEN
              NOT EXISTS (SELECT 1 FROM eos_finance.invoices later WHERE later.tenant_id = inv.tenant_id AND later.sales_order_id = inv.sales_order_id
                AND later.voided_at IS NOT NULL AND (later.issued_at, later.id) > (inv.issued_at, inv.id)) END AS is_latest_voided_invoice` : ""}
       FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
       JOIN eos_finance.financial_counterparties cp ON cp.tenant_id = o.tenant_id AND cp.id = o.counterparty_id
       LEFT JOIN eos_crm.accounts a ON a.tenant_id = cp.tenant_id AND a.id = cp.crm_account_id${withSource ? `
       LEFT JOIN eos_finance.billing_packages bp ON bp.tenant_id = o.tenant_id AND bp.id = o.source_record_id AND o.source_domain = 'BILLING_PACKAGE' AND bp.source_kind = 'SALES_ORDER'
         AND bp.operating_company_id = o.operating_company_id
       LEFT JOIN eos_commercial.sales_orders so ON so.tenant_id = bp.tenant_id AND so.id = bp.sales_order_id
       LEFT JOIN eos_finance.invoices inv ON inv.tenant_id = o.tenant_id AND inv.obligation_id = o.id` : ""}
      WHERE o.tenant_id = $1 AND ${visible} AND ${where}
      ORDER BY o.due_on NULLS LAST, o.created_at DESC, o.id LIMIT ${Number(limit)}`, params);
  return rows.map((r) => Object.freeze({
    id: String(r.id), operatingCompanyId: String(r.operating_company_id), kind: String(r.kind), currency: String(r.currency), status: String(r.status),
    sourceDomain: String(r.source_domain), sourceRecordId: String(r.source_record_id), dueOn: dateText(r.due_on), overdue: r.overdue === true,
    originatedMinor: String(r.originated_minor), settledMinor: String(r.settled_minor), outstandingMinor: String(r.outstanding_minor),
    counterparty: r.counterparty_kind === "INTERNAL_OPERATING_COMPANY" ? { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: r.counterparty_company }
      : { kind: "EXTERNAL_ORGANIZATION", crmAccountId: r.crm_account_id, name: r.counterparty_name ?? null },
    // F-2: the Sales Order a receivable was billed from (obligation -> billing package -> Sales Order), where the record carries one. Asked for only by
    // listObligations; the workspace sections do not join it. A receivable with no Sales Order source answers null, never an invented reference. A package
    // of a DIFFERENT operating company than the receivable is no source (the attribution rule readObligation applies): a reader never gets another
    // company's Sales Order number through a mismatched package.
    ...(withSource ? { sourceSalesOrder: r.source_sales_order_id ? Object.freeze({ id: String(r.source_sales_order_id), salesOrderNumber: r.source_sales_order_number ?? null }) : null } : {}),
    // F-1a: the invoice issued against this receivable (1:1), or null while none has been. Its number and issue date are the invoice's own; what is
    // outstanding is, and stays, this row's balance. Asked for only by listObligations (same join set as the Sales Order source).
    ...(withSource ? { invoice: r.invoice_id ? Object.freeze({ id: String(r.invoice_id), invoiceNumber: String(r.invoice_number), issuedAt: new Date(r.invoice_issued_at).toISOString(),
      accountingReference: r.invoice_accounting_reference ?? null,
      voidedAt: r.invoice_voided_at ? new Date(r.invoice_voided_at).toISOString() : null }) : null } : {}),
    // FU-2 (F-1a low finding): whether Issue may be offered, decided by the SAME predicate issueInvoice refuses with (invoiceIssue.ts issueBlocker) -- the screen
    // offers Issue only where this is true and never on a financed sale. `reason` is the refusal code the command would give. The command still re-decides.
    ...(withSource ? { issuable: issuableOf(r) } : {}),
    // FU-2: for a VOIDED invoice, whether its Sales Order can be prepared again for billing (the rebill), decided here; null for an invoice that is not void.
    ...(withSource ? { rebill: r.invoice_voided_at ? rebillOf(r) : null } : {}),
  }));
}

type Op = (deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) => Promise<unknown>;

const WITHHELD_SECTION = Object.freeze({ count: null, outstandingByCurrency: null, items: Object.freeze([]), withheld: true });
const WITHHELD_SECTIONS = Object.freeze(["fundingReceivables", "payables", "intercompanyReceivables", "intercompanyPayables", "unappliedSettlements",
  "accountingHandoffs", "reconciliation", "missingCostEvidence", "intercompanyReliefPending"]);

/** The workspace of a caller who does not read every company in scope in full: receivables over visible rows, the rest withheld. */
async function restrictedWorkspace(deps: WorkOrderOperationDeps, caller: WorkOrderCaller,
  scope: { consolidated: boolean; companies: string[] }, vis: FinanceVisibility) {
  const t = caller.actor.tenantId;
  // Counts and totals are computed in SQL over EVERY visible open receivable (never over a capped page); the lists below are bounded
  // samples of the same rows and say nothing about the totals.
  const aggParams: unknown[] = [t];
  const visibleOpen = obligationVisibilityClause(vis, "o", aggParams);
  const { rows: agg } = await deps.pool.query(
    `SELECT currency, count(*)::int AS n, count(*) FILTER (WHERE overdue)::int AS overdue_n, count(*) FILTER (WHERE status = 'PARTIAL')::int AS partial_n,
            sum(outstanding_minor)::text AS outstanding
       FROM (SELECT o.currency, o.status, b.outstanding_minor, (${OVERDUE_SQL}) AS overdue
               FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
              WHERE o.tenant_id = $1 AND ${visibleOpen} AND o.kind = 'RECEIVABLE' AND o.status IN ('OPEN','PARTIAL')) x
      GROUP BY currency ORDER BY currency`, aggParams);
  const byCurrency: Record<string, string> = {};
  let openCount = 0, overdueCount = 0, partialCount = 0;
  for (const r of agg) { byCurrency[String(r.currency)] = String(r.outstanding); openCount += r.n; overdueCount += r.overdue_n; partialCount += r.partial_n; }
  const openItems = await obligationRows(deps.pool, t, vis, () => `o.status IN ('OPEN','PARTIAL') AND o.kind = 'RECEIVABLE'`, 25);
  const overdueItems = await obligationRows(deps.pool, t, vis, () => `o.kind = 'RECEIVABLE' AND (${OVERDUE_SQL})`, 50);
  const partialItems = await obligationRows(deps.pool, t, vis, () => `o.kind = 'RECEIVABLE' AND o.status = 'PARTIAL'`, 50);
  return Object.freeze({
    scope: { operatingCompanyId: scope.consolidated ? "consolidated" : scope.companies[0], projection: scope.consolidated ? "CONSOLIDATED_REPORTING_PROJECTION" : "OPERATING_COMPANY",
      companies: scope.companies },
    visibility: Object.freeze({ restricted: true, fullCompanies: vis.fullCompanies, restrictedCompanies: vis.restrictedCompanies, emptyCompanies: vis.emptyCompanies }),
    withheld: Object.freeze({ reason: RESTRICTED_WITHHELD_REASON, sections: WITHHELD_SECTIONS }),
    exceptionCounts: {
      overdueObligations: overdueCount, partiallyPaidObligations: partialCount,
      unappliedSettlements: null, accountingHandoffExceptions: null, reconciliationMismatches: null, unreconciledSettlements: null,
      missingCostEvidence: null, intercompanyReliefPending: null,
    },
    receivables: Object.freeze({ count: openCount, outstandingByCurrency: byCurrency, items: openItems }),
    fundingReceivables: WITHHELD_SECTION, payables: WITHHELD_SECTION, intercompanyReceivables: WITHHELD_SECTION, intercompanyPayables: WITHHELD_SECTION,
    overdue: overdueItems,
    partiallyPaid: partialItems,
    unappliedSettlements: [], accountingHandoffs: [], reconciliation: [], missingCostEvidence: [], intercompanyReliefPending: [],
  });
}

async function readFinanceWorkspace(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireView(caller);
  const scope = await companyScope(deps.pool, caller, FINANCE_VIEW_CAPABILITY, input.operatingCompanyId);
  const vis = await visibilityOver(deps, caller, scope.companies);
  // A view over ANY company the caller does not read in full is RECEIVABLES ONLY, over its visible rows: every other section
  // cannot be attributed to a credited salesperson, so it is WITHHELD (named, never zero) -- even for the full companies in a
  // mixed view, because a total over only part of the scope would read as the whole.
  if (vis.restricted) return restrictedWorkspace(deps, caller, scope, vis);
  const t = caller.actor.tenantId;
  const open = await obligationRows(deps.pool, t, vis, () => `o.status IN ('OPEN','PARTIAL')`, 500);
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
    visibility: Object.freeze({ restricted: false }),
    exceptionCounts,
    receivables: summarize("RECEIVABLE"), fundingReceivables: summarize("FUNDING_RECEIVABLE"), payables: summarize("PAYABLE"),
    intercompanyReceivables: summarize("INTERCOMPANY_RECEIVABLE"), intercompanyPayables: summarize("INTERCOMPANY_PAYABLE"),
    overdue: open.filter((o) => o.overdue).slice(0, 50),
    partiallyPaid: open.filter((o) => o.status === "PARTIAL").slice(0, 50),
    unappliedSettlements: unapplied.map((s) => ({ id: String(s.id), operatingCompanyId: String(s.operating_company_id), kind: String(s.kind), currency: String(s.currency),
      amountMinor: String(s.amount_minor), unappliedMinor: String(s.unapplied_minor), businessDate: dateText(s.business_date), sourceReference: String(s.source_reference) })),
    accountingHandoffs: handoffs.map((h) => ({ id: String(h.id), operatingCompanyId: String(h.operating_company_id), payloadKind: String(h.payload_kind), status: String(h.status),
      readinessExceptions: [...(h.readiness_exceptions ?? [])], failureReason: h.failure_reason ?? null, obligationId: h.obligation_id ?? null,
      billingPackageId: h.billing_package_id ?? null, openExceptions: Number(h.open_exceptions) })),
    reconciliation: recon.map((r) => ({ settlementId: String(r.id), operatingCompanyId: String(r.operating_company_id), kind: String(r.kind), amountMinor: String(r.amount_minor),
      currency: String(r.currency), status: r.outcome ?? "UNRECONCILED", externalAmountMinor: r.external_amount_minor === null ? null : String(r.external_amount_minor), reason: r.reason ?? null })),
    missingCostEvidence: missing.map((x) => projectForCaller(MISSING_COST_EVIDENCE_FIELD_GROUPS, caller.actor.capabilities, {
      exceptionId: String(x.id), operatingCompanyId: String(x.operating_company_id), receivingId: String(x.receiving_id),
      receivingLineId: String(x.receiving_line_id), purchaseOrderId: String(x.purchase_order_id), partId: String(x.part_id), receivedQuantity: Number(x.received_quantity) })),
    intercompanyReliefPending: relief.map((r) => projectForCaller(INTERCOMPANY_RELIEF_PENDING_FIELD_GROUPS, caller.actor.capabilities, {
      intercompanyTransactionId: String(r.id), sellerOperatingCompanyId: String(r.seller_operating_company_id),
      buyerOperatingCompanyId: String(r.buyer_operating_company_id), receivingLineId: String(r.line_id), partId: String(r.part_id), quantity: Number(r.received_quantity) })),
  });
}

async function listObligations(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireView(caller);
  const scope = await companyScope(deps.pool, caller, FINANCE_VIEW_CAPABILITY, input.operatingCompanyId);
  // Validate every filter BEFORE any read, in the same order as before.
  if (input.kind !== undefined && !OPEN_KINDS.includes(String(input.kind))) refuse("KIND_INVALID", "INVALID_INPUT", `kind is one of ${OPEN_KINDS.join(", ")}`);
  if (input.status !== undefined && !["OPEN", "PARTIAL", "SETTLED", "VOID"].includes(String(input.status))) refuse("STATUS_INVALID", "INVALID_INPUT", "status is OPEN, PARTIAL, SETTLED or VOID");
  // One customer's obligations (an Account's receivables), still only inside the companies the caller reaches: a Taylor-only
  // caller never sees the same Account's Ventana obligations. A narrowing filter on the same gate -- it grants nothing.
  if (input.crmAccountId !== undefined && (typeof input.crmAccountId !== "string" || input.crmAccountId.trim() === "")) refuse("ACCOUNT_INVALID", "INVALID_INPUT", "crmAccountId is a non-empty account id");
  // F-1a: `invoiced: false` is the BILLING QUEUE -- Sales Order receivables with no invoice yet (the ones issueInvoice can act on); `true` the ones with one.
  if (input.invoiced !== undefined && typeof input.invoiced !== "boolean") refuse("INVOICED_INVALID", "INVALID_INPUT", "invoiced is true or false");
  const recorded = recordedWindow(input);
  const vis = await visibilityOver(deps, caller, scope.companies);
  return Object.freeze({ scope: scope.consolidated ? "consolidated" : scope.companies[0],
    items: await obligationRows(deps.pool, caller.actor.tenantId, vis, (bind) => [
      input.invoiced === false ? "inv.id IS NULL AND bp.id IS NOT NULL" : input.invoiced === true ? "inv.id IS NOT NULL" : null,
      input.kind !== undefined ? `o.kind = ${bind(input.kind)}` : null,
      input.status !== undefined ? `o.status = ${bind(input.status)}` : null,
      input.crmAccountId !== undefined ? `cp.crm_account_id = ${bind(input.crmAccountId)}` : null,
      recorded.from !== null ? `o.created_at >= ${bind(recorded.from)}` : null,
      recorded.to !== null ? `o.created_at < ${bind(recorded.to)}` : null,
    ].filter((c): c is string => c !== null).join(" AND ") || "TRUE", 200, true) });
}

/**
 * An optional RECORDING window on obligations (`recordedFrom` inclusive, `recordedTo` exclusive; ISO-8601 instants with a zone).
 * It narrows by the date EOS recorded the receivable -- NOT an issue date, which EOS receivables do not carry.
 */
function recordedWindow(input: Record<string, unknown>): { from: Date | null; to: Date | null } {
  const one = (v: unknown, name: string): Date | null => {
    if (v === undefined || v === null) return null;
    const ms = typeof v === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : Number.NaN;
    if (!Number.isFinite(ms)) refuse("RECORDED_WINDOW_INVALID", "INVALID_INPUT", `${name} is an ISO-8601 instant with a zone`);
    return new Date(ms);
  };
  const from = one(input.recordedFrom, "recordedFrom"), to = one(input.recordedTo, "recordedTo");
  if (from && to && to.getTime() <= from.getTime()) refuse("RECORDED_WINDOW_INVALID", "INVALID_INPUT", "recordedTo must be after recordedFrom");
  return { from, to };
}

async function readObligation(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireView(caller);
  if (typeof input.obligationId !== "string" || input.obligationId.trim() === "") refuse("OBLIGATION_REQUIRED", "INVALID_INPUT", "obligationId is required");
  // Only the companies the caller is assigned to, and inside them only the rows its inner reach admits: an obligation of
  // another company, or one a restricted reader may not see, answers exactly like a missing one.
  const vis = await visibilityOver(deps, caller, await reachedCompanies(deps.pool, caller, FINANCE_VIEW_CAPABILITY));
  const [o] = await obligationRows(deps.pool, caller.actor.tenantId, vis, (bind) => `o.id = ${bind(input.obligationId)}`, 1);
  if (!o) return refuse("OBLIGATION_NOT_FOUND", "NOT_FOUND", "no obligation with that id");
  const t = caller.actor.tenantId;
  // THE SOURCE and the CREDIT (derive, never persist): obligation -> billing package -> Sales Order -> credited salesperson.
  const { rows: srcRows } = await deps.pool.query(
    `SELECT ob.created_at AS recorded_at, bp.sales_order_id, bp.operating_company_id AS package_company, so.sales_order_number, so.credited_salesperson_employee_id AS credited, so.created_at AS credited_at
       FROM eos_finance.obligations ob
       LEFT JOIN eos_finance.billing_packages bp ON bp.tenant_id = ob.tenant_id AND bp.id = ob.source_record_id AND ob.source_domain = 'BILLING_PACKAGE' AND bp.source_kind = 'SALES_ORDER'
       LEFT JOIN eos_commercial.sales_orders so ON so.tenant_id = bp.tenant_id AND so.id = bp.sales_order_id
      WHERE ob.tenant_id = $1 AND ob.id = $2`, [t, input.obligationId]);
  const src = srcRows[0] ?? {};
  // The SAME rule as the list (obligationRows): a package of a DIFFERENT operating company than the receivable is no source, so its Sales Order number is never shown.
  const packageOfOtherCompany = Boolean(src.sales_order_id) && String(src.package_company) !== o.operatingCompanyId;
  const sourceSalesOrder = src.sales_order_id && !packageOfOtherCompany ? Object.freeze({ id: String(src.sales_order_id), salesOrderNumber: src.sales_order_number ?? null }) : null;
  const attribution = o.kind !== "RECEIVABLE" ? { state: "NOT_ATTRIBUTABLE", reason: "only customer receivables are attributed to a credited salesperson" }
    : packageOfOtherCompany ? { state: "NOT_ATTRIBUTABLE", reason: "the billing package belongs to a different operating company than the receivable" }
    : !sourceSalesOrder ? { state: "NOT_ATTRIBUTABLE", reason: "this receivable has no Sales Order source (a rental charge, or not billed from a Sales Order)" }
    : src.credited === null || src.credited === undefined ? { state: "UNATTRIBUTED", reason: "the source Sales Order records no credited salesperson" }
    : { state: "ATTRIBUTED", creditedSalespersonEmployeeId: String(src.credited), recordedAt: new Date(src.credited_at).toISOString() };
  const { rows: facts } = await deps.pool.query(`SELECT id, fact_class, fact_type, amount_minor, effective_at, created_at, source_domain, source_record_id, reverses_fact_id, reason
    FROM eos_finance.financial_facts WHERE tenant_id = $1 AND obligation_id = $2 ORDER BY created_at, id`, [t, input.obligationId]);
  // A settlement-application fact names its settlement (source_record_id = the settlement id, copied onto its reversal). For a settlement the
  // reader may not read -- the SAME decision as the applications above -- the fact keeps its amount and type but drops the settlement's id,
  // reason and business date (effectiveAt becomes the date EOS recorded the application).
  const factSettlementIds = [...new Set(facts.filter((f) => f.source_domain === "SETTLEMENT").map((f) => String(f.source_record_id)))];
  const visibleSettlementIds = new Set<string>();
  if (factSettlementIds.length > 0) {
    const sp: unknown[] = [t, factSettlementIds];
    const visibleClause = settlementVisibilityClause(vis, "s", sp);
    const { rows: vs } = await deps.pool.query(`SELECT s.id FROM eos_finance.settlements s WHERE s.tenant_id = $1 AND s.id = ANY($2) AND ${visibleClause}`, sp);
    for (const r of vs) visibleSettlementIds.add(String(r.id));
  }
  const hiddenFact = (f: { source_domain: unknown; source_record_id: unknown }) => f.source_domain === "SETTLEMENT" && !visibleSettlementIds.has(String(f.source_record_id));
  const hiddenFactIds = new Set(facts.filter(hiddenFact).map((f) => String(f.id)));
  // A settlement the reader may not read (readSettlement answers "not found" for it) is not described here either: the application
  // keeps its amount, status and date, and says only that the settlement is not visible -- no id, kind or source reference.
  const appParams: unknown[] = [t, input.obligationId];
  const settlementVisible = settlementVisibilityClause(vis, "s", appParams);
  const { rows: apps } = await deps.pool.query(`SELECT a.id, a.settlement_id, a.amount_minor, a.status, a.applied_at, s.kind, s.source_reference, s.business_date,
      ${settlementVisible} AS settlement_visible
    FROM eos_finance.settlement_applications a JOIN eos_finance.settlements s ON s.tenant_id = a.tenant_id AND s.id = a.settlement_id
    WHERE a.tenant_id = $1 AND a.obligation_id = $2 ORDER BY a.applied_at, a.id`, appParams);
  const { rows: hs } = await deps.pool.query(`SELECT id, status, payload_kind, provider_document_reference FROM eos_finance.accounting_handoffs
    WHERE tenant_id = $1 AND obligation_id = $2 ORDER BY created_at`, [t, input.obligationId]);
  // F-1a: the invoice issued against this receivable, if any (its number and dates; the money stays the obligation's).
  const { rows: invRows } = await deps.pool.query(`SELECT id, invoice_number, issued_at, due_date, due_basis, due_reason, accounting_reference FROM eos_finance.invoices WHERE tenant_id = $1 AND obligation_id = $2`, [t, input.obligationId]);
  const invoice = invRows[0] ? Object.freeze({ id: String(invRows[0].id), invoiceNumber: String(invRows[0].invoice_number), issuedAt: new Date(invRows[0].issued_at).toISOString(),
    dueOn: new Date(invRows[0].due_date).toISOString().slice(0, 10), dueBasis: String(invRows[0].due_basis), dueReason: invRows[0].due_reason ?? null,
    accountingReference: invRows[0].accounting_reference ?? null }) : null;
  return Object.freeze({ ...o, recordedAt: src.recorded_at ? new Date(src.recorded_at).toISOString() : null, sourceSalesOrder, invoice, attribution,
    facts: facts.map((f) => hiddenFact(f)
      ? { id: String(f.id), factClass: String(f.fact_class), factType: String(f.fact_type), amountMinor: String(f.amount_minor),
          effectiveAt: new Date(f.created_at).toISOString(), sourceDomain: String(f.source_domain), sourceRecordId: null, settlementVisible: false,
          reversesFactId: f.reverses_fact_id && !hiddenFactIds.has(String(f.reverses_fact_id)) ? f.reverses_fact_id : null, reason: null }
      : { id: String(f.id), factClass: String(f.fact_class), factType: String(f.fact_type), amountMinor: String(f.amount_minor),
          effectiveAt: new Date(f.effective_at).toISOString(), sourceDomain: String(f.source_domain), sourceRecordId: String(f.source_record_id),
          reversesFactId: f.reverses_fact_id && !hiddenFactIds.has(String(f.reverses_fact_id)) ? f.reverses_fact_id : null, reason: f.reason ?? null }),
    applications: apps.map((a) => a.settlement_visible === true
      ? { id: String(a.id), settlementVisible: true, settlementId: String(a.settlement_id), amountMinor: String(a.amount_minor), status: String(a.status),
          settlementKind: String(a.kind), sourceReference: String(a.source_reference), businessDate: dateText(a.business_date) }
      : { id: String(a.id), settlementVisible: false, settlementId: null, amountMinor: String(a.amount_minor), status: String(a.status),
          settlementKind: null, sourceReference: null, businessDate: null, appliedOn: new Date(a.applied_at).toISOString().slice(0, 10) }),
    accountingHandoffs: hs.map((h) => ({ id: String(h.id), status: String(h.status), payloadKind: String(h.payload_kind), providerDocumentReference: h.provider_document_reference ?? null })),
  });
}

async function listSettlements(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireView(caller);
  const scope = await companyScope(deps.pool, caller, FINANCE_VIEW_CAPABILITY, input.operatingCompanyId);
  // The business-date window (optional, YYYY-MM-DD, `to` exclusive) narrows what the caller may already read.
  const day = (v: unknown, name: string): string | null => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) refuse("BUSINESS_DATE_INVALID", "INVALID_INPUT", `${name} is YYYY-MM-DD`);
    return v as string;
  };
  const from = day(input.businessDateFrom, "businessDateFrom"), to = day(input.businessDateTo, "businessDateTo");
  const vis = await visibilityOver(deps, caller, scope.companies);
  const params: unknown[] = [caller.actor.tenantId];
  const visible = settlementVisibilityClause(vis, "s", params);
  const bound = [from !== null ? (params.push(from), `s.business_date >= $${params.length}`) : null, to !== null ? (params.push(to), `s.business_date < $${params.length}`) : null]
    .filter((c): c is string => c !== null);
  const { rows } = await deps.pool.query(
    `SELECT s.id FROM eos_finance.settlements s WHERE s.tenant_id = $1 AND ${[visible, ...bound].join(" AND ")} ORDER BY s.business_date DESC, s.recorded_at DESC, s.id LIMIT 100`,
    params);
  return Object.freeze({ scope: scope.consolidated ? "consolidated" : scope.companies[0],
    items: await Promise.all(rows.map((r) => readSettlement(deps.pool, caller.actor.tenantId, String(r.id)))) });
}

/**
 * readMyFinanceCompanyAccess -- the companies this caller may open in the Financials workspace, whether the Consolidated
 * reporting view is available, and per company which actions its keys reach. Read-only advice for the screen; every read
 * and command re-decides. An unassigned company is never named.
 */
async function readMyFinanceCompanyAccess(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireView(caller);
  if (Object.keys(input ?? {}).length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", "readMyFinanceCompanyAccess takes no input");
  const active = await activeCompanies(deps.pool, caller.actor.tenantId);
  const actor = reachActor(caller);
  // INNER REACH per company (financeVisibility.ts): FULL, RESTRICTED (attributed receivables only) or RESTRICTED_EMPTY (nothing).
  // A restricted reader is offered no settlement action: every command re-decides and refuses it.
  const reaches = (key: string, company: string) => financeReachesCompany(actor, key, company);
  const modeAt = (c: string) => financeVisibilityModeAt(actor, c, selfTeamActive(deps));
  const companies = active.filter((c) => reaches(FINANCE_VIEW_CAPABILITY, c)).map((c) => {
    const mode = modeAt(c), full = mode === "FULL";
    return Object.freeze({
      operatingCompanyId: c, name: operatingCompanyDisplayName(c) ?? c,
      visibility: full ? "FULL" : mode === "EMPTY" ? "RESTRICTED_EMPTY" : "RESTRICTED",
      actions: Object.freeze({ view: true, record: full && reaches(SETTLEMENT_RECORD_CAPABILITY, c), apply: full && reaches(SETTLEMENT_APPLY_CAPABILITY, c),
        correct: full && reaches(SETTLEMENT_CORRECT_CAPABILITY, c), reconcile: full && reaches(RECONCILIATION_RECORD_CAPABILITY, c), issue: full && reaches(INVOICE_ISSUE_CAPABILITY, c) }),
    });
  });
  return Object.freeze({ principalId: caller.actor.principalId, companies: Object.freeze(companies),
    consolidated: active.length > 0 && companies.length === active.length, restricted: companies.some((c) => c.visibility !== "FULL") });
}

/**
 * readFinanceOverview -- the SERVER-AGGREGATED receivables overview the Financials pages total from (nothing is added up in the
 * browser). Per currency (never blended) and per company: billed (originated), collected (settled), outstanding, open and overdue
 * counts, and the aging of the open balance by the company's own business date. VOID records count in nothing; a record with no
 * governed due date is "unaged", never placed in Current. Computed over the caller's INNER reach only (financeVisibility.ts):
 * totals and counts include visible rows and nothing else, so an aggregate can never reveal a hidden row. `recordedFrom` /
 * `recordedTo` narrow by the date EOS recorded the receivable (it carries no issue date).
 */
async function readFinanceOverview(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  requireView(caller);
  const extra = Object.keys(input ?? {}).filter((k) => !["operatingCompanyId", "recordedFrom", "recordedTo"].includes(k));
  if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const scope = await companyScope(deps.pool, caller, FINANCE_VIEW_CAPABILITY, input.operatingCompanyId);
  const recorded = recordedWindow(input);
  const vis = await visibilityOver(deps, caller, scope.companies);
  const params: unknown[] = [caller.actor.tenantId];
  const visible = obligationVisibilityClause(vis, "o", params);
  const bound = [recorded.from !== null ? (params.push(recorded.from), `o.created_at >= $${params.length}`) : null,
    recorded.to !== null ? (params.push(recorded.to), `o.created_at < $${params.length}`) : null].filter((c): c is string => c !== null);
  const { rows } = await deps.pool.query(
    `SELECT GROUPING(x.company) AS by_currency_only, x.company, x.currency,
            (count(*) FILTER (WHERE x.status <> 'VOID'))::int AS count,
            (count(*) FILTER (WHERE x.is_open))::int AS open_count,
            (count(*) FILTER (WHERE x.is_open AND x.days > 0))::int AS overdue_count,
            coalesce(sum(x.originated) FILTER (WHERE x.status <> 'VOID'), 0) AS billed,
            coalesce(sum(x.settled) FILTER (WHERE x.status <> 'VOID'), 0) AS collected,
            coalesce(sum(x.outstanding) FILTER (WHERE x.is_open), 0) AS outstanding,
            coalesce(sum(x.outstanding) FILTER (WHERE x.is_open AND x.due_on IS NULL), 0) AS unaged,
            coalesce(sum(x.outstanding) FILTER (WHERE x.is_open AND x.days <= 0), 0) AS aging_current,
            coalesce(sum(x.outstanding) FILTER (WHERE x.is_open AND x.days BETWEEN 1 AND 30), 0) AS aging_1_30,
            coalesce(sum(x.outstanding) FILTER (WHERE x.is_open AND x.days BETWEEN 31 AND 60), 0) AS aging_31_60,
            coalesce(sum(x.outstanding) FILTER (WHERE x.is_open AND x.days >= 61), 0) AS aging_61_plus
       FROM (SELECT o.operating_company_id AS company, o.currency, o.status, o.due_on, b.originated_minor AS originated, b.settled_minor AS settled,
                    b.outstanding_minor AS outstanding, (o.status IN ('OPEN','PARTIAL') AND b.outstanding_minor > 0) AS is_open,
                    (eos_policy.operating_company_business_date(o.tenant_id, o.operating_company_id, now()) - o.due_on) AS days
               FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
              WHERE o.tenant_id = $1 AND o.kind = 'RECEIVABLE' AND ${[visible, ...bound].join(" AND ")}) x
      GROUP BY GROUPING SETS ((x.company, x.currency), (x.currency)) ORDER BY x.currency, x.company NULLS FIRST`, params);
  const view = (r: Record<string, any>) => Object.freeze({
    currency: String(r.currency), count: Number(r.count), openCount: Number(r.open_count), overdueCount: Number(r.overdue_count),
    billedMinor: String(r.billed), collectedMinor: String(r.collected), outstandingMinor: String(r.outstanding),
    aging: Object.freeze({ currentMinor: String(r.aging_current), days1to30Minor: String(r.aging_1_30), days31to60Minor: String(r.aging_31_60),
      days61PlusMinor: String(r.aging_61_plus), unagedMinor: String(r.unaged) }),
  });
  return Object.freeze({
    scope: { operatingCompanyId: scope.consolidated ? "consolidated" : scope.companies[0], projection: scope.consolidated ? "CONSOLIDATED_REPORTING_PROJECTION" : "OPERATING_COMPANY",
      companies: scope.companies },
    visibility: Object.freeze({ restricted: vis.restricted, fullCompanies: vis.fullCompanies, restrictedCompanies: vis.restrictedCompanies, emptyCompanies: vis.emptyCompanies }),
    basis: "RECEIVABLE obligations of the Finance register (operational truth that money is owed, DECISIONS #197) -- not accounting invoices. "
      + "Billed = originated, Collected = settled, both excluding VOID; Outstanding and aging = open (OPEN / PARTIAL) balances. "
      + "Window, when stated, is the date EOS recorded the receivable.",
    currencies: rows.filter((r) => Number(r.by_currency_only) === 1).map(view),
    byCompany: rows.filter((r) => Number(r.by_currency_only) === 0).map((r) => Object.freeze({ operatingCompanyId: String(r.company), ...view(r) })),
  });
}

/**
 * readAccountBalanceSummary { crmAccountId } -- A6 (Owner ruling 2026-10-19): the customer-balance SUMMARY for operational roles that were never given the Finance
 * workspace. Held through its OWN key (finance.accountBalance.read), it returns, per reached company and currency, ONLY five numbers: how many receivables are open, what
 * is outstanding, how many are overdue and what is overdue, as of now. It never returns an id (obligation, settlement, handoff, billing package), an invoice number, a
 * payment or settlement row, or anything about payables, funding or intercompany, and it has no write path.
 *
 *   REACH   the Employee's company authority (home company, OPERATIONAL company-scoped Roles, explicit company-access grants; a PROTECTED ADMINISTRATOR holds every
 *           company -- eosOps/inventoryCompanyAuthority.ts) UNION the explicit Finance company assignments (financeCompanyAccess.ts). A customer's balance in any other
 *           company reads as NO DATA, exactly like a customer that owes nothing: the answer is the same empty list, so nothing says the account exists elsewhere.
 *   ROWS    RECEIVABLE obligations, open (OPEN / PARTIAL, a balance outstanding), VOID and settled excluded, of that one CRM Account.
 *   INNER   the same financeVisibility.ts decision every other Finance read asks: a sales role keeps its self / team restriction (INACTIVE today, so it reads nothing),
 *           and Finance's exclusions and company isolation are inherited, not restated. A non-sales role holds no visibility key and so reads ALL customers in its reach.
 *   TRUNCATED  a visible set beyond financeVisibility.ts's cap answers UNAVAILABLE, never a confident partial balance (the totals themselves are summed in SQL over every
 *           row, so there is no page to truncate).
 */
async function readAccountBalanceSummary(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  const assigned = financeCompanyReach(reachActor(caller), ACCOUNT_BALANCE_READ_CAPABILITY);
  if (assigned === null) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${ACCOUNT_BALANCE_READ_CAPABILITY}`);
  const extra = Object.keys(input ?? {}).filter((k) => k !== "crmAccountId");
  if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  if (typeof input.crmAccountId !== "string" || input.crmAccountId.trim() === "") refuse("ACCOUNT_INVALID", "INVALID_INPUT", "crmAccountId is a non-empty account id");
  const tenantId = caller.actor.tenantId;
  const own = await resolveInventoryCompanyAuthority(deps.pool, tenantId, caller.actor.principalId);
  const ownIds = own.companyKeys.length === 0 ? [] : (await deps.pool.query(
    `SELECT DISTINCT operating_company_id AS id FROM eos_policy.tenant_operating_company_keys
      WHERE tenant_id = $1 AND status = 'ACTIVE' AND operating_company_key = ANY($2::text[])`, [tenantId, [...own.companyKeys]])).rows.map((r) => String(r.id));
  const reach = new Set([...ownIds, ...(assigned ?? [])]);
  const companies = (await activeCompanies(deps.pool, tenantId)).filter((c) => reach.has(c));
  const asOf = new Date().toISOString();
  if (companies.length === 0) return Object.freeze({ status: "READY", asOf, restricted: false, summaries: Object.freeze([]) });
  let vis: FinanceVisibility;
  try {
    vis = await visibilityOver(deps, caller, companies);
  } catch (err) {
    if (err instanceof FinanceOperationError && err.code === "FINANCE_VISIBILITY_TOO_WIDE") {
      return Object.freeze({ status: "UNAVAILABLE", reason: "VISIBILITY_TOO_WIDE", asOf, restricted: false, summaries: Object.freeze([]) });
    }
    throw err;
  }
  const params: unknown[] = [tenantId];
  const visible = obligationVisibilityClause(vis, "o", params);
  params.push(companies); const inReach = params.length;
  params.push(input.crmAccountId); const account = params.length;
  const { rows } = await deps.pool.query(
    `SELECT x.company, x.currency, count(*)::int AS open_count, coalesce(sum(x.outstanding), 0)::text AS outstanding,
            (count(*) FILTER (WHERE x.overdue))::int AS overdue_count, coalesce(sum(x.outstanding) FILTER (WHERE x.overdue), 0)::text AS overdue_minor
       FROM (SELECT o.operating_company_id AS company, o.currency, b.outstanding_minor AS outstanding, (${OVERDUE_SQL}) AS overdue
               FROM eos_finance.obligations o
               JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
               JOIN eos_finance.financial_counterparties cp ON cp.tenant_id = o.tenant_id AND cp.id = o.counterparty_id
              WHERE o.tenant_id = $1 AND ${visible} AND o.operating_company_id = ANY($${inReach}) AND o.kind = 'RECEIVABLE' AND o.status IN ('OPEN', 'PARTIAL')
                AND b.outstanding_minor > 0 AND cp.kind = 'EXTERNAL_ORGANIZATION' AND cp.crm_account_id = $${account}) x
      GROUP BY x.company, x.currency ORDER BY x.company, x.currency`, params);
  return Object.freeze({
    status: "READY", asOf, restricted: vis.restricted,
    summaries: Object.freeze(rows.map((r) => Object.freeze({
      operatingCompanyId: String(r.company), currency: String(r.currency), openReceivableCount: Number(r.open_count), outstandingMinor: String(r.outstanding),
      overdueCount: Number(r.overdue_count), overdueMinor: String(r.overdue_minor),
    }))),
  });
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
  readMyFinanceCompanyAccess,
  readFinanceOverview,
  readAccountBalanceSummary,
  readSettlement: async (deps, caller, input) => {
    requireView(caller);
    await requireSettlementVisible(deps, caller, input.settlementId);
    return readSettlement(deps.pool, caller.actor.tenantId, input.settlementId);
  },
  // COMMANDS: each is decided against the company of what it writes (company assignment is mandatory). A record outside the
  // caller's companies answers exactly like a missing one; a requested company outside them like an unknown one. A principal
  // that does not read the company in FULL (restricted or empty inner reach) is refused every settlement command the same way.
  recordSettlement: async (deps, caller, input) => {
    requireCapability(caller, SETTLEMENT_RECORD_CAPABILITY);
    consolidatedRefused(input);
    if (typeof input.operatingCompanyId === "string" && !(await fullReachedCompanies(deps, caller, SETTLEMENT_RECORD_CAPABILITY)).includes(input.operatingCompanyId)) {
      outsideScope(SETTLEMENT_RECORD_CAPABILITY);
    }
    return recordFinancialSettlement(deps.pool, actorOf(caller), input as never);
  },
  applySettlement: async (deps, caller, input) => {
    requireCapability(caller, SETTLEMENT_APPLY_CAPABILITY);
    await requireSettlementInFullReach(deps, caller, SETTLEMENT_APPLY_CAPABILITY, input.settlementId);
    // Every obligation it settles must be in the caller's companies too (defence in depth over the settlement's own checks).
    const ids = Array.isArray(input.applications) ? input.applications.map((a) => (a as Record<string, unknown> | null)?.obligationId).filter((x): x is string => typeof x === "string") : [];
    if (ids.length > 0) {
      const { rows } = await deps.pool.query(`SELECT id, operating_company_id FROM eos_finance.obligations WHERE tenant_id = $1 AND id = ANY($2)`, [caller.actor.tenantId, ids]);
      const reach = await fullReachedCompanies(deps, caller, SETTLEMENT_APPLY_CAPABILITY);
      if (rows.some((r) => !reach.includes(String(r.operating_company_id)))) refuse("OBLIGATION_NOT_FOUND", "NOT_FOUND", "no obligation with that id");
    }
    return applyFinancialSettlement(deps.pool, actorOf(caller), input as never);
  },
  reverseSettlementApplication: async (deps, caller, input) => {
    requireCapability(caller, SETTLEMENT_CORRECT_CAPABILITY);
    if (typeof input.applicationId === "string") {
      const { rows } = await deps.pool.query(`SELECT s.operating_company_id FROM eos_finance.settlement_applications a
        JOIN eos_finance.settlements s ON s.tenant_id = a.tenant_id AND s.id = a.settlement_id WHERE a.tenant_id = $1 AND a.id = $2`, [caller.actor.tenantId, input.applicationId]);
      if (rows[0] && !(await fullReachedCompanies(deps, caller, SETTLEMENT_CORRECT_CAPABILITY)).includes(String(rows[0].operating_company_id))) {
        refuse("APPLICATION_NOT_FOUND", "NOT_FOUND", "no settlement application with that id");
      }
    }
    return reverseSettlementApplication(deps.pool, actorOf(caller), input as never);
  },
  voidSettlement: async (deps, caller, input) => {
    requireCapability(caller, SETTLEMENT_CORRECT_CAPABILITY);
    await requireSettlementInFullReach(deps, caller, SETTLEMENT_CORRECT_CAPABILITY, input.settlementId);
    return voidFinancialSettlement(deps.pool, actorOf(caller), input as never);
  },
  reconcileSettlement: async (deps, caller, input) => {
    requireCapability(caller, RECONCILIATION_RECORD_CAPABILITY);
    await requireSettlementInFullReach(deps, caller, RECONCILIATION_RECORD_CAPABILITY, input.settlementId);
    return reconcileFinancialSettlement(deps.pool, actorOf(caller), input as never);
  },
  // F-1a: issue the invoice over a READY billing package's receivable. Capability first, then the PACKAGE's company against the caller's Finance company
  // assignment (and a FULL inner reach there), both before any write; a package outside the caller's companies answers exactly like a missing one.
  issueInvoice: async (deps, caller, input) => {
    requireCapability(caller, INVOICE_ISSUE_CAPABILITY);
    if (typeof input.billingPackageId === "string" && input.billingPackageId.trim() !== "") {
      const { rows } = await deps.pool.query(`SELECT operating_company_id FROM eos_finance.billing_packages WHERE tenant_id = $1 AND id = $2`, [caller.actor.tenantId, input.billingPackageId]);
      if (rows[0] && !(await fullReachedCompanies(deps, caller, INVOICE_ISSUE_CAPABILITY)).includes(String(rows[0].operating_company_id))) {
        refuse("BILLING_PACKAGE_NOT_FOUND", "NOT_FOUND", "no billing package with that id");
      }
    }
    return issueFinancialInvoice(deps.pool, actorOf(caller), input as never);
  },
  // FU-2: PREPARE the billing package of ONE Sales Order on demand -- the rebill trigger after an approved void. REUSES finance.invoice.issue (preparing the package is the
  // first half of issuing; no new key). Order: capability, then the ORDER's company against the caller's Finance company assignment at FULL reach (a foreign, unresolvable or
  // missing order answers exactly like a missing one), then the command (order ELIGIBLE in full, then the existing idempotent preparation), all before any write.
  prepareBillingPackage: async (deps, caller, input) => {
    requireCapability(caller, INVOICE_ISSUE_CAPABILITY);
    if (typeof input.salesOrderId === "string" && input.salesOrderId.trim() !== "") {
      const { rows } = await deps.pool.query(
        `SELECT k.operating_company_id FROM eos_commercial.sales_orders so
           LEFT JOIN eos_policy.tenant_operating_company_keys k ON k.tenant_id = so.tenant_id AND k.operating_company_key = so.operating_company_key AND k.status = 'ACTIVE'
          WHERE so.tenant_id = $1 AND so.id = $2`, [caller.actor.tenantId, input.salesOrderId.trim()]);
      if (rows.length === 0 || rows[0].operating_company_id === null || !(await fullReachedCompanies(deps, caller, INVOICE_ISSUE_CAPABILITY)).includes(String(rows[0].operating_company_id))) {
        refuse("SALES_ORDER_NOT_FOUND", "NOT_FOUND", "no Sales Order with that id");
      }
    }
    return prepareBillingPackageCommand(deps.pool, actorOf(caller), input as never);
  },
  // F-1b: REQUEST a credit, write-off, debit, refund or void of an ISSUED invoice. The kind decides the key (existing record keys); the INVOICE's company is then decided
  // against the caller's Finance company assignment at FULL reach, both before any write; an invoice outside the caller's companies answers exactly like a missing one.
  // Nothing takes effect on a request: a SEPARATE Employee approves (decideInvoiceCorrection). There is no cash-out operation anywhere in this table.
  requestInvoiceCorrection: async (deps, caller, input) => {
    if (!CORRECTION_REQUEST_CAPABILITIES.some((k) => caller.actor.capabilities.has(k))) {
      refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${CORRECTION_REQUEST_CAPABILITIES.join(" or ")}`);
    }
    if (typeof input.kind !== "string" || !(INVOICE_CORRECTION_KINDS as readonly string[]).includes(input.kind)) {
      refuse("CORRECTION_KIND_INVALID", "INVALID_INPUT", `kind is one of ${INVOICE_CORRECTION_KINDS.join(", ")}`);
    }
    const key = CORRECTION_REQUEST_CAPABILITY[input.kind as InvoiceCorrectionKind];
    requireCapability(caller, key);
    const company = await invoiceCompany(deps.pool, caller.actor.tenantId, input.invoiceId);
    if (company !== null && !(await fullReachedCompanies(deps, caller, key)).includes(company)) refuse("INVOICE_NOT_FOUND", "NOT_FOUND", "no issued invoice with that id");
    return requestInvoiceCorrection(deps.pool, actorOf(caller), input as never);
  },
  // F-1b: DECIDE a pending correction. APPROVE / REJECT need the kind's approval key; WITHDRAW is the requester's own, with the request key. A correction outside every company the
  // caller reaches with the keys they hold answers exactly like a missing one (before its kind or state is revealed); the approving Employee must differ from the requester (re-decided in the command).
  decideInvoiceCorrection: async (deps, caller, input) => {
    const withdraw = input.decision === "WITHDRAW";
    const family = withdraw ? CORRECTION_REQUEST_CAPABILITIES : CORRECTION_APPROVAL_CAPABILITIES;
    const held = family.filter((k) => caller.actor.capabilities.has(k));
    if (held.length === 0) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this operation requires ${family.join(" or ")}`);
    const scope = await correctionScope(deps.pool, caller.actor.tenantId, input.correctionId);
    const reach = new Set<string>();
    for (const k of held) for (const c of await fullReachedCompanies(deps, caller, k)) reach.add(c);
    if (scope !== null && !reach.has(scope.company)) refuse("CORRECTION_NOT_FOUND", "NOT_FOUND", "no invoice correction with that id");
    if (scope !== null) requireCapability(caller, (withdraw ? CORRECTION_REQUEST_CAPABILITY : CORRECTION_APPROVE_CAPABILITY)[scope.kind]);
    return decideInvoiceCorrection(deps.pool, actorOf(caller), input as never);
  },
  // F-1b reads: the register of corrections (finance.payment.read at FULL reach; a restricted reader sees none) and one correction with its invoice and receivable.
  listInvoiceCorrections: async (deps, caller, input) => {
    requireView(caller);
    const extra = Object.keys(input ?? {}).filter((k) => !["operatingCompanyId", "invoiceId", "status", "kind"].includes(k));
    if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
    consolidatedRefused(input);
    let companies = await fullReachedCompanies(deps, caller, FINANCE_VIEW_CAPABILITY);
    if (typeof input.operatingCompanyId === "string") {
      const scope = await companyScope(deps.pool, caller, FINANCE_VIEW_CAPABILITY, input.operatingCompanyId);
      companies = companies.filter((c) => scope.companies.includes(c));
    }
    const { operatingCompanyId: _company, ...filter } = input;
    return Object.freeze({ items: await listInvoiceCorrections(deps.pool, caller.actor.tenantId, companies, filter) });
  },
  readInvoiceCorrection: async (deps, caller, input) => {
    requireView(caller);
    const extra = Object.keys(input ?? {}).filter((k) => k !== "correctionId");
    if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
    const scope = await correctionScope(deps.pool, caller.actor.tenantId, input.correctionId);
    if (scope === null || !(await fullReachedCompanies(deps, caller, FINANCE_VIEW_CAPABILITY)).includes(scope.company)) refuse("CORRECTION_NOT_FOUND", "NOT_FOUND", "no invoice correction with that id");
    const correction = await readInvoiceCorrectionOn(deps.pool, caller.actor.tenantId, String(input.correctionId));
    const balance = await readObligationBalance(deps.pool, caller.actor.tenantId, correction.obligationId);
    const { rows } = await deps.pool.query(`SELECT amount_due_minor, is_void FROM eos_finance.invoice_totals WHERE tenant_id = $1 AND invoice_id = $2`, [caller.actor.tenantId, correction.invoiceId]);
    return Object.freeze({
      correction,
      // The invoice is the ORIGINAL document and never changes; what is owed is the receivable's balance (OD-F1-2).
      invoice: Object.freeze({ id: correction.invoiceId, invoiceNumber: correction.invoiceNumber, originalAmountDueMinor: String(rows[0]?.amount_due_minor ?? "0"), void: rows[0]?.is_void === true }),
      receivable: balance && Object.freeze({ obligationId: balance.obligationId, status: balance.status, originatedMinor: balance.originatedMinor.toString(),
        settledMinor: balance.settledMinor.toString(), outstandingMinor: balance.outstandingMinor.toString() }),
    });
  },
  supplyReceiptCostEvidence: async (deps, caller, input) => supplyReceiptCostEvidence({ pool: deps.pool }, caller.actor, input),
  relieveIntercompanySaleInventory: async (deps, caller, input) => relieveIntercompanySaleInventory({ pool: deps.pool }, caller.actor, input),
  // Financial Policy (DECISIONS #232): each operation checks its own finance.policy.* key.
  ...EOS_FINANCIAL_POLICY_OPERATIONS,
});
export const FINANCE_OPERATIONS = Object.freeze(Object.keys(EOS_FINANCE_OPERATIONS));
export const isFinanceOperation = (name: unknown): name is string => typeof name === "string" && Object.prototype.hasOwnProperty.call(EOS_FINANCE_OPERATIONS, name);
export { FinanceFoundationError };
