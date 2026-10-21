// ISSUE ONE INVOICE ON EOS (F-1a, DECISIONS #F-1a; spec docs/architecture/f1-invoicing-spec.md, Owner "invoicing: Build it now").
//
// WHAT AN INVOICE IS HERE (OD-F1-2). The customer-facing DOCUMENT issued against ONE receivable obligation, 1:1. The obligation stays the single
// source of "money is owed" (#197): the invoice carries the number, the issue date, the due date and the frozen lines and tax, and never stores what is
// outstanding -- that is read from the obligation. Cash stays settlements (OD-F1-3); the `payments` tables are not touched.
//
// WHAT ISSUING TAKES FROM THE PACKAGE (OD-F1-6, OD-F1-7). One invoice per READY billing package, built from the package and nothing else: its lines,
// the Agreement's customer discount, shipping, install charge, tax and trade-in credit, exactly as the package froze them. Nothing is re-priced. The
// tax is the package's DETERMINED tax; a package whose tax is unknown refuses issuance (unknown is never zero). A superseded or HELD package, a
// non-Sales-Order package, a financed or rental package and a package without its receivable are refused.
//
// THE NUMBER (OD-F1-5). `INV-YYYY-######` per (tenant, operating-company key, UTC year), allocated by invoiceNumberAllocator.ts in THIS transaction
// and only on the apply path: a replay returns the invoice that exists and allocates nothing; a refusal rolls its increment back. The accounting
// provider's own document reference is a separate column (`accounting_reference`) and is never written here.
//
// THE DUE DATE (OD-F1-8). From the customer's governed payment terms for the company (Finance configuration, counterparty_company_profiles
// .payment_terms_net_days, #202/#204): issue date on the company's business calendar + net days. The issuer may name a LATER date and must say why;
// an EARLIER date is refused. Where no terms are configured the issuer states the date and the reason (the spec's stated fallback). The date is
// also set on the receivable (obligations.due_on, once, from NULL) so aging begins there.
//
// IDEMPOTENCY. (actor, idempotency key) names the command; the request fingerprint (package, due date, reason) must match on a replay, otherwise
// IDEMPOTENCY_KEY_REUSED. The package row is locked FIRST so two concurrent issues of one package serialize; the loser sees the winner's invoice.
//
// AUTHORITY is decided by the transport (financeOperations.ts: finance.invoice.issue AND a Finance company assignment at the package's company,
// refused before this runs). This module trusts only the FinanceActor it is given.
//
// ONE audit row per APPLIED command (Q-1 convention, eosAudit/commandAuditEvent.ts), in this transaction: identity, amounts, due date and the governed
// reason; never free text beyond the reason. A replay and a refusal write nothing.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { FinanceFoundationError, type FinanceActor, type FinanceFoundationCategory } from "./financeFoundation";
import { allocateInvoiceNumber } from "./invoiceNumberAllocator";
import { recordCommandAudit } from "../eosAudit/commandAuditEvent";

export const INVOICE_ISSUE_CAPABILITY = "finance.invoice.issue";
export const INVOICE_DUE_BASES = Object.freeze(["TERMS", "TERMS_EXTENDED", "NO_TERMS_ENTERED"] as const);
export type InvoiceDueBasis = (typeof INVOICE_DUE_BASES)[number];
/** The governed reason limit (the Commercial reason limit). */
export const INVOICE_REASON_MAX = 500;

type Queryable = Pick<PoolClient, "query">;

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
const isoDate = (v: unknown, name: string): string => {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !d || d.toISOString().slice(0, 10) !== v) refuse("DUE_DATE_INVALID", "INVALID_INPUT", `${name} is a real calendar date, YYYY-MM-DD`);
  return v as string;
};
const addDays = (day: string, days: number): string => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const big = (v: unknown): bigint => (v === null || v === undefined ? 0n : BigInt(v as string | number));

