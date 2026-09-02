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
import { useFinancialFacts } from "../../hooks/useFinancialFacts.js";
import { FACTS_STATE, FACTS_DETAIL, financialFactsState, formatByCurrency } from "../../domain/financialFactsView.js";

// THE FIVE SUMMARY FIGURES the approved handoff specifies: Booked / Billed / Collected /
// Outstanding / Credits.
//
// Outstanding is a SLOT, not a computed figure. The wired AR read below returns
// `summary.outstandingByCurrency` — a per-currency map — and this page must not collapse it
// into one number: "multi-currency balances list per currency, never summed" is the same
// rule AccountArSection states, and summing across currencies would be exactly the
// client-side financial authority this family forbids. So the figure keeps its place and
// states its absence; the per-invoice outstanding truth is rendered by the AR section.
const SUMMARY_SLOTS = [
  ...LIFECYCLE_SCORECARD_SLOTS.filter((s) => ["booked", "billed", "collected"].includes(s.key)),
  { key: "outstanding", label: "Outstanding", factClass: "OPERATIONAL_ACTUAL" },
  { key: "credits", label: "Credits", factClass: "OPERATIONAL_ACTUAL", absence: "No corrections read" },
];

export default function FinancialsCustomerFinancials() {
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState(null);
  const search = useAccountSearch(term);

  // ACCOUNT-SCOPED governed read. The account id is a REQUESTED FILTER, not authorization: the
  // server intersects it with this principal's FIN-004 reach, so choosing a customer you cannot see
  // returns nothing rather than their figures. The read is issued only once a customer is chosen —
  // an unfiltered account read on an empty search would be a whole-book query nobody asked for.
  const facts = useFinancialFacts({ accountId: selected?.id ?? null }, { enabled: Boolean(selected) });
  const { state: factsState, result: factsResult } = financialFactsState(facts);
  const factsAnswered = factsState === FACTS_STATE.READY || factsState === FACTS_STATE.EMPTY;
  const summary = factsAnswered ? (factsResult?.summary ?? {}) : {};

  // Each slot reads ONE server-computed per-currency total, or names its own absence. Booked is not
  // an invoice fact and Credits has no governed read — neither is approximated from what is here.
  const slotFigure = (key) => {
    const field = { billed: "billedByCurrency", collected: "collectedByCurrency", outstanding: "outstandingByCurrency" }[key];
    if (!field) return null;
    if (!factsAnswered) return null;
    const byCurrency = summary[field];
    return byCurrency && typeof byCurrency === "object" ? formatByCurrency(byCurrency) : null;
  };
  const slotAbsence = (slot) => {
    if (slot.key === "booked") return "Not an invoice fact";
    if (slot.key === "credits") return slot.absence ?? "No corrections read";
    if (!factsAnswered) return factsState === FACTS_STATE.LOADING ? "Reading…" : factsState === FACTS_STATE.DENIED ? "Withheld" : "Unavailable";
    return "Not supplied by this read";
  };

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
            <div className="fin-scorecard fin-scorecard--five">
              {SUMMARY_SLOTS.map((slot) => (
                <div key={slot.key} className="fin-scorecard__slot">
                  <FinancialFigure
                    label={slot.label}
                    factClass={slot.factClass}
                    valueText={slotFigure(slot.key)}
                    absence={slotAbsence(slot)}
                    detail={slot.key === "booked" ? "Booked value is established on the Sales Order, not the invoice. This read exposes invoice facts, so Billed is never substituted for it." : slot.key === "credits" ? "No governed read exposes correction events for a customer yet. The adjustment commands are merged; their read surface is not built, and a figure is not inferred from invoice credits." : FACTS_DETAIL[factsState] ?? null}
                  />
                </div>
              ))}
            </div>
            <p className="fin-section-note">
              Billed, Collected and Outstanding are server-computed totals for this customer,
              scoped by your governed visibility and listed per currency — never summed across
              currencies here. Booked and Credits keep their places and state why they are absent.
            </p>
          </section>

          <div className="fin-overview-grid">
            <div>
              <section className="ns-section" aria-label="Sales versus Service">
                <div className="ns-section__head">
                  <h2 className="ns-section__title">Sales vs Service</h2>
                  <span className="ns-section__meta">· split from source lineage, never inferred</span>
                </div>
                <p className="ns-state ns-state--na">
                  No split to show. The split is read from each event&rsquo;s source lineage
                  (Sales Order vs Work Order); this page composes no lineage read yet, and a
                  customer&rsquo;s activity is never apportioned by guess.
                  <FinAnnotation tip="Unattributed lineage is reported as unattributed, never guessed. A split inferred from anything other than the governed source record would be a fabricated attribution — the same defect class as a fabricated number." />
                </p>
              </section>

              {/* The real composition: the same governed AR section the Account page mounts,
                  reading listAccountInvoiceAr. DENIED, UNAVAILABLE and EMPTY all render
                  their own honest states inside it. */}
              <AccountArSection accountId={selected.id} />

              <section className="ns-section" aria-label="Financial history">
                <div className="ns-section__head">
                  <h2 className="ns-section__title">Financial history</h2>
                  <span className="ns-section__meta">· newest first · every event links to its owning record</span>
                </div>
                <p className="ns-state ns-state--na">
                  No event ledger to show. The ledger composes invoice, payment and correction
                  events for this customer; those read surfaces are not built, so no history is
                  assembled here — and none is reconstructed from what the page can already see.
                </p>
              </section>
            </div>

            <aside className="fin-rail">
              <section className="ns-section" aria-label="Open items">
                <div className="ns-section__head">
                  <h2 className="ns-section__title">Open items</h2>
                </div>
                <p className="ns-state ns-state--na">
                  Unapplied payments and blocked billing carry their exception colours here when
                  their reads are composed. Neither read exists on this page today, so no open
                  item is listed — and none is implied by silence: the receivables section above
                  states its own result.
                </p>
              </section>

              <section className="ns-section" aria-label="Context">
                <div className="ns-section__head">
                  <h2 className="ns-section__title">Context</h2>
                </div>
                {/* Deliberately no second "Account record →" link: the identity line at the
                    top of the page already carries it, and one destination should not have
                    two links on one page. */}
                <p className="ns-state ns-state--na">
                  Terms, credit posture and ownership are Customer authority. They are read from
                  the Account record linked in the identity line above — this page never restates
                  or edits them.
                </p>
              </section>
            </aside>
          </div>
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
