// FINANCIALS REPORTING READ — PURE view model for the governed `listFinancialFacts` callable
// (functions/src/finance/financialReportingRead.ts). No Firebase import; unit-testable in Node.
//
// ════════════ THIS MODULE DOES NO MONEY ARITHMETIC ════════════
//
// Every figure it renders was summed by the server, which is the only place that knows what the
// principal was allowed to see. The client formats and labels; it never adds, never nets, never
// buckets. If a figure a page wants is not in the envelope, the honest answer is that the read
// does not supply it — not a total computed here from rows that may themselves be a partial slice.
//
// ════════════ UNATTRIBUTED IS NOT ZERO ════════════
//
// The invoices in this system predate FIN-002's attribution stamping in part: an invoice issued by
// the currently deployed command build carries `companyId` but no `attribution` and no line
// `businessUnitId`. Those facts are REAL and VISIBLE; they simply cannot be placed on a salesperson
// or unit axis. The server counts them in `unattributed`, and the sentences below name that count
// so a performance table reads "3 invoices carry no credited salesperson" rather than showing a
// person's row at zero — which would be a claim about their performance that nobody made.

import { formatMoneyDisplay } from "./moneyDisplay.js";

export const FACTS_STATE = Object.freeze({
  LOADING: "LOADING",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  EMPTY: "EMPTY",
  READY: "READY",
});

/**
 * Map the {loading, errorStatus, result} chain onto ONE honest state.
 *
 * `status: "unavailable"` from the server is a real answer, not a failure: the callable refuses to
 * label a truncated page "ready" rather than summarizing a partial set confidently. It maps to
 * UNAVAILABLE for exactly that reason — the page must not present it as "nothing here".
 */
/*
 * `detail` is the ONE honest-state sentence every page renders for a non-ready read. For an
 * incomplete read it is the server's named reason and counts (incompleteReadNote), falling back to
 * the generic FACTS_DETAIL sentence only when the server named nothing. `accountSelector` is true
 * only on a page that actually offers a single-account choice, so the sentence never advises a
 * narrowing the page cannot perform.
 */
export function financialFactsState({ loading, errorStatus, result }, { accountSelector = false } = {}) {
  if (loading) return { state: FACTS_STATE.LOADING, detail: null };
  if (errorStatus === "denied") return { state: FACTS_STATE.DENIED, detail: FACTS_DETAIL[FACTS_STATE.DENIED] };
  if (errorStatus === "unavailable" || result == null) {
    return { state: FACTS_STATE.UNAVAILABLE, detail: FACTS_DETAIL[FACTS_STATE.UNAVAILABLE] };
  }
  const incomplete = (completeness) => ({
    state: FACTS_STATE.UNAVAILABLE,
    completeness,
    detail: incompleteReadNote(completeness, { accountSelector }) ?? FACTS_DETAIL[FACTS_STATE.UNAVAILABLE],
  });
  // An incomplete read is UNAVAILABLE, and it carries the server's named reason and counts so a
  // page can say WHY — never rendered as empty, never as a total.
  const completeness = financialFactsCompleteness(result);
  if (result.status !== "ready") return incomplete(completeness);
  // Defence in depth: a "ready" status beside a non-COMPLETE contract is treated as incomplete.
  if (completeness.status !== "COMPLETE") return incomplete(completeness);
  // EMPTINESS IS ABOUT THE WHOLE ANSWER, NOT ABOUT INVOICES.
  //
  // This used to test `result.invoices` alone, which quietly broke Payments: that page requests
  // factTypes ["PAYMENT_RECEIPT","PAYMENT_APPLICATION"], so the server correctly returns an EMPTY
  // invoices array alongside four real payments — and the page declared itself empty while holding
  // the records it was asked to show. A read that returned facts must never render as "no records".
  const returned =
    (result.invoices?.length ?? 0) + (result.payments?.length ?? 0) + (result.applications?.length ?? 0);
  if (returned === 0) return { state: FACTS_STATE.EMPTY, result, detail: FACTS_DETAIL[FACTS_STATE.EMPTY] };
  return { state: FACTS_STATE.READY, result, detail: null };
}

