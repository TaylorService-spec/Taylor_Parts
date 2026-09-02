// INVOICE DETAIL — /financials/invoices/:invoiceId (North Star P1, page 03 record view).
//
// An invoice number in a list is a label; an invoice a person can OPEN is a record. This composes
// that record from the same governed reporting read the collection already uses — no second read,
// no new authority, and no fact this system does not already hold.
//
// ════════ WHY THE URL CARRIES THE DOCUMENT ID ════════
//
// Invoice numbers are per-company sequences and they COLLIDE: INV-000001 exists for taylor, for
// ventana, and for the legacy uppercase TAYLOR. A number in the URL would be ambiguous, so the
// route uses the document id — which is also the established grammar for every other record route
// here (customers/:accountId, opportunities/sales-order/:salesOrderId). The NUMBER stays the human
// identity on the page, where the company beside it makes it unambiguous.
//
// ════════ ISSUED INVOICES ARE IMMUTABLE ════════
//
// There is deliberately no edit control, and there must never be one: an issued invoice is
// financial history. Corrections are separate governed events. An action appears only where its
// command AND its policy both exist — otherwise the page says why, rather than offering a button
// that would fail.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinancialsHonestSection,
  FinancialFigure,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import { useFinancialFacts } from "../../hooks/useFinancialFacts.js";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory.js";
import { useAccountNames } from "../../hooks/useAccountNames.js";
import { resolveEmployeeIdentity } from "../../domain/actorDisplayName.js";
import {
  FACTS_STATE,
  FACTS_DETAIL,
  financialFactsState,
  invoiceRow,
  formatByCurrency,
} from "../../domain/financialFactsView.js";

const dateWords = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString() : "Not recorded");
const money = (minor, currency) => formatByCurrency(currency ? { [currency]: minor } : {});

