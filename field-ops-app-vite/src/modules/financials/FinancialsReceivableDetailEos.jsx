// RECEIVABLE DETAIL -- /financials/invoices/:invoiceId WHERE AN EOS API IS DECLARED (Firebase exit B1, DECISIONS #B1).
//
// One Finance-register receivable: its amounts, who owes it, where it came from, how it has been settled and every fact that makes up
// its history. Replaces the Firebase invoice record page. The URL carries the register's own record id.
//
// WHAT IS SHOWN, AND WHAT IS NAMED AS NOT SUPPLIED. The invoice number, the issue date and the business unit are not carried by the
// register (model decisions MD-B1-1 .. MD-B1-3, domain/financialsEos.js): each row says so by name instead of leaving a blank. The
// credited salesperson is shown for ATTRIBUTED rows only -- derived from the source Sales Order's credit recorded when the order was
// created, never the Account's current owner; an unattributed or unattributable row says which and why.
//
// HISTORY IS APPEND-ONLY. The facts below are the register's: an origination, every settlement applied against it, and any reversal or
// correction, each its own fact with the original kept. Nothing on this page edits anything.
import { useParams, Link } from "react-router-dom";
import { FinancialsPageFrame, FinancialsHonestSection, FinancialFigure, FinAnnotation } from "./FinancialsPrimitives.jsx";
import { companyWords } from "./financialsDisplay.js";
import { statusLabel } from "../../shared/display/displayLabels.js";
import { useAccountNames } from "../../hooks/useAccountNames.js";
import { useGovernedEmployeeDirectory } from "../../hooks/useGovernedEmployeeDirectory.js";
import { useEosFinanceRead } from "../../hooks/useEosFinanceRead.js";
import { resolveEmployeeIdentity } from "../../domain/actorDisplayName.js";
import { FACTS_STATE, FACTS_DETAIL } from "../../domain/financialFactsView.js";
import { NOT_SUPPLIED, receivablePosition, dayMillis, settlementKindWords } from "../../domain/financialsEos.js";
import { formatMoneyDisplay } from "../../domain/moneyDisplay.js";

const money = (minor, currency) => formatMoneyDisplay(Number(minor), currency);
const dateWords = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString() : "Not recorded");
const instantWords = (iso) => (iso ? new Date(iso).toLocaleString() : "Not recorded");
const POSITION_WORDS = { OVERDUE: "Overdue", CURRENT: "Current", SETTLED: "Settled", VOID: "Void", UNKNOWN: "Position not recorded" };

