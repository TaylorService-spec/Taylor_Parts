// EMPLOYEE > EFFECTIVE ACCESS -- the SERVER EVALUATOR's answer, rendered, never re-derived.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md section 8,
// "Specified, not implemented: explainEffectiveAccess" { principalId } -> per capability
// { capabilityKey, objectKey, actionKey, via: [{ grantor, condition }], runtime }.
//
// ONE EVALUATOR. The server resolves the Principal's qualifying assignments, the capability set and the
// grant conditions from the SAME PostgreSQL provider the runtime uses. This panel draws each row's verdict
// (Allowed / Conditional / Withheld / DIRECT EXCEPTION not enforced / Denied), its source Security Role or
// direct exception, its condition, its scope and the server's reason -- and computes none of them. An
// unknown verdict is shown raw.
//
// NOT SERVED YET IS A STATE. Until the server serves explainEffectiveAccess the read answers
// UNKNOWN_OPERATION and this panel says Effective Access is UNAVAILABLE -- it never falls back to the
// older getPrincipalEffectiveAccess preview, which is not the runtime evaluator (pass-7 G.1).
import { useMemo, useState } from "react";
import { adminControlPlaneClient, refusalText } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { effectiveAccessRows, groupByObject } from "./controlPlaneModel.js";

const VERDICT_TAG = Object.freeze({
  ALLOWED: "fo-cp-tag fo-cp-tag--allowed",
  CONDITIONAL: "fo-cp-tag fo-cp-tag--conditional",
  WITHHELD_FROM_FLAT_KERNELS: "fo-cp-tag fo-cp-tag--conditional",
  NOT_ENFORCED_DIRECT: "fo-cp-tag fo-cp-tag--direct",
  DENIED: "fo-cp-tag fo-cp-tag--denied",
});

export default function EmployeeEffectiveAccess({ api = adminControlPlaneClient, principalId }) {
  const read = useControlPlaneRead(principalId ? () => api.explainEffectiveAccess(principalId) : null, `explain:${principalId}`);
  const rows = useMemo(() => (read.status === "ready" ? effectiveAccessRows(read.data) : null), [read.status, read.data]);
  const [filter, setFilter] = useState("");

  if (!principalId) {
    return <p className="fo-muted" data-effective-access="NO_PRINCIPAL">No governed Principal is linked to this Employee, so there is no access to explain.</p>;
  }
  if (read.status === "loading" || read.status === "idle") return <p className="fo-muted" data-effective-access="LOADING">Asking the server evaluator…</p>;
  if (read.status === "unavailable") {
    return (
      <div data-effective-access="UNAVAILABLE">
        <p className="fo-warning">
          Effective Access is unavailable: this EOS API does not serve the runtime evaluator&rsquo;s
          explanation (explainEffectiveAccess) yet. Nothing is shown rather than an answer computed
          anywhere else.
        </p>
        <p className="fo-muted">{refusalText(read.error)}</p>
      </div>
    );
  }
  if (read.status === "failed") {
    return <p className="fo-warning" role="alert" data-effective-access="FAILED">{refusalText(read.error)}</p>;
  }
  if (!rows) {
    return <p className="fo-warning" role="alert" data-effective-access="UNREADABLE">The server returned an Effective Access payload this screen cannot read, so nothing is shown.</p>;
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => `${r.capabilityKey} ${r.displayLabel ?? ""} ${r.objectKey ?? ""}`.toLowerCase().includes(needle)) : rows;

  return (
    <div data-effective-access="READY" data-effective-access-rows={rows.length}>
      <p className="fo-muted">
        The server evaluator&rsquo;s answer for this Employee&rsquo;s Principal: per Object action, the
        verdict, the Security Role (or direct exception) it comes through, its condition and why.
      </p>
      <label className="fo-form-field">
        <span>Filter</span>
        <input type="search" aria-label="Filter effective access" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>
      {rows.length === 0 ? <p className="fo-muted">The evaluator reports no capability for this Principal.</p> : null}
      {groupByObject(shown).map((group) => (
        <table key={group.objectKey} className="fo-table" aria-label={`Effective access on ${group.objectKey}`}>
          <thead>
            <tr><th>{group.objectKey}</th><th>Verdict</th><th>Source</th><th>Condition</th><th>Scope</th><th>Why</th></tr>
          </thead>
          <tbody>
            {group.items.map((row) => (
              <tr key={row.capabilityKey} data-capability={row.capabilityKey} data-verdict={row.verdict ?? "NONE"}>
                <td>
                  {row.displayLabel ?? row.actionKey ?? row.capabilityKey}{" "}
                  <span className="fo-muted"><code>{row.capabilityKey}</code></span>
                </td>
                <td><span className={VERDICT_TAG[row.verdict] ?? "fo-cp-tag"}>{row.verdictWords}</span></td>
                <td>
                  {row.sources.length === 0 ? <span className="fo-muted">—</span> : row.sources.map((s, i) => (
                    <div key={i}>{s.direct ? <span className="fo-cp-tag fo-cp-tag--direct">{s.words}</span> : s.words}</div>
                  ))}
                  {row.direct && row.sources.every((s) => !s.direct) ? <span className="fo-cp-tag fo-cp-tag--direct">DIRECT EXCEPTION</span> : null}
                </td>
                <td className="fo-muted">{row.sources.map((s) => s.condition).filter(Boolean).join(" · ") || "—"}</td>
                <td className="fo-muted">{row.scope ? (typeof row.scope === "string" ? row.scope : JSON.stringify(row.scope)) : "—"}</td>
                <td className="fo-muted">{row.why ? (typeof row.why === "string" ? row.why : JSON.stringify(row.why)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
