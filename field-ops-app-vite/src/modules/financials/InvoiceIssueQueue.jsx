// BILLING QUEUE > ISSUE INVOICES (F-1a, DECISIONS #F-1a). For a holder of finance.invoice.issue: the Sales Order receivables that have no invoice yet, and the
// governed `issueInvoice` command (POST /operations/finance) to issue one.
//
// The server decides everything; this only offers. A company is offered only where the server's own advice (readMyFinanceCompanyAccess `actions.issue`)
// says the key reaches it with a full Finance reading; every command re-decides. Issuing is one step for an authorized person (no second approver, Owner
// 2026-10-20). The due date comes from the customer's governed payment terms; a person may pick a LATER date and must say why. Nothing is optimistic: the
// queue is re-read after every issue, and a refusal is shown in the server's own words with nothing changed. Nothing is totalled here.
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeader, Button, StatusIndicator } from "../../shared/ui/primitives";
import { Field } from "../../shared/ui/form";
import { callFinanceApi } from "../../services/financeApiClient";
import { formatMinorUnits } from "../../domain/money.js";
import { operatingCompanyLabel } from "../../shared/display/displayLabels.js";

const EMPTY = Object.freeze([]);
const newKey = () => `inv-issue-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
export const money = (minor, currency = "USD") => (minor === null || minor === undefined ? "—" : formatMinorUnits(Number(minor), currency));

/** The operating companies the server says this reader may issue invoices for (`actions.issue`), or the reason it could not say. Asked once; never when `enabled` is false. */
export function useIssuableCompanies(callApi, enabled = true) {
  const [access, setAccess] = useState({ loading: enabled, companies: EMPTY, failure: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    (async () => {
      const res = await callApi("readMyFinanceCompanyAccess");
      if (!live) return;
      if (!res.ok) { setAccess({ loading: false, companies: EMPTY, failure: res.message ?? "Finance could not be read." }); return; }
      setAccess({ loading: false, companies: (res.result?.companies ?? EMPTY).filter((c) => c.actions?.issue === true), failure: null });
    })();
    return () => { live = false; };
  }, [callApi, enabled]);
  return access;
}

/**
 * The one issue step, shared by the Billing Queue and the Receivables register: the optional later due date (with its reason) and the `issueInvoice`
 * command. ONE idempotency key per opened panel; a refusal stays here in the server's own words with nothing changed. `onIssued(invoice)` is the
 * caller's cue to re-read; nothing is optimistic.
 */
export function IssuePanel({ callApi, billingPackageId, subject, amountText, onIssued, onCancel, onBusyChange }) {
  const [key] = useState(newKey);
  const [dueOn, setDueOn] = useState("");
  const [dueReason, setDueReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const issue = async () => {
    setBusy(true); onBusyChange?.(true); setRefusal(null);
    const reason = dueReason.trim();
    const res = await callApi("issueInvoice", { billingPackageId, idempotencyKey: key, ...(dueOn ? { dueOn, ...(reason ? { dueReason: reason } : {}) } : {}) });
    setBusy(false); onBusyChange?.(false);
    if (!res.ok) { setRefusal(res.message ?? "The invoice was not issued."); return; }
    onIssued(res.result.invoice);
  };
  return (
    <div role="group" aria-label="Issue invoice">
      <p>
        Issue an invoice for {subject} — {amountText}.
        The due date follows the customer&rsquo;s payment terms. Pick a later date only if you need one, and say why.
      </p>
      <Field label="Later due date (optional)">
        <input className="fo-input" type="date" aria-label="Later due date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
      </Field>
      <Field label="Reason for that date">
        <input className="fo-input" aria-label="Reason for that date" maxLength={500} value={dueReason} onChange={(e) => setDueReason(e.target.value)} />
      </Field>
      {refusal && <StatusIndicator tone="danger">{refusal}</StatusIndicator>}
      <Button disabled={busy} onClick={issue}>Issue invoice now</Button>{" "}
      <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  );
}

/**
 * REBILL after a void (FU-2): prepare a NEW billing package for the voided sale's Sales Order (`prepareBillingPackage`, the invoice-issue key). It is offered only where the
 * server's read says the order can be prepared again; this decides nothing. ONE idempotency key per opened panel; a refusal stays here in the server's own words with nothing changed.
 * `onPrepared(result)` is the caller's cue to re-read: the new receivable then appears with its own Issue.
 */
export function RebillPanel({ callApi, salesOrderId, subject, onPrepared, onCancel, onBusyChange }) {
  const [key] = useState(() => `bpk-prepare-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const prepare = async () => {
    setBusy(true); onBusyChange?.(true); setRefusal(null);
    const res = await callApi("prepareBillingPackage", { salesOrderId, idempotencyKey: key });
    setBusy(false); onBusyChange?.(false);
    if (!res.ok) { setRefusal(res.message ?? "The rebill was not prepared."); return; }
    onPrepared(res.result);
  };
  return (
    <div role="group" aria-label="Prepare rebill">
      <p>
        Prepare a new billing package for {subject}, so it can be invoiced again under a NEW invoice number.
        The voided invoice keeps its number. Nothing is issued until you issue the new receivable.
      </p>
      {refusal && <StatusIndicator tone="danger">{refusal}</StatusIndicator>}
      <Button disabled={busy} onClick={prepare}>Prepare rebill now</Button>{" "}
      <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
    </div>
  );
}

