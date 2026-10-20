// GOVERNED CREDITS, WRITE-OFFS, ADJUSTMENTS, REFUNDS AND VOIDS OF AN ISSUED INVOICE (F-1b, DECISIONS #F-1b; spec docs/architecture/f1-invoicing-spec.md;
// Owner rulings docs/governance/owner-commercial-spec-rulings-2026-10-20.md OD-F1-1 / OD-F1-4 / OD-F1-9 / OD-F1-11).
//
// THE RULE (Owner, OD-F1-1 / OD-F1-4). Every credit, write-off, debit adjustment, refund and void of an ISSUED invoice is REQUESTED by one Employee and APPROVED by a
// SEPARATE authorized Employee. The threshold is $0: an amount is positive or the request is refused, and there is no "record" mode, so no amount, however small, takes
// effect on a request alone. The invoice itself is never edited: a correction is its OWN record (eos_finance.invoice_corrections) linked to the invoice.
//
//   requestInvoiceCorrection   records the PROPOSED effect as PENDING. Nothing moves. (finance.adjustment.record, or finance.refund.record for a refund)
//   decideInvoiceCorrection    APPROVE applies it atomically; REJECT closes it; WITHDRAW lets the requester take it back.
//                              (finance.adjustment.approve / finance.refund.approve / finance.invoice.void.approve by kind; WITHDRAW is the requester's own, with the request key)
//
// TWO PEOPLE ARE TWO EMPLOYEES (the G-1 rule). The requester's linked Employee is recorded on the request. An approval is refused SELF_APPROVAL_FORBIDDEN when the
// Principals are equal, when the approver's linked Employee is the Employee recorded on the request (so relinking the requester's Employee to a new Principal does not
// make a second person), or when the requester Principal's CURRENT link resolves to the approver's Employee. Both people must resolve to an access-eligible Employee. The
// database refuses the same (invoice_corrections CHECKs), so a bug here cannot apply a one-person correction.
//
// WHAT AN APPLIED CORRECTION DOES (all in the approving transaction, under the receivable's row lock; the original number, history and audit are preserved):
//   CREDIT_MEMO / WRITE_OFF  a NEGATIVE OBLIGATION-class fact (RECEIVABLE_CREDITED / RECEIVABLE_WRITTEN_OFF) on the invoice's receivable; capped at the outstanding balance.
//   DEBIT_CHARGE             a POSITIVE fact (RECEIVABLE_CHARGED).
//     obligation_balances sums OBLIGATION facts, so OUTSTANDING STAYS DERIVED FROM THE OBLIGATION (OD-F1-2): the invoice stores no balance, and its own totals are the
//     original, unchanged. The database admits such a fact only for an APPLIED correction decided by a separate Employee (assert_adjustment_fact_is_approved).
//   REFUND                   RECORDS the refund obligation and its reconciliation only: the chosen application of a customer payment is reversed (the original kept) and
//     re-applied for what the refund leaves, and a CUSTOMER_REFUND accounting fact is written (settlement.ts): a refund RECORDED, NOT evidence that cash was sent. NOTHING IS PAID: no cash-out, no payment execution, no
//     provider call, no bank instruction exists anywhere in this module or in the Finance operations (OD-F1-11: "a new settlement kind is not permission to pay out").
//   VOID                     only BEFORE any money moves: no application (reversed or not), no settlement fact, no applied adjustment. The invoice's void columns are set (the
//     database admits that single change only for an APPLIED, two-person VOID correction and refuses it once anything moved), then the receivable is voided with reversing
//     facts. The number is never reused. Otherwise the credit path above applies.
//
// AUTHORITY is decided by the transport (financeOperations.ts: the kind's key, then the invoice's / correction's company against the caller's Finance company assignment at
// FULL reach; a foreign company reads exactly like a missing record, before any write). This module trusts only the FinanceActor it is given and re-decides the people.
//
// IDEMPOTENCY. request: (actor, key) with a request fingerprint; decide: (actor, key) with a decision fingerprint. A replay writes nothing; the same key with a different
// request is IDEMPOTENCY_KEY_REUSED. ONE audit row per APPLIED command (request, approve, reject, withdraw) in the command's own transaction: identity, amounts, the two
// Employees and the governed reason -- never free text. A refusal rolls back and leaves no trace.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import {
  FinanceFoundationError, insertObligationAdjustmentFactOn, readObligationBalance, type FinanceActor, type FinanceFoundationCategory, type ObligationBalance,
} from "./financeFoundation";
import { REFUND_NOTICE, applySettlementAmountOn, recordRefundFactOn, reverseApplicationOn } from "./settlement";
import { retirePackageReceivableOn } from "./billingPackage";
import { businessToday } from "./invoiceIssue";
import { linkedEmployeeId } from "./financeVisibility";
import { recordCommandAudit } from "../eosAudit/commandAuditEvent";

