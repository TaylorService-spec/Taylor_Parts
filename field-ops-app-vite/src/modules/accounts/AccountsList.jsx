import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ACCOUNT_STATUS, ACCOUNT_RELATIONSHIP_TYPE, accountStatusLabel } from "../../domain/constants";
import { createAccount } from "../../domain/accounts";
import { accountEntity, accountIndexList } from "../../metadata/definitions/account.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import { useAccountPortfolioSummary } from "../../hooks/useAccountPortfolioSummary";
import { useAccountSearch } from "../../hooks/useAccountSearch";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import Modal from "../../shared/ui/Modal";
import AccountForm from "./AccountForm";

// Customers — the first surface on the metadata list runtime.
//
// WHAT CHANGED AND WHY IT MATTERS. This page used to subscribe to the ENTIRE accounts
// collection and do all filtering, counting and tag-faceting in memory. At Taylor's
// current volume that was invisible; at 250,000 accounts it is a quarter of a million
// document reads to render one screen, which is the client-side dataset ownership §9
// forbids. Rows now come from a bounded, cursor-paged metadata query.
//
// THE CARDS ARE NOT COMPUTED FROM THE ROWS. Total/Active/Prospect/Inactive/Archived are
// claims about the whole book of business, so they come from getAccountPortfolioSummary,
// a governed server-side count over the complete scope. Deriving them from the page would
// produce numbers that are smaller than the truth while still labelled "Total" — a worse
// failure than the unbounded read this replaces, because that one was merely slow.
//
// Neither read is unbounded, and there is no second one: the old subscription is gone
// rather than kept alongside.
//
// FACETS: ONE RESTORED, ONE STILL DEFERRED. The relationship chips are back, because the
// index derivation now models filter COMBINATIONS and the three composites the query
// really needs are declared. Their values come from the enum, which is a closed set the
// code owns — not from scanning the collection.
//
// The tag chips are NOT back. Tag values are open, so the only way to know which exist is
// to read every account, and rebuilding the facet from the current page would present
// "the tags on these fifty rows" as "the tags that exist". Tags still RENDER in their
// rows; the global facet waits on an authoritative catalog and is recorded as such.

const RELATIONSHIP_LABEL = { CUSTOMER: "Customer", VENDOR: "Vendor" };

const STATUS_CARDS = [
  { key: "total", label: "Total", status: null },
  { key: "ACTIVE", label: accountStatusLabel(ACCOUNT_STATUS.ACTIVE), status: ACCOUNT_STATUS.ACTIVE },
  { key: "PROSPECT", label: accountStatusLabel(ACCOUNT_STATUS.PROSPECT), status: ACCOUNT_STATUS.PROSPECT },
  { key: "INACTIVE", label: accountStatusLabel(ACCOUNT_STATUS.INACTIVE), status: ACCOUNT_STATUS.INACTIVE },
  { key: "ARCHIVED", label: accountStatusLabel(ACCOUNT_STATUS.ARCHIVED), status: ACCOUNT_STATUS.ARCHIVED },
];

