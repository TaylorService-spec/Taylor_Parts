// PAYMENT DETAIL — /financials/payments/:paymentId (North Star P1, page 05 record view).
//
// ════════ THE IDENTITY PROBLEM THIS PAGE SOLVES ════════
//
// A cash receipt has no governed number. CashReceiptRecord carries company, account, currency,
// amount, method, receivedAtMillis, externalRef and the applied/unapplied projection — and no
// sequence. The collection was therefore showing the Firestore document id as the operator-facing
// label, which tells a reader nothing they can act on.
//
// The identity here is COMPOSED from facts the record actually holds (date · customer · amount).
// It is not a number, it does not persist, and it is not a client-side sequence — inventing any of
// those would create a second identity the server has never heard of. The document id remains, in
// a Technical details block, labelled as what it is.
//
// The URL carries the document id because a URL is technical identity; the visible header does not.
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FinancialsPageFrame,
  FinancialsHonestSection,
  FinancialFigure,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import { useFinancialFacts } from "../../hooks/useFinancialFacts.js";
import { useAccountNames } from "../../hooks/useAccountNames.js";
import {
  FACTS_STATE,
  FACTS_DETAIL,
  financialFactsState,
  formatByCurrency,
  paymentIdentity,
  paymentContext,
} from "../../domain/financialFactsView.js";

const dateWords = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString() : "Not recorded");
const money = (minor, currency) => formatByCurrency(currency ? { [currency]: minor } : {});

