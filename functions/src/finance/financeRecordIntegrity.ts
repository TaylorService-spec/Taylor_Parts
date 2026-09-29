// Finance — STRUCTURAL INTEGRITY of stored finance records, and the pre-activation CENSUS over them.
//
// ════════════════════ WHY (Controller ruling DQ-019, 2026-09-28) ════════════════════
//
// "Authoritative finance/ledger results must FAIL CLOSED on malformed rows (no silent skip), and a
// pre-activation census must detect malformed legacy rows; ambiguous data is never repaired."
//
// The finance reads used to coerce any unreadable amount to ZERO (`nn(v) = safe non-negative
// integer ? v : 0`). That is the silent-skip defect in money form, and it is not conservative in
// either direction:
//   · a malformed `appliedMinor` ("5000", -1, 12.5, null) read as 0 INFLATES outstanding — the
//     customer is shown owing money they paid;
//   · a malformed `totalMinor` read as 0 makes a real invoice vanish from Billed and from A/R.
// A figure computed over a row the system cannot read is not a figure. The reads now refuse.
//
// ════════════════════ WHAT COUNTS AS MALFORMED ════════════════════
//
// Only what the GOVERNED WRITERS make unambiguous — this module encodes their shapes, it does not
// invent a stricter schema:
//   · REQUIRED money (written by every writer at creation): must be a safe non-negative integer in
//     minor units. Absent is malformed.
//   · OPTIONAL money (written only once a later command touches it — the adjustment counters, and
//     an invoice's running `appliedMinor`): ABSENT is the writers' own zero and is valid; PRESENT
//     but not a safe non-negative integer (string, negative, fractional, NaN, null) is malformed.
//   · REQUIRED identity (currency; an application's invoiceId/paymentId): must be a non-empty
//     string. An amount with no currency cannot be placed in any per-currency figure.
//
// It REPAIRS NOTHING and INFERS NOTHING. It names the record id and the defective FIELD NAMES only
// — never a value — so its output is safe to log, audit and hand to an Owner as census evidence.
//
// Pure: no Firestore, no clock, no I/O. The reads (financialReportingRead.ts, financeReadCallables.ts)
// and the census (below, and scripts/financeRecordCensusCli.js over an exported snapshot) share it,
// so "malformed" means the same thing at runtime and at activation.

export type FinanceRecordKind = "INVOICE" | "PAYMENT_RECEIPT" | "PAYMENT_APPLICATION";

const isMinor = (v: unknown): boolean => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isText = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

interface Shape {
  requiredMoney: readonly string[];
  optionalMoney: readonly string[];
  requiredText: readonly string[];
}

/** The governed writers' shapes (invoiceCommands / paymentCommands / adjustment+refund commands). */
export const FINANCE_RECORD_SHAPES: Readonly<Record<FinanceRecordKind, Shape>> = Object.freeze({
  // buildInvoiceRecord writes totalMinor + currency at issuance; applyPayment/refund write
  // appliedMinor later; adjustments write credits/charges/writeOff later.
  INVOICE: Object.freeze({
    requiredMoney: Object.freeze(["totalMinor"]),
    optionalMoney: Object.freeze(["appliedMinor", "creditsMinor", "chargesMinor", "writeOffMinor"]),
    requiredText: Object.freeze(["currency"]),
  }),
  // recordPayment writes amountMinor, appliedMinor and currency on the receipt.
  PAYMENT_RECEIPT: Object.freeze({
    requiredMoney: Object.freeze(["amountMinor", "appliedMinor"]),
    optionalMoney: Object.freeze([]),
    requiredText: Object.freeze(["currency"]),
  }),
  // Every application names both ends and the amount it moved.
  PAYMENT_APPLICATION: Object.freeze({
    requiredMoney: Object.freeze(["appliedAmountMinor"]),
    optionalMoney: Object.freeze([]),
    requiredText: Object.freeze(["invoiceId", "paymentId", "currency"]),
  }),
});