export default function AccountsList() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  // ONE relationship at a time, not a set. Firestore permits a single array filter per
  // query, so offering multi-select would promise an intersection no declared index
  // serves — and the old page's AND-semantics chips were only possible because it was
  // filtering in memory.
  const [relationshipFilter, setRelationshipFilter] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const creatingRef = useRef(false);

  const filters = useMemo(() => {
    const next = [];
    if (statusFilter) next.push({ fieldId: "status", operator: "EQUALS", value: statusFilter });
    if (relationshipFilter) {
      next.push({ fieldId: "relationshipTypes", operator: "ARRAY_CONTAINS", value: relationshipFilter });
    }
    return next;
  }, [statusFilter, relationshipFilter]);

  const { presentation, loadMore, retry } = useMetadataList(accountIndexList, accountEntity, { filters });
  const { summary, state: summaryState, retry: retrySummary } = useAccountPortfolioSummary();

  async function handleCreate(values) {
    const created = await createAccount(values);
    if (created?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    // A status filter that would hide the customer just created is cleared, so the
    // confirmation is not immediately contradicted by an empty table.
    if (statusFilter && created?.status !== statusFilter) setStatusFilter(null);
    setAnnouncement(`Customer ${created.name} created.`);
    setShowCreate(false);
    // The page is a query result, not a live subscription, so a new record does not
    // arrive on its own. Refetching is explicit rather than hoped for.
    retry();
    retrySummary();
  }

  const cardCount = (card) => {
    if (summaryState !== "READY" || !summary) return null;
    return card.status === null ? summary.total : summary.byStatus?.[card.key] ?? 0;
  };

  // GOVERNED SEARCH, NOT THE OLD GLOBAL SEARCH. The GlobalSearch `accounts` provider
  // (src/shared/search/searchProviders.js) filters an array the caller supplies, and the
  // only caller that could supply it was the whole-collection subscription this page no
  // longer holds — handing it the current page instead would search fifty rows and render
  // "no results" for a customer that exists, so it stayed removed rather than repurposed.
  //
  // This is the replacement recorded at that removal: domain/accountSearch.js issues a
  // real, bounded Firestore prefix query on `name` (see that module for why prefix, not
  // substring/full-text, and why no composite index is needed). It matches customers
  // whose name STARTS WITH what was typed, case-sensitively — the UI copy below says so
  // rather than implying a broader search.
  const [searchTerm, setSearchTerm] = useState("");
  const search = useAccountSearch(searchTerm);

  const actions = (
    <ActionRail
      primary={<button type="button" className="fo-btn-primary" onClick={() => setShowCreate(true)}>+ New Customer</button>}
    />
  );

  return (
    <WorkspaceShell title="Customers" actions={actions}>
      <p className="fo-sr-only" role="status" aria-live="polite">{announcement}</p>

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

      <div className="fo-global-search" role="search">
        <input
          type="search"
          placeholder="Search customers by name (starts with)…"
          aria-label="Search customers by name — matches names starting with what you type"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm.trim() && (
          <div className="fo-global-search-results" role="status" aria-live="polite">
            {search.state === "LOADING" && <div className="fo-muted fo-global-search-empty">Searching…</div>}
            {search.state === "EMPTY" && <div className="fo-muted fo-global-search-empty">{search.message}</div>}
            {search.state === "DENIED" && <div className="fo-warning fo-global-search-empty">{search.message}</div>}
            {search.state === "UNAVAILABLE" && <div className="fo-warning fo-global-search-empty">{search.message}</div>}
            {(search.state === "READY" || search.state === "TRUNCATED") && (
              <>
                {search.results.map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    className="fo-global-search-result"
                    onClick={() => { setSearchTerm(""); navigate(`/customers/${account.id}`); }}
                  >
                    <span>{account.name}</span>
                    {account.status && <span className="fo-muted"> — {accountStatusLabel(account.status)}</span>}
                  </button>
                ))}
                {/* Truncation is disclosed IN the results panel, not hidden below the fold —
                    a capped list that looks complete is the exact failure this replaces. */}
                {search.truncated && <div className="fo-muted fo-global-search-empty">{search.message}</div>}
              </>
            )}
          </div>
        )}
      </div>

      <div className="fo-portfolio-cards" role="group" aria-label="Customer portfolio by status">
        {STATUS_CARDS.map((card) => {
          const pressed = card.status === null ? statusFilter === null : statusFilter === card.status;
          const count = cardCount(card);
          return (
            <button
              key={card.key}
              type="button"
              className={`fo-portfolio-card${pressed ? " fo-portfolio-card-active" : ""}`}
              aria-pressed={pressed}
              onClick={() => setStatusFilter((cur) => (card.status === null ? null : cur === card.status ? null : card.status))}
            >
              {/* An unavailable count shows a dash, never a zero. "0 Active" is a claim
                  about the business; "—" is a claim about the read, and they are not
                  interchangeable. */}
              <span className="fo-portfolio-card-count">{count === null ? "—" : count}</span>
              <span className="fo-portfolio-card-label">{card.label}</span>
            </button>
          );
        })}
      </div>

      {summaryState === "DENIED" && (
        <p className="fo-muted" role="status">Portfolio totals are not available to you.</p>
      )}
      {summaryState === "UNAVAILABLE" && (
        <p className="fo-warning" role="status">
          Portfolio totals could not be loaded.{" "}
          <button type="button" className="fo-link-btn" onClick={retrySummary}>Try again</button>
        </p>
      )}

      {/* The audit of legacy title-cased statuses is still open, so this is not
          hypothetical. Records the enum does not recognise are counted in the total and
          reported here rather than disappearing from four categories that would then
          silently fail to add up. */}
      {summaryState === "READY" && summary?.unclassified > 0 && (
        <p className="fo-warning" role="status">
          {summary.unclassified} customer{summary.unclassified === 1 ? " has a status" : "s have statuses"} outside the
          standard set, so the totals above add up to more than the four categories shown.
        </p>
      )}

      <div className="fo-portfolio-filters">
        <div className="fo-filter-group" role="group" aria-label="Filter by relationship type">
          <span className="fo-filter-label">Relationship:</span>
          {Object.values(ACCOUNT_RELATIONSHIP_TYPE).map((type) => (
            <button
              key={type}
              type="button"
              className={`fo-filter-chip${relationshipFilter === type ? " fo-filter-chip-active" : ""}`}
              aria-pressed={relationshipFilter === type}
              onClick={() => setRelationshipFilter((cur) => (cur === type ? null : type))}
            >
              {RELATIONSHIP_LABEL[type] ?? type}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="fo-link-btn"
          onClick={() => { setStatusFilter(null); setRelationshipFilter(null); }}
          disabled={!statusFilter && !relationshipFilter}
        >
          Clear filters
        </button>
      </div>

      <MetadataListGrid
        presentation={presentation}
        caption="Customers"
        onRowClick={(id) => navigate(`/customers/${id}`)}
        onLoadMore={loadMore}
        onRetry={retry}
      />
    </WorkspaceShell>
  );
}
