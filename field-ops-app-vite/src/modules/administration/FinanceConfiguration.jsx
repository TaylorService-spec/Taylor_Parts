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

const refusalText = (res) => {
  if (res.code === "FORBIDDEN") return "Finance configuration is not available to you. It needs finance.configuration.manage, which your account does not currently hold.";
  if (res.code === "NOT_CONFIGURED") return "The EOS Administration API is not configured for this environment.";
  return res.message || "The request could not be completed.";
};

const EMPTY_DESTINATION = { operatingCompanyId: "", displayName: "", providerKey: "", externalCompanyRef: "", activate: true };
const EMPTY_TERMS = { operatingCompanyId: "", counterpartyKind: "INTERNAL_OPERATING_COMPANY", counterpartyRef: "", netDays: "" };
const COUNTERPARTY_LABEL = { INTERNAL_OPERATING_COMPANY: "Operating company", EXTERNAL_ORGANIZATION: "Organization" };
const counterpartyText = (cp) => cp.kind === "INTERNAL_OPERATING_COMPANY" ? cp.operatingCompanyId : (cp.name ?? cp.crmAccountId);

export default function FinanceConfiguration({ callApi = callPolicyApi }) {
  const [destinations, setDestinations] = useState(null);
  const [terms, setTerms] = useState([]);
  const [refusal, setRefusal] = useState(null);
  const [destinationDraft, setDestinationDraft] = useState(EMPTY_DESTINATION);
  const [termsDraft, setTermsDraft] = useState(EMPTY_TERMS);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

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
      <SectionHeader id="finance-configuration-title" title="Finance configuration" description="Accounting destinations and payment terms for each operating company. Each change states a reason and is audited." />
      {refusal && <p className="fo-muted" role="status">{refusal}</p>}
      {destinations && (
        <>
          <h4>Accounting destinations</h4>
          <table className="fo-table" aria-label="Accounting destinations">
            <thead><tr><th>Operating company</th><th>Destination</th><th>Provider</th><th>External company</th><th>Status</th><th /></tr></thead>
            <tbody>
              {destinations.map((d) => (
                <tr key={d.id}>
                  <td>{d.operatingCompanyId}</td>
                  <td>{d.displayName}</td>
                  <td>{d.providerKey ?? <span className="fo-muted">none</span>}</td>
                  <td>{d.externalCompanyRef ?? <span className="fo-muted">none</span>}</td>
                  <td><StatusIndicator tone={d.status === "ACTIVE" ? "positive" : "neutral"}>{d.status === "ACTIVE" ? "Active destination" : "Inactive (history)"}</StatusIndicator></td>
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
            <Field label="Operating company id"><input className="fo-input" aria-label="Operating company id" value={destinationDraft.operatingCompanyId} onChange={(e) => setDestinationDraft({ ...destinationDraft, operatingCompanyId: e.target.value })} /></Field>
            <Field label="Destination name"><input className="fo-input" aria-label="Destination name" value={destinationDraft.displayName} onChange={(e) => setDestinationDraft({ ...destinationDraft, displayName: e.target.value })} /></Field>
            <Field label="Provider (optional)"><input className="fo-input" aria-label="Provider (optional)" value={destinationDraft.providerKey} onChange={(e) => setDestinationDraft({ ...destinationDraft, providerKey: e.target.value })} /></Field>
            <Field label="External company (optional)"><input className="fo-input" aria-label="External company (optional)" value={destinationDraft.externalCompanyRef} onChange={(e) => setDestinationDraft({ ...destinationDraft, externalCompanyRef: e.target.value })} /></Field>
            <Field label="Activate now">
              <input type="checkbox" aria-label="Activate now" checked={destinationDraft.activate} onChange={(e) => setDestinationDraft({ ...destinationDraft, activate: e.target.checked })} />
            </Field>
          </div>

          <h4>Payment terms</h4>
          <p className="fo-muted">A change applies to obligations opened after it; an obligation already open keeps its due date.</p>
          <table className="fo-table" aria-label="Payment terms">
            <thead><tr><th>Operating company</th><th>Counterparty</th><th>Terms</th></tr></thead>
            <tbody>
              {terms.map((t) => (
                <tr key={`${t.operatingCompanyId}:${t.counterparty.kind}:${counterpartyText(t.counterparty)}`}>
                  <td>{t.operatingCompanyId}</td>
                  <td>{counterpartyText(t.counterparty)} <span className="fo-muted">({COUNTERPARTY_LABEL[t.counterparty.kind]})</span></td>
                  <td>{t.paymentTermsNetDays === null ? <span className="fo-muted">Not configured</span> : `Net ${t.paymentTermsNetDays} days`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fo-form-row">
            <Field label="Operating company id (who is owed)"><input className="fo-input" aria-label="Operating company id (who is owed)" value={termsDraft.operatingCompanyId} onChange={(e) => setTermsDraft({ ...termsDraft, operatingCompanyId: e.target.value })} /></Field>
            <Field label="Counterparty kind">
              <select className="fo-input" aria-label="Counterparty kind" value={termsDraft.counterpartyKind} onChange={(e) => setTermsDraft({ ...termsDraft, counterpartyKind: e.target.value })}>
                <option value="INTERNAL_OPERATING_COMPANY">Operating company</option>
                <option value="EXTERNAL_ORGANIZATION">Organization</option>
              </select>
            </Field>
            <Field label={termsDraft.counterpartyKind === "INTERNAL_OPERATING_COMPANY" ? "Counterparty company id" : "Counterparty organization id"}>
              <input className="fo-input" aria-label={termsDraft.counterpartyKind === "INTERNAL_OPERATING_COMPANY" ? "Counterparty company id" : "Counterparty organization id"} value={termsDraft.counterpartyRef} onChange={(e) => setTermsDraft({ ...termsDraft, counterpartyRef: e.target.value })} />
            </Field>
            <Field label="Net days"><input className="fo-input" aria-label="Net days" inputMode="numeric" value={termsDraft.netDays} onChange={(e) => setTermsDraft({ ...termsDraft, netDays: e.target.value })} /></Field>
          </div>

          <Field label="Reason (required for every change)"><input className="fo-input" aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="fo-form-actions">
            <Button disabled={busy || !reason.trim() || !destinationDraft.operatingCompanyId || !destinationDraft.displayName} onClick={configureDestination}>Add destination</Button>
            <Button disabled={busy || !reason.trim() || !termsDraft.operatingCompanyId || !termsDraft.counterpartyRef || !netDaysValid} onClick={setTerms_}>Save payment terms</Button>
          </div>
          {notice && <FormError>{notice.tone === "danger" ? notice.text : null}</FormError>}
          {notice?.tone === "positive" && <p className="fo-muted" role="status">{notice.text}</p>}
        </>
      )}
    </section>
  );
}