export default function FinancialsInvoiceDetail() {
  const { invoiceId } = useParams();

  // ponytail: selects one invoice from the bounded governed page rather than adding a
  // single-invoice read. Correct and cheap at this collection's size; when the set outgrows one
  // page the read gains an invoiceId filter — the seam is the request, not this component.
  const read = useFinancialFacts({});
  const { state, result } = financialFactsState(read);
  const answered = state === FACTS_STATE.READY || state === FACTS_STATE.EMPTY;

  const { byEmployeeId, loading: dirLoading, error: dirError } = useEmployeeDirectory();

  const found = useMemo(
    () => (answered ? ((result?.invoices ?? []).find((i) => i.invoiceId === invoiceId) ?? null) : null),
    [answered, result, invoiceId],
  );
  const applications = useMemo(
    () => (answered ? (result?.applications ?? []).filter((a) => a.invoiceId === invoiceId) : []),
    [answered, result, invoiceId],
  );
  const payments = useMemo(() => {
    const ids = new Set(applications.map((a) => a.paymentId));
    return (result?.payments ?? []).filter((p) => ids.has(p.paymentId));
  }, [applications, result]);

  const names = useAccountNames(found?.accountId ? [found.accountId] : []);
  const customerName = found?.accountId ? (names.get(found.accountId) ?? null) : null;

  const row = found ? invoiceRow(found) : null;
  const credited = found
    ? resolveEmployeeIdentity(found.creditedSalespersonId, {
        byEmployeeId,
        loading: dirLoading,
        error: dirError,
        noun: "salesperson",
      })
    : null;

  // NOT FOUND is distinct from DENIED and from a failed read. Within an answered result an id that
  // matches nothing is either outside this principal's visibility or not an invoice at all — and
  // the page cannot tell which, so it says exactly that instead of guessing.
  const honest = !answered
    ? { state, detail: FACTS_DETAIL[state] ?? null }
    : found
      ? { state: null }
      : {
          state: "NO_MATCHES",
          detail:
            "No invoice with this identifier is within your governed visibility. That is not a statement that the record does not exist: an invoice outside your scope is refused by the server, and this page cannot tell the two apart.",
        };

  return (
    <FinancialsPageFrame
      title={row ? row.invoiceNumber : "Invoice"}
      crumb={`Invoices → ${row ? row.invoiceNumber : "Record"}`}
      custody="One issued invoice. Issued invoices are immutable financial history — corrections are recorded as separate governed events, never as edits to this record."
      custodyTip="This record composes the same governed reporting read as the Invoices collection; nothing here is a second source of financial truth. Company authority came from the Sales Order's operatingCompanyId at issuance (FIN-002), and the credited salesperson is frozen on the invoice — neither is re-derived from the customer's current owner."
    >
      <p className="fin-section-note">
        <Link to="/financials/invoices">← All invoices</Link>
      </p>

      <FinancialsHonestSection
        id="fin-invoice-record"
        title="Invoice record"
        meta={row ? `${row.companyId ?? "company not attributed"} · ${row.position}` : null}
        honest={honest}
        subject="Invoice record"
      >
        {row ? (
          <>
            <section className="fin-scorecard-section" aria-label="Invoice amounts">
              <div className="fin-scorecard fin-scorecard--three">
                <div className="fin-scorecard__slot">
                  <FinancialFigure
                    label="Original amount"
                    factClass="OPERATIONAL_ACTUAL"
                    valueText={money(found.totalMinor, found.currency)}
                  />
                </div>
                <div className="fin-scorecard__slot">
                  <FinancialFigure
                    label="Applied"
                    factClass="OPERATIONAL_ACTUAL"
                    valueText={money(found.appliedMinor, found.currency)}
                  />
                </div>
                <div className="fin-scorecard__slot">
                  <FinancialFigure
                    label="Outstanding"
                    factClass="OPERATIONAL_ACTUAL"
                    valueText={money(found.outstandingMinor, found.currency)}
                  />
                </div>
              </div>
            </section>

            <div className="ns-table-wrap">
              <table className="ns-table fin-facts">
                <caption className="fo-sr-only">Invoice facts</caption>
                <tbody>
                  <tr>
                    <th scope="row">Invoice number</th>
                    <td className="fin-nowrap">{row.invoiceNumber}</td>
                  </tr>
                  <tr>
                    <th scope="row">Status</th>
                    <td>
                      {row.position}
                      {row.daysOverdue ? ` · ${row.daysOverdue} days overdue` : ""}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Lifecycle state</th>
                    <td>{found.state ?? "Not recorded"}</td>
                  </tr>
                  <tr>
                    <th scope="row">Customer</th>
                    <td>
                      {found.accountId ? (
                        <Link to={`/customers/${found.accountId}`}>
                          {customerName ?? "Customer name not resolved"}
                        </Link>
                      ) : (
                        "Not recorded"
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Operating company</th>
                    <td>{found.companyId ?? "Not attributed"}</td>
                  </tr>
                  <tr>
                    <th scope="row">Business unit</th>
                    <td>
                      {found.businessUnitIds.length === 0 ? "Not attributed" : found.businessUnitIds.join(" · ")}
                      {found.businessUnitIds.length === 0 ? (
                        <FinAnnotation tip="This invoice was issued by a command generation that predates FIN-002 line attribution. The absence is truthful history — it is not backfilled, and no unit is inferred for it." />
                      ) : null}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Credited salesperson</th>
                    <td>
                      {found.creditedSalespersonId ? (credited?.name ?? "Resolving…") : "Not attributed"}
                      <FinAnnotation tip="Frozen on the invoice at issuance (FIN-002). Never re-derived from the customer's current owner, from who created the record, or from any mutable Sales Order." />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Issued</th>
                    <td>{dateWords(found.issuedAtMillis)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Due</th>
                    <td>{dateWords(found.dueDate)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Currency</th>
                    <td>{found.currency ?? "Not recorded"}</td>
                  </tr>
                  <tr>
                    <th scope="row">Source Sales Order</th>
                    <td>
                      {found.salesOrderId ? (
                        <Link to={`/customers/opportunities/sales-order/${found.salesOrderId}`}>
                          {found.salesOrderId}
                        </Link>
                      ) : (
                        "Not recorded"
                      )}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Credits · charges · write-offs</th>
                    <td>
                      {money(found.creditsMinor, found.currency)} · {money(found.chargesMinor, found.currency)} ·{" "}
                      {money(found.writeOffMinor, found.currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="fin-truth-band" role="note">
              <strong>Issued invoices are immutable.</strong> Corrections are recorded as governed
              financial events against this invoice, never as edits to it.
              <FinAnnotation tip="The correction commands — credit, adjustment, write-off, refund — are merged and deployed, but FIN-007 approval policy (thresholds, approver roles, escalation) is not configured, so a correction cannot be raised from here yet. An action appears only where its command AND its policy both exist; offering one now would produce a button whose command refuses." />
            </div>

            <section className="ns-section" aria-label="Payment applications">
              <div className="ns-section__head">
                <h2 className="ns-section__title">Payment applications</h2>
                <span className="ns-section__meta">· each application is its own governed fact</span>
              </div>
              {applications.length > 0 ? (
                <div className="ns-table-wrap">
                  <table className="ns-table">
                    <caption className="fo-sr-only">Applications against this invoice</caption>
                    <thead>
                      <tr>
                        <th scope="col">Applied</th>
                        <th scope="col">Cash received</th>
                        <th scope="col">Method</th>
                        <th scope="col" className="ns-num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applications.map((a) => {
                        const p = payments.find((x) => x.paymentId === a.paymentId) ?? null;
                        return (
                          <tr key={a.applicationId}>
                            <td>{dateWords(a.appliedAtMillis)}</td>
                            <td>{p ? dateWords(p.receivedAtMillis) : "Not in scope"}</td>
                            <td>{p?.method ?? "Not recorded"}</td>
                            <td className="ns-num">{money(a.appliedAmountMinor, a.currency)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ns-state">No payment has been applied to this invoice.</p>
              )}
            </section>

            <section className="ns-section" aria-label="Invoice lines">
              <div className="ns-section__head">
                <h2 className="ns-section__title">Invoice lines</h2>
              </div>
              <p className="ns-state ns-state--na">
                Line detail is not carried by the governed reporting read. It exposes this invoice's
                amounts and attribution, not its line composition — so lines are named as absent
                rather than reconstructed from the Sales Order, which is a mutable record and not
                what this invoice froze.
              </p>
            </section>

            <p className="fin-section-note fin-identity-line">
              Record identifier <code>{found.invoiceId}</code>
              <FinAnnotation tip="The internal document id, shown for support and audit correlation only. The invoice NUMBER is the operator-facing identity; numbers are per-company sequences that repeat across companies, which is why the URL carries this id instead." />
            </p>
          </>
        ) : null}
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
