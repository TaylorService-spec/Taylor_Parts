// FINANCE CONFIGURATION -- the Administration surface for the governed PostgreSQL finance configuration (Controller POST-FBR
// GOVERNED CONFIGURATION, DECISIONS #203, 2026-10-02). Every read and change goes to /admin/policy, where the server gates it on
// finance.configuration.manage and audits each change with its stated reason. This component decides nothing: a refusal is
// rendered as the server's answer.
//
// TWO RECORDS. An operating company's accounting destinations (one ACTIVE at a time; a superseded one stays as history and an
// untouched handoff follows the new active one, a handoff with delivery history never moves) and its payment terms with each
// counterparty (they govern FUTURE obligations only -- an obligation already opened keeps its due date). The company's
// business time zone is System Configuration (Owner ruling #204), not Finance configuration.
import { useCallback, useEffect, useState } from "react";
import { SectionHeader, StatusIndicator, Button } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callPolicyApi } from "../../services/adminPolicyApiClient";
import { OPERATING_COMPANIES } from "../../domain/operatingCompanyAuthority.js";
import { operatingCompanyLabel } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

const refusalText = (res) => {
  if (res.code === "FORBIDDEN") return "Finance configuration is not available to you. It needs finance.configuration.manage, which your account does not currently hold.";
  if (res.code === "NOT_CONFIGURED") return "The EOS Administration API is not configured for this environment.";
  return res.message || "The request could not be completed.";
};

const EMPTY_DESTINATION = { operatingCompanyId: "", displayName: "", providerKey: "", externalCompanyRef: "", activate: true };
const EMPTY_TERMS = { operatingCompanyId: "", counterpartyKind: "INTERNAL_OPERATING_COMPANY", counterpartyRef: "", netDays: "" };
const COUNTERPARTY_LABEL = { INTERNAL_OPERATING_COMPANY: "Operating Company", EXTERNAL_ORGANIZATION: "Organization" };
const counterpartyKey = (cp) => cp.kind === "INTERNAL_OPERATING_COMPANY" ? cp.operatingCompanyId : (cp.name ?? cp.crmAccountId);
const counterpartyText = (cp) => cp.kind === "INTERNAL_OPERATING_COMPANY" ? operatingCompanyLabel(cp.operatingCompanyId) : (cp.name ?? cp.crmAccountId);