type Queryable = Pick<PoolClient, "query">;

export const INVOICE_CORRECTION_KINDS = Object.freeze(["CREDIT_MEMO", "DEBIT_CHARGE", "WRITE_OFF", "REFUND", "VOID"] as const);
export type InvoiceCorrectionKind = (typeof INVOICE_CORRECTION_KINDS)[number];
export const INVOICE_CORRECTION_DECISIONS = Object.freeze(["APPROVE", "REJECT", "WITHDRAW"] as const);
export type InvoiceCorrectionDecision = (typeof INVOICE_CORRECTION_DECISIONS)[number];
export const INVOICE_CORRECTION_STATUSES = Object.freeze(["PENDING", "APPLIED", "REJECTED", "WITHDRAWN"] as const);

/** Requesting a credit, write-off, debit or void is recording an adjustment to an issued invoice; requesting a refund is recording a refund (existing keys, migration 1761609600000). */
export const CORRECTION_REQUEST_CAPABILITY: Readonly<Record<InvoiceCorrectionKind, string>> = Object.freeze({
  CREDIT_MEMO: "finance.adjustment.record", DEBIT_CHARGE: "finance.adjustment.record", WRITE_OFF: "finance.adjustment.record", VOID: "finance.adjustment.record", REFUND: "finance.refund.record",
});
/** The explicit Finance APPROVAL capabilities (migration 1764712000000): held by a different Employee than the requester, with the same company authority. */
export const CORRECTION_APPROVE_CAPABILITY: Readonly<Record<InvoiceCorrectionKind, string>> = Object.freeze({
  CREDIT_MEMO: "finance.adjustment.approve", DEBIT_CHARGE: "finance.adjustment.approve", WRITE_OFF: "finance.adjustment.approve",
  REFUND: "finance.refund.approve", VOID: "finance.invoice.void.approve",
});
export const CORRECTION_APPROVAL_CAPABILITIES: readonly string[] = Object.freeze([...new Set(Object.values(CORRECTION_APPROVE_CAPABILITY))]);
export const CORRECTION_REQUEST_CAPABILITIES: readonly string[] = Object.freeze([...new Set(Object.values(CORRECTION_REQUEST_CAPABILITY))]);
/** OD-F1-1 / OD-F1-4: the threshold above which a second Employee must approve. ZERO: every positive amount does, and an amount is never zero. */
export const CORRECTION_APPROVAL_THRESHOLD_MINOR = 0n;
/** The governed reason limit (the Commercial reason limit, as issuing an invoice). */
export const CORRECTION_REASON_MAX = 500;
export { REFUND_NOTICE };

const FACT_TYPE: Readonly<Record<"CREDIT_MEMO" | "DEBIT_CHARGE" | "WRITE_OFF", "RECEIVABLE_CREDITED" | "RECEIVABLE_CHARGED" | "RECEIVABLE_WRITTEN_OFF">> = Object.freeze({
  CREDIT_MEMO: "RECEIVABLE_CREDITED", DEBIT_CHARGE: "RECEIVABLE_CHARGED", WRITE_OFF: "RECEIVABLE_WRITTEN_OFF",
});

const refuse = (code: string, category: FinanceFoundationCategory, message: string): never => {
  throw new FinanceFoundationError(code, category, message);
};
function only(i: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(i ?? {}).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
}
const text = (v: unknown, name: string, max = 200): string => {
  if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse(`${name.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${name} is required`);
  return (v as string).trim();
};
const positiveMinor = (v: unknown, name: string): bigint => {
  if (!Number.isSafeInteger(v) || (v as number) <= 0) refuse("AMOUNT_INVALID", "INVALID_INPUT", `${name} is a positive whole number of minor units`);
  return BigInt(v as number);
};
const kindOf = (v: unknown): InvoiceCorrectionKind => {
  if (typeof v !== "string" || !(INVOICE_CORRECTION_KINDS as readonly string[]).includes(v)) refuse("CORRECTION_KIND_INVALID", "INVALID_INPUT", `kind is one of ${INVOICE_CORRECTION_KINDS.join(", ")}`);
  return v as InvoiceCorrectionKind;
};
const sha = (parts: unknown[]): string => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    if (err instanceof FinanceFoundationError) throw err;
    // A database trigger refuses with "CODE: sentence" (the repository convention).
    const m = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec((err as { message?: string })?.message ?? "");
    if (m) refuse(m[1], m[1].includes("NOT_FOUND") ? "NOT_FOUND" : "CONFLICT", m[2]);
    // A concurrent twin lost a race on a unique index: a governed answer, never a raw 500.
    const u = err as { code?: string; constraint?: string };
    if (u?.code === "23505" && (u.constraint === "invoice_corrections_request_key" || u.constraint === "invoice_corrections_decision_key")) {
      refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that idempotency key recorded a different correction");
    }
    if (u?.code === "23505" && u.constraint === "invoice_corrections_one_void") refuse("VOID_ALREADY_REQUESTED", "CONFLICT", "this invoice already has a void request (pending or applied)");
    throw err;
  } finally {
    c.release();
  }
}

