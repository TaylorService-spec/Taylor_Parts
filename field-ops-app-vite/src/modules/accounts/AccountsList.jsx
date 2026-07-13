import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { ACCOUNTS_COLLECTION, ACCOUNT_STATUS, ACCOUNT_RELATIONSHIP_TYPE } from "../../domain/constants";
import { createAccount } from "../../domain/accounts";
import {
  summarizeAccounts,
  filterAccounts,
  collectTags,
  hasActiveFilters,
  formatLastUpdate,
} from "../../domain/accountPortfolio";
import GlobalSearch from "../../shared/search/GlobalSearch";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import AccountForm from "./AccountForm";

// Sprint 2.0.2 -- Customer Foundation. Internal name AccountsList; rendered UI
// says "Customers" throughout (docs/BusinessEntityModel.md).
//
// Customer Results Dashboard: /customers is a portfolio dashboard -- status
// portfolio cards (click to filter), local relationship-type + tag filters
// (clear/reset + live result count), and an enriched results table (name,
// status, relationship, tags, human-readable last update). It uses ONLY the
// existing Accounts subscription (useFirestoreCollection) and computes every
// metric/filter locally (domain/accountPortfolio.js) -- no Contact/Location
// query, no per-account query loop, no raw IDs, no financial calculation.
// Global Search, New Customer, and the /customers/:accountId detail link are
// preserved.

const STATUS_CARDS = [
  { key: "total", label: "Total", status: null },
  { key: "active", label: "Active", status: ACCOUNT_STATUS.ACTIVE },
  { key: "prospect", label: "Prospect", status: ACCOUNT_STATUS.PROSPECT },
  { key: "inactive", label: "Inactive", status: ACCOUNT_STATUS.INACTIVE },
  { key: "archived", label: "Archived", status: ACCOUNT_STATUS.ARCHIVED },
];

const RELATIONSHIP_LABEL = {
  [ACCOUNT_RELATIONSHIP_TYPE.CUSTOMER]: "Customer",
  [ACCOUNT_RELATIONSHIP_TYPE.VENDOR]: "Vendor",
};

export default function AccountsList() {
  const { data: accounts, loading, error } = useFirestoreCollection(ACCOUNTS_COLLECTION);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const [relationshipFilter, setRelationshipFilter] = useState([]);
  const [tagFilter, setTagFilter] = useState([]);

  const summary = useMemo(() => summarizeAccounts(accounts), [accounts]);
  const allTags = useMemo(() => collectTags(accounts), [accounts]);
  const filtered = useMemo(
    () => filterAccounts(accounts, { status: statusFilter, relationshipTypes: relationshipFilter, tags: tagFilter }),
    [accounts, statusFilter, relationshipFilter, tagFilter]
  );
  const filtersActive = hasActiveFilters({ status: statusFilter, relationshipTypes: relationshipFilter, tags: tagFilter });

  async function handleCreate(values) {
    await createAccount(values);
    setShowForm(false);
  }

  function toggleStatus(status) {
    // Total (status null) always clears; a status card toggles on/off.
    setStatusFilter((cur) => (status === null ? null : cur === status ? null : status));
  }
  function toggleRelationship(type) {
    setRelationshipFilter((cur) => (cur.includes(type) ? cur.filter((t) => t !== type) : [...cur, type]));
  }
  function toggleTag(tag) {
    setTagFilter((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  }
  function clearFilters() {
    setStatusFilter(null);
    setRelationshipFilter([]);
    setTagFilter([]);
  }

  const cardCount = (card) => (card.status === null ? summary.total : summary[card.key]);

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Customers">
        <GlobalSearch providerKeys={["accounts"]} context={{ accounts }} placeholder="Search customers..." />
        <button type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "+ New Customer"}
        </button>
      </WorkspaceHeader>

      {showForm && <AccountForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} submitLabel="Create Customer" />}

      {loading ? (
        <p className="fo-muted" role="status">Loading customers...</p>
      ) : error ? (
        <p className="fo-warning" role="status">Unable to load customers ({error.code ?? "error"}).</p>
      ) : accounts.length === 0 ? (
        <p className="fo-muted" role="status">No customers yet. Create one above.</p>
      ) : (
        <>
          {/* Portfolio cards -- click to filter by status; Total clears the status filter */}
          <div className="fo-portfolio-cards" role="group" aria-label="Customer portfolio by status">
            {STATUS_CARDS.map((card) => {
              const pressed = card.status === null ? statusFilter === null : statusFilter === card.status;
              return (
                <button
                  key={card.key}
                  type="button"
                  className={`fo-portfolio-card${pressed ? " fo-portfolio-card-active" : ""}`}
                  aria-pressed={pressed}
                  onClick={() => toggleStatus(card.status)}
                >
                  <span className="fo-portfolio-card-count">{cardCount(card)}</span>
                  <span className="fo-portfolio-card-label">{card.label}</span>
                </button>
              );
            })}
          </div>

          {/* Local filters: relationship type + tags, with clear/reset */}
          <div className="fo-portfolio-filters">
            <div className="fo-filter-group" role="group" aria-label="Filter by relationship type">
              <span className="fo-filter-label">Relationship:</span>
              {Object.values(ACCOUNT_RELATIONSHIP_TYPE).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`fo-filter-chip${relationshipFilter.includes(type) ? " fo-filter-chip-active" : ""}`}
                  aria-pressed={relationshipFilter.includes(type)}
                  onClick={() => toggleRelationship(type)}
                >
                  {RELATIONSHIP_LABEL[type] ?? type}
                </button>
              ))}
            </div>

            {allTags.length > 0 && (
              <div className="fo-filter-group" role="group" aria-label="Filter by tag">
                <span className="fo-filter-label">Tags:</span>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`fo-filter-chip${tagFilter.includes(tag) ? " fo-filter-chip-active" : ""}`}
                    aria-pressed={tagFilter.includes(tag)}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            <button type="button" className="fo-link-btn" onClick={clearFilters} disabled={!filtersActive}>
              Clear filters
            </button>
          </div>

          <p className="fo-muted fo-portfolio-count" role="status" aria-live="polite">
            {filtered.length} of {summary.total} customer{summary.total === 1 ? "" : "s"} shown
          </p>

          {filtered.length === 0 ? (
            <p className="fo-muted" role="status">
              No customers match the current filters.{" "}
              <button type="button" className="fo-link-btn" onClick={clearFilters}>Clear filters</button>
            </p>
          ) : (
            <div className="fo-table-scroll">
              <table className="fo-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Relationship</th>
                    <th>Tags</th>
                    <th>Last update</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((account) => {
                    const rels = Object.values(ACCOUNT_RELATIONSHIP_TYPE).filter((t) =>
                      (account.relationshipTypes ?? []).includes(t)
                    );
                    return (
                      <tr key={account.id}>
                        <td>
                          <Link to={`/customers/${account.id}`}>{account.name}</Link>
                        </td>
                        <td>
                          {account.status && (
                            <span className={`fo-badge fo-badge-${account.status.toLowerCase()}`}>{account.status}</span>
                          )}
                        </td>
                        <td>
                          {rels.length > 0 ? (
                            rels.map((t) => (
                              <span key={t} className={`fo-badge fo-badge-relationship-${t.toLowerCase()}`}>
                                {RELATIONSHIP_LABEL[t] ?? t}
                              </span>
                            ))
                          ) : (
                            <span className="fo-muted">—</span>
                          )}
                        </td>
                        <td className="fo-muted">{(account.tags ?? []).join(", ") || "—"}</td>
                        <td className="fo-muted">{formatLastUpdate(account.updatedAt ?? account.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
