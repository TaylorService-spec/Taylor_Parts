import { formatTimestamp } from "../../domain/displayTimestamp.js";
import { usePolicyStore } from "./usePolicyStore.js";

const DEFAULT_LIMIT = 100;

export function auditChangeKind(event) {
  const hasBefore = event?.before !== null && event?.before !== undefined;
  const hasAfter = event?.after !== null && event?.after !== undefined;
  if (!hasBefore && hasAfter) return "Created";
  if (hasBefore && !hasAfter) return "Removed";
  if (hasBefore && hasAfter) return "Changed";
  return "Recorded";
}

/**
 * Administration > Audit Logs
 *
 * Read-only projection of the append-only EOS policy audit history. The browser
 * asks the deployed Administration API for persisted events; it does not read
 * Firestore and it does not infer an audit record from client state.
 *
 * Deliberately do not JSON-dump before/after payloads here. An audit event can
 * include identity-binding values and future policy payloads that deserve a
 * purpose-built detail view rather than accidental disclosure in a table. This
 * index answers who/what/when/why and whether the event created, changed or
 * removed state.
 */
export default function AdminAuditLogs() {
  const audit = usePolicyStore("readPolicyAuditHistory", { limit: DEFAULT_LIMIT });

  return (
    <div className="fo-panel">
      <h2>Audit Logs</h2>
      <p className="fo-muted">
        Read-only, append-only Administration history from the governed EOS policy store.
        Showing the latest {DEFAULT_LIMIT} events.
      </p>

      {audit.status === "loading" && <p className="fo-muted" role="status">Reading audit history…</p>}
      {audit.status === "unconfigured" && (
        <p className="fo-warning" role="status">
          The EOS Administration service is not configured in this environment.
        </p>
      )}
      {audit.status === "failed" && (
        <p className="fo-warning" role="alert">
          {audit.error?.description ?? "The governed audit history could not be read."}
        </p>
      )}

      {audit.status === "ready" && (audit.data ?? []).length === 0 && (
        <p className="fo-muted">No Administration audit events are recorded for this tenant.</p>
      )}

      {audit.status === "ready" && (audit.data ?? []).length > 0 && (
        <table className="fo-table" aria-label="Administration audit history">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Target</th>
              <th>Actor</th>
              <th>Change</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {audit.data.map((event) => (
              <tr key={event.id}>
                <td>{formatTimestamp(event.occurredAt)}</td>
                <td><code>{event.action}</code></td>
                <td>
                  <span>{event.targetKind}</span>
                  <br />
                  <code className="fo-muted">{event.targetId}</code>
                </td>
                <td><code>{event.actorUid}</code></td>
                <td>{auditChangeKind(event)}</td>
                <td className="fo-muted">{event.reason || "No reason recorded"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export { DEFAULT_LIMIT };
