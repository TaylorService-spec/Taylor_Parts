// ADMINISTRATION > ROLES & PERMISSIONS > one SECURITY ROLE -- the enforced view of a Role.
//
// Contract: docs/architecture/administration-control-plane-2026-09-26.md section 8
// (getSecurityRoleDetail, listRoleCapabilityDecisionHistory, grant/revoke/condition mutations).
//
//   the Role (name, key, protected)
//   Holders -- the Principals with an active assignment of this Role
//   Objects & actions -- every governed action, held or not, with SOURCE and CONDITION, and the
//     controls to grant / revoke / set or retire a condition (reason required)
//   Decision history -- every Administration decision on this Role, oldest first, superseded included
//
// A SECURITY ROLE IS ACCESS. It is not a Job Role (business function, Workforce) and is never shown as
// one. The server's evaluator reads exactly these rows; nothing here is a projection it does not use.
import { useMemo, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { adminControlPlaneClient } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { GrantCellControls, GrantCellFacts } from "./GrantControls.jsx";
import { ReadState } from "./ObjectActionSecurity.jsx";
import { conditionKindsFor, roleActionsByObject } from "./controlPlaneModel.js";

export default function SecurityRoleDetail({ api = adminControlPlaneClient, roleKey }) {
  const detail = useControlPlaneRead(roleKey ? () => api.getSecurityRoleDetail(roleKey) : null, `role:${roleKey}`);
  const history = useControlPlaneRead(roleKey ? () => api.listRoleCapabilityDecisionHistory({ roleKey, limit: 200 }) : null, `history:${roleKey}`);
  const groups = useMemo(() => (detail.data ? roleActionsByObject(detail.data) : null), [detail.data]);
  const [openObject, setOpenObject] = useState(null);
  const kinds = conditionKindsFor(detail.data?.supportedConditionKinds);

  if (!roleKey) return null;
  if (!detail.data) return <ReadState read={detail} what="this Security Role" />;
  if (!groups) return <p className="fo-warning" role="alert">The server returned a Security Role payload this screen cannot read, so nothing is shown.</p>;

  const role = detail.data;
  const holders = Array.isArray(role.holders) ? role.holders : [];
  const onChanged = () => { detail.reload(); history.reload(); };

  return (
    <section className="fo-panel" aria-label={`Security Role ${role.name ?? roleKey}`} data-security-role={roleKey}>
      <h3>
        {role.name ?? roleKey} <span className="fo-muted">· Security Role <code>{roleKey}</code>{role.protected ? " · protected" : ""}</span>
      </h3>
      {role.description ? <p className="fo-muted">{role.description}</p> : null}
      {detail.status === "loading" ? <p className="fo-muted" role="status">Re-reading from the server…</p> : null}

      <h4>Holders ({holders.length})</h4>
      {holders.length === 0 ? (
        <p className="fo-muted">No Principal holds this Security Role.</p>
      ) : (
        <table className="fo-table" aria-label="Holders">
          <thead><tr><th>Principal</th><th>Scope</th><th>Since</th></tr></thead>
          <tbody>
            {holders.map((h) => (
              <tr key={h.assignmentId}>
                <td>{h.displayName ?? h.principalId} <span className="fo-muted"><code>{h.principalId}</code></span></td>
                <td className="fo-muted">{h.scopeType}{h.scopeValue ? ` · ${h.scopeValue}` : ""}</td>
                <td className="fo-muted">{h.grantedAt ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Objects &amp; actions</h4>
      <p className="fo-muted">
        Every governed action, grouped by Object. Expand an Object to administer its actions for this Role.
      </p>
      <table className="fo-table" aria-label="Objects and actions">
        <thead><tr><th>Object / action</th><th>State</th><th>Administer</th></tr></thead>
        <tbody>
          {groups.map((group) => {
            const open = openObject === group.objectKey;
            return (
              <ObjectGroupRows
                key={group.objectKey}
                group={group}
                open={open}
                onToggle={() => setOpenObject(open ? null : group.objectKey)}
                api={api}
                roleKey={roleKey}
                kinds={kinds}
                onChanged={onChanged}
              />
            );
          })}
        </tbody>
      </table>

      <DecisionHistory read={history} />
    </section>
  );
}

function ObjectGroupRows({ group, open, onToggle, api, roleKey, kinds, onChanged }) {
  return (
    <>
      <tr>
        <td colSpan={3}>
          <Button type="button" variant="secondary" onClick={onToggle} aria-expanded={open}>
            {open ? "▾" : "▸"} {group.objectKey}
          </Button>
          <span className="fo-muted">{` ${group.heldCount} of ${group.actions.length} held`}</span>
        </td>
      </tr>
      {open ? group.actions.map((action) => (
        <tr key={action.capabilityKey} className="fo-row-nested" data-role-action={action.capabilityKey}>
          <td>
            {action.displayLabel ?? "Unlabelled action"}{" "}
            <span className="fo-muted"><code>{action.capabilityKey}</code></span>
            {action.forbiddenBy ? <span className="fo-muted">{` · ${action.forbiddenBy}`}</span> : null}
          </td>
          <td><GrantCellFacts cell={action} /></td>
          <td>
            <GrantCellControls
              api={api}
              objectKey={action.objectKey}
              actionKey={action.actionKey}
              roleKey={roleKey}
              cell={action}
              kinds={kinds}
              onChanged={onChanged}
            />
          </td>
        </tr>
      )) : null}
    </>
  );
}

function DecisionHistory({ read }) {
  const rows = Array.isArray(read.data) ? read.data : [];
  return (
    <div className="fo-cp-section" aria-label="Decision history">
      <h4>Decision history</h4>
      {!read.data ? <ReadState read={read} what="the decision history" /> : null}
      {read.data && rows.length === 0 ? <p className="fo-muted">No Administration decision has been recorded for this Security Role.</p> : null}
      {rows.length > 0 ? (
        <table className="fo-table" aria-label="Decision history">
          <thead><tr><th>When</th><th>Capability</th><th>Decision</th><th>Reason</th><th>Actor</th><th>Current</th></tr></thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={d.id ?? `${d.capabilityKey}-${d.decidedAt}-${i}`}>
                <td className="fo-muted">{d.decidedAt ?? "—"}</td>
                <td><code>{d.capabilityKey}</code></td>
                <td>{d.decision}{d.requiresCondition ? " · requires condition" : ""}</td>
                <td>{d.reason}</td>
                <td className="fo-muted"><code>{d.actorPrincipalId ?? "—"}</code></td>
                <td className="fo-muted">{d.supersededAt ? `superseded ${d.supersededAt}` : "current"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