/**
 * THE COMPLETENESS CONTRACT, read — never inferred beyond what the server said.
 *
 * The server returns `completeness: { status: COMPLETE | PARTIAL | NOT_READ, reason, pageSize,
 * scanCeiling, scans: [{ collection, documentsRead, pages, exhausted }] }`. Rows and figures are
 * only ever present when it is COMPLETE. A deployed function older than this bundle sends no
 * `completeness`; its `status: "ready"` already meant "not truncated" (it refused truncated pages),
 * so that — and only that — maps to COMPLETE, labelled as the legacy contract. Anything else with
 * no contract is UNKNOWN, which is not complete.
 */
export function financialFactsCompleteness(result) {
  const c = result?.completeness;
  if (c && typeof c === "object" && typeof c.status === "string") {
    return {
      status: c.status,
      reason: c.reason ?? null,
      scanCeiling: typeof c.scanCeiling === "number" ? c.scanCeiling : null,
      scans: Array.isArray(c.scans) ? c.scans : [],
      legacy: false,
    };
  }
  if (result?.status === "ready") return { status: "COMPLETE", reason: null, scanCeiling: null, scans: [], legacy: true };
  return { status: "UNKNOWN", reason: null, scanCeiling: null, scans: [], legacy: true };
}

const COLLECTION_WORDS = Object.freeze({
  invoices: "invoices",
  payment_applications: "payment applications",
  payments: "payment receipts",
});

/**
 * The sentence for an incomplete read, or null when the read was complete. States the reason and
 * the counts the server reported; never estimates what the unread remainder would have added.
 */
export function incompleteReadNote(completeness, { accountSelector = false } = {}) {
  if (!completeness || completeness.status === "COMPLETE") return null;
  const scans = completeness.scans ?? [];
  const over = scans.find((s) => s && s.exhausted === false);
  const what = over ? COLLECTION_WORDS[over.collection] ?? over.collection : "records";
  const withheld = "Nothing is shown: a total over part of the records would read as a total over all of them.";
  switch (completeness.reason) {
    case "SCAN_CEILING_REACHED": {
      const limit = completeness.scanCeiling ?? "the maximum number of";
      if (over?.tenantWide) {
        // Company, period and unit filters narrow AFTER the read, so they cannot help here; only an
        // account narrows the read itself, and only where the page offers one is it suggested.
        const advice = accountSelector ? " Select a single account to see a complete answer for it." : "";
        return `This tenant holds more than ${limit} ${what}, which is more than one governed read can complete. ${withheld}${advice}`;
      }
      return `More than ${limit} ${what} fall under this request, which is more than one governed read can complete. ${withheld}`;
    }
    case "DANGLING_REFERENCE": {
      // A count of missing RECORDS the server reported — not money.
      let n = 0;
      for (const s of scans) if (typeof s?.danglingIds === "number") n += s.danglingIds;
      return `${n || "Some"} payment receipt${n === 1 ? "" : "s"} named by a payment application could not be found. Nothing is shown: an answer with a broken link between its records is not complete.`;
    }
    case "INDEX_MISSING":
      return "The governed read could not run because a required database index is not deployed. Nothing is shown; this is a deployment fact, not an absence of records.";
    case "READ_FAILED":
      return completeness.status === "PARTIAL"
        ? `The governed read failed part-way (after ${over?.documentsRead ?? "some"} ${what}). Nothing is shown, because the records already read are not the whole answer.`
        : "The governed read failed before any record was read. Nothing is shown; this is not an absence of records.";
    case "NO_REACH":
      return "No financial visibility scope confers reach for your principal, so nothing was read.";
    default:
      return null;
  }
}

/** The honest-state detail sentence for each non-ready state. Contract copy — states the fact, only. */
export const FACTS_DETAIL = Object.freeze({
  [FACTS_STATE.DENIED]:
    "The server refused this read for your principal. That is a permission fact about your governed financial visibility, not an absence of records — reach requires both the finance fact-family gate and a visibility scope.",
  [FACTS_STATE.UNAVAILABLE]:
    "The governed read did not return a complete result, so nothing is shown. The server refuses to summarize a partial page: an incomplete financial total is worse than none.",
  [FACTS_STATE.EMPTY]:
    "The governed read answered, and no records fall within your visibility scope for this filter. This is a real result, not a failure.",
});

