// Finance — PURE internal reconciliation core (F11 / FIN-010). The payment/adjustment cores promise that
// every stored AR projection (appliedMinor / creditsMinor / chargesMinor / writeOffMinor /
// outstandingMinor / state) is ONLY a cache of the durable fact records. This module makes that promise
// CHECKABLE: recompute the projection from the facts and diff it against what is stored. IN_SYNC or
// DRIFT with named differences — a drifted projection is a defect to investigate, never silently
// "fixed" here (this module writes nothing and proposes nothing; invariant C).
//
// EXTERNAL reconciliation (EOS vs the accounting authority of record) is intentionally absent: the
// authority of record is NOT YET SELECTED (DECISIONS #145) — there is nothing to reconcile against, and
// building a speculative matcher would guess an interface. The Reconciliation & Exceptions surface gets
// internal drift detection now; external reconciliation arrives with the authority-of-record selection.
// Integer minor units; pure; no I/O.
//
// ════════════════════ DORMANT: NO PRODUCTION CALLER, BY DECISION, NOT BY OVERSIGHT ════════════════════
//
// P2-K (2026-09-12) audited this. NOTHING under functions/src imports this module; its only
// importers are functions/test/financialReconciliation.test.mjs and
// functions/test/invoiceTotalsAuthority.test.mjs. It is exercised (invoiceTotalsAuthority.test.mjs
// runs in `npm run test:adminPolicy`, financialReconciliation.test.mjs now runs in
// `npm run test:financeUnit`) but never RUN against real data. Two findings say leave it that way
// until an Owner rules:
//
//   (a) `reconcileInvoiceProjection` DISAGREES WITH THE PRODUCTION ADJUSTMENT CORE about invoice
//       state. adjustmentCommands.ts/adjustmentCallables.ts deliberately do NOT move `state` on a
//       credit memo or write-off ("a write-off settles the AR balance without payment; it does NOT
//       mark the invoice PAID"). This function re-derives state via deriveInvoiceStateFromFacts,
//       which returns PAID whenever outstanding <= 0. So an invoice correctly settled by a full
//       WRITE_OFF or CREDIT_MEMO — stored state ISSUED, outstanding 0 — is reported as DRIFT on
//       `state`. That is a FALSE POSITIVE produced by correct production behaviour. It is pinned as
//       an executed test ("KNOWN CONFLICT ...") in financialReconciliation.test.mjs. Wiring this
//       reconciler before the conflict is resolved would alarm on healthy invoices.
//       OWNER QUESTION #1: after a full write-off or credit memo, is the invoice's lifecycle state
//       PAID, or does it stay ISSUED with outstanding 0? The two modules currently answer
//       differently and only one of them can be right.
//
//   (b) The drift classes themselves are NARROWED, not gone. Every Firestore writer of the AR cache
//       (paymentCallables / refundCallables / adjustmentCallables) updates it inside the SAME
//       transaction that writes the durable fact, and firestore.rules denies all client read/write
//       on invoices / payments / payment_applications / invoice_adjustments. The header-vs-lines
//       class is narrower still: buildInvoiceRecord is the only writer of totalMinor and it derives
//       it from eosOps/invoiceTotals.ts. What is NOT closed: records written before those
//       invariants existed, out-of-band/manual repair, and the eventual Firestore→Postgres cutover
//       (eosOps/invoiceAuthority.ts, unwired). Those are exactly what a sweep would find.
//       OWNER QUESTION #2: when a sweep does find a cache/fact divergence, should it BLOCK the
//       operation, WARN, or reconcile asynchronously? FIN-010 defers this; nothing here decides it.
//
// Consequence: this module is kept, not retired, and NOT wired. functions/test/
// financeDetectorWiring.test.mjs is the ratchet — it fails if this module acquires a production
// importer while still declared DORMANT, or if either suite falls out of package.json.
import { deriveOutstandingMinor, deriveInvoiceStateFromFacts } from "./paymentCommands";
import {
  reconcileInvoiceTotalsAgainstLines,
  type InvoiceLineAmounts,
} from "../eosOps/invoiceTotals";

export class ReconciliationError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "ReconciliationError"; this.code = code; }
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const nn = (v: unknown): number => (isInt(v) && v >= 0 ? v : 0);

