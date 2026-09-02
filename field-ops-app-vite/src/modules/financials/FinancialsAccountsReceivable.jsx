// ACCOUNTS RECEIVABLE — /financials/accounts-receivable (North Star P1, page 04).
//
// Design authority: docs/north-star/financials/North Star - Financials 04 Accounts Receivable.dc.html.
// Issued-but-unpaid OPERATIONAL exposure — explicitly not accounting-reconciled. Aging
// starts from the governed dueDate (established by current invoice authority); no DSO or
// risk score exists because no authority computes one.
//
// PARTIALLY WIRED, and the split is deliberate. The exposure table below reads the governed
// reporting seam: every row is one invoice with the server's own outstanding figure. The AGING
// SCORECARD above it stays in its honest state, because bucketing outstanding balances into
// Current / 1–30 / 31–60 / 61+ is money arithmetic, and this client does not do money arithmetic
// over authoritative facts — a bucket total computed here from a page of rows would silently
// become a claim about the whole book. When the read supplies aged rollups, the slots fill.
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import { AR_AGING_BUCKETS } from "../../domain/financialsSurface.js";
import { useFinancialFacts } from "../../hooks/useFinancialFacts.js";
import { useFinancialsPeriod } from "../../hooks/useFinancialsPeriod.js";
import { FACTS_STATE, FACTS_DETAIL, financialFactsState, outstandingRows } from "../../domain/financialFactsView.js";

const dateWords = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString() : "—");

export default function FinancialsAccountsReceivable() {
  const [company, setCompany] = useState("consolidated");
  const period = useFinancialsPeriod();

  // WHAT PERIOD MEANS HERE, stated because the two readings differ materially: it selects
  // RECEIVABLES ARISING FROM INVOICES ISSUED IN THE WINDOW. It is NOT "A/R as of a date" — no
  // historical balance snapshot exists in this system, and outstanding is always derived as of NOW
  // from current facts. Aging still derives from each invoice's own governed dueDate, untouched by
  // the period.
  const read = useFinancialFacts(
    {
      companyId: company === "consolidated" ? null : company,
      factTypes: ["INVOICE"],
      ...period.requestFields,
    },
    { enabled: !period.blocked },
  );
  const { state, result } = financialFactsState(read);
  // READY and EMPTY both mean the server answered; only the record count differs.
  const answered = state === FACTS_STATE.READY || state === FACTS_STATE.EMPTY;
  const rows = answered ? outstandingRows(result) : [];

  const honest =
    answered && rows.length === 0
      ? {
          state: "EMPTY",
          detail:
            period.presetKey === "all"
              ? "The governed read answered, and no invoice in your visibility scope carries an outstanding balance."
              : `No open receivables from invoices issued in this period (${period.label}). This is not an as-of-date balance. Choose All activity to see the full set.`,
        }
      : answered
        ? { state: null }
        : { state, detail: FACTS_DETAIL[state] ?? null };

  return (
    <FinancialsPageFrame
      title="Accounts Receivable"
      crumb="Accounts Receivable"
      custody="Issued but unpaid operational exposure. Operational actual — not an accounting-reconciled balance; no accounting authority is connected."
      custodyTip="A/R composes issued invoices minus governed applications and credits. Aging starts from the governed dueDate established by invoice authority. Disputed-invoice, promise-to-pay and terms-change aging treatments are not implemented (FIN-AG-DUEDATE-POLICY) and are never silently invented."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} period={period.controlProps} />

      <section className="fin-scorecard-section" aria-label="Aging">
        <div className="fin-scorecard fin-scorecard--aging">
          {AR_AGING_BUCKETS.map((bucket) => (
            <div key={bucket.key} className="fin-scorecard__slot">
              <div className="fin-figure">
                <div className="fin-figure__label">{bucket.label}</div>
                <div className="fin-figure__absence">Not supplied by this read</div>
                <span className="fin-factclass">Operational actual</span>
              </div>
            </div>
          ))}
        </div>
        <p className="fin-section-note">
          One aging grammar, everywhere
          <FinAnnotation tip="One canonical bucket vocabulary — Current / 1–30 / 31–60 / 61+ — used on every surface that ages receivables. The governed read returns per-invoice facts, not aged bucket totals, and this page will not total them itself: a bucket summed from one page of rows would read as a claim about the whole book. Per-invoice age is shown in the table below, where it is factual. No DSO and no risk score: neither has authority." />
        </p>
      </section>

      {/* CONTRACT COPY, VISIBLE WITH ROWS ON SCREEN. Two readings of "Period" are possible here and
          they mean materially different things — "invoices issued in the window" versus "the
          balance as it stood at the end of that window". The system supports only the first, and
          stating that only in a filtered empty state left the distinction invisible in exactly the
          case where it misleads: a populated table under a selected period. */}
      <p className="fin-truth-band" role="note">
        <strong>Period filters by invoice issue date.</strong> Outstanding reflects the current
        balance, not an as-of-period balance.
        <FinAnnotation tip="Selecting a period narrows this table to receivables arising from invoices ISSUED in that window. It does not reconstruct what was owed at the end of it: no historical balance snapshot exists in this system, and outstanding is always derived from current governed facts. Aging derives from each invoice's own governed dueDate, which the period never touches." />
      </p>

      <FinancialsHonestSection
        id="fin-ar-by-customer"
        title="Exposure by customer"
        meta="largest exposure first · drills to invoice records and Customer Financials"
        honest={honest}
        subject="A/R reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Receivables grouped by customer</caption>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Invoice</th>
                <th scope="col">Due</th>
                <th scope="col">Age</th>
                <th scope="col" className="ns-num">Original</th>
                <th scope="col" className="ns-num">Applied</th>
                <th scope="col" className="ns-num">Outstanding</th>
              </tr>
            </thead>
            {rows.length > 0 ? (
              <tbody>
                {rows.map((row) => (
                  <tr key={row.invoiceId}>
                    <td>{row.accountId ?? "—"}</td>
                    <td>{row.invoiceNumber}</td>
                    <td>{dateWords(row.dueDate)}</td>
                    <td>
                      {row.daysOverdue === null
                        ? row.position
                        : row.daysOverdue > 0
                          ? `${row.daysOverdue} days overdue`
                          : "Current"}
                    </td>
                    <td className="ns-num">{row.total}</td>
                    <td className="ns-num">{row.applied}</td>
                    <td className="ns-num">{row.outstanding}</td>
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
