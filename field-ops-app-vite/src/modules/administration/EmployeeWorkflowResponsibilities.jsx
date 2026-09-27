// EMPLOYEE > WORKFLOW RESPONSIBILITIES -- derived by the server, never a second permission system.
//
//   responsibility = an ACTIVE workflow action a Security Role this Principal holds is bound to
//                    AND the runtime evaluator allows its capability
//
// The server (listPrincipalWorkflowResponsibilities) intersects the bindings with the SAME evaluator
// explainEffectiveAccess uses. This panel draws its answer. Bindings that confer nothing -- bound,
// but the capability is not held -- are listed separately so no administrator mistakes them for
// authority.
import { refusalText } from "../../services/adminControlPlaneClient.js";
import { workflowAdminClient } from "../../services/workflowAdminClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";

export default function EmployeeWorkflowResponsibilities({ api = workflowAdminClient, principalId }) {
  const read = useControlPlaneRead(principalId ? () => api.listPrincipalWorkflowResponsibilities(principalId) : null, `wf-resp:${principalId}`);
  if (!principalId) return <p className="fo-muted" data-workflow-responsibilities="NO_PRINCIPAL">No governed Principal is linked, so there are no workflow responsibilities.</p>;
  if (read.status === "loading" || read.status === "idle") return <p className="fo-muted" data-workflow-responsibilities="LOADING">Asking the server…</p>;
  if (read.status !== "ready") {
    return <p className="fo-warning" role="alert" data-workflow-responsibilities={read.status.toUpperCase()}>{refusalText(read.error)}</p>;
  }
  const data = read.data ?? {};
  const rows = Array.isArray(data.responsibilities) ? data.responsibilities : null;
  const inert = Array.isArray(data.boundWithoutAuthority) ? data.boundWithoutAuthority : [];
  if (!rows) return <p className="fo-warning" role="alert" data-workflow-responsibilities="UNREADABLE">The server returned a payload this screen cannot read, so nothing is shown.</p>;

  return (
    <div data-workflow-responsibilities="READY" data-workflow-responsibility-rows={rows.length}>
      <p className="fo-muted">
        Actions in ACTIVE workflow versions this Employee may perform: bound through a Security Role
        they hold, and allowed by the server evaluator. A per-record guard is decided on the record.
      </p>
      {rows.length === 0 ? <p className="fo-muted">No active workflow action is currently this Employee&rsquo;s responsibility.</p> : (
        <table className="fo-table" aria-label="Workflow responsibilities">
          <thead><tr><th>Workflow</th><th>Action</th><th>Via Security Role</th><th>Authority</th><th>Guard</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.workflowKey}/${r.actionKey}`} data-responsibility={`${r.workflowKey}/${r.actionKey}`}>
                <td>{r.workflowName ?? r.workflowKey} <span className="fo-muted">v{r.version}</span></td>
                <td>{r.actionLabel ?? r.actionKey} <span className="fo-muted">· {r.from} → {r.to}</span></td>
                <td>{(r.viaRoles ?? []).join(", ")}</td>
                <td>{r.authority}{r.capabilityKey ? <span className="fo-muted"> · <code>{r.capabilityKey}</code></span> : null}</td>
                <td className="fo-muted">{r.guardKind ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {inert.length > 0 ? (
        <details>
          <summary>{inert.length} binding(s) confer nothing (the capability is not held)</summary>
          <ul>
            {inert.map((r) => (
              <li key={`${r.workflowKey}/${r.actionKey}`} data-inert-binding={`${r.workflowKey}/${r.actionKey}`}>
                {r.workflowKey} / {r.actionKey} via {(r.viaRoles ?? []).join(", ")} — {r.reasonCode}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