// ════════════════════ views and reads ════════════════════

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const SELECT_CORRECTION = `SELECT c.*, i.invoice_number FROM eos_finance.invoice_corrections c JOIN eos_finance.invoices i ON i.tenant_id = c.tenant_id AND i.id = c.invoice_id`;

export const correctionView = (r: Record<string, any>) => Object.freeze({
  id: String(r.id), operatingCompanyId: String(r.operating_company_id), invoiceId: String(r.invoice_id), invoiceNumber: String(r.invoice_number), obligationId: String(r.obligation_id),
  kind: String(r.kind) as InvoiceCorrectionKind, amountMinor: String(r.amount_minor), currency: String(r.currency), reason: String(r.reason), status: String(r.status),
  settlementId: r.settlement_id ?? null, applicationId: r.application_id ?? null,
  requestedBy: String(r.requested_by), requestedByEmployeeId: String(r.requested_by_employee_id), requestedAt: iso(r.requested_at) as string,
  decidedBy: r.decided_by ?? null, decidedByEmployeeId: r.decided_by_employee_id ?? null, decidedAt: iso(r.decided_at), decisionReason: r.decision_reason ?? null,
  factId: r.fact_id ?? null, refundRecordId: r.refund_settlement_id ?? null,
  // A refund is an ACCOUNTING FACT, never evidence that cash was sent.
  refundRecorded: r.kind === "REFUND" && r.status === "APPLIED" && r.refund_settlement_id != null,
  ...(r.kind === "REFUND" && r.status === "APPLIED" ? { notice: REFUND_NOTICE } : {}),
});

export async function readInvoiceCorrectionOn(db: Queryable, tenantId: string, correctionId: string) {
  const { rows } = await db.query(`${SELECT_CORRECTION} WHERE c.tenant_id = $1 AND c.id = $2`, [tenantId, correctionId]);
  return rows[0] ? correctionView(rows[0]) : refuse("CORRECTION_NOT_FOUND", "NOT_FOUND", "no invoice correction with that id");
}

/** The company of an invoice's receivable, or null: the transport decides company authority on it before the command can write. */
export async function invoiceCompany(db: Queryable, tenantId: string, invoiceId: unknown): Promise<string | null> {
  if (typeof invoiceId !== "string" || invoiceId.trim() === "") return null;
  const { rows } = await db.query(
    `SELECT o.operating_company_id FROM eos_finance.invoices i JOIN eos_finance.obligations o ON o.tenant_id = i.tenant_id AND o.id = i.obligation_id
      WHERE i.tenant_id = $1 AND i.id = $2 AND i.obligation_id IS NOT NULL`, [tenantId, invoiceId]);
  return rows[0] ? String(rows[0].operating_company_id) : null;
}
/** A correction's company and kind, or null (the same transport rule). */
export async function correctionScope(db: Queryable, tenantId: string, correctionId: unknown): Promise<{ company: string; kind: InvoiceCorrectionKind } | null> {
  if (typeof correctionId !== "string" || correctionId.trim() === "") return null;
  const { rows } = await db.query(`SELECT operating_company_id, kind FROM eos_finance.invoice_corrections WHERE tenant_id = $1 AND id = $2`, [tenantId, correctionId]);
  return rows[0] ? { company: String(rows[0].operating_company_id), kind: rows[0].kind as InvoiceCorrectionKind } : null;
}

/** The register: corrections of the given companies (already admitted at FULL reach by the transport), newest first, optionally one invoice / status / kind. */
export async function listInvoiceCorrections(db: Queryable, tenantId: string, companies: readonly string[], filter: { invoiceId?: unknown; status?: unknown; kind?: unknown }) {
  only(filter as Record<string, unknown>, ["invoiceId", "status", "kind", "operatingCompanyId"]);
  const params: unknown[] = [tenantId, companies];
  let where = `c.tenant_id = $1 AND c.operating_company_id = ANY($2)`;
  if (filter.invoiceId !== undefined && filter.invoiceId !== null) { params.push(text(filter.invoiceId, "invoiceId")); where += ` AND c.invoice_id = $${params.length}`; }
  if (filter.status !== undefined && filter.status !== null) {
    if (typeof filter.status !== "string" || !(INVOICE_CORRECTION_STATUSES as readonly string[]).includes(filter.status)) refuse("CORRECTION_STATUS_INVALID", "INVALID_INPUT", `status is one of ${INVOICE_CORRECTION_STATUSES.join(", ")}`);
    params.push(filter.status); where += ` AND c.status = $${params.length}`;
  }
  if (filter.kind !== undefined && filter.kind !== null) { params.push(kindOf(filter.kind)); where += ` AND c.kind = $${params.length}`; }
  const { rows } = await db.query(`${SELECT_CORRECTION} WHERE ${where} ORDER BY c.requested_at DESC, c.id LIMIT 100`, params);
  return rows.map(correctionView);
}

