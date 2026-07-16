import { useEffect, useMemo, useRef, useState } from "react";
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
  clearedFiltersForAccount,
} from "../../domain/accountPortfolio";
import GlobalSearch from "../../shared/search/GlobalSearch";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import Modal from "../../shared/ui/Modal";
import LoadingState from "../../shared/ui/LoadingState";
import EmptyState from "../../shared/ui/EmptyState";
import FailureState from "../../shared/ui/FailureState";
import { loadErrorMessage } from "../../domain/loadErrorMessage";
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
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const [relationshipFilter, setRelationshipFilter] = useState([]);
  const [tagFilter, setTagFilter] = useState([]);
  // After a successful create: the row to move focus to + a live announcement.
  const [pendingFocus, setPendingFocus] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const newRowLinkRef = useRef(null);
  // Set by AccountForm's onSavingChange while a create is committing. Read synchronously
  // by the Modal's onClose so Escape / ✕ / backdrop cannot dismiss the overlay mid-save
  // (#322) -- a ref, not state, so the close handler sees the CURRENT status, not a value
  // captured on an earlier render.
  const creatingRef = useRef(false);

  const summary = useMemo(() => summarizeAccounts(accounts), [accounts]);
  const allTags = useMemo(() => collectTags(accounts), [accounts]);
  const filtered = useMemo(
    () => filterAccounts(accounts, { status: statusFilter, relationshipTypes: relationshipFilter, tags: tagFilter }),
    [accounts, statusFilter, relationshipFilter, tagFilter]
  );
  const filtersActive = hasActiveFilters({ status: statusFilter, relationshipTypes: relationshipFilter, tags: tagFilter });

  // Called by AccountForm inside the overlay. On failure this THROWS so
  // AccountForm catches it, shows the error inside the still-open overlay, and
  // nothing here runs (the overlay does not close). On success: clear only the
  // filters that would hide the new customer, queue focus + a live announcement,
  // and close the overlay. The live Accounts subscription adds the row itself --
  // no manual insert, no refetch.
  async function handleCreate(values) {
    const created = await createAccount(values);
    if (created?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    const next = clearedFiltersForAccount(created, {
      status: statusFilter,
      relationshipTypes: relationshipFilter,
      tags: tagFilter,
    });
    setStatusFilter(next.status);
    setRelationshipFilter(next.relationshipTypes);
    setTagFilter(next.tags);
    setPendingFocus({ id: created.id, name: created.name });
    setAnnouncement(`Customer ${created.name} created.`);
    setShowCreate(false);
  }

  // Once the newly created customer's row is rendered (the live subscription has
  // delivered it and current filters don't hide it), move focus to its name and
  // consume the pending-focus marker.
  useEffect(() => {
    if (pendingFocus && newRowLinkRef.current) {
      newRowLinkRef.current.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus, filtered]);

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
        <button type="button" onClick={() => setShowCreate(true)}>
          + New Customer
        </button>
      </WorkspaceHeader>

      {/* Success announcement -- polite live region for assistive tech. */}
      <p className="fo-sr-only" role="status" aria-live="polite">{announcement}</p>

      {/* Creation overlay -- opens without navigating or moving the dashboard.
          The form catches its own save failures and keeps the overlay open.

          CLOSE-DURING-SAVE GUARD (#322): onClose refuses while a create is committing, so
          Escape / ✕ / backdrop cannot dismiss the overlay mid-write. The form's own Cancel
          button is already disabled during save, but the Modal chrome routes through
          onClose, which the button does not intercept -- so the guard lives here, reading
          the ref AccountForm sets via onSavingChange.

          Still a #293 CANARY (#302): the guard is a fresh-identity inline arrow every
          render, exactly as before -- guarding it did not memoize it, so its identity
          still changes each render and it still exposes a [onClose]-keyed regression.
          Modal reads onClose through a ref, so this costs nothing. Honesty caveat, per the
          driver's own note: the deterministic typing suite PASSES here even on unfixed
          main (AccountForm holds its own state, so typing re-renders the form, not
          AccountsList, and the arrow keeps its identity through the burst); the Location
          flow is the hard reproducer. Do NOT "tidy" this into a useCallback -- it is a
          real canary, just not the one the suite fails on. */}
      {showCreate && (
        <Modal title="New Customer" onClose={() => { if (creatingRef.current) return; setShowCreate(false); }}>
          <AccountForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            onSavingChange={(v) => { creatingRef.current = v; }}
            submitLabel="Create Customer"
          />
        </Modal>
      )}

      {loading ? (
        <LoadingState>Loading customers…</LoadingState>
      ) : error ? (
        // Terminal subscription failure -- safe categorized copy only (never the
        // raw code); the content branch below is not reached, so no stale data.
        <FailureState message={loadErrorMessage(error, { entity: "customers" })} />
      ) : accounts.length === 0 ? (
        <EmptyState
          variant="database"
          title="No customers yet"
          message="Add your first customer to get started."
          action={<button type="button" onClick={() => setShowCreate(true)}>+ New Customer</button>}
        />
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
            <EmptyState
              variant="filtered"
              message="No customers match the current filters."
              action={<button type="button" className="fo-link-btn" onClick={clearFilters}>Clear filters</button>}
            />
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
                          <Link
                            to={`/customers/${account.id}`}
                            ref={account.id === pendingFocus?.id ? newRowLinkRef : undefined}
                          >
                            {account.name}
                          </Link>
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
