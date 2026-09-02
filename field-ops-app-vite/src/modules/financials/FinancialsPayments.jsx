// PAYMENTS — /financials/payments (North Star P1, page 05).
//
// Design authority: docs/north-star/financials/North Star - Financials 05 Payments.dc.html —
// APPROVED AS DRAWN. RECEIVED ≠ APPLIED ≠ UNAPPLIED ≠ RECONCILED.
//
// WIRED to the governed reporting read. Payments reach this page only through the invoices the
// principal can see: a payment is visible exactly when the invoice it settles is, which is why
// there is no separate payments authorization to reason about here.
//
// The UNAPPLIED column is not computed. Current payment authority refuses over-application, so no
// governed record can truthfully carry an unapplied balance, and a subtraction printed in that
// column would be arithmetic asserting a fact the system forbids. It stays named as FUTURE
// AUTHORITY (FIN-AG-PAYMENT-UNAPPLIED) in the band above and dashed in the table.
import { useState } from "react";
import {
  FinancialsPageFrame,
  FinancialsFilterRail,
  FinancialsHonestSection,
  FinAnnotation,
} from "./FinancialsPrimitives.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { useFinancialFacts } from "../../hooks/useFinancialFacts.js";
import { useFinancialsPeriod } from "../../hooks/useFinancialsPeriod.js";
import { FACTS_STATE, FACTS_DETAIL, financialFactsState, formatByCurrency } from "../../domain/financialFactsView.js";

const VIEW_OPTIONS = [
  { key: "all", label: "All" },
  { key: "unapplied", label: "Unapplied" },
  { key: "applied", label: "Fully applied" },
];

const dateWords = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString() : "—");
const amount = (minor, currency) => formatByCurrency(currency ? { [currency]: minor } : {});

export default function FinancialsPayments() {
  const [company, setCompany] = useState("consolidated");
  const [view, setView] = useState("all");
  const period = useFinancialsPeriod();

  // NOTE ON DATE SEMANTICS: the reporting read scopes a period by the INVOICE issued date, which is
  // the one canonical event date it carries. Payments here are therefore the applications against
  // invoices issued in the window — not receipts banked in it. The control says so rather than
  // implying a payment-date filter this read does not offer.
  const read = useFinancialFacts(
    {
      companyId: company === "consolidated" ? null : company,
      factTypes: ["PAYMENT_RECEIPT", "PAYMENT_APPLICATION"],
      ...period.requestFields,
    },
    { enabled: !period.blocked },
  );
  const { state, result } = financialFactsState(read);

  // READY and EMPTY both mean the server answered; only the record count differs.
  const answered = state === FACTS_STATE.READY || state === FACTS_STATE.EMPTY;
  const payments = answered ? (result?.payments ?? []) : [];
  // "Unapplied" selects records whose received amount exceeds what was applied. Under current
  // authority that set is always empty — which is the truth the band above states, shown rather
  // than asserted.
  const rows =
    view === "unapplied"
      ? payments.filter((p) => p.amountMinor > p.appliedMinor)
      : view === "applied"
        ? payments.filter((p) => p.amountMinor === p.appliedMinor)
        : payments;

  const honest =
    answered && rows.length === 0
      ? {
          state: "EMPTY",
          detail:
            view === "unapplied"
              ? "No governed payment carries an unapplied balance. Current payment authority refuses over-application, so this view is empty as a matter of what the system permits — not because a read failed."
              : period.presetKey === "all"
                ? "The governed read answered, and no payment settles an invoice within your visibility scope."
                : `No payments against invoices issued in this period (${period.label}). Choose All activity to see the full set.`,
        }
      : answered
        ? { state: null }
        : { state, detail: FACTS_DETAIL[state] ?? null };

  return (
    <FinancialsPageFrame
      title="Payments"
      crumb="Payments"
      custody="Governed operational payment workspace. Received, applied, unapplied and reconciled are four different facts and are never blended."
      custodyTip="The payment core records cash receipt and application to an invoice, derives outstanding balance, and refuses over-application. Applied-in-full is an operational state, not reconciliation — no banking or settlement authority is drawn, deliberately."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} period={period.controlProps} />
      <FilterBar variant="views" label="Payment views" options={VIEW_OPTIONS} activeKey={view} onChange={setView} />

      <div className="fin-truth-band fin-truth-band--future" role="note">
        <strong>Unapplied cash — FUTURE AUTHORITY.</strong>
        <p>
          A real unapplied-cash balance workflow is not implemented: current payment authority
          refuses over-application, so no record can truthfully carry an unapplied balance today.
          Whether such a workflow should exist at all is an open Owner policy question
          (FIN-PQ-UNAPPLIED-POLICY). This composition keeps the North Star target visible without
          enabling the behavior or seeding fake records.
          <FinAnnotation tip="Design page 05 is approved as drawn with the unapplied-cash content labelled FUTURE AUTHORITY (FIN-AG-PAYMENT-UNAPPLIED). The Unapplied view above stays part of the approved grammar; it selects over governed records only, so it shows what they truthfully contain — today, nothing." />
        </p>
      </div>

      <FinancialsHonestSection
        id="fin-payments-collection"
        title="Payment collection"
        meta="applications drill to invoice records · reconciliation absence stated, never implied"
        honest={honest}
        subject="Payment reads"
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Governed payments</caption>
            <thead>
              <tr>
                <th scope="col">Payment</th>
                <th scope="col">Customer</th>
                <th scope="col">Received</th>
                <th scope="col">Method · Reference</th>
                <th scope="col" className="ns-num">Amount</th>
                <th scope="col" className="ns-num">Applied</th>
                <th scope="col" className="ns-num">
                  Unapplied
                  <FinAnnotation tip="Never computed on this page. Unapplied cash has no governed record under current authority, and printing amount minus applied here would assert a balance the payment core forbids." />
                </th>
              </tr>
            </thead>
            {rows.length > 0 ? (
              <tbody>
                {rows.map((p) => (
                  <tr key={p.paymentId}>
                    <td>{p.paymentId}</td>
                    <td>{p.accountId ?? "—"}</td>
                    <td>{dateWords(p.receivedAtMillis)}</td>
                    <td>{p.method ?? "Not recorded"}</td>
                    <td className="ns-num">{amount(p.amountMinor, p.currency)}</td>
                    <td className="ns-num">{amount(p.appliedMinor, p.currency)}</td>
                    <td className="ns-num">—</td>
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
