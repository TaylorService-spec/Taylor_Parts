// EOS Operational Data Plane — the ONE definition of what an invoice's money is.
//
// ════════════════════ WHY THIS IS ITS OWN MODULE, AND WHY IT LIVES HERE ════════════════════
//
// Three layers need the same arithmetic and, until this module, two of them did it separately and
// the third did not do it at all:
//
//   1. ISSUANCE. functions/src/finance/invoiceCommands.ts's `buildInvoiceRecord` computed the four
//      header aggregates with four inline `out.reduce(...)` calls, then persisted them beside the
//      lines on the Firestore document.
//   2. RECONCILIATION. functions/src/finance/financialReconciliation.ts's
//      `reconcileInvoiceProjection` took `stored.totalMinor` as its GIVEN basis and proved only the
//      AR overlay on top of it — so the header aggregate every downstream AR figure is computed
//      from had no proof against the lines it claims to summarise.
//   3. THE POSTGRES AUTHORITY. migrations/1758931200000_invoice-authority.sql expresses the same
//      arithmetic as GENERATED ALWAYS columns plus the `invoice_totals` view, where no writer can
//      supply a wrong answer.
//
// All three now derive from THIS function. That is the point: an aggregate with one definition can
// still be stale, but it can no longer be a DIFFERENT answer depending on who asked.
//
// ════════════════════ EXACT INTEGER MINOR UNITS, NEVER FLOAT ════════════════════
//
// Every amount is a safe integer in minor units and every operation is integer addition or
// multiplication. There is no rounding step anywhere, because there is no fractional value to
// round: a non-integer input is a defect and is refused, not coerced. This is the same discipline
// invoiceCommands.ts's isInt/isPosInt/isNonNegInt already enforce, factored out so the Postgres
// layer and the reconciler cannot acquire a softer version of it.
//
// NO FIREBASE, NO I/O, NO IMPORTS. This module is pure so that both the transitional Firestore
// command core and the eos_ops Postgres repository can share it without either dragging the
// other's dependencies along.

export class InvoiceTotalsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InvoiceTotalsError";
    this.code = code;
  }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/**
 * The money inputs of one billed line — the values a writer actually supplies.
 *
 * Deliberately NOT the full InvoiceLineRecord: the derived per-line amounts (subtotal, taxable
 * base, line total) are this module's OUTPUT, and accepting them as input is how a caller's wrong
 * arithmetic gets believed.
 */
export interface InvoiceLineAmountInput {
  billableQty: number;
  unitPriceMinor: number;
  /** Absent means zero — the stated meaning of absence, matching the command core. */
  discountMinor?: number;
  /** The INJECTED tax determination. Absent is NOT zero: it is a refusal (see below). */
  taxMinor?: number;
}

/** The derived amounts for one line. Every field here is computed, never supplied. */
export interface InvoiceLineAmounts {
  subtotalMinor: number;
  discountMinor: number;
  taxableBaseMinor: number;
  taxMinor: number;
  lineTotalMinor: number;
}

/**
 * Derive one line's amounts.
 *
 * TAX ABSENCE IS A REFUSAL, NOT A ZERO. `buildInvoiceRecord` raises TAX_REQUIRES_REVIEW for a line
 * with no determination, and migration 008 gives `invoice_lines.tax_minor` NOT NULL with no
 * DEFAULT for the same reason: "nobody decided" and "the answer is zero" are different facts, and
 * a layer that silently converts the first into the second is manufacturing a tax determination.
 */
export function deriveInvoiceLineAmounts(line: InvoiceLineAmountInput, at = "line"): InvoiceLineAmounts {
  if (!line || typeof line !== "object") throw new InvoiceTotalsError("LINE_INVALID", `${at}: a line is required`);
  if (!isInt(line.billableQty) || line.billableQty <= 0) {
    throw new InvoiceTotalsError("LINE_INVALID", `${at}: billableQty must be a positive integer`);
  }
  if (!isInt(line.unitPriceMinor) || line.unitPriceMinor < 0) {
    throw new InvoiceTotalsError("UNPRICED", `${at}: unitPriceMinor must be a non-negative integer`);
  }
  const discountMinor = line.discountMinor === undefined ? 0 : line.discountMinor;
  if (!isInt(discountMinor) || discountMinor < 0) {
    throw new InvoiceTotalsError("LINE_INVALID", `${at}: discountMinor must be a non-negative integer`);
  }
  if (!isInt(line.taxMinor) || (line.taxMinor as number) < 0) {
    throw new InvoiceTotalsError("TAX_REQUIRES_REVIEW", `${at}: has no tax determination`);
  }
  const taxMinor = line.taxMinor as number;
  const subtotalMinor = line.unitPriceMinor * line.billableQty;
  const taxableBaseMinor = subtotalMinor - discountMinor;
  if (taxableBaseMinor < 0) throw new InvoiceTotalsError("LINE_INVALID", `${at}: discount exceeds subtotal`);
  return {
    subtotalMinor,
    discountMinor,
    taxableBaseMinor,
    taxMinor,
    lineTotalMinor: taxableBaseMinor + taxMinor,
  };
}