// ════════════════════ eligibility (one rule, at request and again at approval) ════════════════════

interface Eligible { readonly inv: Record<string, any>; readonly balance: ObligationBalance; readonly app: Record<string, any> | null }

/**
 * What may be corrected, decided under the receivable's row lock. Used at REQUEST (so an impossible correction is refused early) and again at APPROVAL (the world may
 * have moved): an issued, un-voided invoice; a live receivable; then the rule of the kind.
 */
async function eligibilityOn(c: Queryable, actor: FinanceActor, corr: { kind: InvoiceCorrectionKind; invoiceId: string; amount: bigint | null; applicationId: string | null }): Promise<Eligible> {
  const t = actor.tenantId;
  const { rows } = await c.query(
    `SELECT i.id, i.invoice_number, i.currency, i.voided_at, i.obligation_id, i.billing_package_id, o.operating_company_id, o.counterparty_id
       FROM eos_finance.invoices i JOIN eos_finance.obligations o ON o.tenant_id = i.tenant_id AND o.id = i.obligation_id
      WHERE i.tenant_id = $1 AND i.id = $2 AND i.obligation_id IS NOT NULL`, [t, corr.invoiceId]);
  const inv = rows[0] ?? refuse("INVOICE_NOT_FOUND", "NOT_FOUND", "no issued invoice with that id");
  // A REFUND locks the payment settlement and the application BEFORE the receivable (the order applySettlement takes), so the two cannot deadlock.
  let app: Record<string, any> | null = null;
  if (corr.kind === "REFUND") {
    const ar = await c.query(
      `SELECT a.id, a.settlement_id, a.obligation_id, a.amount_minor, a.status AS app_status, s.kind AS settlement_kind, s.status AS settlement_status, s.currency AS settlement_currency,
              s.counterparty_id AS settlement_counterparty, s.operating_company_id AS settlement_company
         FROM eos_finance.settlement_applications a JOIN eos_finance.settlements s ON s.tenant_id = a.tenant_id AND s.id = a.settlement_id
        WHERE a.tenant_id = $1 AND a.id = $2 AND a.obligation_id = $3 FOR UPDATE OF s, a`, [t, corr.applicationId, inv.obligation_id]);
    app = ar.rows[0] ?? refuse("APPLICATION_NOT_FOUND", "NOT_FOUND", "no payment application of this invoice with that id");
  }
  await c.query(`SELECT 1 FROM eos_finance.obligations WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [t, inv.obligation_id]);
  const balance = (await readObligationBalance(c, t, String(inv.obligation_id))) ?? refuse("OBLIGATION_NOT_FOUND", "NOT_FOUND", "the invoice's receivable does not exist");
  if (inv.voided_at) refuse("INVOICE_VOID", "PRECONDITION_FAILED", `invoice ${inv.invoice_number} is void; nothing more is recorded against it`);
  if (balance.status === "VOID") refuse("RECEIVABLE_VOID", "PRECONDITION_FAILED", "the invoice's receivable is void");
  switch (corr.kind) {
    case "CREDIT_MEMO":
    case "WRITE_OFF":
      // Firebase's rule, kept: a credit or write-off never exceeds what is outstanding (no customer credit balance is built, OD-F1-10).
      if ((corr.amount as bigint) > balance.outstandingMinor) refuse("AMOUNT_EXCEEDS_OUTSTANDING", "PRECONDITION_FAILED", `the amount exceeds the outstanding ${balance.outstandingMinor.toString()}; nothing is credited above what is owed`);
      break;
    case "DEBIT_CHARGE":
      break;
    case "REFUND": {
      const a = app as Record<string, any>;
      if (a.app_status !== "APPLIED") refuse("APPLICATION_NOT_APPLIED", "PRECONDITION_FAILED", "that application is reversed; only money applied to this invoice is refunded");
      if (a.settlement_kind !== "CUSTOMER_PAYMENT" || a.settlement_status !== "RECORDED") refuse("REFUND_SOURCE_INVALID", "PRECONDITION_FAILED", "only a recorded customer payment is refunded");
      if (a.settlement_currency !== inv.currency) refuse("CURRENCY_MISMATCH", "PRECONDITION_FAILED", "the payment and the invoice are in different currencies");
      if ((corr.amount as bigint) > BigInt(a.amount_minor)) refuse("REFUND_EXCEEDS_APPLIED", "PRECONDITION_FAILED", `the refund exceeds the ${a.amount_minor} applied; a refund returns only what was applied`);
      break;
    }
    case "VOID": {
      // OD-F1-9: only BEFORE any settlement or adjustment is applied. A reversed application still means money moved, so ANY application refuses.
      const moved = await c.query(`SELECT 1 FROM eos_finance.settlement_applications WHERE tenant_id = $1 AND obligation_id = $2 LIMIT 1`, [t, inv.obligation_id]);
      const cash = await c.query(`SELECT 1 FROM eos_finance.financial_facts WHERE tenant_id = $1 AND obligation_id = $2 AND fact_class = 'SETTLEMENT' LIMIT 1`, [t, inv.obligation_id]);
      if (moved.rows.length > 0 || cash.rows.length > 0 || balance.settledMinor !== 0n) refuse("VOID_AFTER_SETTLEMENT", "PRECONDITION_FAILED", "money has been applied to this invoice; it is corrected by a credit memo, not voided");
      const adjusted = await c.query(`SELECT kind FROM eos_finance.invoice_corrections WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'APPLIED' LIMIT 1`, [t, inv.id]);
      if (adjusted.rows.length > 0) refuse("VOID_AFTER_ADJUSTMENT", "PRECONDITION_FAILED", "an adjustment has been applied to this invoice; it is corrected by a credit memo, not voided");
      const delivered = await c.query(
        `SELECT status FROM eos_finance.accounting_handoffs WHERE tenant_id = $1 AND billing_package_id = $2 AND status IN ('DELIVERY_IN_PROGRESS', 'ACKNOWLEDGED') LIMIT 1`, [t, inv.billing_package_id]);
      if (delivered.rows.length > 0) refuse("ACCOUNTING_HANDOFF_DELIVERED", "CONFLICT", `the invoice's accounting handoff is ${delivered.rows[0].status}; it cannot be voided without a provider-side correction`);
      if (balance.originatedMinor <= 0n) refuse("VOID_NOT_APPLICABLE", "PRECONDITION_FAILED", "the receivable originated nothing");
      break;
    }
  }
  return { inv, balance, app };
}

