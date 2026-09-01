// CUSTOMER FINANCIALS — /financials/customer-financials (North Star P1, page 07).
//
// Design authority: docs/north-star/financials/North Star - Financials 07 Customer Financials.dc.html.
// A COMPOSED VIEW: customer identity stays Customer authority (the existing certified
// Account record — linked, never duplicated); financial events stay Financial authority.
// No new truth collection, no duplicated summary document.
//
// Composition today: the existing governed account name search (domain/accountSearch.js —
// the ONE bounded search read) selects the customer, and the ONE wired governed finance
// read (listAccountInvoiceAr, via the existing AccountArSection) composes that account's
// per-invoice receivables. Every other summary figure keeps its slot with its honest
// state until its read activates. Figures must reconcile to owning records to the cent —
// which is exactly why nothing here recomputes them client-side.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAccountSearch } from "../../hooks/useAccountSearch";
import AccountArSection from "../accounts/AccountArSection.jsx";
import { FinancialsPageFrame, FinAnnotation, FinancialFigure } from "./FinancialsPrimitives.jsx";
import { LIFECYCLE_SCORECARD_SLOTS } from "../../domain/financialsSurface.js";

// The five summary slots for one customer (page 07 grammar): Booked / Billed / Collected /
// Outstanding / Credits. Outstanding activates first — it is the AR read AccountArSection
// already composes per invoice; the summary figure itself waits for the same activation.
const SUMMARY_SLOTS = LIFECYCLE_SCORECARD_SLOTS.filter((s) =>
  ["booked", "billed", "collected"].includes(s.key),
);

export default function FinancialsCustomerFinancials() {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState(null);
  const search = useAccountSearch(term);

  return (
    <FinancialsPageFrame
      title="Customer Financials"
      crumb="Customer Financials"
      custody="Customer-centric composition of governed Sales and Service financial facts. Identity stays with the Customer record; every figure reconciles to its owning financial record."
      custodyTip="A composed view, not a truth store: no separate customer financial summary document exists. Unattributed lineage is reported as unattributed, never guessed. Sales vs Service splits come from source lineage when the composing reads activate."
    >
      <section className="ns-section" aria-label="Customer selector">
        <label className="fin-search-label" htmlFor="fin-customer-search">
          Customer
        </label>
        <input
          id="fin-customer-search"
          className="fin-search-input"
          type="search"
          placeholder="Search customer names…"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setSelected(null);
          }}
          autoComplete="off"
        />
        {search.state === "LOADING" ? <p className="ns-state">Searching…</p> : null}
        {search.message ? <p className="ns-state ns-state--na">{search.message}</p> : null}
        {(search.state === "READY" || search.state === "TRUNCATED") && !selected ? (
          <ul className="fin-search-results">
            {search.results.map((account) => (
              <li key={account.id}>
                <button type="button" className="fin-search-result" onClick={() => setSelected(account)}>
                  {account.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {selected ? (
        <>
          <section className="ns-section" aria-label="Customer identity">
            <p className="fin-identity-line">
              <strong>{selected.name}</strong>
              <span aria-hidden="true"> · </span>
              <Link to={`/customers/${selected.id}`}>Account record →</Link>
              <FinAnnotation tip="Customer identity is the certified Account record's alone. This page links to it and never restates or edits it." />
            </p>
          </section>

          <section className="fin-scorecard-section" aria-label="Financial summary">
            <div className="fin-scorecard fin-scorecard--customer">
              {SUMMARY_SLOTS.map((slot) => (
                <div key={slot.key} className="fin-scorecard__slot">
                  <FinancialFigure
                    label={slot.label}
                    factClass={slot.factClass}
                    absence="No read on this surface"
                  />
                </div>
              ))}
              <div className="fin-scorecard__slot">
                <FinancialFigure label="Credits" factClass="OPERATIONAL_ACTUAL" absence="No corrections read" />
              </div>
            </div>
            <p className="fin-section-note">
              Summary figures activate with their governed reads; the per-invoice receivables below
              are the one governed finance read wired today (server-authorized, fail-closed).
            </p>
          </section>

          {/* The real composition: the same governed AR section the Account page mounts,
              reading listAccountInvoiceAr under finance.read + finance.visibility.*.
              DENIED and UNAVAILABLE render their own honest states inside. */}
          <AccountArSection accountId={selected.id} />
        </>
      ) : (
        <p className="ns-state ns-state--na">
          Select a customer to compose their governed financial facts. Nothing is fetched until a
          customer is chosen.
        </p>
      )}
    </FinancialsPageFrame>
  );
}
