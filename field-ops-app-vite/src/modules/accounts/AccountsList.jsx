import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ACCOUNT_STATUS, accountStatusLabel } from "../../domain/constants";
import { createAccount } from "../../domain/accounts";
import { accountEntity, accountIndexList } from "../../metadata/definitions/account.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import { useAccountPortfolioSummary } from "../../hooks/useAccountPortfolioSummary";
import { useAccountSearch } from "../../hooks/useAccountSearch";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import {
  AddFilter, ActiveCriteria, SortControl, ListEmptyState, DroppedCriteriaNotice,
} from "../../metadata/MetadataListControls.jsx";
import ListViewHeader from "../../metadata/ListViewHeader.jsx";
import { useListViewChrome } from "../../hooks/useListViewChrome.js";
import {
  addFilter, removeFilter, clearFilters, setSort, makeCriterion, describeDropped, describeRefusal,
} from "../../metadata/listUrlState.js";
import { useListCriteria } from "../../hooks/useListCriteria.js";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import { REFERENCE_STATE } from "../../metadata/referenceResolution.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
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
  const [announcement, setAnnouncement] = useState("");
  const creatingRef = useRef(false);

  // LIST CRITERIA LIVE IN THE URL. Two pieces of screen-local filter state used to hold them,
  // which meant a narrowed list did not survive opening a customer and coming back, could not be
  // shared, and could not be bookmarked — the work of narrowing 250,000 accounts to eleven was
  // thrown away by the most ordinary thing a person does with a list.
  const { criteria, apply } = useListCriteria(accountIndexList, accountEntity, "customers");

  // SAVED VIEWS + AN HONEST COUNT, shared by every object. The count is a real aggregate over
  // the same filters the list uses -- never a tally of loaded rows, and null rather than 0 on
  // any failure.
  const { activeViewId, selectView, total } = useListViewChrome(accountIndexList, accountEntity, criteria, apply);

  // The status a portfolio card is currently pressed for. DERIVED from the criteria rather than
  // held beside them, so the cards and the filter chips cannot disagree about what is applied.
  const statusFilter = useMemo(
    () => criteria.filters.find((f) => f.fieldId === "status" && f.operator === "EQUALS")?.value ?? null,
    [criteria],
  );

  const toggleStatus = (status) => {
    if (!status || statusFilter === status) {
      apply(removeFilter(criteria, "status", "EQUALS"));
      return;
    }
    apply(addFilter(criteria, makeCriterion({
      fieldId: "status", operator: "EQUALS", value: status, valueLabel: accountStatusLabel(status),
    })));
  };

  const { summary, state: summaryState, retry: retrySummary } = useAccountPortfolioSummary();

  // OWNER IS RESOLVED LIVE, NOT READ FROM THE SNAPSHOT. `accountOwner` stores
  // assignedToDisplayName alongside the id, and AccountDetail deliberately ignores it in favour of
  // the CURRENT directory name — a person who changed their name, or a record written before they
  // did, would otherwise be shown as somebody who no longer exists. The list follows that rule.
  //
  // ONE directory read for the whole page, not one per row: useEmployeeDirectory is a single
  // subscription keyed by employee id, so adding an Owner column costs no reads per record.
  const directory = useEmployeeDirectory();
  const resolveReference = useCallback((fieldId, id) => {
    if (fieldId !== "accountOwnerEmployeeId") return undefined;
    if (directory.loading) return { state: REFERENCE_STATE.LOADING };
    const employee = directory.byEmployeeId?.get(id);
    const name = employee?.displayName ?? employee?.name ?? null;
    // NOT_FOUND rather than a raw id. An owner who no longer resolves reads as gone; the employee
    // id is a routing key and never content.
    return name ? { state: REFERENCE_STATE.FOUND, label: name } : { state: REFERENCE_STATE.NOT_FOUND };
  }, [directory]);

  const { presentation, loadMore, retry, descriptorErrors } = useMetadataList(accountIndexList, accountEntity, {
    filters: criteria.filters,
    sort: criteria.sort,
    resolveReference,
  });

  // What was ASKED FOR and is not in effect, from both places it can fail: parsing the URL against
  // this build, and planning the query. The second one matters here more than anywhere else in the
  // platform — `relationshipTypes` and `lineOfBusiness` are BOTH arrays, Firestore serves one array
  // filter per query, and "customers on the Taylor line" is the first thing anybody would ask.
  const droppedMessage = useMemo(() => {
    const fromUrl = describeDropped(criteria.dropped);
    if (fromUrl) return fromUrl;
    // A REFUSED request and a DROPPED criterion are different outcomes and get different words:
    // dropped leaves a list that renders and is broader than asked for; refused runs no query at
    // all, so the screen is empty and "broader" would describe the opposite of what is on it.
    return describeRefusal(descriptorErrors, "customers");
  }, [criteria, descriptorErrors]);

  async function handleCreate(values) {
    const created = await createAccount(values);
    if (created?.blocked) {
      const blockedErr = new Error("write blocked");
      blockedErr.blocked = true;
      throw blockedErr;
    }
    // A newly created PROSPECT must not vanish behind a status filter that excludes it. Prospect is
    // a STATUS, so "create a prospect while filtered to Active" is an ordinary thing to do, and the
    // confirmation would otherwise be immediately contradicted by an empty table.
    if (statusFilter && created?.status !== statusFilter) apply(removeFilter(criteria, "status", "EQUALS"));
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
      primary={<Button variant="primary" onClick={() => setShowCreate(true)}>+ New Customer</Button>}
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
              onClick={() => toggleStatus(card.status)}
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

      {/* SILENT TRUNCATION IS THE WORST FAILURE A LIST CAN HAVE, and this one had it.
          The default sort is `updatedAt DESC`. Firestore's orderBy silently EXCLUDES every
          document missing the ordered field -- so 101 of 103 customers vanished from the list
          while the header above still read "103 Total", because the portfolio summary is a
          different read that does not sort. A shorter list looks like a shorter list; nothing
          about it says "94% of your customers are not shown".
          Counted rather than assumed: the row count is compared against the total the summary
          already fetched, and any shortfall is stated in the reader's own terms. This does not
          fix the missing field -- it makes its absence impossible to mistake for an empty
          business. */}
      {/* TWO DIFFERENT SHORTFALLS, AND THEY MUST NOT WEAR THE SAME SENTENCE.
          "More pages exist" and "these records can never appear" are different facts with
          different remedies -- one is answered by Load more, the other only by changing the sort --
          and the guard above suppressed BOTH by requiring !hasMore. On the 106-customer sandbox
          list that meant no message at all, which is how the sinking-record defect stayed invisible
          even after the count disagreed with the rows.
          Only the !hasMore case can be attributed to the missing sort field, and only that case
          says so. With more pages outstanding the shortfall is not yet diagnosable, so the message
          states what IS known -- the page boundary -- and claims nothing further. */}
      {summaryState === "READY"
        && summary?.total > 0
        && criteria.filters.length === 0
        // READS presentation.rows, NOT presentation.page.rows. buildListPresentation returns
        // { state, columns, rows, hasMore } and has no `page` key at all, so this whole guard was
        // reading undefined and short-circuiting: the warning it describes has never once rendered.
        // A safeguard against silent truncation that is itself silent is the worst of both.
        && presentation?.state === "READY"
        && presentation.rows.length < summary.total && (
        presentation.hasMore ? (
          <p className="fo-muted" role="status">
            Showing the first {presentation.rows.length} of {summary.total} customers. Load more to
            see the rest.
          </p>
        ) : (
          <p className="fo-warning" role="status">
            Showing {presentation.rows.length} of {summary.total} customers. The rest are missing
            the “last update” value this list is sorted by, so they cannot appear here. Sort or filter
            by another field to reach them.
          </p>
        )
      )}

      {/* THE ONE SHARED FILTER AND SORT EXPERIENCE, from the Account metadata.

          This replaces a screen-local relationship chip group. Those chips offered exactly one
          field, hard-coded here, and could never have offered Line of Business without somebody
          editing this file — while the canonical control offers whatever the definition declares
          and its composite indexes prove. */}
      <ListViewHeader
        def={accountIndexList}
        entity={accountEntity}
        criteria={criteria}
        total={total}
        activeViewId={activeViewId}
        onSelectView={selectView}
      />
      <div className="fo-listctl">
        <AddFilter
          def={accountIndexList}
          entity={accountEntity}
          onAdd={(c) => apply(addFilter(criteria, c))}
        />
        <SortControl
          entity={accountEntity}
          criteria={criteria}
          onSort={(fieldId, direction) => apply(setSort(criteria, fieldId, direction))}
        />
      </div>
      <ActiveCriteria
        criteria={criteria}
        entity={accountEntity}
        onRemove={(fieldId, operator) => apply(removeFilter(criteria, fieldId, operator))}
        onClear={() => apply(clearFilters(criteria))}
      />

      {/* Refused WHOLE, never partially. Applying one array filter and dropping the other would
          return a broader set than was asked for while looking as though both had been applied. */}
      <DroppedCriteriaNotice message={droppedMessage} />
      {/* A list filtered to nothing and an empty book of business are different statements.
          MetadataListGrid renders its own "no rows" state, so this only takes over the FILTERED
          case, where telling somebody they have no customers would be plainly false. */}
      {presentation?.state === "FILTERED" ? (
        <ListEmptyState
          criteria={criteria}
          onClear={() => apply(clearFilters(criteria))}
        />
      ) : (
      <MetadataListGrid
        presentation={presentation}
        caption="Customers"
        onRowClick={(id) => navigate(`/customers/${id}`)}
        onLoadMore={loadMore}
        onRetry={retry}
      />
      )}
    </WorkspaceShell>
  );
}