const money = (minor, currency) => formatMoneyDisplay(minor, currency);

/**
 * Format a per-currency map the server produced. Multiple currencies render as separate amounts —
 * they are never combined, here or anywhere. An empty map is an honest dash, not a zero: the server
 * omits a currency with nothing in it, and printing "$0.00" would assert a balance it never stated.
 */
export function formatByCurrency(byCurrency) {
  const entries = Object.entries(byCurrency ?? {}).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return "—";
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, minor]) => money(minor, currency))
    .join(" · ");
}

const AR_POSITION_WORDS = Object.freeze({
  OVERDUE: "Overdue",
  CURRENT: "Current",
  SETTLED: "Settled",
  VOID: "Void",
  UNKNOWN: "Position not recorded",
});

/** One invoice row, ready to render. Every amount is the server's; only the wording is ours. */
export function invoiceRow(read) {
  return {
    invoiceId: read.invoiceId,
    invoiceNumber: read.invoiceNumber ?? read.invoiceId,
    accountId: read.accountId,
    companyId: read.companyId,
    // "Mixed" is the collection-level truth for a cross-unit invoice: line-level BU is the only
    // unit fact, so no single unit may be printed in a header cell (FIN-002).
    businessUnit:
      read.businessUnitIds.length === 0
        ? "Not attributed"
        : read.businessUnitIds.length === 1
          ? read.businessUnitIds[0]
          : "Mixed",
    creditedSalespersonId: read.creditedSalespersonId,
    issuedAtMillis: read.issuedAtMillis,
    dueDate: read.dueDate,
    total: money(read.totalMinor, read.currency),
    applied: money(read.appliedMinor, read.currency),
    outstanding: money(read.outstandingMinor, read.currency),
    position: AR_POSITION_WORDS[read.arPosition] ?? "Position not recorded",
    positionTone: read.arPosition === "OVERDUE" ? "critical" : read.arPosition === "SETTLED" ? "positive" : "info",
    daysOverdue: read.daysOverdue,
  };
}

/** The open-exposure rows for A/R: the same server figures, restricted to what is actually owed. */
export function outstandingRows(result) {
  return (result?.invoices ?? []).filter((i) => i.outstandingMinor > 0).map(invoiceRow);
}

/** One rollup row. `key` is a governed id; the caller supplies the human label for it. */
export function rollupRow(row) {
  return {
    key: row.key,
    invoiceCount: row.invoiceCount,
    billed: formatByCurrency(row.billedByCurrency),
    collected: formatByCurrency(row.collectedByCurrency),
    outstanding: formatByCurrency(row.outstandingByCurrency),
  };
}

/**
 * The sentence naming facts that cannot be placed on a dimension, or null when every fact is
 * attributed. Rendered BESIDE a rollup table, never folded into it as an "Other" row — an
 * unattributed fact belongs to nobody, and giving it a row invents an entity.
 */
export function unattributedNote(result, dimension) {
  const count = result?.unattributed?.[dimension] ?? 0;
  if (!count) return null;
  const noun = count === 1 ? "invoice carries" : "invoices carry";
  const what =
    dimension === "creditedSalesperson"
      ? "no credited salesperson"
      : "no line-level business unit";
  return `${count} visible ${noun} ${what}, so ${count === 1 ? "it is" : "they are"} not placed on this axis. They are counted here rather than dropped, and never shown as a zero against anyone.`;
}

/**
 * THE LIFECYCLE SCORECARD (page 01), resolved slot by slot from what the read ACTUALLY returns.
 *
 * ════════ THE SEAM THIS FUNCTION IS HONEST ABOUT ════════
 *
 * The reporting read returns a server-computed CONSOLIDATED total for exactly one lifecycle
 * position — outstanding, in `summary.outstandingByCurrency`. Billed and collected come back only
 * as PER-COMPANY rollups. So:
 *
 *   · A/R outstanding populates in every scope, straight from the server's own total;
 *   · billed and collected populate when the requested filters resolve to exactly ONE company
 *     rollup, because then the figure is that row's value — a read, not a sum;
 *   · under a consolidated view spanning several companies they stay ABSENT and say why. Adding
 *     the company rows together here is the one thing this module must never do: a total assembled
 *     client-side from a scoped slice reads as a statement about the whole book.
 *
 * Booked, billable-now and unbilled are absent in every scope. Booked is a Sales Order fact and
 * this read exposes invoices; billable-now needs a governed billable projection that FIN-BLOCK-002
 * leaves unresolved; unbilled is booked − billed and cannot be truer than the facts under it.
 * None of the three is approximated from what IS here.
 */