// ════════════════════ request ════════════════════

export interface RequestInvoiceCorrectionInput {
  kind: unknown; invoiceId: unknown; amountMinor?: unknown; applicationId?: unknown; reason: unknown; idempotencyKey: unknown;
}

export async function requestInvoiceCorrection(pool: Pool, actor: FinanceActor, input: RequestInvoiceCorrectionInput) {
  only(input as unknown as Record<string, unknown>, ["kind", "invoiceId", "amountMinor", "applicationId", "reason", "idempotencyKey"]);
  const kind = kindOf(input.kind);
  const invoiceId = text(input.invoiceId, "invoiceId");
  const reason = text(input.reason, "reason", CORRECTION_REASON_MAX);
  const key = text(input.idempotencyKey, "idempotencyKey");
  // A void has no amount of its own (it is the whole receivable); every other kind states a positive one. $0 is not an amount: there is no free threshold.
  let amount: bigint | null = null;
  if (kind === "VOID") {
    if (input.amountMinor !== undefined && input.amountMinor !== null) refuse("AMOUNT_NOT_ACCEPTED", "INVALID_INPUT", "a void is of the whole invoice; it states no amount");
  } else {
    amount = positiveMinor(input.amountMinor, "amountMinor");
  }
  let applicationId: string | null = null;
  if (kind === "REFUND") applicationId = text(input.applicationId, "applicationId");
  else if (input.applicationId !== undefined && input.applicationId !== null) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", "not accepted: applicationId (a refund names the payment application it returns)");
  const fingerprint = sha([kind, invoiceId, amount === null ? null : amount.toString(), applicationId, reason]);

  return tx(pool, async (c) => {
    // REPLAY: the command already applied. Nothing is written or audited.
    const { rows: prior } = await c.query(
      `SELECT id, request_fingerprint FROM eos_finance.invoice_corrections WHERE tenant_id = $1 AND requested_by = $2 AND request_idempotency_key = $3`, [actor.tenantId, actor.principalId, key]);
    if (prior[0]) {
      if (prior[0].request_fingerprint !== fingerprint) refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that idempotency key requested a different correction");
      return Object.freeze({ outcome: "replayed" as const, correction: await readInvoiceCorrectionOn(c, actor.tenantId, String(prior[0].id)) });
    }
    // Two people need two Employees: the requester must be one.
    const requesterEmployee = (await linkedEmployeeId(c, actor.tenantId, actor.principalId))
      ?? refuse("REQUESTER_EMPLOYEE_REQUIRED", "PRECONDITION_FAILED", "a correction is requested by an Employee: this account is linked to no access-eligible Employee");
    const e = await eligibilityOn(c, actor, { kind, invoiceId, amount, applicationId });
    if (kind === "VOID") {
      const { rows: open } = await c.query(`SELECT 1 FROM eos_finance.invoice_corrections WHERE tenant_id = $1 AND invoice_id = $2 AND kind = 'VOID' AND status IN ('PENDING', 'APPLIED')`, [actor.tenantId, invoiceId]);
      if (open.length > 0) refuse("VOID_ALREADY_REQUESTED", "CONFLICT", "this invoice already has a void request (pending or applied)");
    }
    const storedAmount = kind === "VOID" ? e.balance.originatedMinor : (amount as bigint);
    const id = `icr_${randomUUID()}`;
    await c.query(
      `INSERT INTO eos_finance.invoice_corrections (id, tenant_id, operating_company_id, invoice_id, obligation_id, kind, amount_minor, currency, reason, settlement_id, application_id,
          status, requested_by, requested_by_employee_id, request_idempotency_key, request_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING',$12,$13,$14,$15)`,
      [id, actor.tenantId, e.inv.operating_company_id, invoiceId, e.inv.obligation_id, kind, storedAmount.toString(), e.inv.currency, reason, e.app?.settlement_id ?? null, applicationId,
        actor.principalId, requesterEmployee, key, fingerprint]);
    const correction = await readInvoiceCorrectionOn(c, actor.tenantId, id);
    await recordCommandAudit(c, actor.tenantId, actor.principalId, {
      action: "finance.correction.request", targetKind: "invoice_correction", targetId: id, before: null,
      after: { correctionId: id, kind, status: "PENDING", invoiceId, invoiceNumber: correction.invoiceNumber, operatingCompanyId: correction.operatingCompanyId, obligationId: correction.obligationId,
        amountMinor: correction.amountMinor, currency: correction.currency, applicationId, requestedByEmployeeId: requesterEmployee },
      reason,
    });
    return Object.freeze({ outcome: "requested" as const, correction });
  });
}

