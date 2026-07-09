import { useState } from "react";
import { Link } from "react-router-dom";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { ACCOUNTS_COLLECTION } from "../../domain/constants";
import { createAccount } from "../../domain/accounts";
import GlobalSearch from "../../shared/search/GlobalSearch";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";
import AccountForm from "./AccountForm";

// Sprint 2.0.2 -- Customer Foundation. Internal name AccountsList;
// rendered UI says "Customers" throughout, per the approved naming
// convention (docs/BusinessEntityModel.md). Search bar IS
// GlobalSearch's accounts provider, not a separately hand-rolled
// <input> + debounce -- the whole point of building that component
// this sprint instead of duplicating DispatcherBoard.jsx's pattern
// locally.
//
// Epic 9 -- Platform Workspace Framework: header/toolbar and loading/
// empty-state now come from shared/ui/ instead of a locally-hand-rolled
// copy. No behavior change.
export default function AccountsList() {
  const { data: accounts, loading } = useFirestoreCollection(ACCOUNTS_COLLECTION);
  const [showForm, setShowForm] = useState(false);

  async function handleCreate(values) {
    await createAccount(values);
    setShowForm(false);
  }

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Customers">
        <GlobalSearch providerKeys={["accounts"]} context={{ accounts }} placeholder="Search customers..." />
        <button type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New Customer"}
        </button>
      </WorkspaceHeader>

      {showForm && <AccountForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} submitLabel="Create Customer" />}

      <LoadingEmptyState
        loading={loading}
        isEmpty={accounts.length === 0}
        loadingText="Loading customers..."
        emptyText="No customers yet. Create one above."
      >
        <table className="fo-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>
                  <Link to={`/customers/${account.id}`}>{account.name}</Link>
                </td>
                <td>
                  {account.status && (
                    <span className={`fo-badge fo-badge-${account.status.toLowerCase()}`}>{account.status}</span>
                  )}
                </td>
                <td className="fo-muted">{(account.tags ?? []).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </LoadingEmptyState>
    </div>
  );
}
