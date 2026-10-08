// FINANCE WORKSPACE — on /financials (the Overview's exception rail; Finance Closure, DECISIONS #206).
//
// The exception-first operational workspace of the subledger: what is owed to and by each company, what has been received or
// paid and where it was applied, what is overdue, partially paid, unapplied, unreconciled, not yet handed to accounting, or
// missing its cost evidence. Company-scoped: Taylor, Ventana, or the Consolidated REPORTING VIEW (a read across companies --
// it owns nothing and nothing is recorded in it).
//
// It decides nothing. Every figure is the server's (finance.payment.read); every action is a governed command the server
// authorizes on its own capability (record / apply / reconcile) and refuses otherwise -- the refusal is rendered as its answer.
// Missing data is never zero: a section with no rows says so; an amount the server did not give is not computed here.
import { useCallback, useEffect, useState } from "react";
import { PageHeader, SectionHeader, Button, StatusIndicator } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callFinanceApi } from "../../services/financeApiClient";
import { formatMinorUnits } from "../../domain/money.js";
import { OPERATING_COMPANIES, OPERATING_COMPANY_IDS } from "../../domain/operatingCompanyAuthority.js";
import { operatingCompanyLabel, statusLabel } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

// Company choices come from the governed table; the Consolidated reporting view is not a company.
const COMPANIES = [
  ...OPERATING_COMPANIES.filter((c) => c.active).map((c) => [c.id, operatingCompanyLabel(c.id)]),
  ["consolidated", "Consolidated (Reporting View)"],
];
const STATUS_WORDS = Object.freeze({ OPEN: "Open", PARTIAL: "Partially Paid", SETTLED: "Settled", VOID: "Void" });
const SETTLEMENT_WORDS = Object.freeze({ CUSTOMER_PAYMENT: "Customer Payment", PROVIDER_FUNDING: "Provider Funding", VENDOR_PAYMENT: "Vendor Payment",
  INTERCOMPANY_PAYMENT: "Intercompany Payment", INTERCOMPANY_RECEIPT: "Intercompany Receipt" });
const HANDOFF_WORDS = Object.freeze({ PENDING_DESTINATION: "Waiting for an accounting destination", READY_FOR_DELIVERY: "Ready for accounting",
  REJECTED: "Rejected by accounting", FAILED_RETRYABLE: "Delivery failed — retry possible", FAILED_FINAL: "Delivery failed" });
const money = (minor, currency = "USD") => (minor === null || minor === undefined ? "—" : formatMinorUnits(Number(minor), currency));
const counterpartyWords = (cp) => cp?.kind === "INTERNAL_OPERATING_COMPANY" ? operatingCompanyLabel(cp.operatingCompanyId) : (cp?.name ?? cp?.crmAccountId ?? "—");
const companyWords = (id) => operatingCompanyLabel(id) || "—";
const minorValue = (minor) => (minor === null || minor === undefined || minor === "" ? null : Number(minor));
const PAYLOAD_WORDS = Object.freeze({ OPERATIONAL_BILLING_PACKAGE: "Billing Package", VENDOR_PAYABLE: "Vendor Payable" });
const payloadWords = (kind) => PAYLOAD_WORDS[kind] ?? "Intercompany Obligation";

// Sortable columns (client-side over the rows the governed read returned; the server's order is the default).
const OBLIGATION_COLUMNS = Object.freeze({
  company: { value: (o) => companyWords(o.operatingCompanyId) },
  counterparty: { value: (o) => counterpartyWords(o.counterparty) },
  status: { value: (o) => statusLabel(o.status, STATUS_WORDS) },
  due: { value: (o) => o.dueOn ?? null },
  originated: { value: (o) => minorValue(o.originatedMinor) },
  outstanding: { value: (o) => minorValue(o.outstandingMinor) },
  record: { value: (o) => o.id },
});
const HANDOFF_COLUMNS = Object.freeze({
  company: { value: (h) => companyWords(h.operatingCompanyId) },
  what: { value: (h) => payloadWords(h.payloadKind) },
  status: { value: (h) => statusLabel(h.status, HANDOFF_WORDS) },
  record: { value: (h) => h.obligationId },
});
const COST_EVIDENCE_COLUMNS = Object.freeze({
  company: { value: (x) => companyWords(x.operatingCompanyId) },
  receipt: { value: (x) => x.receivingId },
  part: { value: (x) => x.partId },
  quantity: { value: (x) => (typeof x.receivedQuantity === "number" ? x.receivedQuantity : minorValue(x.receivedQuantity)) },
});

