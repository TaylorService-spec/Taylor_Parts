// EOS Operational Data Plane — the INVOICE repository over the Postgres business authority
// (migrations/1758931200000_invoice-authority.sql).
//
// ════════════════════ WHAT THIS IS, AND WHAT IT IS NOT ════════════════════
//
// This is the repository/transaction boundary for `eos_finance.invoices` + `eos_finance.invoice_lines`,
// in the same shape cycleCountRepository.ts established: it RECEIVES a Pool (it never opens a
// connection and never reads DATABASE_URL), it owns the transaction boundary, and it is not wired
// to any HTTP operation. Nothing deployed calls it yet, and no data has moved — the Firestore
// `invoices` collection remains the live authority until a cutover this packet does not perform.
//
// It is NOT a second invoice command core. The issuance RULES — the Sales Order cross-check, the
// billing-eligibility gate, the BILL_NOW policy decision, the per-company number allocation — stay
// where they are (functions/src/finance/invoiceCommands.ts, invoiceCallables.ts, invoiceNumbering.ts).
// What moves here is PERSISTENCE and the money arithmetic's enforcement, because that is what
// Postgres can hold and Firestore could not.
//
// ════════════════════ THE ARITHMETIC IS NOT THIS MODULE'S TO RESTATE ════════════════════
//
// `insertIssuedInvoice` supplies only the line INPUTS — quantity, unit price, discount, tax. It
// does not compute or send subtotal, taxable base or line total: those are GENERATED ALWAYS
// columns, and Postgres rejects an INSERT that supplies one. `readInvoiceTotals` reads the
// `invoice_totals` VIEW rather than any stored header field, because the header has no totals to
// read. The single shared derivation (invoiceTotals.ts) is used only to VALIDATE inputs before
// they are sent, so a caller gets the command core's own refusal (TAX_REQUIRES_REVIEW, UNPRICED,
// discount-exceeds-subtotal) instead of an opaque constraint violation.
//
// ════════════════════ OPERATING COMPANY ════════════════════
//
// `operatingCompanyKey` is required and never inferred — `requireOperatingCompanyKey` is the ONE
// shape check (operatingCompanyCustody.ts), reused rather than rewritten. It is never derived from
// a warehouse, a truck, an employee or a homeWarehouseId. For a Sales-Order-derived invoice the
// governed value is the ORDER's `operatingCompanyId`, which invoiceCommands.ts's
// `verifySalesOrderMatch` already refuses to let a caller override.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { type OperatingCompanyKey, requireOperatingCompanyKey } from "./operatingCompanyCustody.js";
import {
  deriveInvoiceLineAmounts,
  sumInvoiceLineAmounts,
  type InvoiceLineAmounts,
  type InvoiceTotals,
} from "./invoiceTotals.js";

// OWNER RULING (W1 integration): Invoice and Payment are one financial bounded context and
// neither belongs in eos_ops. Migration 1758931200000 establishes `eos_finance` and the Invoice
// authority in it; 1759017600000 extends the same schema with receipts and applications.
const SCHEMA = "eos_finance";
const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;

export class InvoiceAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "InvoiceAuthorityError";
  }
}

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvoiceAuthorityError("REQUIRED", `${field} is required`);
  }
  return value;
};

/** One billed line, as a caller supplies it. The derived amounts are deliberately absent. */
export interface InvoiceLineInput {
  readonly salesOrderLineId: string;
  readonly kind: string;
  readonly ref: string;
  /** FIN-002 reporting attribution from the governed Sales Order line; null is an honest absence. */
  readonly businessUnitId?: string | null;
  readonly billableQty: number;
  readonly unitPriceMinor: number;
  readonly discountMinor?: number;
  readonly taxMinor: number;
}

export interface IssuedInvoiceInput {
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly invoiceNumber: string;
  readonly accountId: string;
  readonly salesOrderId: string;
  readonly currency: string;
  /** AR aging begins here. Carried, never computed. */
  readonly dueDate: Date;
  readonly issuedBy: string;
  readonly taxProvenance?: string | null;
  readonly lines: readonly InvoiceLineInput[];
}

