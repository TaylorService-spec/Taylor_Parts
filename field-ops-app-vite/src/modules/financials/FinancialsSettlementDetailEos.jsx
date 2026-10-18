// SETTLEMENT DETAIL -- /financials/payments/:paymentId WHERE AN EOS API IS DECLARED (Firebase exit B1, DECISIONS #B1).
//
// One Finance-register settlement: the evidence recorded, what has been applied to which receivable (every application, including
// reversed ones, each its own fact), and its reconciliation evidence. Replaces the Firebase payment record page. The URL carries the
// register's own settlement id. Nothing here edits anything: corrections are the governed Settlement Corrections commands.
import { useParams, Link } from "react-router-dom";
import { FinancialsPageFrame, FinancialsHonestSection, FinancialFigure, FinAnnotation } from "./FinancialsPrimitives.jsx";
import { companyWords } from "./financialsDisplay.js";
import { statusLabel } from "../../shared/display/displayLabels.js";
import { useEosFinanceRead } from "../../hooks/useEosFinanceRead.js";
import { FACTS_STATE, FACTS_DETAIL } from "../../domain/financialFactsView.js";
import { settlementRecord, settlementKindWords } from "../../domain/financialsEos.js";
import { formatMoneyDisplay } from "../../domain/moneyDisplay.js";
import { recordRef } from "./FinancialsReceivablesEos.jsx";

const money = (minor, currency) => formatMoneyDisplay(Number(minor), currency);
const instantWords = (iso) => (iso ? new Date(iso).toLocaleString() : "Not recorded");