/** The four aggregates an invoice header has historically stored, plus the taxable base. */
export interface InvoiceTotals {
  lineCount: number;
  subtotalMinor: number;
  discountMinor: number;
  taxableBaseMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Sum already-derived line amounts. Separate from `deriveInvoiceTotals` because a reader of the
 * Postgres authority has lines whose amounts were generated BY the database and must be summed
 * exactly as stored, not re-derived from inputs it did not read.
 */
export function sumInvoiceLineAmounts(lines: readonly InvoiceLineAmounts[]): InvoiceTotals {
  const rows = Array.isArray(lines) ? lines : [];
  const totals: InvoiceTotals = {
    lineCount: rows.length,
    subtotalMinor: 0,
    discountMinor: 0,
    taxableBaseMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
  };
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i];
    for (const key of ["subtotalMinor", "discountMinor", "taxableBaseMinor", "taxMinor", "lineTotalMinor"] as const) {
      if (!isInt(l?.[key])) {
        throw new InvoiceTotalsError("LINE_INVALID", `line ${i}: ${key} must be a safe integer to be summed`);
      }
    }
    totals.subtotalMinor += l.subtotalMinor;
    totals.discountMinor += l.discountMinor;
    totals.taxableBaseMinor += l.taxableBaseMinor;
    totals.taxMinor += l.taxMinor;
    totals.totalMinor += l.lineTotalMinor;
  }
  return totals;
}

/** Derive every line, then sum. The whole invoice's money, from its inputs, in one call. */
export function deriveInvoiceTotals(lines: readonly InvoiceLineAmountInput[]): InvoiceTotals {
  const rows = Array.isArray(lines) ? lines : [];
  return sumInvoiceLineAmounts(rows.map((l, i) => deriveInvoiceLineAmounts(l, `line ${i}`)));
}

/** A header aggregate as it is actually stored, for comparison against the lines. */
export interface StoredInvoiceTotals {
  subtotalMinor?: number;
  discountMinor?: number;
  taxMinor?: number;
  totalMinor?: number;
}

export interface TotalsDifference {
  field: string;
  storedValue: number | null;
  derivedValue: number;
}

export interface InvoiceTotalsReconciliation {
  status: "IN_SYNC" | "DRIFT";
  derived: InvoiceTotals;
  differences: TotalsDifference[];
}

/**
 * Compare a STORED invoice header aggregate against the lines it claims to summarise.
 *
 * This is the proof that did not exist. `reconcileInvoiceProjection` reconciles the AR overlay
 * (applied / credits / charges / write-offs / outstanding / state) and treats `stored.totalMinor`
 * as true; nothing reconciled the total itself. An invoice whose header says one number and whose
 * lines say another is invisible to every existing check, and every AR figure downstream —
 * billed, outstanding, aging — is computed from the header's number.
 *
 * An absent stored field is reported as a difference with storedValue null rather than silently
 * coerced to 0: an invoice missing its total is not an invoice whose total is zero.
 */
export function reconcileInvoiceTotalsAgainstLines(
  stored: StoredInvoiceTotals,
  lines: readonly InvoiceLineAmounts[],
): InvoiceTotalsReconciliation {
  const derived = sumInvoiceLineAmounts(lines);
  const differences: TotalsDifference[] = [];
  const pairs: ReadonlyArray<readonly [string, unknown, number]> = [
    ["subtotalMinor", stored?.subtotalMinor, derived.subtotalMinor],
    ["discountMinor", stored?.discountMinor, derived.discountMinor],
    ["taxMinor", stored?.taxMinor, derived.taxMinor],
    ["totalMinor", stored?.totalMinor, derived.totalMinor],
  ];
  for (const [field, storedValue, derivedValue] of pairs) {
    if (!isInt(storedValue)) {
      differences.push({ field, storedValue: null, derivedValue });
      continue;
    }
    if (storedValue !== derivedValue) differences.push({ field, storedValue, derivedValue });
  }
  return { status: differences.length === 0 ? "IN_SYNC" : "DRIFT", derived, differences };
}
