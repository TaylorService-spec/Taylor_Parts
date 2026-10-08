// Administration -> System Configuration (Owner ruling #204, 2026-10-03).
//
// Governed company / system settings, by ONE server registry: each operating company's business time zone and default
// language today, and the settings that follow without a new screen architecture. Every read and change goes to
// /admin/policy, where the server gates it on admin.systemConfiguration.manage (system administration -- it confers no
// business approval), validates it (and the database re-checks), and audits it with its reason. This screen decides
// nothing: a refusal is the server's answer, rendered here. Business-specific configuration stays with its own domain:
// accounting destinations and payment terms are on Financial Policy; Sales discount authority is Sales Configuration.
import { useCallback, useEffect, useState } from "react";
import { PageHeader, SectionHeader, Button } from "../../shared/ui/primitives";
import { Field, FormError } from "../../shared/ui/form";
import { callPolicyApi } from "../../services/adminPolicyApiClient";
import { operatingCompanyLabel } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

const refusalText = (res) => {
  if (res.code === "FORBIDDEN") return "System Configuration is not available to you. It needs admin.systemConfiguration.manage, which your account does not currently hold.";
  if (res.code === "NOT_CONFIGURED") return "The EOS Administration API is not configured for this environment.";
  return res.message || "The request could not be completed.";
};

export default function AdminSystemConfiguration({ callApi = callPolicyApi }) {
  const [config, setConfig] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const languageName = (tag) => config?.supportedLanguages?.find((l) => l.languageTag === tag)?.displayName ?? tag;
  const { sort, toggle, sorted } = useTableSort({
    rows: config?.companies ?? null,
    columns: {
      company: { value: (c) => operatingCompanyLabel(c.operatingCompanyId) },
      timeZone: { value: (c) => c.values?.businessTimeZone?.value },
      language: { value: (c) => languageName(c.values?.defaultLanguage?.value) },
    },
  });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;

  const load = useCallback(async () => {
    const res = await callApi("listSystemConfiguration", {});
    if (!res.ok) { setConfig(null); setRefusal(refusalText(res)); return; }
    setRefusal(null);
    setConfig(res.data ?? null);
  }, [callApi]);

  useEffect(() => { load(); }, [load]);

  const draftKey = (companyId, settingKey) => `${companyId}:${settingKey}`;
  const save = async (companyId, settingKey) => {
    setBusy(true);
    setNotice(null);
    const res = await callApi("setSystemConfigurationSetting", { operatingCompanyId: companyId, settingKey, value: drafts[draftKey(companyId, settingKey)], reason });
    setBusy(false);
    if (!res.ok) { setNotice({ tone: "danger", text: refusalText(res) }); return; }
    setNotice({ tone: "positive", text: "Saved." });
    setReason("");
    setDrafts((d) => ({ ...d, [draftKey(companyId, settingKey)]: undefined }));
    await load();
  };

  return (
    <div>
      <PageHeader title="System Configuration" subtitle="Company settings: business time zone and default language. Each change is validated, states a reason and is audited." />
      {refusal && <p className="fo-muted" role="status">{refusal}</p>}
      {config && (
        <section className="fo-panel" aria-labelledby="system-configuration-company">
          <SectionHeader id="system-configuration-company" title="Company" description="The business date of an event is its date in the company's time zone; timestamps are kept as recorded. A change applies from now on." />
          <table className="fo-table" aria-label="Company settings">
            <thead><tr>{header("company", "Operating Company")}{header("timeZone", "Time Zone")}{header("language", "Language")}</tr></thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.operatingCompanyId}>
                  <td>{operatingCompanyLabel(c.operatingCompanyId)}</td>
                  <td>
                    <div>{c.values.businessTimeZone?.value}</div>
                    <input className="fo-input" aria-label={`New time zone for ${operatingCompanyLabel(c.operatingCompanyId)}`} placeholder="e.g. America/Phoenix"
                      value={drafts[draftKey(c.operatingCompanyId, "businessTimeZone")] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [draftKey(c.operatingCompanyId, "businessTimeZone")]: e.target.value })} />
                    <Button size="sm" variant="secondary" disabled={busy || !reason.trim() || !drafts[draftKey(c.operatingCompanyId, "businessTimeZone")]}
                      onClick={() => save(c.operatingCompanyId, "businessTimeZone")}>Set Time Zone for {operatingCompanyLabel(c.operatingCompanyId)}</Button>
                  </td>
                  <td>
                    <div>{languageName(c.values.defaultLanguage?.value)}{c.values.defaultLanguage?.source === "DEFAULT" ? <span className="fo-muted"> (Default)</span> : null}</div>
                    <select className="fo-input" aria-label={`New language for ${operatingCompanyLabel(c.operatingCompanyId)}`}
                      value={drafts[draftKey(c.operatingCompanyId, "defaultLanguage")] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [draftKey(c.operatingCompanyId, "defaultLanguage")]: e.target.value })}>
                      <option value="">Choose a Language…</option>
                      {config.supportedLanguages.map((l) => <option key={l.languageTag} value={l.languageTag}>{l.displayName}</option>)}
                    </select>
                    <Button size="sm" variant="secondary" disabled={busy || !reason.trim() || !drafts[draftKey(c.operatingCompanyId, "defaultLanguage")]}
                      onClick={() => save(c.operatingCompanyId, "defaultLanguage")}>Set Language for {operatingCompanyLabel(c.operatingCompanyId)}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Field label="Reason (Required for Every Change)"><input className="fo-input" aria-label="Reason for the change" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {notice && <FormError>{notice.tone === "danger" ? notice.text : null}</FormError>}
          {notice?.tone === "positive" && <p className="fo-muted" role="status">{notice.text}</p>}
        </section>
      )}
    </div>
  );
}