/**
 * THE GAP THIS FILE USED TO HAVE.
 *
 * `reconcileInvoiceProjection` below proves the AR OVERLAY — applied, credits, charges,
 * write-offs, outstanding, state — against the durable payment/adjustment/refund facts. It takes
 * `stored.totalMinor` as its GIVEN basis (see `derivedFacts`), and nothing anywhere proved THAT.
 *
 * So the one number every AR figure is computed from — billed, outstanding, and every aging bucket
 * in financeReadProjection.ts — was the only one with no proof against the lines it summarises. A
 * header that disagrees with its own lines passes `reconcileInvoiceProjection` cleanly and reports
 * IN_SYNC, because the disagreement is upstream of everything that function compares.
 *
 * This closes it. The stored header aggregate is diffed against the invoice's own embedded lines,
 * through the same shared derivation (eosOps/invoiceTotals.ts) that issuance now uses and that the
 * Postgres authority expresses as GENERATED ALWAYS columns. It is a SEPARATE function, not folded
 * into the projection reconciler, because the two answer different questions and a caller that has
 * lines is not the same caller as one that has payment facts.
 */
export function reconcileInvoiceTotals(
  stored: { invoiceId: string; subtotalMinor?: number; discountMinor?: number; taxMinor?: number; totalMinor?: number },
  lines: readonly InvoiceLineAmounts[],
): ReconciliationResult {
  if (!stored || typeof stored.invoiceId !== "string" || stored.invoiceId.length === 0) {
    throw new ReconciliationError("INVOICE_REQUIRED", "a stored invoice with invoiceId is required");
  }
  if (!Array.isArray(lines)) {
    // An invoice with no lines readable is not an invoice reconciled to zero — it is a
    // reconciliation that cannot be performed, and saying IN_SYNC about it would be a lie.
    throw new ReconciliationError("LINES_REQUIRED", `invoice ${stored.invoiceId} has no readable lines to reconcile its total against`);
  }
  const { status, differences } = reconcileInvoiceTotalsAgainstLines(stored, lines);
  return { recordId: stored.invoiceId, status, differences };
}

export interface StoredInvoiceProjection {
  invoiceId: string;
  currency: string;
  state: string;
  totalMinor: number;
  appliedMinor?: number;
  creditsMinor?: number;
  chargesMinor?: number;
  writeOffMinor?: number;
  outstandingMinor?: number;
}

export interface ApplicationFactRow { invoiceId: string; appliedAmountMinor: number }
export interface AdjustmentFactRow { invoiceId: string; type: string; amountMinor: number }
export interface RefundFactRow { invoiceId: string; amountMinor: number }

export interface Difference {
  field: string;
  storedValue: number | string | null;
  derivedValue: number | string;
}

export interface ReconciliationResult {
  recordId: string; // the invoice or payment the reconciliation ran over
  status: "IN_SYNC" | "DRIFT";
  differences: Difference[];
}

