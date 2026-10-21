// RECEIVABLES -- /financials/invoices and /financials/accounts-receivable WHERE AN EOS API IS DECLARED (Firebase exit B1, DECISIONS #B1).
//
// The Finance register's RECEIVABLE obligations -- EOS operational truth that money is owed (DECISIONS #197), NOT the accounting
// invoice. This is the replacement for the Firebase `listFinancialFacts` Invoices and Accounts Receivable pages: the same grammar
// (filter rail, views, honest states), the EOS vocabulary (Receivable), and the server's own figures. The company boundary AND the
// credited-person / team reach are decided by the server; a restricted reader sees a part of the book and the page says so.
//
// NOTHING IS INVENTED. The invoice number and issue date are supplied once an invoice has been issued against the receivable (F-1a) and are
// shown as "Not invoiced" before; the business unit is not carried: it is named as a model decision (domain/financialsEos.js NOT_SUPPLIED)
// instead of being shown as a blank or fabricated. F-1a-UI: a holder of finance.invoice.issue is offered Issue invoice on an un-invoiced Sales
// Order receivable (the Billing Queue is not reachable on the EOS build); the server's per-company advice narrows it and every command re-decides. No amount is totalled here: the scorecard
// and the aging buckets are the server's, per currency.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FinancialsPageFrame, FinancialsFilterRail, FinancialsHonestSection, FinSortableHeader, FinAnnotation } from "./FinancialsPrimitives.jsx";
import { companyWords, labelWords } from "./financialsDisplay.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import FilterBar from "../../shared/ui/FilterBar";
import { useAccountNames } from "../../hooks/useAccountNames.js";
import { useFinancialsPeriod } from "../../hooks/useFinancialsPeriod.js";
import { useEosFinanceRead } from "../../hooks/useEosFinanceRead.js";
import { fetchFinancialFactsFromEos, OBLIGATION_PAGE_LIMIT } from "../../services/eosFinancialsClient.js";
import { AR_AGING_BUCKETS } from "../../domain/financialsSurface.js";
import { NOT_SUPPLIED } from "../../domain/financialsEos.js";
import { Button } from "../../shared/ui/primitives";
import { INVOICE_ISSUE_GATE } from "../../access/shellCapabilityGates.js";
import { callFinanceApi } from "../../services/financeApiClient.js";
import { IssuePanel, RebillPanel, useIssuableCompanies } from "./InvoiceIssueQueue.jsx";
import { FACTS_STATE, FACTS_DETAIL, financialFactsState, invoiceRow, agingSlots, unagedNote, formatByCurrency } from "../../domain/financialFactsView.js";

const VIEW_OPTIONS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "settled", label: "Settled" },
  { key: "void", label: "Void" },
];

function applyView(rows, view) {
  if (view === "open") return rows.filter((r) => r.raw.outstandingMinor > 0 && r.raw.arPosition !== "VOID");
  if (view === "settled") return rows.filter((r) => r.raw.arPosition === "SETTLED");
  if (view === "void") return rows.filter((r) => r.raw.arPosition === "VOID");
  return rows;
}

const dateWords = (ms) => (typeof ms === "number" ? new Date(ms).toLocaleDateString() : "—");
/** The EOS record reference: the register's own id, shortened. Not an invoice number (MD-B1-1). */
export const recordRef = (id) => String(id).replace(/^obl_/, "").slice(0, 8).toUpperCase();

/** Issue is offered only where the SERVER says so (FU-2: the issueInvoice command's own predicate, invoiceIssue.ts issueBlocker); this screen decides nothing, and a read with no verdict offers nothing. */
const issuable = (r) => r.raw.issuable?.eligible === true;
/** Prepare rebill is offered only where the SERVER says the voided invoice's Sales Order can be prepared again for billing. */
const rebillable = (r) => r.raw.rebill?.eligible === true && typeof r.raw.salesOrderId === "string" && r.raw.salesOrderId !== "";

/**
 * @param {{ mode?: "invoices" | "ar", hasCapability?: (id: string) => boolean, callApi?: typeof callFinanceApi }} props
 *   invoices = the whole collection with views; ar = the open exposure with aging. `hasCapability` is the shell's gate answer (App.jsx); without it nothing
 *   can be issued and the server is never asked.
 */
