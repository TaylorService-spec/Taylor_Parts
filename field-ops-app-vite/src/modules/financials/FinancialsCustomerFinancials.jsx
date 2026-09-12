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
import { companyAttribution } from "../../domain/companyAttribution.js";

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

  // WHOSE MONEY THESE FIVE FIGURES ARE.
  //
  // This page has no Company control — unlike every other Financials page, which carries the shared
  // filter rail — and it never had one, because it is the CUSTOMER's page and a customer is not a
  // company. But an account is not company-partitioned either: an invoice's operating company is
  // stamped from its Sales Order, so a customer who buys from both operating companies produces a
  // Billed/Collected/Outstanding figure here that silently spans Taylor and Ventana, with nothing on
  // screen saying so. That is a number a salesperson acts on.
  //
  // The fix is DISCLOSURE, not a filter: the consolidated totals stay (they are a real answer to a
  // real question), and the server's own partition — accumulated in the same pass, so it reconciles
  // to them exactly — is stated beside them. Nothing here adds, nets or splits money; if the
  // governed read supplies no partition, `supplied` is false and the page renders precisely as it
  // does today rather than asserting a breakdown it never received.
  const company = companyAttribution(summary);
  const showCompany = company.supplied && company.spansMultipleCompanies;

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

          {/* THE DISCLOSURE. Rendered only when the governed read's OWN summary says the figures
              span more than one operating company. A single-company customer gets nothing added —
              one company is not a disclosure — and a read that carries no company dimension at all
              gets nothing added either, because a breakdown that was never received must not be
              implied. Every amount below is the server's; this table selects and formats. */}
          {showCompany ? (
            <section className="ns-section" aria-label="Operating company breakdown">
              <div className="ns-section__head">
                <h2 className="ns-section__title">By operating company</h2>
                <span className="ns-section__meta">· governed company per invoice, never inferred</span>
              </div>
              <p className="fin-truth-band" role="note">
                <strong>The figures above span more than one operating company.</strong> {company.spanNote}
                <FinAnnotation tip="An invoice's operating company is stamped from its Sales Order's governed operatingCompanyId and is never inferred from the account, its owner, its salesperson, its line of business or a display name. The split below is the server's own partition of the same facts, accumulated in the same pass as the consolidated totals, so the rows reconcile to them exactly." />
              </p>
              <div className="ns-table-wrap">
                <table className="ns-table">
                  <caption className="fo-sr-only">
                    This customer&rsquo;s billed, collected and outstanding totals per operating company
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Operating company</th>
                      <th scope="col" className="ns-num">Invoices</th>
                      <th scope="col" className="ns-num">Billed</th>
                      <th scope="col" className="ns-num">Collected</th>
                      <th scope="col" className="ns-num">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {company.rows.map((row) => (
                      <tr key={row.key}>
                        {/* Unattributed money keeps its OWN row rather than being folded into a
                            company or dropped. Without it the parts would quietly fail to add up
                            to the consolidated totals above, which is what makes them trustworthy. */}
                        <th scope="row">{row.label}</th>
                        <td className="ns-num">{row.invoiceCount ?? "—"}</td>
                        <td className="ns-num">{row.billedText}</td>
                        <td className="ns-num">{row.collectedText}</td>
                        <td className="ns-num">{row.outstandingText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {company.unattributedNote ? (
                <p className="fin-section-note">{company.unattributedNote}</p>
              ) : null}
              <p className="fin-section-note">
                This page has no Company filter: it answers a question about a customer, and a
                customer is not a company. The rows are stated rather than selected, and no total
                here is assembled in the browser.
              </p>
            </section>
          ) : null}

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