/** "1250.50" -> 125050 minor units; null when it is not an amount with at most two decimals. Integer arithmetic only. */
export function toMinorUnits(text) {
  const t = String(text ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

function ObligationTable({ title, section }) {
  const { sort, toggle, sorted } = useTableSort({ rows: section?.items ?? EMPTY, columns: OBLIGATION_COLUMNS });
  if (!section) return null;
  return (
    <section className="fo-panel" aria-label={title}>
      <SectionHeader title={title} description={section.count === 0 ? "None outstanding." : `${section.count} outstanding — ${Object.entries(section.outstandingByCurrency).map(([c, m]) => money(m, c) + " " + c).join(", ")}`} />
      {section.items.length > 0 && (
        <table className="fo-table">
          <thead>
            <tr>
              <SortableHeader columnKey="company" label="Company" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="counterparty" label="Counterparty" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="status" label="Status" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="due" label="Due" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="originated" label="Originated" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="outstanding" label="Outstanding" sort={sort} onSort={toggle} />
              <SortableHeader columnKey="record" label="Record" sort={sort} onSort={toggle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => (
              <tr key={o.id}>
                <td>{companyWords(o.operatingCompanyId)}</td>
                <td>{counterpartyWords(o.counterparty)}</td>
                <td>{statusLabel(o.status, STATUS_WORDS)}{o.overdue ? " · overdue" : ""}</td>
                <td>{o.dueOn ?? <span className="fo-muted">No due date governed</span>}</td>
                <td>{money(o.originatedMinor, o.currency)}</td>
                <td>{money(o.outstandingMinor, o.currency)}</td>
                <td className="fo-muted">{o.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const EMPTY = Object.freeze([]);

export default function FinancialsWorkspace({ callApi = callFinanceApi, embedded = false }) {
  const [company, setCompany] = useState(OPERATING_COMPANY_IDS.TAYLOR);
  const [ws, setWs] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ kind: "CUSTOMER_PAYMENT", counterpartyRef: "", amount: "", currency: "USD", sourceReference: "", businessDate: "" });
  const [applyDraft, setApplyDraft] = useState({});
  const [reconDraft, setReconDraft] = useState({});

  const load = useCallback(async () => {
    const res = await callApi("readFinanceWorkspace", { operatingCompanyId: company });
    if (!res.ok) { setWs(null); setRefusal(res.code === "FORBIDDEN" ? "The Finance workspace is not available to you. It needs finance.payment.read." : (res.message ?? "Finance could not be read.")); return; }
    setRefusal(null);
    setWs(res.result);
  }, [callApi, company]);
  useEffect(() => { load(); }, [load]);

  const run = async (operation, input) => {
    setBusy(true); setNotice(null);
    const res = await callApi(operation, input);
    setBusy(false);
    if (!res.ok) { setNotice({ tone: "danger", text: res.message ?? "The request was refused." }); return false; }
    setNotice({ tone: "positive", text: "Recorded." });
    await load();
    return true;
  };
  const key = (k) => `ws-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const internalKind = form.kind === "INTERCOMPANY_PAYMENT" || form.kind === "INTERCOMPANY_RECEIPT";
  const recordSettlement = async () => {
    const minor = toMinorUnits(form.amount);
    if (minor === null || minor <= 0) { setNotice({ tone: "danger", text: "The amount must look like 1250.00." }); return; }
    const ok = await run("recordSettlement", { operatingCompanyId: company, kind: form.kind, amountMinor: minor, currency: form.currency,
      counterparty: internalKind ? { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: form.counterpartyRef } : { kind: "EXTERNAL_ORGANIZATION", crmAccountId: form.counterpartyRef },
      sourceReference: form.sourceReference, ...(form.businessDate ? { businessDate: form.businessDate } : {}), idempotencyKey: key("stl") });
    if (ok) setForm({ ...form, amount: "", sourceReference: "" });
  };
  const applySettlement = (s) => {
    const d = applyDraft[s.id] ?? {};
    const minor = toMinorUnits(d.amount);
    if (!d.obligationId || minor === null || minor <= 0) { setNotice({ tone: "danger", text: "State the obligation and an amount like 100.00." }); return; }
    run("applySettlement", { settlementId: s.id, applications: [{ obligationId: d.obligationId.trim(), amountMinor: minor }], idempotencyKey: key("app") });
  };
  const reconcile = (r) => {
    const d = reconDraft[r.settlementId] ?? {};
    const minor = toMinorUnits(d.amount);
    if (!d.reference || minor === null) { setNotice({ tone: "danger", text: "State the accounting reference and the amount it shows." }); return; }
    run("reconcileSettlement", { settlementId: r.settlementId, externalReference: d.reference.trim(), externalAmountMinor: minor, ...(d.reason ? { reason: d.reason } : {}), idempotencyKey: key("rec") });
  };

  const counts = ws?.exceptionCounts;
  const handoffSort = useTableSort({ rows: ws?.accountingHandoffs ?? EMPTY, columns: HANDOFF_COLUMNS });
  const costEvidenceSort = useTableSort({ rows: ws?.missingCostEvidence ?? EMPTY, columns: COST_EVIDENCE_COLUMNS });
  return (
    <div>
      {embedded
        ? <SectionHeader title="Finance Workspace" description="What needs attention first: overdue, partially paid, unapplied, unreconciled, not yet handed to accounting, or missing cost evidence. EOS is the operational subledger; your accounting system stays the books." />
        : <PageHeader title="Finance Workspace" subtitle="What needs attention first: overdue, partially paid, unapplied, unreconciled, not yet handed to accounting, or missing cost evidence. EOS is the operational subledger; your accounting system stays the books." />}
      <Field label="Company">
        <select className="fo-input" aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
          {COMPANIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {refusal && <p className="fo-muted" role="status">{refusal}</p>}
      {ws && (
        <>
          {ws.scope.projection === "CONSOLIDATED_REPORTING_PROJECTION" && (
            <StatusIndicator tone="neutral">Consolidated is a reporting view across {ws.scope.companies.map((id) => operatingCompanyLabel(id)).join(" and ")}. Nothing is recorded in it.</StatusIndicator>
          )}
          <section className="fo-panel" aria-label="Needs attention">
            <SectionHeader title="Needs Attention" />
            <dl>
              <dt className="fo-muted">Overdue obligations</dt><dd>{counts.overdueObligations}</dd>
              <dt className="fo-muted">Partially paid obligations</dt><dd>{counts.partiallyPaidObligations}</dd>
              <dt className="fo-muted">Unapplied settlements</dt><dd>{counts.unappliedSettlements}</dd>
              <dt className="fo-muted">Accounting handoff exceptions</dt><dd>{counts.accountingHandoffExceptions}</dd>
              <dt className="fo-muted">Reconciliation mismatches</dt><dd>{counts.reconciliationMismatches}</dd>
              <dt className="fo-muted">Settlements not yet reconciled</dt><dd>{counts.unreconciledSettlements}</dd>
              <dt className="fo-muted">Receipt lines missing cost evidence</dt><dd>{counts.missingCostEvidence}</dd>
              <dt className="fo-muted">Intercompany sales awaiting seller inventory relief</dt><dd>{counts.intercompanyReliefPending}</dd>
            </dl>
          </section>

          <ObligationTable title="Receivables" section={ws.receivables} />
          <ObligationTable title="Funding Receivables (Financing Providers)" section={ws.fundingReceivables} />
          <ObligationTable title="Payables" section={ws.payables} />
          <ObligationTable title="Intercompany Receivables" section={ws.intercompanyReceivables} />
          <ObligationTable title="Intercompany Payables" section={ws.intercompanyPayables} />

          <section className="fo-panel" aria-label="Unapplied settlements">
            <SectionHeader title="Unapplied Settlements" description={ws.unappliedSettlements.length === 0 ? "Every recorded settlement is fully applied." : "Received or paid, not yet applied in full."} />
            {ws.unappliedSettlements.length > 0 && (
              <table className="fo-table">
                <thead><tr><th>Company</th><th>Kind</th><th>Reference</th><th>Date</th><th>Amount</th><th>Unapplied</th><th>Apply to an Obligation</th></tr></thead>
                <tbody>
                  {ws.unappliedSettlements.map((s) => (
                    <tr key={s.id}>
                      <td>{companyWords(s.operatingCompanyId)}</td><td>{statusLabel(s.kind, SETTLEMENT_WORDS)}</td><td>{s.sourceReference}</td><td>{s.businessDate}</td>
                      <td>{money(s.amountMinor, s.currency)}</td><td>{money(s.unappliedMinor, s.currency)}</td>
                      <td>
                        <input className="fo-input" aria-label={`Obligation for ${s.sourceReference}`} placeholder="Obligation record" value={applyDraft[s.id]?.obligationId ?? ""}
                          onChange={(e) => setApplyDraft({ ...applyDraft, [s.id]: { ...applyDraft[s.id], obligationId: e.target.value } })} />
                        <input className="fo-input" aria-label={`Amount to apply from ${s.sourceReference}`} placeholder="Amount" value={applyDraft[s.id]?.amount ?? ""}
                          onChange={(e) => setApplyDraft({ ...applyDraft, [s.id]: { ...applyDraft[s.id], amount: e.target.value } })} />
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => applySettlement(s)}>Apply {s.sourceReference}</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="fo-panel" aria-label="Accounting handoffs">
            <SectionHeader title="Accounting Handoffs" description={ws.accountingHandoffs.length === 0 ? "Nothing waiting for accounting." : "Each company's records waiting for, or refused by, its own accounting destination."} />
            {ws.accountingHandoffs.length > 0 && (
              <table className="fo-table">
                <thead>
                  <tr>
                    <SortableHeader columnKey="company" label="Company" sort={handoffSort.sort} onSort={handoffSort.toggle} />
                    <SortableHeader columnKey="what" label="What" sort={handoffSort.sort} onSort={handoffSort.toggle} />
                    <SortableHeader columnKey="status" label="Status" sort={handoffSort.sort} onSort={handoffSort.toggle} />
                    <SortableHeader columnKey="record" label="Record" sort={handoffSort.sort} onSort={handoffSort.toggle} />
                  </tr>
                </thead>
                <tbody>
                  {handoffSort.sorted.map((h) => (
                    <tr key={h.id}><td>{companyWords(h.operatingCompanyId)}</td>
                      <td>{payloadWords(h.payloadKind)}</td>
                      <td>{statusLabel(h.status, HANDOFF_WORDS)}{h.failureReason ? ` — ${h.failureReason}` : ""}</td><td className="fo-muted">{h.obligationId}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="fo-panel" aria-label="Reconciliation">
            <SectionHeader title="Reconciliation" description={ws.reconciliation.length === 0 ? "Every settlement is reconciled with accounting." : "Settlements not yet confirmed by accounting, or where accounting shows something different."} />
            {ws.reconciliation.length > 0 && (
              <table className="fo-table">
                <thead><tr><th>Company</th><th>Kind</th><th>Amount</th><th>Status</th><th>Record What Accounting Shows</th></tr></thead>
                <tbody>
                  {ws.reconciliation.map((r) => (
                    <tr key={r.settlementId}>
                      <td>{companyWords(r.operatingCompanyId)}</td><td>{statusLabel(r.kind, SETTLEMENT_WORDS)}</td><td>{money(r.amountMinor, r.currency)}</td>
                      <td>{r.status === "MISMATCH" ? `Mismatch — accounting shows ${money(r.externalAmountMinor, r.currency)}` : "Not yet reconciled"}</td>
                      <td>
                        <input className="fo-input" aria-label={`Accounting reference for ${r.settlementId}`} placeholder="Accounting reference" value={reconDraft[r.settlementId]?.reference ?? ""}
                          onChange={(e) => setReconDraft({ ...reconDraft, [r.settlementId]: { ...reconDraft[r.settlementId], reference: e.target.value } })} />
                        <input className="fo-input" aria-label={`Accounting amount for ${r.settlementId}`} placeholder="Amount" value={reconDraft[r.settlementId]?.amount ?? ""}
                          onChange={(e) => setReconDraft({ ...reconDraft, [r.settlementId]: { ...reconDraft[r.settlementId], amount: e.target.value } })} />
                        <input className="fo-input" aria-label={`Mismatch reason for ${r.settlementId}`} placeholder="Reason (if different)" value={reconDraft[r.settlementId]?.reason ?? ""}
                          onChange={(e) => setReconDraft({ ...reconDraft, [r.settlementId]: { ...reconDraft[r.settlementId], reason: e.target.value } })} />
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => reconcile(r)}>Reconcile</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="fo-panel" aria-label="Missing cost evidence">
            <SectionHeader title="Receipts Missing Cost Evidence" description={ws.missingCostEvidence.length === 0 ? "Every received line has its cost." : "Received without a price: no cost is assumed and no obligation is created until the evidence is supplied."} />
            {ws.missingCostEvidence.length > 0 && (
              <table className="fo-table">
                <thead>
                  <tr>
                    <SortableHeader columnKey="company" label="Company" sort={costEvidenceSort.sort} onSort={costEvidenceSort.toggle} />
                    <SortableHeader columnKey="receipt" label="Receipt" sort={costEvidenceSort.sort} onSort={costEvidenceSort.toggle} />
                    <SortableHeader columnKey="part" label="Part" sort={costEvidenceSort.sort} onSort={costEvidenceSort.toggle} />
                    <SortableHeader columnKey="quantity" label="Quantity" sort={costEvidenceSort.sort} onSort={costEvidenceSort.toggle} />
                  </tr>
                </thead>
                <tbody>{costEvidenceSort.sorted.map((x) => <tr key={x.exceptionId}><td>{companyWords(x.operatingCompanyId)}</td><td>{x.receivingId}</td><td>{x.partId}</td><td>{x.receivedQuantity}</td></tr>)}</tbody>
              </table>
            )}
          </section>

          {ws.scope.projection === "OPERATING_COMPANY" && (
            <section className="fo-panel" aria-label="Record a settlement">
              <SectionHeader title="Record a Settlement" description="Evidence of money received or paid — never a bank feed. It is applied to obligations separately." />
              <div className="fo-form-row">
                <Field label="Kind">
                  <select className="fo-input" aria-label="Settlement kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                    {Object.entries(SETTLEMENT_WORDS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
                <Field label={internalKind ? "Other company" : "Organization record"}>
                  <input className="fo-input" aria-label={internalKind ? "Other company" : "Organization record"} value={form.counterpartyRef} onChange={(e) => setForm({ ...form, counterpartyRef: e.target.value })} />
                </Field>
                <Field label="Amount"><input className="fo-input" aria-label="Settlement amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
                <Field label="Reference"><input className="fo-input" aria-label="Settlement reference" value={form.sourceReference} onChange={(e) => setForm({ ...form, sourceReference: e.target.value })} /></Field>
                <Field label="Business Date (Optional)"><input className="fo-input" aria-label="Business date" placeholder="YYYY-MM-DD" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} /></Field>
              </div>
              <div className="fo-form-actions">
                <Button disabled={busy || !form.counterpartyRef || !form.amount || !form.sourceReference} onClick={recordSettlement}>Record Settlement</Button>
              </div>
            </section>
          )}
          {notice && <FormError>{notice.tone === "danger" ? notice.text : null}</FormError>}
          {notice?.tone === "positive" && <p className="fo-muted" role="status">{notice.text}</p>}
        </>
      )}
    </div>
  );
}
