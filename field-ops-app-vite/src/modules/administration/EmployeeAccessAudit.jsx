// EMPLOYEE > ACCESS AUDIT -- the principal-side lens on the governed PostgreSQL audit trail.
//
// Reads `readPolicyAuditHistory { limit }` (gate: audit.event.read, on the server) and SELECTS the events
// whose target or before/after row names this Employee's linked Principal: Security Role assignments and
// revocations, direct grants, identity rebinds. Selection is presentation, not authorization -- the server
// already decided the caller may read the tenant's policy audit.
//
// The Employee-side trail (profile, manager, status, company, Job Role) is the separate governed Change
// History section (EMP-RT-H1). The two are never merged: each says which trail it is.
//
// BOUNDED, AND SAID SO. The read returns the tenant's most recent events (at most 500); an older event for
// this Principal is outside it. A refusal renders as itself, never as "no history".
import { useMemo } from "react";
import { adminControlPlaneClient } from "../../services/adminControlPlaneClient.js";
import { useControlPlaneRead } from "./useControlPlaneRead.js";
import { ReadState } from "./ObjectActionSecurity.jsx";
import { titleCase } from "../../shared/display/displayLabels.js";
import { useTableSort } from "../../shared/ui/sorting/useTableSort.js";
import SortableHeader from "../../shared/ui/sorting/SortableHeader.jsx";

export const ACCESS_AUDIT_LIMIT = 500;

const names = (value, principalId) => Boolean(value && typeof value === "object" && value.principalId === principalId);

/** The events that concern one Principal, newest first. Pure; exported for proof. */
export function principalAuditEvents(events, principalId) {
  if (!Array.isArray(events) || !principalId) return [];
  return events
    .filter((e) => e && (e.targetId === principalId || names(e.before, principalId) || names(e.after, principalId)))
    .sort((a, b) => String(b.occurredAt ?? "").localeCompare(String(a.occurredAt ?? "")));
}

const AUDIT_COLUMNS = Object.freeze({
  when: { value: (e) => e.occurredAt },
  action: { value: (e) => titleCase(e.action) },
  target: { value: (e) => `${e.targetKind ?? ""} ${e.targetId ?? ""}`.trim() },
  reason: { value: (e) => e.reason },
  actor: { value: (e) => e.actorUid },
});

function AccessAuditTable({ events }) {
  const { sort, toggle, sorted } = useTableSort({ rows: events, columns: AUDIT_COLUMNS });
  return (
    <table className="fo-table" aria-label="Access audit">
      <thead><tr>
        <SortableHeader columnKey="when" label="When" sort={sort} onSort={toggle} />
        <SortableHeader columnKey="action" label="Action" sort={sort} onSort={toggle} />
        <SortableHeader columnKey="target" label="Target" sort={sort} onSort={toggle} />
        <SortableHeader columnKey="reason" label="Reason" sort={sort} onSort={toggle} />
        <SortableHeader columnKey="actor" label="Actor" sort={sort} onSort={toggle} />
      </tr></thead>
      <tbody>
        {sorted.map((e) => (
          <tr key={e.id}>
            <td className="fo-muted">{e.occurredAt}</td>
            <td>{titleCase(e.action)}</td>
            <td className="fo-muted">{`${titleCase(e.targetKind)} `}<code>{e.targetId}</code></td>
            <td>{e.reason ?? "—"}</td>
            <td className="fo-muted"><code>{e.actorUid}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function EmployeeAccessAudit({ api = adminControlPlaneClient, principalId }) {
  const read = useControlPlaneRead(principalId ? () => api.readPolicyAuditHistory({ limit: ACCESS_AUDIT_LIMIT }) : null, `audit:${principalId}`);
  const events = useMemo(() => principalAuditEvents(read.data, principalId), [read.data, principalId]);

  if (!principalId) return <p className="fo-muted">No governed Principal is linked to this Employee, so there is no access audit to read.</p>;
  if (!read.data) return <ReadState read={read} what="the access audit trail" />;
  if (!Array.isArray(read.data)) return <p className="fo-warning" role="alert">The server returned an audit payload this screen cannot read, so nothing is shown.</p>;

  return (
    <div data-access-audit={events.length}>
      <p className="fo-muted">{`Security Role and direct-grant events for this Principal, from the tenant's most recent ${ACCESS_AUDIT_LIMIT} policy audit events.`}</p>
      {events.length === 0 ? <p className="fo-muted">No access event for this Principal in that window.</p> : (
        <AccessAuditTable events={events} />
      )}
    </div>
  );
}