export interface IssueBlocker { readonly code: string; readonly category: FinanceFoundationCategory; readonly message: string }
/** The package columns the issue predicate reads (a billing_packages row, or the same columns joined onto a receivable row). */
export interface IssuePackageFacts {
  readonly source_kind: string | null; readonly tax_evidence_status: string | null; readonly tax_minor: unknown; readonly status: string | null;
  readonly readiness_exceptions?: readonly string[] | null; readonly obligor_basis: string | null; readonly counterparty_id: string | null;
  readonly operating_company_id: string | null; readonly currency: string | null;
}
/**
 * WHY a billing package and its receivable cannot be invoiced, or null. ONE function, two callers: `issueFinancialInvoice` (which refuses with exactly this code,
 * in exactly this order) and the receivable read (which offers Issue only where this is null -- F-1a low finding: the screen offered Issue on a financed sale the
 * server then refused). `p` is null when the receivable has no Sales Order package; `o` is the package's RECEIVABLE obligation, or null. What this cannot see
 * (a line without a price, the due date) depends on the request and is still decided by the command.
 */
export function issueBlocker(
  p: IssuePackageFacts | null, o: { readonly status: string; readonly operating_company_id: string; readonly currency: string } | null, invoiceNumber: string | null,
): IssueBlocker | null {
  const b = (code: string, category: FinanceFoundationCategory, message: string): IssueBlocker => ({ code, category, message });
  if (p === null || p.source_kind !== "SALES_ORDER") return b("UNSUPPORTED_BILLING_SOURCE", "PRECONDITION_FAILED", "only a Sales Order billing package is invoiced here");
  // UNKNOWN TAX IS NEVER ZERO (OD-F1-7): checked before readiness so the refusal names the real cause.
  if (p.tax_evidence_status !== "DETERMINED" || p.tax_minor === null || p.tax_minor === undefined) {
    return b("TAX_NOT_DETERMINED", "PRECONDITION_FAILED", "the billing package's tax is not determined; it cannot be invoiced");
  }
  if (p.status !== "READY") {
    const ex = p.readiness_exceptions ?? [];
    return b("BILLING_PACKAGE_NOT_READY", "PRECONDITION_FAILED", `the billing package is ${p.status}${ex.length > 0 ? ` (${ex.join(", ")})` : ""}; only a READY package is invoiced`);
  }
  if (p.obligor_basis !== "DIRECT_SALE_CUSTOMER" || p.counterparty_id === null) return b("UNSUPPORTED_FINANCIAL_OBLIGOR", "PRECONDITION_FAILED", "only a direct sale to the customer is invoiced");
  if (o === null) return b("RECEIVABLE_NOT_ESTABLISHED", "PRECONDITION_FAILED", "the billing package has no receivable to invoice");
  if (o.status === "VOID") return b("RECEIVABLE_VOID", "PRECONDITION_FAILED", "the package's receivable is void");
  if (o.operating_company_id !== p.operating_company_id || o.currency !== p.currency) return b("RECEIVABLE_PACKAGE_MISMATCH", "CONFLICT", "the receivable does not belong to the package's company and currency");
  if (invoiceNumber !== null) return b("INVOICE_ALREADY_ISSUED", "CONFLICT", `this receivable already has invoice ${invoiceNumber}`);
  return null;
}

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
    // A concurrent twin lost the race on a unique index (the package row lock serializes only the SAME package): a governed answer, never a raw 500.
    const u = err as { code?: string; constraint?: string };
    if (u?.code === "23505" && u.constraint === "invoices_idempotency") refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that idempotency key issued a different invoice");
    if (u?.code === "23505" && (u.constraint === "invoices_one_per_obligation" || u.constraint === "invoices_one_per_package")) refuse("INVOICE_ALREADY_ISSUED", "CONFLICT", "this receivable already has an invoice");
    throw err;
  } finally {
    c.release();
  }
}

export interface IssueInvoiceInput {
  billingPackageId: unknown;
  idempotencyKey: unknown;
  /** YYYY-MM-DD. Omitted: the governed terms decide. Later than the terms (or any date, where no terms exist) needs `dueReason`. */
  dueOn?: unknown;
  dueReason?: unknown;
}