export default function FinancialsReceivableDetailEos() {
  const { invoiceId } = useParams();
  const read = useEosFinanceRead((reader) => reader.receivable(invoiceId), invoiceId);
  const found = read.result;
  const answered = !read.loading && !read.errorStatus && found !== null;
  const state = read.loading ? FACTS_STATE.LOADING : read.errorStatus === "denied" ? FACTS_STATE.DENIED : read.errorStatus === "notFound" ? "NO_MATCHES" : FACTS_STATE.UNAVAILABLE;

  const accountId = found?.counterparty?.crmAccountId ?? null;
  const names = useAccountNames(accountId ? [accountId] : []);
  const creditedId = found?.attribution?.state === "ATTRIBUTED" ? found.attribution.creditedSalespersonEmployeeId : null;
  const directory = useGovernedEmployeeDirectory({ enabled: Boolean(creditedId), employeeIds: creditedId ? [creditedId] : [] });
  const credited = creditedId ? resolveEmployeeIdentity(creditedId, { byEmployeeId: directory.byEmployeeId, loading: directory.loading, error: directory.error, noun: "salesperson" }) : null;

  const position = found ? receivablePosition(found) : null;
  const honest = answered
    ? { state: null }
    : state === "NO_MATCHES"
      ? { state: "NO_MATCHES", detail: "No receivable with this identifier is within your visibility. That is not a statement that the record does not exist: a record outside your companies or your credited-person / team reach is refused exactly like one that is absent." }
      : { state, detail: FACTS_DETAIL[state] ?? null };

  return (
    <FinancialsPageFrame
      title={found ? `Receivable ${found.id}` : "Receivable"}
      crumb="Receivables → Record"
      custody="One receivable from the Finance register. EOS operational truth that money is owed — not the accounting invoice. History is append-only; corrections are separate governed events."
      custodyTip="The register records the receivable, each settlement applied against it, and any reversal or correction as separate facts. The formal invoice (number, issue date) belongs to the accounting authority (DECISIONS #191, #197) and is named as not supplied here, never invented."
    >
      <p className="fin-section-note"><Link to="/financials/invoices">← All receivables</Link></p>

      <FinancialsHonestSection id="fin-receivable-record" title="Receivable Record" meta={found ? `${companyWords(found.operatingCompanyId)} · ${POSITION_WORDS[position]}` : null} honest={honest} subject="Receivable record">
        {found ? (
          <>
            <section className="fin-scorecard-section" aria-label="Receivable amounts">
              <div className="fin-scorecard fin-scorecard--three">
                <div className="fin-scorecard__slot"><FinancialFigure label="Original Amount" factClass="OPERATIONAL_ACTUAL" valueText={money(found.originatedMinor, found.currency)} /></div>
                <div className="fin-scorecard__slot"><FinancialFigure label="Settled" factClass="OPERATIONAL_ACTUAL" valueText={money(found.settledMinor, found.currency)} /></div>
                <div className="fin-scorecard__slot"><FinancialFigure label="Outstanding" factClass="OPERATIONAL_ACTUAL" valueText={money(found.outstandingMinor, found.currency)} /></div>
              </div>
            </section>

            <div className="ns-table-wrap">
              <table className="ns-table fin-facts">
                <caption className="fo-sr-only">Receivable facts</caption>
                <tbody>
                  <tr><th scope="row">Status</th><td>{POSITION_WORDS[position]} · {statusLabel(found.status)}</td></tr>
                  <tr><th scope="row">Customer</th><td>{accountId ? <Link to={`/customers/${accountId}`}>{names.get(accountId) ?? found.counterparty?.name ?? "Customer name not resolved"}</Link> : "Not recorded"}</td></tr>
                  <tr><th scope="row">Operating Company</th><td>{companyWords(found.operatingCompanyId, { short: false })}</td></tr>
                  <tr><th scope="row">Invoice Number</th><td>{NOT_SUPPLIED.invoiceNumber.words}</td></tr>
                  <tr><th scope="row">Issue Date</th><td>{NOT_SUPPLIED.issueDate.words}</td></tr>
                  <tr><th scope="row">Recorded</th><td>{instantWords(found.recordedAt)}</td></tr>
                  <tr><th scope="row">Due</th><td>{found.dueOn ? dateWords(dayMillis(found.dueOn)) : "No governed due date"}</td></tr>
                  <tr><th scope="row">Business Unit</th><td>{NOT_SUPPLIED.businessUnit.words}</td></tr>
                  <tr>
                    <th scope="row">Credited Salesperson</th>
                    <td>
                      {found.attribution?.state === "ATTRIBUTED" ? (credited?.name ?? "Resolving…") : `Not attributed — ${found.attribution?.reason ?? "no attribution recorded"}`}
                      <FinAnnotation tip="Derived from the source Sales Order's credited salesperson, recorded when the order was created and never changed afterwards (FIN-002). Never the Account's current owner, the creator, or the current reporting line." />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Source Sales Order</th>
                    <td>{found.sourceSalesOrder ? <Link to={`/customers/opportunities/sales-order/${found.sourceSalesOrder.id}`}>{found.sourceSalesOrder.salesOrderNumber ?? found.sourceSalesOrder.id}</Link> : "No Sales Order source"}</td>
                  </tr>
                  <tr><th scope="row">Kind</th><td>{statusLabel(found.kind)} · {found.sourceDomain}</td></tr>
                  <tr><th scope="row">Currency</th><td>{found.currency}</td></tr>
                </tbody>
              </table>
            </div>

            <section className="ns-section" aria-label="Settlement applications">
              <div className="ns-section__head"><h2 className="ns-section__title">Settlement Applications</h2><span className="ns-section__meta">· each application is its own governed fact</span></div>
              {found.applications.length > 0 ? (
                <div className="ns-table-wrap">
                  <table className="ns-table">
                    <caption className="fo-sr-only">Settlements applied to this receivable</caption>
                    <thead><tr><th scope="col">Settlement</th><th scope="col">Kind</th><th scope="col">Business Date</th><th scope="col">Status</th><th scope="col" className="ns-num">Amount</th></tr></thead>
                    <tbody>
                      {found.applications.map((a) => (
                        <tr key={a.id}>
                          <td className="fin-nowrap"><Link to={`/financials/payments/${a.settlementId}`}>{a.sourceReference}</Link></td>
                          <td>{settlementKindWords(a.settlementKind)}</td>
                          <td>{dateWords(dayMillis(a.businessDate))}</td>
                          <td>{a.status === "REVERSED" ? "Reversed" : "Applied"}</td>
                          <td className="ns-num">{money(a.amountMinor, found.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="ns-state">No settlement has been applied to this receivable.</p>}
            </section>

            <section className="ns-section" aria-label="Accounting handoffs">
              <div className="ns-section__head"><h2 className="ns-section__title">Accounting Handoffs</h2></div>
              {found.accountingHandoffs.length > 0 ? (
                <ul className="fin-exception-list">
                  {found.accountingHandoffs.map((h) => (
                    <li key={h.id}>{statusLabel(h.payloadKind)} · {statusLabel(h.status)}{h.providerDocumentReference ? ` · accounting reference ${h.providerDocumentReference}` : " · no accounting reference yet"}</li>
                  ))}
                </ul>
              ) : <p className="ns-state">No accounting handoff has been prepared for this receivable.</p>}
            </section>

            <section className="ns-section" aria-label="History">
              <div className="ns-section__head"><h2 className="ns-section__title">History</h2><span className="ns-section__meta">· append-only facts; a reversal keeps the original</span></div>
              <div className="ns-table-wrap">
                <table className="ns-table">
                  <caption className="fo-sr-only">Financial facts of this receivable</caption>
                  <thead><tr><th scope="col">Effective</th><th scope="col">Fact</th><th scope="col">Source</th><th scope="col">Reversal</th><th scope="col" className="ns-num">Amount</th></tr></thead>
                  <tbody>
                    {found.facts.map((f) => (
                      <tr key={f.id}>
                        <td>{instantWords(f.effectiveAt)}</td>
                        <td>{statusLabel(f.factType)}{f.reason ? ` — ${f.reason}` : ""}</td>
                        <td>{f.sourceDomain}</td>
                        <td>{f.reversesFactId ? `Reverses ${f.reversesFactId}` : "—"}</td>
                        <td className="ns-num">{money(f.amountMinor, found.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="fin-section-note fin-identity-line">
              Record identifier <code>{found.id}</code>
              <FinAnnotation tip="The Finance register's own record id, shown for support and audit correlation. It is not an invoice number (MD-B1-1)." />
            </p>
          </>
        ) : null}
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