export default function InvoiceIssueQueue({ callApi = callFinanceApi }) {
  const access = useIssuableCompanies(callApi);
  const [company, setCompany] = useState("");
  const [rows, setRows] = useState({ state: "idle", items: EMPTY, message: null });
  const [row, setRow] = useState(null); // the receivable whose issue panel is open
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false); // an issue is in flight: no other row may start one
  const openRow = useRef(null); // the receivable whose panel is the open one; a callback from any other panel is stale
  const latest = useRef(0);

  useEffect(() => { setCompany((current) => current || access.companies[0]?.operatingCompanyId || ""); }, [access.companies]);

  const load = useCallback(async () => {
    if (!company) return;
    const mine = ++latest.current;
    setRows((r) => ({ ...r, state: "loading" }));
    const res = await callApi("listObligations", { operatingCompanyId: company, kind: "RECEIVABLE", invoiced: false });
    if (mine !== latest.current) return;
    if (!res.ok) { setRows({ state: "unavailable", items: EMPTY, message: res.message ?? "The billing queue could not be read." }); return; }
    setRows({ state: "ready", items: (res.result?.items ?? EMPTY).filter((o) => o.status !== "VOID"), message: null });
  }, [callApi, company]);
  useEffect(() => { load(); }, [load]);

  const issued = async (invoice, issuedRowId) => {
    if (openRow.current === issuedRowId) { openRow.current = null; setNotice({ tone: "positive", text: `Invoice ${invoice.invoiceNumber} issued.` }); setRow(null); }
    await load(); // it was issued either way: re-read, but a superseded panel never closes the one now open
  };

  if (access.loading) return <p className="fo-muted" role="status">Loading the billing queue…</p>;
  if (access.failure) return <p className="fo-muted" role="status">{access.failure}</p>;
  if (access.companies.length === 0) {
    return <StatusIndicator tone="neutral">Your Finance access does not allow issuing invoices for any operating company.</StatusIndicator>;
  }
  return (
    <section className="fo-panel" aria-label="Receivables ready to invoice">
      <SectionHeader title="Ready to Invoice" description="Sales Order receivables with no invoice yet. Issuing creates the invoice and its number; what is owed stays on the receivable." />
      {access.companies.length > 1 && (
        <Field label="Company">
          <select className="fo-input" aria-label="Company" value={company} onChange={(e) => { openRow.current = null; setRow(null); setCompany(e.target.value); }}>
            {access.companies.map((c) => <option key={c.operatingCompanyId} value={c.operatingCompanyId}>{c.name || operatingCompanyLabel(c.operatingCompanyId)}</option>)}
          </select>
        </Field>
      )}
      {notice && <StatusIndicator tone="positive">{notice.text}</StatusIndicator>}
      {rows.state === "unavailable" && <p className="fo-muted" role="status">{rows.message}</p>}
      {rows.state === "ready" && rows.items.length === 0 && <p className="fo-muted">Nothing is waiting to be invoiced.</p>}
      {rows.items.length > 0 && (
        <table className="fo-table">
          <caption className="fo-sr-only">Receivables with no invoice</caption>
          <thead><tr><th scope="col">Sales Order</th><th scope="col">Customer</th><th scope="col">Company</th><th scope="col">Amount</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {rows.items.map((o) => (
              <tr key={o.id}>
                <td>{o.sourceSalesOrder?.salesOrderNumber ?? <span className="fo-muted">—</span>}</td>
                <td>{o.counterparty?.name ?? o.counterparty?.crmAccountId ?? "—"}</td>
                <td>{operatingCompanyLabel(o.operatingCompanyId) || "—"}</td>
                <td>{money(o.originatedMinor, o.currency)}</td>
                <td>
                  {/* FU-2: Issue only where the SERVER says the receivable is issuable (the command's own predicate); a financed sale is told apart, not offered. */}
                  {o.issuable?.eligible === true
                    ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setNotice(null); openRow.current = o.id; setRow(o); }}>Issue invoice</Button>
                    : o.issuable?.reason === "UNSUPPORTED_FINANCIAL_OBLIGOR" ? <span className="fo-muted">Financed sale — not invoiced here</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {row && (
        <IssuePanel key={row.id} callApi={callApi} billingPackageId={row.sourceRecordId} subject={row.sourceSalesOrder?.salesOrderNumber ?? "this receivable"}
          amountText={money(row.originatedMinor, row.currency)} onBusyChange={setBusy} onIssued={(invoice) => issued(invoice, row.id)} onCancel={() => { openRow.current = null; setRow(null); }} />
      )}
    </section>
  );
}