/** The ISSUED invoice as it is answered: the header, and the money summed by the database from the lines (invoice_totals). */
export async function readIssuedInvoiceOn(db: Queryable, tenantId: string, invoiceId: string) {
  const { rows } = await db.query(
    `SELECT i.id, i.operating_company_key, i.invoice_number, i.accounting_reference, i.account_id, i.sales_order_id, i.currency, i.due_date, i.issued_at,
            i.issued_by, i.obligation_id, i.billing_package_id, i.due_basis, i.due_reason, i.tax_provenance, i.voided_at,
            t.line_count, t.subtotal_minor, t.discount_minor, t.tax_minor, t.total_minor, t.shipping_minor, t.install_charge_minor, t.trade_in_minor, t.amount_due_minor,
            o.operating_company_id
       FROM eos_finance.invoices i
       JOIN eos_finance.invoice_totals t ON t.tenant_id = i.tenant_id AND t.invoice_id = i.id
       JOIN eos_finance.obligations o ON o.tenant_id = i.tenant_id AND o.id = i.obligation_id
      WHERE i.tenant_id = $1 AND i.id = $2`, [tenantId, invoiceId]);
  const r = rows[0];
  if (!r) return refuse("INVOICE_NOT_FOUND", "NOT_FOUND", "no invoice with that id");
  return Object.freeze({
    id: String(r.id), invoiceNumber: String(r.invoice_number), accountingReference: r.accounting_reference ?? null,
    operatingCompanyId: String(r.operating_company_id), operatingCompanyKey: String(r.operating_company_key),
    accountId: String(r.account_id), salesOrderId: String(r.sales_order_id), obligationId: String(r.obligation_id), billingPackageId: String(r.billing_package_id),
    currency: String(r.currency), issuedAt: new Date(r.issued_at).toISOString(), dueOn: new Date(r.due_date).toISOString().slice(0, 10),
    dueBasis: String(r.due_basis), dueReason: r.due_reason ?? null, issuedBy: String(r.issued_by), taxProvenance: r.tax_provenance ?? null,
    lineCount: Number(r.line_count), subtotalMinor: String(r.subtotal_minor), customerDiscountMinor: String(r.discount_minor), shippingMinor: String(r.shipping_minor),
    installChargeMinor: String(r.install_charge_minor), taxMinor: String(r.tax_minor), totalMinor: String(r.total_minor), tradeInCreditMinor: String(r.trade_in_minor),
    amountDueMinor: String(r.amount_due_minor),
  });
}

/** The company's business date today (its governed time zone, #203). */
export async function businessToday(db: Queryable, tenantId: string, companyId: string): Promise<string> {
  let day: unknown;
  try {
    const { rows } = await db.query(`SELECT to_char(eos_policy.operating_company_business_date($1, $2, now()), 'YYYY-MM-DD') AS d`, [tenantId, companyId]);
    day = rows[0]?.d;
  } catch (err) {
    // The resolver raises when the company has no governed time zone; that is a governed refusal, never a 500.
    if (/OPERATING_COMPANY_UNRESOLVED/.test((err as { message?: string })?.message ?? "")) day = null;
    else throw err;
  }
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return refuse("BUSINESS_DATE_UNAVAILABLE", "PRECONDITION_FAILED", "the operating company has no governed business time zone, so the issue date and due date cannot be decided");
  }
  return day;
}

/** The farthest a due date may sit beyond the terms date (or beyond the issue date where no terms exist): a TECHNICAL bound, recorded in DECISIONS #F-1a. */
export const INVOICE_DUE_EXTENSION_MAX_DAYS = 365;