export interface IssuedInvoiceResult {
  readonly invoiceId: string;
  readonly lineIds: readonly string[];
  /** Read back from `invoice_totals` — the database's own sum, not the caller's. */
  readonly totals: InvoiceTotals;
}

/**
 * Persist one issued invoice and its lines in ONE transaction.
 *
 * AN INVOICE WITH NO LINES IS REFUSED HERE because SQL cannot refuse it: the "at least one line"
 * rule (invoiceCommands.ts's NO_LINES) spans two tables, so no CHECK can hold it. Migration 008's
 * header says so rather than claiming an enforcement it does not have, and this is the enforcement.
 *
 * Header and lines commit together or not at all. A header without its lines would read as a
 * zero-total invoice through `invoice_totals`, which is exactly the silent wrong number this whole
 * design exists to make impossible.
 */
export async function insertIssuedInvoice(pool: Pool, input: IssuedInvoiceInput): Promise<IssuedInvoiceResult> {
  const tenantId = requireText(input?.tenantId, "tenantId");
  const operatingCompanyKey = requireOperatingCompanyKey(input?.operatingCompanyKey);
  const invoiceNumber = requireText(input?.invoiceNumber, "invoiceNumber");
  const accountId = requireText(input?.accountId, "accountId");
  const salesOrderId = requireText(input?.salesOrderId, "salesOrderId");
  const currency = requireText(input?.currency, "currency");
  const issuedBy = requireText(input?.issuedBy, "issuedBy");
  if (!(input?.dueDate instanceof Date) || Number.isNaN(input.dueDate.getTime())) {
    throw new InvoiceAuthorityError("DUE_DATE_INVALID", "dueDate is required — AR aging begins there");
  }
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  if (lines.length === 0) throw new InvoiceAuthorityError("NO_LINES", "an invoice must have at least one line");

  // Validate every line through the ONE shared derivation before opening a transaction, so a
  // caller sees the command core's refusal rather than a constraint name. The derived values are
  // deliberately discarded — the database generates them.
  lines.forEach((line, i) => {
    requireText(line?.salesOrderLineId, `line ${i} salesOrderLineId`);
    requireText(line?.kind, `line ${i} kind`);
    requireText(line?.ref, `line ${i} ref`);
    deriveInvoiceLineAmounts(line, `line ${i}`);
  });

  const invoiceId = newId("inv");
  const lineIds = lines.map(() => newId("invl"));
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ${SCHEMA}.invoices
         (id, tenant_id, operating_company_key, invoice_number, account_id, sales_order_id,
          currency, due_date, issued_by, tax_provenance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [invoiceId, tenantId, operatingCompanyKey, invoiceNumber, accountId, salesOrderId,
       currency, input.dueDate, issuedBy, input.taxProvenance ?? null],
    );
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // NOTE the columns that are absent: subtotal_minor, taxable_base_minor and line_total_minor
      // are GENERATED ALWAYS. Adding them here would not merely be redundant — Postgres would
      // refuse the statement, which is the guarantee.
      await client.query(
        `INSERT INTO ${SCHEMA}.invoice_lines
           (id, tenant_id, invoice_id, sales_order_line_id, line_kind, line_ref, business_unit_id,
            billable_qty, unit_price_minor, discount_minor, tax_minor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [lineIds[i], tenantId, invoiceId, l.salesOrderLineId, l.kind, l.ref, l.businessUnitId ?? null,
         l.billableQty, l.unitPriceMinor, l.discountMinor ?? 0, l.taxMinor],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const totals = await readInvoiceTotals(pool, { tenantId, invoiceId });
  if (!totals) throw new InvoiceAuthorityError("NOT_FOUND", `invoice ${invoiceId} vanished after commit`);
  return { invoiceId, lineIds, totals: totals.totals };
}

export interface InvoiceTotalsRow {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly operatingCompanyKey: OperatingCompanyKey;
  readonly accountId: string;
  readonly salesOrderId: string;
  readonly currency: string;
  readonly dueDate: Date;
  readonly isVoid: boolean;
  readonly totals: InvoiceTotals;
}

// The view returns BIGINT, which node-postgres delivers as a STRING to avoid silently truncating
// values beyond Number.MAX_SAFE_INTEGER. Converting blindly with Number() would reintroduce
// exactly the precision loss the BIGINT choice avoids, so a value that cannot survive the trip is
// refused rather than rounded.
const bigintToSafeInt = (value: unknown, field: string): number => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new InvoiceAuthorityError("AMOUNT_UNREPRESENTABLE", `${field} is not a safe integer`);
    return value;
  }
  if (typeof value !== "string") throw new InvoiceAuthorityError("AMOUNT_UNREPRESENTABLE", `${field} is missing`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== value) {
    throw new InvoiceAuthorityError("AMOUNT_UNREPRESENTABLE", `${field} "${value}" exceeds exact JavaScript integer range`);
  }
  return parsed;
};

const toTotalsRow = (row: Record<string, unknown>): InvoiceTotalsRow => ({
  invoiceId: row.invoice_id as string,
  tenantId: row.tenant_id as string,
  operatingCompanyKey: row.operating_company_key as string,
  accountId: row.account_id as string,
  salesOrderId: row.sales_order_id as string,
  currency: row.currency as string,
  dueDate: row.due_date as Date,
  isVoid: row.is_void === true,
  totals: {
    lineCount: bigintToSafeInt(row.line_count, "line_count"),
    subtotalMinor: bigintToSafeInt(row.subtotal_minor, "subtotal_minor"),
    discountMinor: bigintToSafeInt(row.discount_minor, "discount_minor"),
    taxableBaseMinor: bigintToSafeInt(row.taxable_base_minor, "taxable_base_minor"),
    taxMinor: bigintToSafeInt(row.tax_minor, "tax_minor"),
    totalMinor: bigintToSafeInt(row.total_minor, "total_minor"),
  },
});

/** One invoice's money, summed from its lines by the database. Null when there is no such invoice. */
export async function readInvoiceTotals(
  pool: Pool,
  scope: { tenantId: string; invoiceId: string },
): Promise<InvoiceTotalsRow | null> {
  const tenantId = requireText(scope?.tenantId, "tenantId");
  const invoiceId = requireText(scope?.invoiceId, "invoiceId");
  const { rows } = await pool.query(
    `SELECT * FROM ${SCHEMA}.invoice_totals WHERE tenant_id = $1 AND invoice_id = $2`,
    [tenantId, invoiceId],
  );
  return rows.length === 0 ? null : toTotalsRow(rows[0]);
}

/**
 * An account's invoices, newest first — the ONE scope the deployed read path actually uses
 * (financeReadCallables.ts's listAccountInvoiceAr is `.where("accountId", "==", accountId)`).
 *
 * The AR overlay is deliberately absent: outstanding, applied and payment state are derived from
 * payment application facts, which belong to the Payment lane. This returns what is BILLED.
 */
export async function readAccountInvoiceTotals(
  pool: Pool,
  scope: { tenantId: string; accountId: string; limit?: number },
): Promise<InvoiceTotalsRow[]> {
  const tenantId = requireText(scope?.tenantId, "tenantId");
  const accountId = requireText(scope?.accountId, "accountId");
  const limit = Number.isSafeInteger(scope?.limit) && (scope.limit as number) > 0 ? (scope.limit as number) : 100;
  const { rows } = await pool.query(
    `SELECT t.* FROM ${SCHEMA}.invoice_totals t
      WHERE t.tenant_id = $1 AND t.account_id = $2
      ORDER BY t.due_date DESC, t.invoice_id
      LIMIT $3`,
    [tenantId, accountId, limit],
  );
  return rows.map(toTotalsRow);
}

/** One invoice's stored line amounts, as the database generated them. */
export async function readInvoiceLineAmounts(
  pool: Pool,
  scope: { tenantId: string; invoiceId: string },
): Promise<InvoiceLineAmounts[]> {
  const tenantId = requireText(scope?.tenantId, "tenantId");
  const invoiceId = requireText(scope?.invoiceId, "invoiceId");
  const { rows } = await pool.query(
    `SELECT subtotal_minor, discount_minor, taxable_base_minor, tax_minor, line_total_minor
       FROM ${SCHEMA}.invoice_lines
      WHERE tenant_id = $1 AND invoice_id = $2
      ORDER BY id`,
    [tenantId, invoiceId],
  );
  return rows.map((r: Record<string, unknown>) => ({
    subtotalMinor: bigintToSafeInt(r.subtotal_minor, "subtotal_minor"),
    discountMinor: bigintToSafeInt(r.discount_minor, "discount_minor"),
    taxableBaseMinor: bigintToSafeInt(r.taxable_base_minor, "taxable_base_minor"),
    taxMinor: bigintToSafeInt(r.tax_minor, "tax_minor"),
    lineTotalMinor: bigintToSafeInt(r.line_total_minor, "line_total_minor"),
  }));
}

/**
 * THE MIGRATION RECONCILIATION PROOF.
 *
 * Given a Firestore invoice's stored header aggregate and its own embedded lines, and the same
 * invoice's rows in the Postgres authority, answer whether the two agree — and, separately,
 * whether the Firestore header ever agreed with its OWN lines in the first place.
 *
 * Those are different questions and the distinction is the whole point. A migration that only
 * compared header-to-header would carry a header that was already wrong straight across and
 * report success. `sourceInternallyConsistent` is false exactly when the source record's stored
 * total disagrees with the lines it was computed from — the defect class this lane was sent to
 * look for.
 */
export interface InvoiceMigrationReconciliation {
  readonly invoiceId: string;
  readonly sourceInternallyConsistent: boolean;
  readonly targetMatchesSourceLines: boolean;
  readonly status: "IN_SYNC" | "DRIFT";
  readonly differences: ReadonlyArray<{ field: string; sourceValue: number | null; targetValue: number }>;
}

export function reconcileMigratedInvoice(input: {
  invoiceId: string;
  sourceStoredTotals: { subtotalMinor?: number; discountMinor?: number; taxMinor?: number; totalMinor?: number };
  sourceLineAmounts: readonly InvoiceLineAmounts[];
  targetTotals: InvoiceTotals;
}): InvoiceMigrationReconciliation {
  const invoiceId = requireText(input?.invoiceId, "invoiceId");
  const fromSourceLines = sumInvoiceLineAmounts(input?.sourceLineAmounts ?? []);
  const target = input?.targetTotals;
  if (!target) throw new InvoiceAuthorityError("REQUIRED", "targetTotals is required");

  const stored = input?.sourceStoredTotals ?? {};
  const sourceInternallyConsistent =
    stored.subtotalMinor === fromSourceLines.subtotalMinor &&
    stored.discountMinor === fromSourceLines.discountMinor &&
    stored.taxMinor === fromSourceLines.taxMinor &&
    stored.totalMinor === fromSourceLines.totalMinor;

  // The comparison that matters is source LINES against target lines: the lines are the durable
  // facts, and the target has no header aggregate to compare a header to.
  const differences: Array<{ field: string; sourceValue: number | null; targetValue: number }> = [];
  const fields = ["lineCount", "subtotalMinor", "discountMinor", "taxableBaseMinor", "taxMinor", "totalMinor"] as const;
  for (const field of fields) {
    const sourceValue = fromSourceLines[field];
    const targetValue = target[field];
    if (typeof targetValue !== "number" || sourceValue !== targetValue) {
      differences.push({ field, sourceValue: typeof sourceValue === "number" ? sourceValue : null, targetValue });
    }
  }
  return {
    invoiceId,
    sourceInternallyConsistent,
    targetMatchesSourceLines: differences.length === 0,
    status: differences.length === 0 ? "IN_SYNC" : "DRIFT",
    differences,
  };
}
