// EMPLOYEE > WORKFLOW RESPONSIBILITIES -- derived by the server, never a second permission system.
//
//   Employee -> Security Role (global or scoped) -> [Functional Role narrows] -> workflow binding (ACTIVE version)
//            -> Role capability grant (+ condition) -> effective responsibility
//
//   responsibility = an ACTIVE workflow action a Security Role this Principal holds is bound to
//                    AND the runtime evaluator allows its capability
//
// FUNCTIONAL ROLE bindings only NARROW: an action with one requires the linked Employee to hold one of its Functional
// Roles as well. Each row shows its SOURCE (which rule produced it) and the required / held Functional Roles; a
// Functional Role held without a Security Role binding is listed with the inert bindings -- it confers nothing.
//
// WHERE TO CHANGE IT (lane WR). Each row carries the server's `adminLocations` -- the Security Role assignment, the
// Functional Role assignment, the workflow binding and the Role capability grant that produced it -- rendered as links to
// the Administration screen that governs each fact (domain/workflowResponsibilityLinks.js). There is no per-Employee
// workflow grant, so nothing here edits a responsibility directly: the administrator changes the underlying fact and
// this panel re-derives.
//
// The server (listPrincipalWorkflowResponsibilities) intersects the bindings with the SAME evaluator
// explainEffectiveAccess uses. This panel draws its answer. Bindings that confer nothing -- bound,
// but the capability is not held -- are listed separately so no administrator mistakes them for
// authority.
import { Link, useInRouterContext } from "react-router-dom";
import { refusalText } from "../../services/adminControlPlaneClient.js";
import { workflowAdminClient } from "../../services/workflowAdminClient.js";
import { adminLocationLinks, ADMIN_LOCATION_KIND_WORDS } from "../../domain/workflowResponsibilityLinks.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { identifierLabel, operatingCompanyLabel, statusLabel, titleCase } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

const SOURCE_WORDS = Object.freeze({
  WORKFLOW_BINDING_AND_EFFECTIVE_AUTHORITY: "Security Role binding + effective authority",
  WORKFLOW_BINDING_FUNCTIONAL_ROLE_AND_EFFECTIVE_AUTHORITY: "Security Role binding + Functional Role + effective authority",
  FUNCTIONAL_ROLE_BINDING_ONLY: "Functional Role binding only — confers nothing",
});
const sourceWords = (source) => SOURCE_WORDS[source] ?? String(source ?? "—");
const functionalText = (r) => {
  const required = Array.isArray(r.requiredFunctionalRoles) ? r.requiredFunctionalRoles : [];
  if (required.length === 0) return "—";
  const held = Array.isArray(r.viaFunctionalRoles) ? r.viaFunctionalRoles : [];
  const words = (keys) => keys.map((k) => identifierLabel(k)).join(", ");
  return `requires one of ${words(required)}; holds ${held.length > 0 ? words(held) : "none"}`;
};
const scopeValueWords = (scopeType, value) => (scopeType === "operatingCompany" ? operatingCompanyLabel(value) : value);
/** Security Role labels, each with its scope when the binding is satisfied only through a scoped assignment. */
const roleText = (r) => {
  const sources = Array.isArray(r.securityRoleSources) ? r.securityRoleSources : null;
  if (!sources || sources.length === 0) return (r.viaRoles ?? []).map((k) => identifierLabel(k)).join(", ");
  return [...new Set(sources.map((s) => (s.scopeType && s.scopeType !== "global"
    ? `${identifierLabel(s.roleKey)} @ ${titleCase(s.scopeType)}: ${scopeValueWords(s.scopeType, s.scopeValue)}`
    : identifierLabel(s.roleKey))))].join(", ");
};
const conditionText = (r) => {
  const parts = [];
  if (r.guardKind) parts.push(`guard ${titleCase(r.guardKind)}`);
  const conditions = Array.isArray(r.grantConditions) ? r.grantConditions : [];
  for (const c of conditions) {
    const kinds = Array.isArray(c?.paths) ? [...new Set(c.paths.flat().map((p) => p?.kind).filter(Boolean))] : [];
    parts.push(`grant condition ${kinds.length > 0 ? kinds.map((k) => titleCase(k)).join(" / ") : "(conditioned)"}`);
  }
  return parts.length > 0 ? parts.join("; ") : "—";
};

function NavLink({ href, children }) {
  // Inside the app the router navigates; rendered bare (tests, embeds) it is a plain anchor to the same address.
  const inRouter = useInRouterContext();
  return inRouter ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>;
}

