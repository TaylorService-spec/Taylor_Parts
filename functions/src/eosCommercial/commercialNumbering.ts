// PostgreSQL-native Commercial business numbering -- wave C1.
//
// One counter row per (tenant, series, UTC year) in `eos_commercial.number_counters` (migration 022). A number is
// allocated by ONE statement -- INSERT ... ON CONFLICT DO UPDATE ... RETURNING -- on the CALLER's transaction:
//
//   * the conflicting row is locked until that transaction ends, so concurrent allocators for the same
//     tenant/series/year serialize and can never return the same value;
//   * a transaction that rolls back takes its increment with it, so an aborted create consumes no committed number;
//   * there is no SELECT MAX, no process-local counter and no Firestore counter.
//
// Visible formats are exactly the ones the Firestore allocators produce today (opportunityNumbering.ts,
// salesAgreementNumbering.ts, salesOrderNumbering.ts): `<PREFIX>-<UTC YYYY>-<sequence zero-padded to six digits>`,
// with no ceiling -- a seventh digit simply appears, as it does today. Scope differs by design: those counters are
// global per year; these are per TENANT per year, matching PostgreSQL's UNIQUE (tenant_id, <number>).
//
// NOT WIRED. No command, callable or Render operation imports this module in C1; the governed command layer (C2)
// calls it inside its create transaction.
import type { PoolClient } from "pg";

export const COMMERCIAL_NUMBER_SERIES = Object.freeze(["OPPORTUNITY", "SALES_AGREEMENT", "SALES_ORDER"] as const);
export type CommercialNumberSeries = (typeof COMMERCIAL_NUMBER_SERIES)[number];

const PREFIX: Readonly<Record<CommercialNumberSeries, string>> = Object.freeze({
  OPPORTUNITY: "OPP",
  SALES_AGREEMENT: "SA",
  SALES_ORDER: "SO",
});

export class CommercialNumberingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommercialNumberingError";
  }
}

/** The UTC calendar year a number belongs to. */
export function commercialNumberYear(at: Date): number {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new CommercialNumberingError("a valid allocation instant is required");
  return at.getUTCFullYear();
}

/** `<PREFIX>-<YYYY>-<######>`, identical to the current Firestore formatters. */
export function formatCommercialNumber(series: CommercialNumberSeries, year: number, sequence: number): string {
  const prefix = PREFIX[series];
  if (!prefix) throw new CommercialNumberingError(`unknown commercial number series ${String(series)}`);
  if (!Number.isInteger(year) || !Number.isInteger(sequence) || sequence < 1) {
    throw new CommercialNumberingError("year and sequence must be integers and the sequence must be positive");
  }
  return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
}

export interface AllocatedCommercialNumber {
  readonly series: CommercialNumberSeries;
  readonly year: number;
  readonly sequence: number;
  readonly number: string;
}

/**
 * Allocate the next number for (tenant, series, UTC year of `at`) on the caller's OPEN transaction.
 * The caller must hold a transaction: outside one, the increment would commit on its own.
 */
export async function allocateCommercialNumber(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  series: CommercialNumberSeries,
  at: Date,
): Promise<AllocatedCommercialNumber> {
  if (typeof tenantId !== "string" || tenantId.trim() === "") throw new CommercialNumberingError("tenantId is required");
  if (!COMMERCIAL_NUMBER_SERIES.includes(series)) throw new CommercialNumberingError(`unknown commercial number series ${String(series)}`);
  const year = commercialNumberYear(at);
  const result = await db.query<{ last_value: string }>(
    `INSERT INTO eos_commercial.number_counters (tenant_id, series, year, last_value)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (tenant_id, series, year)
     DO UPDATE SET last_value = eos_commercial.number_counters.last_value + 1, updated_at = now()
     RETURNING last_value`,
    [tenantId, series, year],
  );
  const sequence = Number(result.rows[0].last_value);
  return { series, year, sequence, number: formatCommercialNumber(series, year, sequence) };
}
