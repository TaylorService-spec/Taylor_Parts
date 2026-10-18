// EMPLOYEE > COMPANY ACCESS -- explicit company-access grants, governed in PostgreSQL (DECISIONS #249, Option A).
//
//   read   listEmployeeCompanyAuthority { employeeId }   (admin.principalAccess.read, server-side)
//   write  grantCompanyAuthority { employeeId, operatingCompanyId, reason[, effectiveFrom, effectiveUntil] }   (admin.roleAssignment.write)
//          revokeCompanyAuthority { grantId, reason }
//
// COMPANY ACCESS lets this person see and act on ANOTHER company's records. It grants no permissions: what they may do in
// that company is still decided by the Security Roles they hold. It is not employment membership -- their Operating Company
// (the Employee record) does not change -- and it does not give Finance access to the company (Finance access is its own
// assignment). Described in those words on screen.
//
// NO CLIENT GATE AND NO CLIENT POLICY. Whether the caller may grant, which companies may be offered, whether a grant is
// active, scheduled or expired, and why a request is refused are ALL the server's answers, drawn as returned. A change is
// previewed by the server first and committed with the preview's digest, exactly like a Security Role assignment.
import { useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { adminControlPlaneClient } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { ReadState } from "./ObjectActionSecurity.jsx";
import { Outcome, ReasonField } from "./GrantControls.jsx";
import { AuthorityImpactPreview, useAuthorityImpactPreview, withPreviewDigest } from "./AuthorityImpactPreview.jsx";
import { statedReason } from "./controlPlaneModel.js";

const STATE_WORDS = Object.freeze({ ACTIVE: "Company access active", SCHEDULED: "Scheduled", EXPIRED: "Expired", REVOKED: "Revoked" });
const dateOnly = (iso) => (typeof iso === "string" && iso.length >= 10 ? iso.slice(0, 10) : "—");
/** A datetime-local value (the browser's own zone) as the offset-carrying instant the server requires; "" when unset or unreadable. */
const instantOf = (local) => {
  if (!local) return "";
  const ms = Date.parse(local);
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString();
};

export default function EmployeeCompanyAccess({ api = adminControlPlaneClient, employeeId, employeeName = "this Employee" }) {
  const read = useControlPlaneRead(employeeId && typeof api.listEmployeeCompanyAuthority === "function"
    ? () => api.listEmployeeCompanyAuthority(employeeId) : null, `companyAccess:${employeeId}`);
  const [companyId, setCompanyId] = useState("");
  const [fromLocal, setFromLocal] = useState("");
  const [untilLocal, setUntilLocal] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const reasonText = statedReason(reason);
  const effectiveFrom = instantOf(fromLocal);
  const effectiveUntil = instantOf(untilLocal);
  const pendingOperation = removing ? "revokeCompanyAuthority" : companyId ? "grantCompanyAuthority" : null;
  const pendingChange = removing
    ? { grantId: removing.id, reason: reasonText }
    : { employeeId, operatingCompanyId: companyId, reason: reasonText, effectiveFrom, effectiveUntil };
  const preview = useAuthorityImpactPreview(api, pendingOperation, pendingChange);

  if (!employeeId) return <p className="fo-muted" data-employee-company-access="NO_EMPLOYEE">No Employee is selected.</p>;
  if (!read.data) return <ReadState read={read} what="this Employee's company access" />;
  const view = read.data;
  if (!view || !Array.isArray(view.grants) || !Array.isArray(view.grantableCompanies)) {
    return <p className="fo-warning" role="alert">The server returned a company-access payload this screen cannot read, so nothing is shown.</p>;
  }

  const rows = view.grants.filter((g) => g.status === "active");
  const history = view.grants.filter((g) => g.status !== "active");

  const grant = async (event) => {
    event.preventDefault();
    if (!companyId || !reasonText || busy || !preview.canConfirm) return;
    setBusy(true);
    const outcome = preview.settle(await api.grantCompanyAuthority(withPreviewDigest(pendingChange, preview)));
    setBusy(false);
    setResult(outcome);
    if (outcome?.ok) { setCompanyId(""); setFromLocal(""); setUntilLocal(""); setReason(""); read.reload(); }
  };

  const revoke = async (event) => {
    event.preventDefault();
    if (!removing || !reasonText || busy || !preview.canConfirm) return;
    setBusy(true);
    const outcome = preview.settle(await api.revokeCompanyAuthority(withPreviewDigest(pendingChange, preview)));
    setBusy(false);
    setResult(outcome);
    if (outcome?.ok) { setRemoving(null); setReason(""); read.reload(); }
  };

  return (
    <div data-employee-company-access={rows.length}>
      <p className="fo-muted">
        Company access lets this person see and act on another company’s records. It grants no permissions: what they may do
        there is still decided by their Security Roles. It does not change their own company, and it does not give Finance access.
      </p>
      <p data-home-company>{`Own company: `}<code>{view.homeOperatingCompanyId}</code> <span className="fo-muted">(from the Employee record)</span></p>

      {rows.length === 0 ? (
        <p className="fo-muted">{`${employeeName} has no company access beyond their own company.`}</p>
      ) : (
        <table className="fo-table" aria-label="Company access held">
          <thead>
            <tr><th>Company</th><th>State</th><th>From</th><th>Until</th><th>Reason</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} data-company-grant={g.id} data-company-grant-state={g.displayState}>
                <td><code>{g.operatingCompanyId}</code></td>
                <td>{STATE_WORDS[g.displayState] ?? g.displayState}</td>
                <td className="fo-muted">{dateOnly(g.effectiveFrom)}</td>
                <td className="fo-muted">{g.effectiveUntil ? dateOnly(g.effectiveUntil) : "No end date"}</td>
                <td className="fo-muted">{g.reason}</td>
                <td>
                  <Button type="button" variant="secondary" onClick={() => { setRemoving(g); setReason(""); setResult(null); }}
                    aria-label={`Remove access to ${g.operatingCompanyId}`}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {removing ? (
        <form className="fo-cp-form" onSubmit={revoke} aria-label="Remove company access">
          <p>{`Remove ${employeeName}’s access to ${removing.operatingCompanyId}? It stops on their next request.`}</p>
          <ReasonField value={reason} onChange={setReason} />
          <AuthorityImpactPreview preview={preview} disabled={!reasonText || busy} />
          <div className="fo-btn-row">
            <Button type="submit" variant="primary" disabled={!reasonText || busy || !preview.canConfirm}>Confirm Removal</Button>
            <Button type="button" variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <form className="fo-cp-form" onSubmit={grant} aria-label="Add company access">
          <label className="fo-form-field">
            <span>Add company access</span>
            <select aria-label="Company to add" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">Choose a company…</option>
              {view.grantableCompanies.map((c) => <option key={c.value} value={c.value}>{c.label ?? c.value}</option>)}
            </select>
          </label>
          {companyId ? (
            <>
              <label className="fo-form-field">
                <span>Starts (optional — blank means now)</span>
                <input type="datetime-local" aria-label="Access starts" value={fromLocal} onChange={(e) => setFromLocal(e.target.value)} />
              </label>
              <label className="fo-form-field">
                <span>Ends (optional — blank means no end date)</span>
                <input type="datetime-local" aria-label="Access ends" value={untilLocal} onChange={(e) => setUntilLocal(e.target.value)} />
              </label>
            </>
          ) : null}
          <ReasonField value={reason} onChange={setReason} />
          <AuthorityImpactPreview preview={preview} disabled={!companyId || !reasonText || busy} />
          <Button type="submit" variant="primary" disabled={!companyId || !reasonText || busy || !preview.canConfirm}>Add Company Access</Button>
          <p className="fo-muted">The server decides whether you may change company access, and says so if not.</p>
        </form>
      )}
      <Outcome result={result} success="Saved by the server; re-reading." />

      {history.length > 0 ? (
        <details data-company-grant-history>
          <summary>{`Past company access (${history.length})`}</summary>
          <ul className="fo-muted">
            {history.map((g) => (
              <li key={g.id}>{`${g.operatingCompanyId} — ${STATE_WORDS[g.displayState] ?? g.displayState}${g.revokedAt ? `, removed ${dateOnly(g.revokedAt)}` : ""}${g.revokeReason ? ` (${g.revokeReason})` : ""}`}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