export default function FinancialsReceivablesEos({ mode = "invoices", hasCapability, callApi = callFinanceApi }) {
  const canIssue = typeof hasCapability === "function" && hasCapability(INVOICE_ISSUE_GATE.issue) === true;
  const issueAccess = useIssuableCompanies(callApi, canIssue);
  const issueCompanies = new Set(issueAccess.companies.map((c) => c.operatingCompanyId));
  const [issuing, setIssuing] = useState(null); // the row whose issue panel is open
  const [rebilling, setRebilling] = useState(null); // the row whose Prepare rebill panel is open
  const [issuedNotice, setIssuedNotice] = useState(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false); // an issue is in flight: no other row may start one
  const openRow = useRef(null); // the row whose panel is the open one; a callback from any other panel is stale
  const [company, setCompany] = useState("consolidated");
  const [view, setView] = useState(mode === "ar" ? "open" : "all");
  const period = useFinancialsPeriod();
  const isAr = mode === "ar";

  const filters = { companyId: company === "consolidated" ? null : company, factTypes: ["INVOICE"], ...period.requestFields };
  const read = useEosFinanceRead(() => fetchFinancialFactsFromEos(filters), JSON.stringify({ filters, reload }), { enabled: !period.blocked });
  const { state, result } = financialFactsState(read);
  const answered = state === FACTS_STATE.READY || state === FACTS_STATE.EMPTY;
  const all = answered ? result.invoices.map((i) => ({ ...invoiceRow(i), raw: i })) : [];
  const rows = applyView(all, isAr ? "open" : view);
  const names = useAccountNames(rows.map((r) => r.accountId).filter(Boolean));
  const aging = agingSlots(state, result);
  const unaged = answered ? unagedNote(result) : null;

  const columns = {
    record: { value: (r) => r.invoiceId },
    invoice: { value: (r) => r.raw.invoiceNumber ?? null },
    customer: { value: (r) => (r.accountId ? (names.get(r.accountId) ?? null) : null) },
    company: { value: (r) => companyWords(r.companyId) },
    due: { value: (r) => (typeof r.dueDate === "number" ? r.dueDate : null) },
    total: { value: (r) => r.raw.totalMinor ?? null },
    applied: { value: (r) => r.raw.appliedMinor ?? null },
    outstanding: { value: (r) => r.raw.outstandingMinor ?? null },
    status: { value: (r) => r.position },
  };
  const { sort, toggle, sorted } = useTableSort({ rows, columns });
  const th = (key, label, extra = {}) => <FinSortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} {...extra} />;

  const honest = answered && rows.length === 0
    ? { state: "EMPTY", detail: period.presetKey === "all"
      ? "The Finance register answered, and no receivable within your visibility matches this view."
      : `No receivables were recorded in this period (${period.label}), or none match this view. The period narrows by the date EOS recorded the receivable. Choose All activity to see the full set.` }
    : answered ? { state: null } : { state, detail: FACTS_DETAIL[state] ?? null };

  return (
    <FinancialsPageFrame
      title={isAr ? "Accounts Receivable" : "Receivables"}
      crumb={isAr ? "Accounts Receivable" : "Receivables"}
      custody={isAr
        ? "Open receivables from the Finance register. Operational actual — not an accounting-reconciled balance; the formal invoice belongs to the accounting authority."
        : "The Finance register's receivables. EOS operational truth that money is owed — not the accounting invoice. Corrections are separate governed events, never edits here."}
      custodyTip="A Receivable is the register's record that a customer owes money, with its settlement applications and history. The invoice number and issue date are those of the invoice issued against the receivable (DECISIONS #F-1a); where none has been issued the page says so, never inventing one. Company reach and credited-person / team reach are decided by the server."
    >
      <FinancialsFilterRail company={company} onCompanyChange={setCompany} period={period.controlProps} />
      {!isAr ? <FilterBar variant="views" label="Receivable Views" options={VIEW_OPTIONS} activeKey={view} onChange={setView} /> : null}

      {answered && result.restricted ? (
        <div className="fin-truth-band" role="note">
          <strong>A part of the book.</strong> Your Finance visibility is limited to the receivables credited to you or your team, so every
          row and every total below covers only those. Other receivables are not hidden by a filter — they are outside your visibility.
        </div>
      ) : null}

      {isAr ? (
        <section className="fin-scorecard-section" aria-label="Aging">
          <div className="fin-scorecard fin-scorecard--aging">
            {AR_AGING_BUCKETS.map((bucket) => (
              <div key={bucket.key} className="fin-scorecard__slot">
                <div className="fin-figure">
                  <div className="fin-figure__label">{labelWords(bucket.label)}</div>
                  {aging[bucket.key] ? (
                    <div className="fin-figure__value">{aging[bucket.key]}</div>
                  ) : (
                    <div className="fin-figure__absence">{answered ? "Not supplied for this scope" : "Reading…"}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {unaged ? <p className="fin-section-note">{unaged}</p> : null}
        </section>
      ) : answered && result.summary ? (
        <section className="fin-scorecard-section" aria-label="Receivable totals">
          <div className="fin-scorecard fin-scorecard--three">
            {[["Billed", result.summary.billedByCurrency], ["Collected", result.summary.collectedByCurrency], ["Outstanding", result.summary.outstandingByCurrency]].map(([label, byCurrency]) => (
              <div key={label} className="fin-scorecard__slot">
                <div className="fin-figure"><div className="fin-figure__label">{label}</div><div className="fin-figure__value">{formatByCurrency(byCurrency)}</div></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <FinancialsHonestSection
        id="fin-receivables-collection"
        title={isAr ? "Open Receivables" : "Receivable Collection"}
        meta="the register's records · settlement applications and history on each"
        honest={honest}
        subject="Receivable reads"
        footer={answered ? (
          <p className="fin-section-note">
            The invoice number and issue date are supplied once an invoice has been issued against a receivable; until then it shows <strong>Not invoiced</strong>. The business unit is <strong>not supplied</strong> by the Finance register: {NOT_SUPPLIED.businessUnit.id} is a named model decision.
            {result.truncated ? ` Showing the first ${OBLIGATION_PAGE_LIMIT} per company; narrow the company or period to see the rest.` : ""}
          </p>
        ) : null}
      >
        <div className="ns-table-wrap">
          <table className="ns-table">
            <caption className="fo-sr-only">Receivables</caption>
            <thead>
              <tr>
                {th("record", "Record", { tip: "The Finance register's own reference (not an invoice number: MD-B1-1)." })}
                {th("invoice", "Invoice", { tip: "The invoice issued against this receivable, with its issue date. Not invoiced: none has been issued yet." })}
                {th("customer", "Customer")}
                {th("company", "Company")}
                {th("due", "Due")}
                {th("total", "Original", { className: "ns-num" })}
                {th("applied", "Settled", { className: "ns-num" })}
                {th("outstanding", "Outstanding", { className: "ns-num" })}
                {th("status", "Status")}
                {canIssue ? <th scope="col">Action</th> : null}
              </tr>
            </thead>
            {rows.length > 0 ? (
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.invoiceId}>
                    <td className="fin-nowrap"><Link to={`/financials/invoices/${row.invoiceId}`}>{recordRef(row.invoiceId)}</Link></td>
                    <td className="fin-nowrap">
                      {row.raw.invoiceNumber ? <>{row.raw.invoiceNumber}{typeof row.raw.issuedAtMillis === "number" ? <span className="fo-muted"> · {dateWords(row.raw.issuedAtMillis)}</span> : null}</> : "Not invoiced"}
                    </td>
                    <td>
                      {row.accountId ? <Link to={`/customers/${row.accountId}`}>{names.get(row.accountId) ?? row.counterpartyName ?? "Customer name not resolved"}</Link> : "—"}
                    </td>
                    <td>{companyWords(row.companyId)}</td>
                    <td>{dateWords(row.dueDate)}</td>
                    <td className="ns-num">{row.total}</td>
                    <td className="ns-num">{row.applied}</td>
                    <td className="ns-num">{row.outstanding}</td>
                    <td>{row.position}</td>
                    {canIssue ? (
                      <td>
                        {issuable(row) && issueCompanies.has(row.companyId)
                          ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setIssuedNotice(null); setRebilling(null); openRow.current = row.invoiceId; setIssuing(row); }}>Issue invoice</Button>
                          : rebillable(row) && issueCompanies.has(row.companyId)
                            ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setIssuedNotice(null); setIssuing(null); openRow.current = row.invoiceId; setRebilling(row); }}>Prepare rebill</Button>
                            : row.raw.issuable?.reason === "UNSUPPORTED_FINANCIAL_OBLIGOR" ? <span className="fo-muted">Financed sale — not invoiced here</span> : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
        {issuedNotice ? <p className="fin-section-note" role="status">{issuedNotice}</p> : null}
        {rebilling ? (
          <RebillPanel key={rebilling.invoiceId} callApi={callApi} salesOrderId={rebilling.raw.salesOrderId} subject={rebilling.raw.salesOrderNumber ?? "this sale"}
            onBusyChange={setBusy} onCancel={() => { openRow.current = null; setRebilling(null); }}
            onPrepared={(prepared) => {
              setReload((n) => n + 1); // it was prepared either way: re-read
              if (openRow.current !== rebilling.invoiceId) return; // a superseded panel never closes the one now open
              openRow.current = null;
              const sale = rebilling.raw.salesOrderNumber ?? "this sale";
              setIssuedNotice(prepared.status === "HELD"
                ? `A new billing package was prepared for ${sale} but is on hold (${(prepared.readinessExceptions ?? []).join(", ") || "see Finance"}); it cannot be invoiced yet.`
                : `A new billing package was prepared for ${sale}. Its new receivable can now be invoiced under a new invoice number.`);
              setRebilling(null);
            }} />
        ) : null}
        {issuing ? (
          <IssuePanel key={issuing.invoiceId} callApi={callApi} billingPackageId={issuing.raw.sourceRecordId} subject={issuing.raw.salesOrderNumber ?? "this receivable"}
            amountText={issuing.total} onBusyChange={setBusy} onCancel={() => { openRow.current = null; setIssuing(null); }}
            onIssued={(invoice) => {
              setReload((n) => n + 1); // it was issued either way: re-read
              if (openRow.current !== issuing.invoiceId) return; // a superseded panel never closes the one now open
              openRow.current = null; setIssuedNotice(`Invoice ${invoice.invoiceNumber} issued.`); setIssuing(null);
            }} />
        ) : null}
        <FinAnnotation tip="Original is what the receivable originated for; Settled is the sum of applied settlements net of reversals; Outstanding is what remains. All three are the server's figures." />
      </FinancialsHonestSection>
    </FinancialsPageFrame>
  );
}