// ════════════════════ decide ════════════════════

export interface DecideInvoiceCorrectionInput {
  correctionId: unknown; decision: unknown; reason: unknown; amountMinor?: unknown; idempotencyKey: unknown;
}

/** The people rule. Refused before any write; the database refuses the same in invoice_corrections CHECKs. */
async function assertSeparatePerson(c: Queryable, actor: FinanceActor, corr: Record<string, any>): Promise<string> {
  const self = () => refuse("SELF_APPROVAL_FORBIDDEN", "PRECONDITION_FAILED", "a correction is decided by a different Employee than the one who requested it -- under any policy (FIN-007)");
  if (actor.principalId === corr.requested_by) return self();
  const approver = (await linkedEmployeeId(c, actor.tenantId, actor.principalId))
    ?? refuse("APPROVER_EMPLOYEE_REQUIRED", "PRECONDITION_FAILED", "a correction is decided by an Employee: this account is linked to no access-eligible Employee");
  // The Employee recorded at request time (a later relink of that Employee to a new Principal does not make a second person) ...
  if (approver === corr.requested_by_employee_id) return self();
  // ... and the requester Principal's CURRENT link.
  const { rows } = await c.query(`SELECT employee_id FROM eos_policy.employee_principal_links WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active'`, [actor.tenantId, corr.requested_by]);
  if (rows.some((r) => String(r.employee_id) === approver)) return self();
  return approver;
}