export const LIFECYCLE_ABSENCE = Object.freeze({
  booked:
    "Booked value is established on the Sales Order, and this read exposes invoice facts. Billed is deliberately not substituted for it — that would rename the metric rather than supply it.",
  billable:
    "Billable-now needs a governed billable projection. Service-origin billing is unresolved (FIN-BLOCK-002), and inferring billable from order state would invent the very authority that is missing.",
  unbilled:
    "Unbilled is booked minus billed. Booked is not supplied by this read, so the difference cannot be truer than the facts beneath it — and it is not computed here from what happens to be available.",
  // Retained as the honest sentence for a scope the server does not total. It is unused while the
  // summary supplies all three lifecycle figures, and it is the copy to restore rather than
  // reinvent if a future figure is ever returned per company only.
  multiCompany:
    "The governed read returns this figure per operating company and no consolidated total. This page will not add the companies together: a total assembled here from a scoped slice would read as a statement about the whole book. Select a single company to see it, or use Company & Business Unit Performance.",
});

export function lifecycleScorecard(state, result, stateDetail = null) {
  const absent = (detail) => ({ valueText: null, absence: "Not supplied by this read", detail });
  const value = (byCurrency) => ({ valueText: formatByCurrency(byCurrency), absence: null, detail: null });

  // Nothing is a figure until the read is READY. A denied or failed read must never show a
  // number — least of all $0.00, which would assert a balance nobody reported.
  if (state !== FACTS_STATE.READY && state !== FACTS_STATE.EMPTY) {
    // `stateDetail` is financialFactsState's own sentence — the named reason for an incomplete read.
    const detail = stateDetail ?? FACTS_DETAIL[state] ?? null;
    const stateAbsence = state === FACTS_STATE.LOADING ? "Reading…" : state === FACTS_STATE.DENIED ? "Withheld" : "Unavailable";
    return Object.fromEntries(
      ["booked", "billable", "billed", "collected", "arOutstanding", "unbilled"].map((k) => [
        k,
        { valueText: null, absence: stateAbsence, detail },
      ]),
    );
  }

  // ALL THREE now come from the server's own consolidated summary, in every scope. The read used
  // to return billed and collected per company only, so a multi-company view had to leave them
  // absent rather than add the rows here. The totals moved to where they belong — the server, which
  // is what knows which facts the caller may see — and this function simply reads them.
  const summary = result?.summary ?? {};
  // A field the summary does not carry is ABSENT, not zero and not a dash. The deployed function
  // can legitimately be older than this bundle — the two ship separately — and a page that
  // rendered "—" for a total the server never sent would be reporting a balance it has no basis
  // for. Falling back to the named absence keeps the page truthful under either version.
  const fromSummary = (byCurrency, absentDetail) =>
    byCurrency && typeof byCurrency === "object" ? value(byCurrency) : absent(absentDetail);

  return {
    booked: absent(LIFECYCLE_ABSENCE.booked),
    billable: absent(LIFECYCLE_ABSENCE.billable),
    billed: fromSummary(summary.billedByCurrency, LIFECYCLE_ABSENCE.multiCompany),
    collected: fromSummary(summary.collectedByCurrency, LIFECYCLE_ABSENCE.multiCompany),
    arOutstanding: fromSummary(summary.outstandingByCurrency, LIFECYCLE_ABSENCE.multiCompany),
    unbilled: absent(LIFECYCLE_ABSENCE.unbilled),
  };
}