/** A choice over the governed operating companies (value = id, label = governed display name). */
function OperatingCompanySelect({ label, value, onChange }) {
  return (
    <select className="fo-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose an Operating Company…</option>
      {OPERATING_COMPANIES.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
    </select>
  );
}

const DESTINATION_COLUMNS = Object.freeze({
  company: { value: (d) => operatingCompanyLabel(d.operatingCompanyId) },
  destination: { value: (d) => d.displayName },
  provider: { value: (d) => d.providerKey },
  external: { value: (d) => d.externalCompanyRef },
  status: { value: (d) => (d.status === "ACTIVE" ? 0 : 1) },
});
const TERMS_COLUMNS = Object.freeze({
  company: { value: (t) => operatingCompanyLabel(t.operatingCompanyId) },
  counterparty: { value: (t) => counterpartyText(t.counterparty) },
  terms: { value: (t) => (typeof t.paymentTermsNetDays === "number" ? t.paymentTermsNetDays : null) },
});

export default function FinanceConfiguration({ callApi = callPolicyApi }) {
  const [destinations, setDestinations] = useState(null);
  const [terms, setTerms] = useState([]);
  const [refusal, setRefusal] = useState(null);
  const [destinationDraft, setDestinationDraft] = useState(EMPTY_DESTINATION);
  const [termsDraft, setTermsDraft] = useState(EMPTY_TERMS);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const destinationSort = useTableSort({ rows: destinations, columns: DESTINATION_COLUMNS });
  const termsSort = useTableSort({ rows: terms, columns: TERMS_COLUMNS });
  const destHeader = (key, label) => <SortableHeader columnKey={key} label={label} sort={destinationSort.sort} onSort={destinationSort.toggle} />;
  const termsHeader = (key, label) => <SortableHeader columnKey={key} label={label} sort={termsSort.sort} onSort={termsSort.toggle} />;

  const load = useCallback(async () => {
    const res = await callApi("listAccountingDestinations", {});
    if (!res.ok) { setDestinations(null); setRefusal(refusalText(res)); return; }
    setRefusal(null);
    setDestinations(res.data?.items ?? []);
    const t = await callApi("listCounterpartyPaymentTerms", {});
    setTerms(t.ok ? (t.data?.items ?? []) : []);
  }, [callApi]);

  useEffect(() => { load(); }, [load]);

  const run = async (operation, input, after) => {
    setBusy(true);
    setNotice(null);
    const res = await callApi(operation, { ...input, reason });
    setBusy(false);
    if (!res.ok) { setNotice({ tone: "danger", text: refusalText(res) }); return; }
    setNotice({ tone: "positive", text: "Saved." });
    setReason("");
    await after?.();
  };

  const configureDestination = () => run("configureAccountingDestination", {
    operatingCompanyId: destinationDraft.operatingCompanyId, displayName: destinationDraft.displayName,
    ...(destinationDraft.providerKey ? { providerKey: destinationDraft.providerKey } : {}),
    ...(destinationDraft.externalCompanyRef ? { externalCompanyRef: destinationDraft.externalCompanyRef } : {}),
    activate: destinationDraft.activate,
  }, async () => { setDestinationDraft(EMPTY_DESTINATION); await load(); });
  const setDestinationStatus = (d, status) => run("setAccountingDestinationStatus", { destinationId: d.id, status }, load);
  const netDaysValid = /^\d{1,4}$/.test(termsDraft.netDays);
  const setTerms_ = () => run("setCounterpartyPaymentTerms", {
    operatingCompanyId: termsDraft.operatingCompanyId,
    counterparty: termsDraft.counterpartyKind === "INTERNAL_OPERATING_COMPANY"
      ? { kind: "INTERNAL_OPERATING_COMPANY", operatingCompanyId: termsDraft.counterpartyRef }
      : { kind: "EXTERNAL_ORGANIZATION", crmAccountId: termsDraft.counterpartyRef },
    paymentTermsNetDays: Number(termsDraft.netDays),
  }, async () => { setTermsDraft(EMPTY_TERMS); await load(); });

  return (
    <section aria-labelledby="finance-configuration-title">
      <SectionHeader id="finance-configuration-title" title="Finance Configuration" description="Accounting destinations and payment terms for each operating company. Each change states a reason and is audited." />
      {refusal && <p className="fo-muted" role="status">{refusal}</p>}
      {destinations && (
        <>
          <h4>Accounting Destinations</h4>
          <table className="fo-table" aria-label="Accounting destinations">
            <thead><tr>
              {destHeader("company", "Operating Company")}{destHeader("destination", "Destination")}{destHeader("provider", "Provider")}
              {destHeader("external", "External Company")}{destHeader("status", "Status")}<th />
            </tr></thead>
            <tbody>
              {destinationSort.sorted.map((d) => (
                <tr key={d.id}>
                  <td>{operatingCompanyLabel(d.operatingCompanyId)}</td>
                  <td>{d.displayName}</td>
                  <td>{d.providerKey ?? <span className="fo-muted">none</span>}</td>
                  <td>{d.externalCompanyRef ?? <span className="fo-muted">none</span>}</td>
                  <td><StatusIndicator tone={d.status === "ACTIVE" ? "positive" : "neutral"}>{d.status === "ACTIVE" ? "Active Destination" : "Inactive (History)"}</StatusIndicator></td>
                  <td>
                    {d.status === "ACTIVE"
                      ? <Button size="sm" variant="secondary" disabled={busy || !reason.trim()} onClick={() => setDestinationStatus(d, "INACTIVE")}>Deactivate {d.displayName}</Button>
                      : <Button size="sm" variant="secondary" disabled={busy || !reason.trim()} onClick={() => setDestinationStatus(d, "ACTIVE")}>Activate {d.displayName}</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fo-form-row">
            <Field label="Operating Company"><OperatingCompanySelect label="Operating Company" value={destinationDraft.operatingCompanyId} onChange={(v) => setDestinationDraft({ ...destinationDraft, operatingCompanyId: v })} /></Field>
            <Field label="Destination Name"><input className="fo-input" aria-label="Destination Name" value={destinationDraft.displayName} onChange={(e) => setDestinationDraft({ ...destinationDraft, displayName: e.target.value })} /></Field>
            <Field label="Provider (Optional)"><input className="fo-input" aria-label="Provider (Optional)" value={destinationDraft.providerKey} onChange={(e) => setDestinationDraft({ ...destinationDraft, providerKey: e.target.value })} /></Field>
            <Field label="External Company (Optional)"><input className="fo-input" aria-label="External Company (Optional)" value={destinationDraft.externalCompanyRef} onChange={(e) => setDestinationDraft({ ...destinationDraft, externalCompanyRef: e.target.value })} /></Field>
            <Field label="Activate Now">
              <input type="checkbox" aria-label="Activate Now" checked={destinationDraft.activate} onChange={(e) => setDestinationDraft({ ...destinationDraft, activate: e.target.checked })} />
            </Field>
          </div>

          <h4>Payment Terms</h4>
          <p className="fo-muted">A change applies to obligations opened after it; an obligation already open keeps its due date.</p>
          <table className="fo-table" aria-label="Payment terms">
            <thead><tr>{termsHeader("company", "Operating Company")}{termsHeader("counterparty", "Counterparty")}{termsHeader("terms", "Terms")}</tr></thead>
            <tbody>
              {termsSort.sorted.map((t) => (
                <tr key={`${t.operatingCompanyId}:${t.counterparty.kind}:${counterpartyKey(t.counterparty)}`}>
                  <td>{operatingCompanyLabel(t.operatingCompanyId)}</td>
                  <td>{counterpartyText(t.counterparty)} <span className="fo-muted">({COUNTERPARTY_LABEL[t.counterparty.kind]})</span></td>
                  <td>{t.paymentTermsNetDays === null ? <span className="fo-muted">Not Configured</span> : `Net ${t.paymentTermsNetDays} days`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fo-form-row">
            <Field label="Operating Company (Who Is Owed)"><OperatingCompanySelect label="Operating Company (Who Is Owed)" value={termsDraft.operatingCompanyId} onChange={(v) => setTermsDraft({ ...termsDraft, operatingCompanyId: v })} /></Field>
            <Field label="Counterparty Kind">
              <select className="fo-input" aria-label="Counterparty Kind" value={termsDraft.counterpartyKind} onChange={(e) => setTermsDraft({ ...termsDraft, counterpartyKind: e.target.value, counterpartyRef: "" })}>
                <option value="INTERNAL_OPERATING_COMPANY">Operating Company</option>
                <option value="EXTERNAL_ORGANIZATION">Organization</option>
              </select>
            </Field>
            {termsDraft.counterpartyKind === "INTERNAL_OPERATING_COMPANY" ? (
              <Field label="Counterparty Company">
                <OperatingCompanySelect label="Counterparty Company" value={termsDraft.counterpartyRef} onChange={(v) => setTermsDraft({ ...termsDraft, counterpartyRef: v })} />
              </Field>
            ) : (
              <Field label="Counterparty Organization ID">
                <input className="fo-input" aria-label="Counterparty Organization ID" value={termsDraft.counterpartyRef} onChange={(e) => setTermsDraft({ ...termsDraft, counterpartyRef: e.target.value })} />
              </Field>
            )}
            <Field label="Net Days"><input className="fo-input" aria-label="Net Days" inputMode="numeric" value={termsDraft.netDays} onChange={(e) => setTermsDraft({ ...termsDraft, netDays: e.target.value })} /></Field>
          </div>

          <Field label="Reason (Required for Every Change)"><input className="fo-input" aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="fo-form-actions">
            <Button disabled={busy || !reason.trim() || !destinationDraft.operatingCompanyId || !destinationDraft.displayName} onClick={configureDestination}>Add Destination</Button>
            <Button disabled={busy || !reason.trim() || !termsDraft.operatingCompanyId || !termsDraft.counterpartyRef || !netDaysValid} onClick={setTerms_}>Save Payment Terms</Button>
          </div>
          {notice && <FormError>{notice.tone === "danger" ? notice.text : null}</FormError>}
          {notice?.tone === "positive" && <p className="fo-muted" role="status">{notice.text}</p>}
        </>
      )}
    </section>
  );
}