export async function decideInvoiceCorrection(pool: Pool, actor: FinanceActor, input: DecideInvoiceCorrectionInput) {
  only(input as unknown as Record<string, unknown>, ["correctionId", "decision", "reason", "amountMinor", "idempotencyKey"]);
  const correctionId = text(input.correctionId, "correctionId");
  if (typeof input.decision !== "string" || !(INVOICE_CORRECTION_DECISIONS as readonly string[]).includes(input.decision)) {
    refuse("DECISION_INVALID", "INVALID_INPUT", `decision is one of ${INVOICE_CORRECTION_DECISIONS.join(", ")}`);
  }
  const decision = input.decision as InvoiceCorrectionDecision;
  const reason = text(input.reason, "reason", CORRECTION_REASON_MAX);
  const key = text(input.idempotencyKey, "idempotencyKey");
  // FIN-007: an approval states an amount ("approving 100 is not approving 150"). Only an approval does; for a void it is the whole invoice amount.
  let stated: bigint | null = null;
  if (decision === "APPROVE") stated = positiveMinor(input.amountMinor, "amountMinor");
  else if (input.amountMinor !== undefined && input.amountMinor !== null) refuse("AMOUNT_NOT_ACCEPTED", "INVALID_INPUT", "only an approval states an amount");
  const fingerprint = sha([correctionId, decision, stated === null ? null : stated.toString(), reason]);

  return tx(pool, async (c) => {
    const { rows } = await c.query(`SELECT * FROM eos_finance.invoice_corrections WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, correctionId]);
    const corr = rows[0] ?? refuse("CORRECTION_NOT_FOUND", "NOT_FOUND", "no invoice correction with that id");
    const kind = corr.kind as InvoiceCorrectionKind;

    // REPLAY: already decided by this actor with this key.
    if (corr.status !== "PENDING") {
      if (corr.decided_by === actor.principalId && corr.decision_idempotency_key === key) {
        if (corr.decision_fingerprint !== fingerprint) refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that idempotency key decided this correction differently");
        return Object.freeze({ outcome: "replayed" as const, correction: await readInvoiceCorrectionOn(c, actor.tenantId, correctionId) });
      }
      refuse("CORRECTION_NOT_PENDING", "CONFLICT", `this correction is already ${String(corr.status).toLowerCase()}`);
    }
    // The key names ONE decision of this actor: another correction's decision cannot reuse it.
    const { rows: keyed } = await c.query(`SELECT 1 FROM eos_finance.invoice_corrections WHERE tenant_id = $1 AND decided_by = $2 AND decision_idempotency_key = $3`, [actor.tenantId, actor.principalId, key]);
    if (keyed.length > 0) refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that idempotency key decided a different correction");

    let approverEmployee: string;
    if (decision === "WITHDRAW") {
      // Only the requester takes a request back (anyone else REJECTS, with the approval key).
      if (actor.principalId !== corr.requested_by) refuse("WITHDRAW_BY_REQUESTER_ONLY", "PRECONDITION_FAILED", "only the person who requested a correction withdraws it");
      approverEmployee = String(corr.requested_by_employee_id);
    } else {
      approverEmployee = await assertSeparatePerson(c, actor, corr);
    }

    let outcome: "applied" | "rejected" | "withdrawn";
    let effect: Record<string, unknown> = {};
    let eligible: Eligible | null = null;
    if (decision === "APPROVE") {
      if ((stated as bigint) !== BigInt(corr.amount_minor)) refuse("APPROVAL_AMOUNT_MISMATCH", "PRECONDITION_FAILED", `the approval states ${(stated as bigint).toString()} but the correction is for ${corr.amount_minor}; approving one amount is not approving another`);
      eligible = await eligibilityOn(c, actor, { kind, invoiceId: String(corr.invoice_id), amount: kind === "VOID" ? null : BigInt(corr.amount_minor), applicationId: corr.application_id ?? null });
      if (kind === "VOID" && eligible.balance.originatedMinor !== BigInt(corr.amount_minor)) refuse("APPROVAL_AMOUNT_MISMATCH", "PRECONDITION_FAILED", "the invoice amount changed since the void was requested");
      outcome = "applied";
    } else {
      outcome = decision === "REJECT" ? "rejected" : "withdrawn";
    }

    const status = decision === "APPROVE" ? "APPLIED" : decision === "REJECT" ? "REJECTED" : "WITHDRAWN";
    const moved = await c.query(
      `UPDATE eos_finance.invoice_corrections SET status = $3, decided_by = $4, decided_by_employee_id = $5, decided_at = now(), decision_reason = $6,
              decision_idempotency_key = $7, decision_fingerprint = $8
        WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'`,
      [actor.tenantId, correctionId, status, actor.principalId, approverEmployee, reason, key, fingerprint]);
    if (moved.rowCount !== 1) refuse("CORRECTION_NOT_PENDING", "CONFLICT", "this correction is no longer pending");

    if (decision === "APPROVE") effect = await applyEffectOn(c, actor, corr, eligible as Eligible);

    const correction = await readInvoiceCorrectionOn(c, actor.tenantId, correctionId);
    await recordCommandAudit(c, actor.tenantId, actor.principalId, {
      action: decision === "APPROVE" ? "finance.correction.approve" : decision === "REJECT" ? "finance.correction.reject" : "finance.correction.withdraw",
      targetKind: "invoice_correction", targetId: correctionId, before: { status: "PENDING" },
      after: { correctionId, kind, status, invoiceId: correction.invoiceId, invoiceNumber: correction.invoiceNumber, operatingCompanyId: correction.operatingCompanyId, obligationId: correction.obligationId,
        amountMinor: correction.amountMinor, currency: correction.currency, requestedBy: correction.requestedBy, requestedByEmployeeId: correction.requestedByEmployeeId,
        decidedBy: actor.principalId, decidedByEmployeeId: approverEmployee, ...effect },
      reason,
    });
    return Object.freeze({ outcome, correction, ...(correction.refundRecorded ? { refundRecorded: true, notice: REFUND_NOTICE } : {}) });
  });
}