/** The defective FIELD NAMES of one stored record (empty = structurally sound). Never values. */
export function financeRecordDefects(kind: FinanceRecordKind, doc: unknown): string[] {
  const shape = FINANCE_RECORD_SHAPES[kind];
  if (!shape) return ["<unknown kind>"];
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return ["<record>"];
  const d = doc as Record<string, unknown>;
  const defects: string[] = [];
  for (const f of shape.requiredMoney) if (!isMinor(d[f])) defects.push(f);
  for (const f of shape.optionalMoney) if (f in d && d[f] !== undefined && !isMinor(d[f])) defects.push(f);
  for (const f of shape.requiredText) if (!isText(d[f])) defects.push(f);
  return defects;
}

export const isFinanceRecordSound = (kind: FinanceRecordKind, doc: unknown): boolean =>
  financeRecordDefects(kind, doc).length === 0;

// ════════════════════ THE PRE-ACTIVATION CENSUS ════════════════════
//
// Run over the COMPLETE legacy set (an exported snapshot — see scripts/financeRecordCensusCli.js)
// before any finance COPY/ACTIVATE step. Its verdict is a GATE, not a repair plan:
//   CLEAN              zero malformed records — the set is structurally copyable;
//   MALFORMED_PRESENT  at least one — activation must STOP, and each listed record goes to the
//                      Owner as a data decision (DQ). Nothing here, and nothing downstream of it,
//                      may fix a value it cannot read.

export interface FinanceCensusRecordIn {
  id: string;
  data: unknown;
}

export interface FinanceCensusInput {
  invoices?: FinanceCensusRecordIn[];
  payments?: FinanceCensusRecordIn[];
  payment_applications?: FinanceCensusRecordIn[];
}

export interface FinanceCensusFinding {
  kind: FinanceRecordKind;
  id: string;
  fields: string[];
}

export interface FinanceCensusResult {
  verdict: "CLEAN" | "MALFORMED_PRESENT";
  scanned: Record<FinanceRecordKind, number>;
  malformed: Record<FinanceRecordKind, number>;
  /** Per defective field, per kind — which writer-shape rule is being broken, and how often. */
  byField: Record<FinanceRecordKind, Record<string, number>>;
  /** Every malformed record by id and field NAME — never a value. Sorted for deterministic evidence. */
  findings: FinanceCensusFinding[];
}

export function censusFinanceRecords(input: FinanceCensusInput): FinanceCensusResult {
  const sets: Array<[FinanceRecordKind, FinanceCensusRecordIn[] | undefined]> = [
    ["INVOICE", input?.invoices],
    ["PAYMENT_RECEIPT", input?.payments],
    ["PAYMENT_APPLICATION", input?.payment_applications],
  ];
  const zero = (): Record<FinanceRecordKind, number> => ({ INVOICE: 0, PAYMENT_RECEIPT: 0, PAYMENT_APPLICATION: 0 });
  const scanned = zero();
  const malformed = zero();
  const byField: Record<FinanceRecordKind, Record<string, number>> = { INVOICE: {}, PAYMENT_RECEIPT: {}, PAYMENT_APPLICATION: {} };
  const findings: FinanceCensusFinding[] = [];
  for (const [kind, rows] of sets) {
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new Error(`census input for ${kind} must be an array of {id, data}`);
    }
    for (const row of rows ?? []) {
      scanned[kind] += 1;
      const id = row && typeof row.id === "string" && row.id.length > 0 ? row.id : "<no id>";
      const fields = row && typeof row === "object" ? financeRecordDefects(kind, row.data) : ["<record>"];
      if (id === "<no id>") fields.unshift("<id>");
      if (fields.length === 0) continue;
      malformed[kind] += 1;
      for (const f of fields) byField[kind][f] = (byField[kind][f] ?? 0) + 1;
      findings.push({ kind, id, fields });
    }
  }
  findings.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));
  const total = malformed.INVOICE + malformed.PAYMENT_RECEIPT + malformed.PAYMENT_APPLICATION;
  return { verdict: total === 0 ? "CLEAN" : "MALFORMED_PRESENT", scanned, malformed, byField, findings };
}
