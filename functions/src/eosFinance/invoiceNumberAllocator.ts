// THE POSTGRESQL INVOICE NUMBER ALLOCATOR -- INV-YYYY-###### (Owner ruling 4, 2026-10-17; WIRED by F-1a, 2026-10-20).
//
// WIRED ONCE: the EOS issuing command (invoiceIssue.ts, `issueInvoice`) calls it in its own transaction, and the counter table it writes
// is created by migration 1764700000000. Nothing here SEEDS the series (Owner safeguard C): a fresh (tenant, company, year) starts at 000001;
// the counter is plain data, so a historical series could be seeded later, only on separate Owner approval and reconciliation. Firebase
// invoices keep their `INV-######` format (finance/invoiceNumbering.ts), unchanged.
//
// ════════════════════ THE POLICY (stated precisely, before any activation) ════════════════════
//
//   FORMAT       `INV-<YYYY>-<sequence>`, the sequence zero-padded to SIX digits MINIMUM (a seventh digit appears rather
//                than wrapping or colliding). Server-allocated only: no caller supplies a number.
//   YEAR         the UTC calendar year of the ISSUANCE instant (the family rule, DECISIONS #106 / #207 section 1).
//   UNIQUENESS   per (tenant, operating-company KEY, year) -- option B of the invoice-numbering proposal. Each operating
//                company has its own gap-free yearly sequence, so Taylor and Ventana can each hold INV-2026-000001. This
//                matches the existing `invoice_number_unique_per_company UNIQUE (tenant_id, operating_company_key,
//                invoice_number)` on eos_finance.invoices, which is the independent structural proof.
//   COUNTER      one row per (tenant_id, operating_company_key, year) in eos_finance.invoice_number_counters, advanced by
//                ONE statement -- INSERT ... ON CONFLICT DO UPDATE ... RETURNING -- on the ISSUING transaction:
//                  * concurrent issues for the same company and year serialize on the row lock and can never return
//                    the same value;
//                  * a rolled-back issuance takes its increment with it (no committed number is skipped by an abort);
//                  * there is no SELECT max, no process-local counter, no Firestore counter.
//   NEVER REUSED a voided invoice keeps its number; nothing decrements the counter.
//   LEGACY       issued `INV-######` numbers (no year segment) are carried verbatim and cannot collide with the yearly
//                form. parseInvoiceNumber reads both; the allocator only ever produces the yearly form.
//   KEYED        the counter is keyed by operating_company_KEY, as invoices are. A company with no ACTIVE key binding
//                (Ventana in nonprod today) cannot issue at all -- the issuance command resolves the key first.
import type { PoolClient } from "pg";

/** The allocator's format, and the CHECK a future migration adds for NEW rows. */
export const INVOICE_NUMBER_PATTERN = /^INV-[0-9]{4}-[0-9]{6,}$/;
/** The legacy Firebase format (finance/invoiceNumbering.ts): no year segment. Read, never produced. */
export const LEGACY_INVOICE_NUMBER_PATTERN = /^INV-[0-9]{6,}$/;

/**
 * The counter table, exactly as the activation migration must create it (kept here so the allocator and its tests are
 * written against the one definition, and so the migration can be checked against it).
 */
export const INVOICE_NUMBER_COUNTERS_DDL = `CREATE TABLE eos_finance.invoice_number_counters (
    tenant_id             TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    operating_company_key TEXT        NOT NULL,
    year                  INTEGER     NOT NULL,
    last_value            BIGINT      NOT NULL,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, operating_company_key, year),
    CONSTRAINT invoice_number_counter_key_present CHECK (length(btrim(operating_company_key)) > 0),
    CONSTRAINT invoice_number_counter_year_range  CHECK (year BETWEEN 1970 AND 9999),
    CONSTRAINT invoice_number_counter_positive    CHECK (last_value >= 1)
)`;

export class InvoiceNumberError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "InvoiceNumberError";
  }
}

/** The UTC calendar year an invoice issued at `at` is numbered in. */
export function invoiceNumberYear(at: Date): number {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new InvoiceNumberError("ISSUED_AT_INVALID", "a valid issuance instant is required");
  return at.getUTCFullYear();
}

/** `INV-<YYYY>-<######>`. Six digits minimum, no ceiling. */
export function formatInvoiceNumber(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) throw new InvoiceNumberError("YEAR_INVALID", "an invoice number carries a four-digit UTC year");
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new InvoiceNumberError("SEQUENCE_INVALID", "an invoice sequence starts at 1");
  return `INV-${year}-${String(sequence).padStart(6, "0")}`;
}

export type ParsedInvoiceNumber =
  | { readonly format: "YEARLY"; readonly year: number; readonly sequence: number }
  | { readonly format: "LEGACY"; readonly sequence: number };

/** Read an invoice number in either the yearly or the legacy form; anything else is null (never guessed at). */
export function parseInvoiceNumber(value: unknown): ParsedInvoiceNumber | null {
  if (typeof value !== "string") return null;
  if (INVOICE_NUMBER_PATTERN.test(value)) {
    const [, y, s] = value.split("-");
    return Object.freeze({ format: "YEARLY" as const, year: Number(y), sequence: Number(s) });
  }
  if (LEGACY_INVOICE_NUMBER_PATTERN.test(value)) return Object.freeze({ format: "LEGACY" as const, sequence: Number(value.slice(4)) });
  return null;
}

export interface AllocatedInvoiceNumber {
  readonly operatingCompanyKey: string;
  readonly year: number;
  readonly sequence: number;
  readonly number: string;
}

/**
 * Allocate the next invoice number for (tenant, operating-company key, UTC year of `issuedAt`) on the caller's OPEN
 * transaction. Outside a transaction the increment would commit on its own, so the issuance command must call this
 * inside the same transaction that inserts the invoice -- and only on the apply path (a replay returns the invoice that
 * already exists and must not allocate).
 */
export async function allocateInvoiceNumber(
  client: Pick<PoolClient, "query">,
  tenantId: string,
  operatingCompanyKey: string,
  issuedAt: Date,
): Promise<AllocatedInvoiceNumber> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") throw new InvoiceNumberError("TENANT_REQUIRED", "tenantId is required");
  if (typeof operatingCompanyKey !== "string" || operatingCompanyKey.trim() === "") {
    throw new InvoiceNumberError("OPERATING_COMPANY_KEY_REQUIRED", "an invoice is numbered within its operating company's key");
  }
  const year = invoiceNumberYear(issuedAt);
  const { rows } = await client.query<{ last_value: string }>(
    `INSERT INTO eos_finance.invoice_number_counters (tenant_id, operating_company_key, year, last_value)
          VALUES ($1, $2, $3, 1)
     ON CONFLICT (tenant_id, operating_company_key, year)
     DO UPDATE SET last_value = eos_finance.invoice_number_counters.last_value + 1, updated_at = now()
       RETURNING last_value`,
    [tenantId, operatingCompanyKey, year],
  );
  const sequence = Number(rows[0].last_value);
  return Object.freeze({ operatingCompanyKey, year, sequence, number: formatInvoiceNumber(year, sequence) });
}