/** The effect of an APPROVED correction, in the approving transaction. The correction row is already APPLIED (the database admits each effect only for such a row). */
async function applyEffectOn(c: Queryable, actor: FinanceActor, corr: Record<string, any>, e: Eligible): Promise<Record<string, unknown>> {
  const id = String(corr.id);
  const kind = corr.kind as InvoiceCorrectionKind;
  const amount = BigInt(corr.amount_minor);
  const obligationId = String(corr.obligation_id);
  const before = e.balance.outstandingMinor;
  const outstandingAfter = async (): Promise<string> => String(((await readObligationBalance(c, actor.tenantId, obligationId)) as ObligationBalance).outstandingMinor);

  if (kind === "CREDIT_MEMO" || kind === "WRITE_OFF" || kind === "DEBIT_CHARGE") {
    const fact = await insertObligationAdjustmentFactOn(c, actor, {
      obligationId, factType: FACT_TYPE[kind], amountMinor: kind === "DEBIT_CHARGE" ? amount : -amount, effectiveAt: new Date(), idempotencyKey: `invcorr:${id}`, sourceRecordId: id,
    });
    await c.query(`UPDATE eos_finance.invoice_corrections SET fact_id = $3 WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, id, fact.fact.id]);
    return { factId: fact.fact.id, factType: FACT_TYPE[kind], outstandingBeforeMinor: before.toString(), outstandingAfterMinor: await outstandingAfter() };
  }

  if (kind === "REFUND") {
    const a = e.app as Record<string, any>;
    // 1. the application is REVERSED (the original is kept, the receivable reopens) ...
    await reverseApplicationOn(c, actor, { applicationId: String(a.id), reason: String(corr.reason), key: `invcorr:${id}:reverse` });
    // 2. ... what the refund does not return is applied again (to the same receivable, from the same payment) ...
    const remainder = BigInt(a.amount_minor) - amount;
    let reappliedApplicationId: string | null = null;
    if (remainder > 0n) {
      const { rows: st } = await c.query(`SELECT * FROM eos_finance.settlements WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, a.settlement_id]);
      reappliedApplicationId = await applySettlementAmountOn(c, actor, st[0], obligationId, remainder, `invcorr:${id}:reapply`);
    }
    // 3. ... and the refund is RECORDED. An accounting fact only (refund recorded; no payment has been sent): nothing is paid, sent or initiated (OD-F1-11).
    const today = await businessToday(c, actor.tenantId, String(corr.operating_company_id));
    const refundRecordId = await recordRefundFactOn(c, actor, {
      operatingCompanyId: String(corr.operating_company_id), counterpartyId: String(a.settlement_counterparty), amountMinor: amount, currency: String(corr.currency), businessDate: today, correctionId: id,
    });
    await c.query(`UPDATE eos_finance.invoice_corrections SET refund_settlement_id = $3 WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, id, refundRecordId]);
    return { refundRecordId, paymentSettlementId: String(a.settlement_id), reversedApplicationId: String(a.id), reappliedApplicationId, outstandingBeforeMinor: before.toString(), outstandingAfterMinor: await outstandingAfter() };
  }

  // VOID: the invoice's void columns (the database admits this one change only for this APPLIED, two-person VOID correction, and only while nothing has moved) ...
  const voided = await c.query(
    `UPDATE eos_finance.invoices SET voided_at = now(), void_reason = $3, voided_by = $4 WHERE tenant_id = $1 AND id = $2 AND voided_at IS NULL`,
    [actor.tenantId, corr.invoice_id, corr.reason, actor.principalId]);
  if (voided.rowCount !== 1) refuse("INVOICE_VOID", "PRECONDITION_FAILED", "the invoice is already void");
  // ... then the receivable is voided with reversing facts (never edited), and the package's accounting handoff superseded. The number is never reused.
  await retirePackageReceivableOn(c, actor, String(e.inv.billing_package_id), String(corr.reason));
  // ... and the package is RETIRED with them (F3): it must not stay READY with a VOID receivable, or the order could never be re-billed. A re-prepare of the same Sales Order
  // then produces a NEW package (next version) with a NEW receivable, which can be invoiced under a new number; the voided invoice keeps its own.
  await c.query(`UPDATE eos_finance.billing_packages SET status = 'SUPERSEDED', status_changed_at = now() WHERE tenant_id = $1 AND id = $2 AND status IN ('HELD', 'READY')`,
    [actor.tenantId, e.inv.billing_package_id]);
  return { voidedInvoiceId: String(corr.invoice_id), outstandingBeforeMinor: before.toString() };
}