/**
 * A/R AGING for the approved bucket slots (page 04), READ from the server's own derivation.
 *
 * The client does not bucket anything here — it selects a field the server already computed and
 * formats it. Any invoice the server could not place on the aging axis (no governed due date) is
 * reported separately by `unagedNote` rather than folded into Current, so the buckets on screen
 * reconcile to the total beside them.
 */
export function agingSlots(state, result) {
  const answered = state === FACTS_STATE.READY || state === FACTS_STATE.EMPTY;
  // THE DEPLOYED FUNCTION CAN BE OLDER THAN THIS BUNDLE — they ship separately. A response with no
  // agingByCurrency at all is "this read does not supply aging", which is NOT the same as "nothing
  // is owed in that bucket". Conflating them would print a reassuring absence over real money.
  const aging = answered ? (result?.agingByCurrency ?? null) : null;
  const supplied = answered && aging !== null;
  const pick = (field) => {
    if (!aging) return null;
    const byCurrency = {};
    for (const [currency, bucket] of Object.entries(aging)) {
      // A bucket the server DID compute and reported as zero is a real answer for that band, and
      // is kept — dropping it would turn "nothing is 61+ overdue" into "unknown".
      if (typeof bucket?.[field] === "number") byCurrency[currency] = bucket[field];
    }
    return Object.keys(byCurrency).length > 0 ? formatByCurrency(byCurrency) : null;
  };
  return {
    supplied,
    total: pick("totalOutstandingMinor"),
    current: pick("currentMinor"),
    b1_30: pick("days1to30Minor"),
    b31_60: pick("days31to60Minor"),
    b61_plus: pick("days61PlusMinor"),
  };
}

/** Owed money the server could not age, named rather than hidden in the nearest bucket. */
export function unagedNote(result) {
  const aging = result?.agingByCurrency ?? {};
  const byCurrency = {};
  for (const [currency, b] of Object.entries(aging)) if (b?.unagedMinor > 0) byCurrency[currency] = b.unagedMinor;
  if (Object.keys(byCurrency).length === 0) return null;
  return `${formatByCurrency(byCurrency)} is owed on invoices with no governed due date. It cannot be placed on the aging axis, so it is counted here rather than added to Current — the buckets above plus this figure reconcile to Total A/R.`;
}

/**
 * ════════ A PAYMENT'S HUMAN IDENTITY ════════
 *
 * A cash receipt has NO governed number. CashReceiptRecord carries company, account, currency,
 * amount, method, receivedAtMillis, externalRef, applied/unapplied and attribution — and no
 * sequence. So the operator-facing identity is COMPOSED from facts the record actually holds:
 *
 *     Aug 30, 2026 · Churn · $2,500.00
 *
 * This deliberately invents nothing. It is not a number, it does not persist, and it is not a
 * client-side sequence — inventing any of those would create a second identity the server has
 * never heard of, which would then have to be reconciled with a real one later.
 *
 * The document id stays available as TECHNICAL detail. It is a database key: showing it where a
 * person's reference belongs tells the reader nothing they can act on.
 */
export function paymentIdentity(payment, customerName = null) {
  const when = typeof payment?.receivedAtMillis === "number"
    ? new Date(payment.receivedAtMillis).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "Date not recorded";
  const who = customerName ?? "Customer not resolved";
  const amount = payment?.currency ? money(payment.amountMinor, payment.currency) : "Amount not recorded";
  return `${when} · ${who} · ${amount}`;
}

/** The supporting line: which invoices this receipt was applied to, and the operator's own ref. */
export function paymentContext(payment, applications = []) {
  const invoices = applications
    .filter((a) => a.paymentId === payment.paymentId)
    .map((a) => a.invoiceNumber)
    .filter(Boolean);
  const parts = [];
  if (invoices.length > 0) parts.push(`Applied to ${invoices.join(", ")}`);
  // An absent externalRef is ordinary — most receipts have none — so it is simply omitted rather
  // than rendered as a gap or a placeholder.
  if (payment?.externalRef) parts.push(`External ref ${payment.externalRef}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** What the server said the principal's reach actually was — never what the page guessed. */
export function scopeSentence(result) {
  const scopes = result?.grantedScopes ?? [];
  if (scopes.length === 0) return null;
  return `Server-resolved visibility scope: ${scopes.join(", ")}.`;
}