export default function FinancialsPaymentDetail() {
  const { paymentId } = useParams();

  // ponytail: selects one receipt from the bounded governed page rather than adding a
  // single-payment read. Correct at this collection's size; the seam for growth is a paymentId
  // filter on the request, not a second read here.
  const read = useFinancialFacts({});
  const { state, result } = financialFactsState(read);
  const answered = state === FACTS_STATE.READY || state === FACTS_STATE.EMPTY;

  const payment = useMemo(
    () => (answered ? ((result?.payments ?? []).find((p) => p.paymentId === paymentId) ?? null) : null),
    [answered, result, paymentId],
  );

  // Applications carry the invoiceId; the invoice list carries its NUMBER. Joining them here is
  // presentation, not derivation — both facts came from the same governed response.
  const applications = useMemo(() => {
    const apps = (result?.applications ?? []).filter((a) => a.paymentId === paymentId);
    const byId = new Map((result?.invoices ?? []).map((i) => [i.invoiceId, i]));
    return apps.map((a) => ({ ...a, invoice: byId.get(a.invoiceId) ?? null, invoiceNumber: byId.get(a.invoiceId)?.invoiceNumber ?? null }));
  }, [result, paymentId]);

  const names = useAccountNames(payment?.accountId ? [payment.accountId] : []);
  const customerName = payment?.accountId ? (names.get(payment.accountId) ?? null) : null;

  const identity = payment ? paymentIdentity(payment, customerName) : "Payment";
  const context = payment ? paymentContext(payment, applications) : null;

  const honest = !answered
    ? { state, detail: FACTS_DETAIL[state] ?? null }
    : payment
      ? { state: null }
      : {
          state: "NO_MATCHES",
          detail:
            "No payment with this identifier is within your governed visibility. A payment is visible exactly when the invoice it settles is, so this may be a record outside your scope rather than one that does not exist — and this page cannot tell the two apart.",
        };

  return (
    <FinancialsPageFrame
      title={identity}
      crumb="Payments → Receipt"
      custody="One governed cash receipt. Received, applied, unapplied and reconciled are four different facts and are never blended."
      custodyTip="A receipt carries no governed number, so the heading is composed from the facts the record holds — the date the cash was received, the customer, and the amount. That composition is a label, not an identifier: it is never stored and never used as a key."
    >
      <p className="fin-section-note">
        <Link to="/financials/payments">← All payments</Link>
      </p>

      <FinancialsHonestSection
        id="fin-payment-record"
        title="Receipt"
        meta={context}
        honest={honest}
        subject="Payment record"
      >
        {payment ? (
          <>
            <section className="fin-scorecard-section" aria-label="Receipt amounts">
              <div className="fin-scorecard fin-scorecard--three">
                <div className="fin-scorecard__slot">
                  <FinancialFigure label="Received" factClass="OPERATIONAL_ACTUAL" valueText={money(payment.amountMinor, payment.currency)} />
                </div>
                <div className="fin-scorecard__slot">
                  <FinancialFigure label="Applied" factClass="OPERATIONAL_ACTUAL" valueText={money(payment.appliedMinor, payment.currency)} />
                </div>
                <div className="fin-scorecard__slot">
                  {/* NOT COMPUTED. Current authority refuses over-application, so no governed
                      record can carry an unapplied balance; printing received − applied here would
                      assert a fact the payment core forbids. */}
                  <FinancialFigure
                    label="Unapplied"
                    factClass="OPERATIONAL_ACTUAL"
                    absence="Future authority"
                    detail="Unapplied cash has no governed record under current authority: the payment core refuses over-application, so a receipt cannot carry an unapplied balance. Whether the workflow should exist is an open Owner policy question (FIN-PQ-UNAPPLIED-POLICY)."
                  />
                </div>
              </div>
            </section>

            <div className="ns-table-wrap">
              <table className="ns-table">
                <caption className="fo-sr-only">Receipt facts</caption>
                <tbody>
                  <tr>
                    <th scope="row">Customer</th>
                    <td>
                      {payment.accountId ? (
                        <Link to={`/customers/${payment.accountId}`}>{customerName ?? "Customer name not resolved"}</Link>
                      ) : (
                        "Not recorded"
                      )}
                    </td>
                  </tr>
                  <tr><th scope="row">Operating company</th><td>{payment.companyId ?? "Not attributed"}</td></tr>
                  <tr><th scope="row">Cash received</th><td>{dateWords(payment.receivedAtMillis)}</td></tr>
                  <tr><th scope="row">Method</th><td>{payment.method ?? "Not recorded"}</td></tr>
                  <tr>
                    <th scope="row">External reference</th>
                    {/* undefined and null mean different things here. The deployed function can be
                        older than this bundle, in which case the field is simply ABSENT from the
                        response — saying "None recorded" then would assert the receipt carries no
                        reference when it may well carry one. */}
                    <td>
                      {payment.externalRef
                        ? payment.externalRef
                        : Object.hasOwn(payment, "externalRef")
                          ? "None recorded"
                          : "Not supplied by this read"}
                    </td>
                  </tr>
                  <tr><th scope="row">Currency</th><td>{payment.currency ?? "Not recorded"}</td></tr>
                </tbody>
              </table>
            </div>

            <section className="ns-section" aria-label="Applications">
              <div className="ns-section__head">
                <h2 className="ns-section__title">Applied to</h2>
                <span className="ns-section__meta">· each application is its own governed fact</span>
              </div>
              {applications.length > 0 ? (
                <div className="ns-table-wrap">
                  <table className="ns-table">
                    <caption className="fo-sr-only">Invoices this receipt was applied to</caption>
                    <thead>
                      <tr>
                        <th scope="col">Invoice</th>
                        <th scope="col">Applied on</th>
                        <th scope="col" className="ns-num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applications.map((a) => (
                        <tr key={a.applicationId}>
                          <td className="fin-nowrap">
                            {a.invoice ? (
                              <Link to={`/financials/invoices/${a.invoice.invoiceId}`}>{a.invoiceNumber}</Link>
                            ) : (
                              "Invoice outside your scope"
                            )}
                          </td>
                          <td>{dateWords(a.appliedAtMillis)}</td>
                          <td className="ns-num">{money(a.appliedAmountMinor, a.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ns-state">This receipt has no application within your visibility.</p>
              )}
            </section>

            {/* GOVERNED ACTIONS, classified rather than guessed. A control appears only where its
                command AND its policy both exist; a Function existing is not sufficient. */}
            <div className="fin-truth-band" role="note">
              <strong>Payment state changes through governed events, never by editing this record.</strong>
              <p>
                Applying cash, refunding and adjusting are separate governed commands with their own
                authority. None is offered here: <em>applyPayment</em> is reached from the invoice
                being settled rather than from a receipt, and <em>recordRefund</em> and{" "}
                <em>recordInvoiceAdjustment</em> are deployed but their FIN-007 approval policy —
                thresholds, approver roles, escalation — is unconfigured, so a correction raised now
                would be refused.
                <FinAnnotation tip="Classification against current authority: Apply payment = AUTHORITY_BLOCKED from this surface (invoice-scoped command). Refund / reverse = POLICY_BLOCKED (command deployed, FIN-007 policy unconfigured). Adjust = POLICY_BLOCKED (same). Reconcile = FUTURE (FIN-010 has no external provider and no results read). There is deliberately no status control: a payment's state is the sum of its governed events." />
              </p>
            </div>

            <section className="ns-section" aria-label="Technical details">
              <div className="ns-section__head">
                <h2 className="ns-section__title">Technical details</h2>
              </div>
              <p className="fin-section-note fin-identity-line">
                Record identifier <code>{payment.paymentId}</code>
                <FinAnnotation tip="The internal document id, kept for support and audit correlation. It is a database key, not a payment number — this system has no governed payment numbering, so the heading composes an identity from the receipt's own facts instead." />
              </p>
            </section>
          </>
        ) : null}
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