export default function FinancialsSettlementDetailEos() {
  const { paymentId } = useParams();
  const read = useEosFinanceRead((reader) => reader.settlement(paymentId), paymentId);
  const s = read.result ? settlementRecord(read.result) : null;
  const answered = !read.loading && !read.errorStatus && s !== null;
  const state = read.loading ? FACTS_STATE.LOADING : read.errorStatus === "denied" ? FACTS_STATE.DENIED : read.errorStatus === "notFound" ? "NO_MATCHES" : FACTS_STATE.UNAVAILABLE;
  const honest = answered
    ? { state: null }
    : state === "NO_MATCHES"
      ? { state: "NO_MATCHES", detail: "No settlement with this identifier is within your visibility. That is not a statement that the record does not exist: a record outside your companies, or one applied to receivables outside your credited-person / team reach, is refused exactly like one that is absent." }
      : { state, detail: FACTS_DETAIL[state] ?? null };

  return (
    <FinancialsPageFrame
      title={s ? `Settlement ${s.sourceReference ?? s.id}` : "Settlement"}
      crumb="Settlements → Record"
      custody="One settlement from the Finance register: evidence EOS recorded, never a bank fact. Applications and reconciliation are separate facts."
      custodyTip="A settlement is applied to compatible receivables (same company, counterparty and currency), fully or partially. An application is reversed by an equal-and-opposite fact that keeps the original; a settlement with no live application can be voided. Reconciliation is evidence of the external accounting system's reference and amount."
    >
      <p className="fin-section-note"><Link to="/financials/payments">← All settlements</Link></p>
      <FinancialsHonestSection id="fin-settlement-record" title="Settlement Record" meta={s ? `${companyWords(s.operatingCompanyId)} · ${settlementKindWords(s.kind)}` : null} honest={honest} subject="Settlement record">
        {s ? (
          <>
            <section className="fin-scorecard-section" aria-label="Settlement amounts">
              <div className="fin-scorecard fin-scorecard--three">
                <div className="fin-scorecard__slot"><FinancialFigure label="Received" factClass="OPERATIONAL_ACTUAL" valueText={money(s.amountMinor, s.currency)} /></div>
                <div className="fin-scorecard__slot"><FinancialFigure label="Applied" factClass="OPERATIONAL_ACTUAL" valueText={money(s.appliedMinor, s.currency)} /></div>
                <div className="fin-scorecard__slot"><FinancialFigure label="Unapplied" factClass="OPERATIONAL_ACTUAL" valueText={money(s.unappliedMinor, s.currency)} /></div>
              </div>
            </section>
            <div className="ns-table-wrap">
              <table className="ns-table fin-facts">
                <caption className="fo-sr-only">Settlement facts</caption>
                <tbody>
                  <tr><th scope="row">Status</th><td>{s.status === "VOID" ? `Void${s.voidReason ? ` — ${s.voidReason}` : ""}` : "Recorded"}</td></tr>
                  <tr><th scope="row">Kind</th><td>{settlementKindWords(s.kind)}{s.direction ? ` · ${statusLabel(s.direction)}` : ""}</td></tr>
                  <tr><th scope="row">Operating Company</th><td>{companyWords(s.operatingCompanyId, { short: false })}</td></tr>
                  <tr><th scope="row">Business Date</th><td>{s.businessDate ?? "Not recorded"}</td></tr>
                  <tr><th scope="row">Reference</th><td>{s.sourceReference ?? "Not recorded"}{s.method ? ` · ${statusLabel(s.method)}` : ""}</td></tr>
                  <tr><th scope="row">Recorded</th><td>{instantWords(s.recordedAt)}</td></tr>
                  <tr><th scope="row">Reconciliation</th><td>{s.reconciliationStatus === "NOT_APPLICABLE" ? "Not applicable" : (s.reconciliationStatus ?? "Not recorded")}</td></tr>
                  <tr><th scope="row">Replaces</th><td>{s.replacesSettlementId ? <Link to={`/financials/payments/${s.replacesSettlementId}`}>{s.replacesSettlementId}</Link> : "—"}</td></tr>
                  {s.notes ? <tr><th scope="row">Notes</th><td>{s.notes}</td></tr> : null}
                </tbody>
              </table>
            </div>

            <section className="ns-section" aria-label="Applications">
              <div className="ns-section__head"><h2 className="ns-section__title">Applications</h2><span className="ns-section__meta">· each application is its own governed fact, reversed ones kept</span></div>
              {s.applications.length > 0 ? (
                <div className="ns-table-wrap">
                  <table className="ns-table">
                    <caption className="fo-sr-only">Applications of this settlement</caption>
                    <thead><tr><th scope="col">Receivable</th><th scope="col">Applied</th><th scope="col">Status</th><th scope="col" className="ns-num">Amount</th></tr></thead>
                    <tbody>
                      {s.applications.map((a) => (
                        <tr key={a.id}>
                          <td className="fin-nowrap"><Link to={`/financials/invoices/${a.obligationId}`}>{recordRef(a.obligationId)}</Link></td>
                          <td>{instantWords(a.appliedAt)}</td>
                          <td>{a.status === "REVERSED" ? `Reversed${a.reversalReason ? ` — ${a.reversalReason}` : ""}` : "Applied"}</td>
                          <td className="ns-num">{money(a.amountMinor, s.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="ns-state">Nothing has been applied to a receivable yet.</p>}
            </section>

            <section className="ns-section" aria-label="Reconciliation evidence">
              <div className="ns-section__head"><h2 className="ns-section__title">Reconciliation Evidence</h2></div>
              {s.reconciliations.length > 0 ? (
                <ul className="fin-exception-list">
                  {s.reconciliations.map((r) => (
                    <li key={r.id}>{statusLabel(r.outcome)} · external reference {r.externalReference ?? "not recorded"}{r.reason ? ` — ${r.reason}` : ""}</li>
                  ))}
                </ul>
              ) : <p className="ns-state">No reconciliation evidence has been recorded: this settlement is unreconciled.</p>}
            </section>
            <p className="fin-section-note fin-identity-line">
              Record identifier <code>{s.id}</code>
              <FinAnnotation tip="The Finance register's own settlement id, shown for support and audit correlation." />
            </p>
          </>
        ) : null}
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
