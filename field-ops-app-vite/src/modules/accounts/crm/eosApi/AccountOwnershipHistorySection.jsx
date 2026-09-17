// PLATFORM-SANDBOX ONLY: the Account's governed ownership history, in the record page rail beside the owner fact
// (Commercial profile). Selected by AccountDetail with CRM_VIA_EOS_API; every other build renders nothing here.
//
// Minimal and in the rail's existing grammar (ns-rail__section / ns-rail__title / ns-rail__meta / ns-state). Owners are
// shown by their CURRENT directory name (byEmployeeId), never by a raw id; an unresolved id reads "Unknown owner".
import { useAccountOwnershipHistory } from "../../../../hooks/crm/eosApi/useAccountOwnershipHistory.js";
import { ACCOUNT_OWNERSHIP_EVENT_LABEL, ACCOUNT_OWNERSHIP_HANDOFF_SOURCE_LABEL } from "../../../../domain/accountOwnershipChange.js";
import { formatDateOnly } from "../../../../domain/displayTimestamp.js";

function ownerName(employeeId, byEmployeeId, directoryLoading) {
  if (!employeeId) return null;
  const name = byEmployeeId?.get?.(employeeId)?.displayName;
  if (name) return name;
  return directoryLoading ? "resolving…" : "Unknown owner";
}

export default function AccountOwnershipHistorySection({ accountId, refreshKey = 0, byEmployeeId, directoryLoading = false }) {
  const { items, truncated, loading, error, retry } = useAccountOwnershipHistory(accountId, refreshKey);

  return (
    <section className="ns-rail__section" aria-label="Ownership history">
      <h3 className="ns-rail__title">Ownership history</h3>
      {loading ? (
        <p className="ns-state">Loading ownership history…</p>
      ) : error ? (
        <p className="ns-state">
          {error} <button type="button" className="fo-link-btn" onClick={retry}>Retry</button>
        </p>
      ) : items.length === 0 ? (
        <p className="ns-state">No ownership changes recorded.</p>
      ) : (
        <ol className="ns-rail__meta">
          {items.map((row) => {
            const to = ownerName(row.newOwnerEmployeeId, byEmployeeId, directoryLoading);
            const from = ownerName(row.previousOwnerEmployeeId, byEmployeeId, directoryLoading);
            return (
              <li key={row.historyId}>
                {formatDateOnly(row.effectiveAt)}: {ACCOUNT_OWNERSHIP_EVENT_LABEL[row.event] ?? row.event}
                {row.event === "OWNER_HANDOFF" ? ` from ${from} to ${to}` : ` to ${to}`}
                {row.source ? ` (${ACCOUNT_OWNERSHIP_HANDOFF_SOURCE_LABEL[row.source] ?? row.source})` : ""}
                {row.reason ? `. ${row.reason}` : ""}
              </li>
            );
          })}
          {truncated && <li>Showing the latest {items.length} changes.</li>}
        </ol>
      )}
    </section>
  );
}
