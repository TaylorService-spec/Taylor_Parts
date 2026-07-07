import { useState } from "react";
import { Link } from "react-router-dom";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { ACCOUNTS_COLLECTION } from "../../domain/constants";
import { createAccount } from "../../domain/accounts";
import GlobalSearch from "../../shared/search/GlobalSearch";
import AccountForm from "./AccountForm";

// Sprint 2.0.2 -- Customer Foundation. Internal name AccountsList;
// rendered UI says "Customers" throughout, per the approved naming
// convention (docs/BusinessEntityModel.md). Search bar IS
// GlobalSearch's accounts provider, not a separately hand-rolled
// <input> + debounce -- the whole point of building that component
// this sprint instead of duplicating DispatcherBoard.jsx's pattern
// locally.
export default function AccountsList() {
  const { data: accounts, loading } = useFirestoreCollection(ACCOUNTS_COLLECTION);
  const [showForm, setShowForm] = useState(false);

  async function handleCreate(values) {
    await createAccount(values);
    setShowForm(false);
  }

  return (
    <div className="fo-panel">
      <div className="disp-board-toolbar" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Customers</h2>
        <GlobalSearch providerKeys={["accounts"]} context={{ accounts }} placeholder="Search customers..." />
        <button type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New Customer"}
        </button>
      </div>

      {showForm && <AccountForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} submitLabel="Create Customer" />}

      {loading ? (
        <p className="fo-muted">Loading customers...</p>
      ) : accounts.length === 0 ? (
        <p className="fo-muted">No customers yet. Create one above.</p>
      ) : (
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
      )}
    </div>
  );
}