export async function issueFinancialInvoice(pool: Pool, actor: FinanceActor, input: IssueInvoiceInput) {
  only(input as unknown as Record<string, unknown>, ["billingPackageId", "idempotencyKey", "dueOn", "dueReason"]);
  const packageId = text(input.billingPackageId, "billingPackageId");
  const key = text(input.idempotencyKey, "idempotencyKey");
  const dueOn = input.dueOn === undefined || input.dueOn === null ? null : isoDate(input.dueOn, "dueOn");
  const dueReason = input.dueReason === undefined || input.dueReason === null ? null : text(input.dueReason, "dueReason", INVOICE_REASON_MAX);
  const fingerprint = createHash("sha256").update(JSON.stringify([packageId, dueOn, dueReason])).digest("hex");

  return tx(pool, async (c) => {
    // The package row is the unit of serialization: one invoice per package, and two concurrent issues take turns.
    const { rows: pk } = await c.query(`SELECT * FROM eos_finance.billing_packages WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, packageId]);
    const p = pk[0] ?? refuse("BILLING_PACKAGE_NOT_FOUND", "NOT_FOUND", "no billing package with that id");

    // REPLAY: the command already applied. Nothing is allocated, written or audited.
    const { rows: prior } = await c.query(
      `SELECT id, request_fingerprint FROM eos_finance.invoices WHERE tenant_id = $1 AND issued_by = $2 AND idempotency_key = $3`, [actor.tenantId, actor.principalId, key]);
    if (prior[0]) {
      if (prior[0].request_fingerprint !== fingerprint) refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "that idempotency key issued a different invoice");
      return Object.freeze({ outcome: "replayed" as const, invoice: await readIssuedInvoiceOn(c, actor.tenantId, String(prior[0].id)) });
    }

    // ── what may be invoiced: ONE predicate (issueBlocker), the same one the receivable read uses to offer or withhold Issue ──
    const { rows: ob } = await c.query(
      `SELECT o.id, o.operating_company_id, o.currency, o.status, b.originated_minor
         FROM eos_finance.obligations o JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
        WHERE o.tenant_id = $1 AND o.source_domain = 'BILLING_PACKAGE' AND o.source_record_id = $2 AND o.kind = 'RECEIVABLE' FOR UPDATE OF o`, [actor.tenantId, packageId]);
    const o = ob[0] ?? null;
    const { rows: had } = o ? await c.query(`SELECT invoice_number FROM eos_finance.invoices WHERE tenant_id = $1 AND obligation_id = $2`, [actor.tenantId, o.id]) : { rows: [] as { invoice_number: string }[] };
    const blocker = issueBlocker(p, o, had[0]?.invoice_number ?? null);
    if (blocker) refuse(blocker.code, blocker.category, blocker.message);
    if (o === null) return refuse("RECEIVABLE_NOT_ESTABLISHED", "PRECONDITION_FAILED", "the billing package has no receivable to invoice"); // unreachable: issueBlocker names it

    // ── the lines and the money, exactly as the package froze them ──
    const { rows: lines } = await c.query(`SELECT * FROM eos_finance.billing_package_lines WHERE tenant_id = $1 AND package_id = $2 ORDER BY line_number`, [actor.tenantId, packageId]);
    if (lines.length === 0 || lines.some((l) => l.unit_price_minor === null)) refuse("PRICE_EVIDENCE_MISSING", "PRECONDITION_FAILED", "a billed line has no price; it cannot be invoiced");
    const subtotal = lines.reduce((s, l) => s + big(l.unit_price_minor) * BigInt(l.billable_qty), 0n);
    const discount = big(p.customer_discount_minor), shipping = big(p.shipping_minor), install = big(p.install_charge_minor), tax = big(p.tax_minor), tradeIn = big(p.trade_in_minor);
    const total = subtotal - discount + shipping + install + tax;
    const amountDue = total - tradeIn;
    if (subtotal !== big(p.subtotal_minor) || total !== big(p.total_minor)) refuse("INVOICE_TOTAL_MISMATCH", "CONFLICT", "the package lines do not add up to the package total");
    if (amountDue !== big(o.originated_minor)) refuse("INVOICE_TOTAL_MISMATCH", "CONFLICT", "the invoice would not equal the amount the receivable originated");

    // ── the due date (OD-F1-8) ──
    const today = await businessToday(c, actor.tenantId, String(p.operating_company_id));
    const { rows: terms } = await c.query(
      `SELECT payment_terms_net_days FROM eos_finance.counterparty_company_profiles WHERE tenant_id = $1 AND counterparty_id = $2 AND operating_company_id = $3 AND status = 'ACTIVE'`,
      [actor.tenantId, p.counterparty_id, p.operating_company_id]);
    const netDays: number | null = terms[0]?.payment_terms_net_days ?? null;
    const fromTerms = netDays === null ? null : addDays(today, Number(netDays));
    let due: string, basis: InvoiceDueBasis, reason: string | null = null;
    if (dueOn === null) {
      if (fromTerms === null) refuse("DUE_DATE_REQUIRED", "INVALID_INPUT", "this customer has no governed payment terms for this company; state the due date and the reason");
      due = fromTerms as string; basis = "TERMS";
    } else {
      if (dueOn < today) refuse("DUE_DATE_IN_PAST", "INVALID_INPUT", "the due date is before the issue date");
      if (fromTerms !== null && dueOn < fromTerms) refuse("DUE_DATE_EARLIER_THAN_TERMS", "INVALID_INPUT", `the customer's terms give ${fromTerms}; a due date may only be later`);
      if (dueOn > addDays(fromTerms ?? today, INVOICE_DUE_EXTENSION_MAX_DAYS)) {
        refuse("DUE_DATE_TOO_FAR", "INVALID_INPUT", `a due date may be at most ${INVOICE_DUE_EXTENSION_MAX_DAYS} days beyond ${fromTerms === null ? "the issue date" : "the customer's terms"}`);
      }
      if (dueOn === fromTerms) { due = dueOn; basis = "TERMS"; }
      else {
        if (dueReason === null) refuse("DUE_REASON_REQUIRED", "INVALID_INPUT", "a due date other than the terms needs a reason");
        due = dueOn; basis = fromTerms === null ? "NO_TERMS_ENTERED" : "TERMS_EXTENDED"; reason = dueReason;
      }
    }

    // ── apply: number, header, lines, the receivable's due date, the audit row ──
    const { rows: clock } = await c.query(`SELECT now() AS t`);
    const issuedAt = new Date(clock[0].t);
    const allocated = await allocateInvoiceNumber(c, actor.tenantId, String(p.operating_company_key), issuedAt);
    const invoiceId = `inv_${randomUUID()}`;
    await c.query(
      `INSERT INTO eos_finance.invoices (id, tenant_id, operating_company_key, invoice_number, account_id, sales_order_id, currency, due_date, issued_at, issued_by,
          tax_provenance, obligation_id, billing_package_id, customer_discount_minor, shipping_minor, install_charge_minor, package_tax_minor, trade_in_minor,
          due_basis, due_reason, idempotency_key, request_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [invoiceId, actor.tenantId, p.operating_company_key, allocated.number, p.commercial_customer_account_id, p.sales_order_id, p.currency, `${due}T00:00:00Z`, issuedAt,
        actor.principalId, "BILLING_PACKAGE_DETERMINED_TAX", o.id, packageId, discount.toString(), shipping.toString(), install.toString(), tax.toString(), tradeIn.toString(),
        basis, reason, key, fingerprint]);
    for (const l of lines) {
      // The package's tax is the Agreement's (order-level); no per-line tax determination exists, so it rides on the invoice header (package_tax_minor).
      await c.query(
        `INSERT INTO eos_finance.invoice_lines (id, tenant_id, invoice_id, sales_order_line_id, line_kind, line_ref, business_unit_id, billable_qty, unit_price_minor, discount_minor, tax_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0)`,
        [`invl_${randomUUID()}`, actor.tenantId, invoiceId, `${p.sales_order_id}:${l.sales_order_line_number}`, l.kind, l.ref, l.business_unit, l.billable_qty, l.unit_price_minor]);
    }
    // The receivable's due date is set ONCE (the database allows NULL -> date only for the date of an invoice that names it): exactly one row must change.
    const dated = await c.query(`UPDATE eos_finance.obligations SET due_on = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND due_on IS NULL`,
      [actor.tenantId, o.id, due, actor.principalId]);
    if (dated.rowCount !== 1) refuse("RECEIVABLE_ALREADY_DATED", "CONFLICT", "the receivable already has a governed due date; it cannot be invoiced");
    const invoice = await readIssuedInvoiceOn(c, actor.tenantId, invoiceId);
    if (BigInt(invoice.amountDueMinor) !== amountDue || invoice.lineCount !== lines.length) refuse("INVOICE_TOTAL_MISMATCH", "CONFLICT", "the stored invoice does not equal the package");
    await recordCommandAudit(c, actor.tenantId, actor.principalId, {
      action: "finance.invoice.issue", targetKind: "invoice", targetId: invoiceId, before: null,
      after: { invoiceNumber: invoice.invoiceNumber, operatingCompanyId: invoice.operatingCompanyId, obligationId: invoice.obligationId, billingPackageId: packageId,
        salesOrderId: invoice.salesOrderId, accountId: invoice.accountId, currency: invoice.currency, lineCount: invoice.lineCount, subtotalMinor: invoice.subtotalMinor,
        customerDiscountMinor: invoice.customerDiscountMinor, shippingMinor: invoice.shippingMinor, installChargeMinor: invoice.installChargeMinor, taxMinor: invoice.taxMinor,
        totalMinor: invoice.totalMinor, tradeInCreditMinor: invoice.tradeInCreditMinor, amountDueMinor: invoice.amountDueMinor, dueOn: invoice.dueOn, dueBasis: basis },
      reason,
    });
    return Object.freeze({ outcome: "issued" as const, invoice });
  });
}