function WhereToChange({ row, employeeId }) {
  const locations = Array.isArray(row.adminLocations) ? row.adminLocations : [];
  if (locations.length === 0) return <span className="fo-muted">—</span>;
  return (
    <ul className="fo-admin-locations" data-admin-locations={locations.length}>
      {locations.map((loc, i) => (
        <li key={`${loc.kind}/${loc.id ?? i}/${i}`} data-admin-location={loc.kind} data-admin-location-id={loc.id ?? ""}>
          <span className="fo-muted">{ADMIN_LOCATION_KIND_WORDS[loc.kind] ?? loc.kind}: </span>
          {adminLocationLinks(loc, { employeeId }).map((l, j) => (
            <span key={l.href}>{j > 0 ? " · " : null}<NavLink href={l.href}>{l.label}</NavLink></span>
          ))}
        </li>
      ))}
    </ul>
  );
}

const RESPONSIBILITY_COLUMNS = Object.freeze({
  workflow: { value: (r) => r.workflowName ?? titleCase(r.workflowKey) },
  action: { value: (r) => r.actionLabel ?? titleCase(r.actionKey) },
  roles: { value: (r) => roleText(r) },
  functional: { value: (r) => { const t = functionalText(r); return t === "—" ? null : t; } },
  authority: { value: (r) => statusLabel(r.authority) },
  condition: { value: (r) => { const t = conditionText(r); return t === "—" ? null : t; } },
  source: { value: (r) => sourceWords(r.source) },
});

function ResponsibilityTable({ rows, employeeId }) {
  const { sort, toggle, sorted } = useTableSort({ rows, columns: RESPONSIBILITY_COLUMNS });
  const header = (key, label) => <SortableHeader columnKey={key} label={label} sort={sort} onSort={toggle} />;
  return (
    <table className="fo-table" aria-label="Workflow responsibilities">
      <thead><tr>
        {header("workflow", "Workflow")}{header("action", "Action")}{header("roles", "Via Security Role")}{header("functional", "Functional Role")}
        {header("authority", "Authority")}{header("condition", "Condition / Guard")}{header("source", "Source")}<th>Change It In</th>
      </tr></thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={`${r.workflowKey}/${r.actionKey}`} data-responsibility={`${r.workflowKey}/${r.actionKey}`} data-responsibility-authority={r.authority ?? ""}>
            <td>{r.workflowName ?? titleCase(r.workflowKey)} <span className="fo-muted">v{r.version}</span></td>
            <td>{r.actionLabel ?? titleCase(r.actionKey)} <span className="fo-muted">· {titleCase(r.from)} → {titleCase(r.to)}</span></td>
            <td data-via-roles>{roleText(r)}</td>
            <td className="fo-muted" data-functional-role-requirement>{functionalText(r)}</td>
            <td>{statusLabel(r.authority)}{r.capabilityKey ? <span className="fo-muted"> · <code>{r.capabilityKey}</code></span> : null}</td>
            <td className="fo-muted" data-responsibility-condition>{conditionText(r)}</td>
            <td className="fo-muted" data-responsibility-source={r.source ?? "NONE"}>{sourceWords(r.source)}</td>
            <td><WhereToChange row={r} employeeId={employeeId} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function EmployeeWorkflowResponsibilities({ api = workflowAdminClient, principalId, employeeId = null }) {
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
        they hold, and allowed by the server evaluator. A per-record guard or scope is decided on the record.
        There is no per-Employee workflow grant — change the Security Role, Functional Role, workflow
        binding or Role grant named in &ldquo;Change It In&rdquo;.
      </p>
      {rows.length === 0 ? <p className="fo-muted">No active workflow action is currently this Employee&rsquo;s responsibility.</p> : (
        <div className="fo-table-scroll">
          <ResponsibilityTable rows={rows} employeeId={employeeId} />
        </div>
      )}
      {inert.length > 0 ? (
        <details>
          <summary>{inert.length} binding(s) confer nothing (capability, Security Role binding or Functional Role missing)</summary>
          <ul>
            {inert.map((r) => (
              <li key={`${r.workflowKey}/${r.actionKey}`} data-inert-binding={`${r.workflowKey}/${r.actionKey}`}>
                {titleCase(r.workflowKey)} / {titleCase(r.actionKey)} via {[...(r.viaRoles ?? []).map((k) => identifierLabel(k)), ...(r.viaFunctionalRoles ?? []).map((k) => `Functional Role ${identifierLabel(k)}`)].join(", ") || "—"} — <code>{r.reasonCode}</code> <span className="fo-muted">({sourceWords(r.source)})</span>
                <WhereToChange row={r} employeeId={employeeId} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