// Recompute the invoice AR projection from its durable facts and diff against the stored projection.
// Facts for OTHER invoices are a caller defect (thrown) — a reconciliation over the wrong fact set would
// report false drift or false sync.
export function reconcileInvoiceProjection(
  stored: StoredInvoiceProjection,
  facts: { applications: ApplicationFactRow[]; adjustments: AdjustmentFactRow[]; refunds: RefundFactRow[] },
): ReconciliationResult {
  if (!stored || typeof stored.invoiceId !== "string" || stored.invoiceId.length === 0) {
    throw new ReconciliationError("INVOICE_REQUIRED", "a stored invoice projection with invoiceId is required");
  }
  // NOTE THE BOUNDARY: totalMinor is checked for SHAPE here and taken as the basis for everything
  // below. Whether it actually equals the sum of the invoice's lines is a different question, and
  // it is `reconcileInvoiceTotals` above that answers it — this function cannot, because a payment
  // fact set says nothing about what was billed.
  if (!isInt(stored.totalMinor)) throw new ReconciliationError("PROJECTION_INVALID", "stored totalMinor must be an integer");
  const applications = Array.isArray(facts?.applications) ? facts.applications : [];
  const adjustments = Array.isArray(facts?.adjustments) ? facts.adjustments : [];
  const refunds = Array.isArray(facts?.refunds) ? facts.refunds : [];
  for (const rows of [applications, adjustments, refunds] as { invoiceId: string }[][]) {
    for (const r of rows) {
      if (r?.invoiceId !== stored.invoiceId) {
        throw new ReconciliationError("FOREIGN_FACT", `fact for invoice ${r?.invoiceId} offered to reconcile ${stored.invoiceId}`);
      }
    }
  }
  const sum = (rows: { amountMinor?: number; appliedAmountMinor?: number }[], key: "amountMinor" | "appliedAmountMinor"): number =>
    rows.reduce((n, r) => {
      const v = r[key];
      if (!isInt(v) || v < 0) throw new ReconciliationError("FACT_INVALID", `${key} must be a non-negative integer on every fact`);
      return n + v;
    }, 0);

  // Derived truth: applied = applications − refunds; credits/charges/write-offs from adjustment facts.
  const appliedFromFacts = sum(applications, "appliedAmountMinor") - sum(refunds, "amountMinor");
  const creditsFromFacts = sum(adjustments.filter((a) => a.type === "CREDIT_MEMO"), "amountMinor");
  const chargesFromFacts = sum(adjustments.filter((a) => a.type === "DEBIT_CHARGE"), "amountMinor");
  const writeOffFromFacts = sum(adjustments.filter((a) => a.type === "WRITE_OFF"), "amountMinor");
  const unknownTypes = adjustments.filter((a) => !["CREDIT_MEMO", "DEBIT_CHARGE", "WRITE_OFF"].includes(a.type));
  if (unknownTypes.length > 0) {
    throw new ReconciliationError("FACT_INVALID", `unknown adjustment type "${unknownTypes[0].type}" — the fact set is not reconcilable`);
  }

  const derivedFacts = {
    currency: stored.currency,
    state: stored.state,
    totalMinor: stored.totalMinor,
    appliedMinor: appliedFromFacts,
    creditsMinor: creditsFromFacts,
    chargesMinor: chargesFromFacts,
    writeOffMinor: writeOffFromFacts,
  };
  const derivedOutstanding = deriveOutstandingMinor(derivedFacts);
  // State drift check: VOID is terminal and never re-derived; otherwise the state implied by the facts.
  const derivedState = stored.state === "VOID" ? "VOID" : deriveInvoiceStateFromFacts(derivedFacts);

  const differences: Difference[] = [];
  const diff = (field: string, storedValue: number | string | null, derivedValue: number | string): void => {
    if (storedValue !== derivedValue) differences.push({ field, storedValue, derivedValue });
  };
  diff("appliedMinor", nn(stored.appliedMinor), appliedFromFacts);
  diff("creditsMinor", nn(stored.creditsMinor), creditsFromFacts);
  diff("chargesMinor", nn(stored.chargesMinor), chargesFromFacts);
  diff("writeOffMinor", nn(stored.writeOffMinor), writeOffFromFacts);
  diff("outstandingMinor", isInt(stored.outstandingMinor) ? (stored.outstandingMinor as number) : null, derivedOutstanding);
  diff("state", stored.state, derivedState);

  return { recordId: stored.invoiceId, status: differences.length === 0 ? "IN_SYNC" : "DRIFT", differences };
}

export interface StoredReceipt {
  paymentId: string;
  amountMinor: number;
  appliedMinor?: number;
  unappliedMinor?: number;
}

// A receipt's own invariant: amount = applied + unapplied, and applied must equal the sum of its
// application facts. Same IN_SYNC/DRIFT honesty.
export function reconcileReceipt(stored: StoredReceipt, applications: { paymentId: string; appliedAmountMinor: number }[]): ReconciliationResult {
  if (!stored || typeof stored.paymentId !== "string" || stored.paymentId.length === 0) {
    throw new ReconciliationError("RECEIPT_REQUIRED", "a stored receipt with paymentId is required");
  }
  if (!isInt(stored.amountMinor)) throw new ReconciliationError("PROJECTION_INVALID", "stored amountMinor must be an integer");
  const rows = Array.isArray(applications) ? applications : [];
  for (const r of rows) {
    if (r?.paymentId !== stored.paymentId) throw new ReconciliationError("FOREIGN_FACT", `application for payment ${r?.paymentId} offered to reconcile ${stored.paymentId}`);
    if (!isInt(r.appliedAmountMinor) || r.appliedAmountMinor < 0) throw new ReconciliationError("FACT_INVALID", "appliedAmountMinor must be a non-negative integer");
  }
  const appliedFromFacts = rows.reduce((n, r) => n + r.appliedAmountMinor, 0);
  const differences: Difference[] = [];
  if (nn(stored.appliedMinor) !== appliedFromFacts) {
    differences.push({ field: "appliedMinor", storedValue: nn(stored.appliedMinor), derivedValue: appliedFromFacts });
  }
  const derivedUnapplied = stored.amountMinor - appliedFromFacts;
  if (nn(stored.unappliedMinor) !== derivedUnapplied) {
    differences.push({ field: "unappliedMinor", storedValue: nn(stored.unappliedMinor), derivedValue: derivedUnapplied });
  }
  if (derivedUnapplied < 0) {
    differences.push({ field: "amountMinor", storedValue: stored.amountMinor, derivedValue: appliedFromFacts });
  }
  return { recordId: stored.paymentId, status: differences.length === 0 ? "IN_SYNC" : "DRIFT", differences };
}
