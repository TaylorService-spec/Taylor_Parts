import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PARTS_CATALOG, getCatalogItem } from "../../data/partsCatalog";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import {
  useReorderRequests,
  useReorderRequestsByStatus,
  useReorderRequestsAssignedTo,
  useReorderRequestsByStatuses,
} from "../../hooks/useReorderRequests";
import { requestReorderForRecommendation, getDisplayQty } from "../../domain/inventoryReorderRequests";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import { useAuth } from "../../auth/AuthContext";
import GlobalSearch from "../../shared/search/GlobalSearch";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";
import InventoryHealthPanel from "../operations/panels/InventoryHealthPanel";
import { hasUsageHistory } from "../../domain/inventoryAnalyticsEngine";

// Sprint 2.1.1 -- Inventory Domain Foundation. The real Inventory >
// Parts workspace, replacing the legacy demo Inventory.jsx that
// previously rendered at this nav slot (navConfig.js's "parts" item
// keeps its legacyKey: "inventory" unchanged -- only what renders at
// this route changed, mirroring exactly how WorkOrdersList.jsx
// replaced Jobs.jsx at Service > Work Orders in Sprint 2.0.3). The
// legacy Inventory.jsx file itself is untouched and no longer routed
// to from here -- same "deprecated, not deleted" treatment as
// domain/workOrderLifecycle.js.
//
// Read-only: every value below comes from PARTS_CATALOG (static
// reference data, not Firestore) or useInventoryLedger() (the same
// one-shot inventory_transactions read + pure analytics functions
// Operations.jsx's Inventory Health panel already uses). No new
// Firestore query, no new computed math.
//
// Epic 9 -- Platform Workspace Framework: header/toolbar, category
// filter bar, and loading state come from shared/ui/ instead of a
// locally-hand-rolled copy. Pagination is NOT part of that epic
// (still only one instance in the app, per EPIC-9's own "Future
// Expansion" section) and is unchanged below.
//
// Sprint 2.1.2 -- Inventory Operational Queue. Adds an "Inventory
// Operational Queue" section, presenting healthEntries as an
// actionable, urgency-ranked queue -- "Needs Reorder" is the first
// queue in that framework, not the section's permanent name. Reuses
// InventoryHealthPanel.jsx (Operations' own renderer) directly rather
// than a second table, so the Inventory workspace and the Operations
// dashboard are guaranteed to show identical urgency/recommendation
// results for the same inventory state -- same component, same data
// pipeline, not just the same formula. No independent calculation of
// any kind is introduced here.
//
// Sprint 2.1.3 -- Reorder Request & Notification Foundation. The queue
// gains a "Request Reorder" action (InventoryHealthPanel's optional
// onRequestReorder/requestedPartIds props -- Operations.jsx's own call
// site doesn't pass them, so it never grows this affordance). Writes
// go exclusively through domain/inventoryReorderRequests.js's
// createReorderRequest() -- this component never calls Firestore
// directly. requestedPartIds merges already-pending requests (read via
// useReorderRequests()) with parts requested during this session, so a
// button doesn't stay clickable after creating a duplicate request.
//
// Sprint 2.1.5 -- Inventory -> Parts Manager Handoff. Adds a read-only
// "Parts Manager Queue" section listing READY_FOR_PARTS_MANAGER
// requests, on this same existing /inventory route -- no new route.
// Reuses useReorderRequestsByStatus() (hooks/useReorderRequests.js),
// the same read pattern as the Notification Panel's new section.
//
// Sprint 2.1.6 -- Parts Manager -> Parts Associate Assignment. Adds a
// read-only "Parts Associate Queue" section on this same route,
// filtered to the signed-in user's own assignments
// (useReorderRequestsAssignedTo(user.uid)) -- assigned work
// automatically leaves the Parts Manager Queue above once its status
// moves to ASSIGNED_TO_PARTS_ASSOCIATE, no extra removal logic needed.
// Assignment itself happens on PartDetail.jsx, not here.
//
// Sprint 2.1.7 -- Purchase Execution Foundation. Splits the Parts
// Associate Queue into "Waiting" (ASSIGNED_TO_PARTS_ASSOCIATE) and "In
// Progress" (PURCHASING_IN_PROGRESS), two calls to the now-generalized
// useReorderRequestsAssignedTo(userId, status) -- a request moves
// itself between the two sections once "Start Purchasing" (on
// PartDetail.jsx) is used, no extra removal logic needed here either.
//
// Bug fix (post-2.1.7) -- "Request Reorder" produced no visible result
// on failure. Root cause was NOT this component: the live deployed
// firestore.rules had never included a reorder_requests match block at
// all (confirmed via a read-only Admin SDK check against the live
// project -- committed rules across Sprints 2.1.3-2.1.7 were never
// deployed), so every create silently hit permission-denied with
// nothing surfaced. Independently of that deploy gap, handleRequestReorder()
// itself had no error handling -- fixed here so a future failure of any
// kind (network, rules, anything) shows a clear message instead of
// silence, and the button now shows "Requesting..." and disables while
// a request is in flight instead of allowing an immediate second click.
//
// Sprint 2.1.8 -- Purchasing Progress Update. The "In Progress" table
// gains a "Latest Update" column (vendor-contacted status + timestamp
// of the most recent update, or "No update yet") -- realtime, same as
// every other field here, updating live once a Parts Associate posts
// an update on PartDetail.jsx. No new query: still the same
// useReorderRequestsAssignedTo(userId, PURCHASING_IN_PROGRESS) read.
// Inventory Operational Queue, PR A (docs/specifications/inventory-
// operational-queue.md). "All Assigned Work" -- cross-user oversight of
// every Reorder Request currently assigned to ANY Parts Associate,
// additive to (never a replacement for) the personal Waiting/In Progress
// queues below, which stay scoped to exactly the signed-in user. Same two
// statuses those personal queues already read, just without the
// per-user filter -- via useReorderRequestsByStatuses(), not a third read
// implementation.
const ALL_ASSIGNED_WORK_STATUSES = [
  REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE,
  REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS,
];

const PAGE_SIZE = 25;
const ACTIONABLE_URGENCIES = new Set(["CRITICAL", "HIGH"]);

// Zero-history reorder behavior sprint, PR 3. NEEDS_PLANNING gets its
// own filter tab, distinct from ACTIONABLE_URGENCIES -- per the
// Specification, these parts are grouped by recommendation readiness,
// never urgency-ranked alongside CRITICAL/HIGH/MEDIUM/LOW (see
// domain/inventoryAnalyticsEngine.ts's RecommendationStatus type).
//
// Inventory Health / Parts Catalog separation (PR B, docs/specifications/
// inventory-operational-queue.md) -- the "Show All" tab is REMOVED, not
// relabeled. It returned healthEntries unfiltered, which is a ledger-
// active-parts-only subset of the catalog (computeAvailableStockByPart()
// requires at least one RESERVED/RELEASED transaction), not the complete
// catalog Owner intent requires "Show All" to mean. Inventory Health now
// keeps exactly the two real, calculated risk signals; the Parts Catalog
// table below (already enriched with the same healthEntries data, per
// its own "Risk" column) is the one true complete-catalog view.
const QUEUE_FILTER_OPTIONS = [
  { key: "ACTIONABLE", label: "Critical & High" },
  { key: "NEEDS_PLANNING", label: "Needs Planning" },
];

// Inventory Health / Parts Catalog separation (PR B) -- filter-specific
// empty messages, replacing InventoryHealthPanel.jsx's single
// undifferentiated "No ledger activity yet" string, which was misleading
// on this page: selecting Critical & High with real ledger data present
// but nothing currently urgent showed the same message as a genuinely
// empty ledger. Operations.jsx's own call site is unaffected -- it never
// passes emptyText, so it keeps InventoryHealthPanel's own default.
const QUEUE_FILTER_EMPTY_TEXT = {
  ACTIONABLE: "No parts are currently Critical or High priority.",
  NEEDS_PLANNING: "No parts currently need planning.",
};

function useCategories() {
  return useMemo(() => {
    const set = new Set(PARTS_CATALOG.map((part) => part.category));
    return ["ALL", ...[...set].sort()];
  }, []);
}

export default function PartsList() {
  const { user } = useAuth();
  const { healthEntries, loading } = useInventoryLedger();
  const { data: pendingRequests } = useReorderRequests();
  const { data: partsManagerQueue, loading: partsManagerLoading } = useReorderRequestsByStatus(
    REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER
  );
  const { data: partsAssociateWaiting, loading: partsAssociateWaitingLoading } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE
  );
  const { data: partsAssociateInProgress, loading: partsAssociateInProgressLoading } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS
  );
  const {
    data: allAssignedWork,
    loading: allAssignedWorkLoading,
    error: allAssignedWorkError,
  } = useReorderRequestsByStatuses(ALL_ASSIGNED_WORK_STATUSES);
  const categories = useCategories();
  const [category, setCategory] = useState("ALL");
  const [page, setPage] = useState(0);
  const [queueFilter, setQueueFilter] = useState("ACTIONABLE");
  const [justRequestedPartIds, setJustRequestedPartIds] = useState(() => new Set());
  const [submittingPartId, setSubmittingPartId] = useState(null);
  const [reorderError, setReorderError] = useState(null);

  const needsPlanningEntries = useMemo(
    () => healthEntries.filter((entry) => entry.recommendation.recommendationStatus === "NEEDS_PLANNING"),
    [healthEntries]
  );
  const actionableEntries = useMemo(
    () => healthEntries.filter((entry) => ACTIONABLE_URGENCIES.has(entry.recommendation.urgency)),
    [healthEntries]
  );
  const queueEntries = queueFilter === "NEEDS_PLANNING" ? needsPlanningEntries : actionableEntries;

  // Inventory Health / Parts Catalog separation (PR B) -- counts,
  // computed here (not in the static QUEUE_FILTER_OPTIONS array, which
  // has no data access) and merged in via FilterBar.jsx's existing
  // `option.count` support, unused until now.
  const queueFilterOptionsWithCounts = useMemo(
    () =>
      QUEUE_FILTER_OPTIONS.map((option) => ({
        ...option,
        count: option.key === "NEEDS_PLANNING" ? needsPlanningEntries.length : actionableEntries.length,
      })),
    [needsPlanningEntries, actionableEntries]
  );

  const requestedPartIds = useMemo(() => {
    const set = new Set(justRequestedPartIds);
    for (const request of pendingRequests) set.add(request.partId);
    return set;
  }, [pendingRequests, justRequestedPartIds]);

  async function handleRequestReorder(partId, recommendation, manualQty) {
    setSubmittingPartId(partId);
    setReorderError(null);
    try {
      await requestReorderForRecommendation({ partId, recommendation, manualQty });
      setJustRequestedPartIds((prev) => new Set(prev).add(partId));
    } catch (err) {
      const partName = getCatalogItem(partId)?.name ?? partId;
      setReorderError(`Could not request reorder for ${partName}: ${err.message}`);
    } finally {
      setSubmittingPartId(null);
    }
  }

  const healthByPartId = useMemo(() => {
    const map = new Map();
    for (const entry of healthEntries) map.set(entry.partId, entry);
    return map;
  }, [healthEntries]);

  const filteredParts = useMemo(() => {
    if (category === "ALL") return PARTS_CATALOG;
    return PARTS_CATALOG.filter((part) => part.category === category);
  }, [category]);

  const pageCount = Math.max(1, Math.ceil(filteredParts.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedParts = filteredParts.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  function handleCategoryChange(value) {
    setCategory(value);
    setPage(0);
  }

  // Inventory Health / Parts Catalog separation (PR B) -- counts for the
  // catalog's own filter bar too, same FilterBar.jsx support, same
  // reasoning as the Inventory Health tabs above. "All Categories" is
  // this page's one true "show everything" experience post-PR-B -- its
  // count is the complete catalog size, not a ledger-scoped subset.
  const filterOptions = categories.map((cat) => ({
    key: cat,
    label: cat === "ALL" ? "All Categories" : cat,
    count: cat === "ALL" ? PARTS_CATALOG.length : PARTS_CATALOG.filter((part) => part.category === cat).length,
  }));

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Parts">
        <GlobalSearch providerKeys={["parts"]} context={{ parts: PARTS_CATALOG }} placeholder="Search parts..." />
      </WorkspaceHeader>

      <h3>Inventory Operational Queue</h3>
      <p className="fo-muted">
        Parts ranked by urgency, from the same analytics used by the Operations dashboard's Inventory Health panel.
      </p>
      <FilterBar options={queueFilterOptionsWithCounts} activeKey={queueFilter} onChange={setQueueFilter} />
      {reorderError && <p className="fo-muted">{reorderError}</p>}
      <LoadingEmptyState loading={loading} isEmpty={false} loadingText="Loading operational queue..." emptyText="">
        <InventoryHealthPanel
          healthEntries={queueEntries}
          title="Needs Reorder"
          onRequestReorder={handleRequestReorder}
          requestedPartIds={requestedPartIds}
          submittingPartId={submittingPartId}
          emptyText={QUEUE_FILTER_EMPTY_TEXT[queueFilter]}
        />
      </LoadingEmptyState>

      <h3>Parts Manager Queue</h3>
      <p className="fo-muted">
        Reorder Requests approved by Inventory review, now handed off to the Parts Manager for fulfillment.
      </p>
      <LoadingEmptyState
        loading={partsManagerLoading}
        isEmpty={partsManagerQueue.length === 0}
        loadingText="Loading Parts Manager queue..."
        emptyText="No requests awaiting the Parts Manager."
      >
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Qty</th>
              <th>Urgency</th>
              <th>Approved</th>
            </tr>
          </thead>
          <tbody>
            {partsManagerQueue.map((request) => (
              <tr key={request.id}>
                <td>
                  <Link to={`/inventory/${request.partId}?requestId=${request.id}`}>
                    {getCatalogItem(request.partId)?.name ?? request.partId}
                  </Link>
                </td>
                <td>{getDisplayQty(request)}</td>
                <td>
                  {request.urgency ? (
                    <span className={`fo-badge fo-badge-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
                  ) : (
                    <span className="fo-badge">Needs planning</span>
                  )}
                </td>
                <td className="fo-muted">
                  {request.reviewedAt ? new Date(request.reviewedAt).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LoadingEmptyState>

      <h3>Parts Associate Queue</h3>
      <p className="fo-muted">Reorder Requests assigned to you, split by whether you've started purchasing.</p>

      <h4>Waiting</h4>
      <LoadingEmptyState
        loading={partsAssociateWaitingLoading}
        isEmpty={partsAssociateWaiting.length === 0}
        loadingText="Loading Parts Associate queue..."
        emptyText="No requests currently waiting on you."
      >
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Qty</th>
              <th>Urgency</th>
              <th>Assigned</th>
            </tr>
          </thead>
          <tbody>
            {partsAssociateWaiting.map((request) => (
              <tr key={request.id}>
                <td>
                  <Link to={`/inventory/${request.partId}?requestId=${request.id}`}>
                    {getCatalogItem(request.partId)?.name ?? request.partId}
                  </Link>
                </td>
                <td>{getDisplayQty(request)}</td>
                <td>
                  {request.urgency ? (
                    <span className={`fo-badge fo-badge-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
                  ) : (
                    <span className="fo-badge">Needs planning</span>
                  )}
                </td>
                <td className="fo-muted">
                  {request.assignedAt ? new Date(request.assignedAt).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LoadingEmptyState>

      <h4>In Progress</h4>
      <LoadingEmptyState
        loading={partsAssociateInProgressLoading}
        isEmpty={partsAssociateInProgress.length === 0}
        loadingText="Loading Parts Associate queue..."
        emptyText="No purchasing currently in progress."
      >
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Qty</th>
              <th>Urgency</th>
              <th>Purchasing started</th>
              <th>Latest Update</th>
            </tr>
          </thead>
          <tbody>
            {partsAssociateInProgress.map((request) => (
              <tr key={request.id}>
                <td>
                  <Link to={`/inventory/${request.partId}?requestId=${request.id}`}>
                    {getCatalogItem(request.partId)?.name ?? request.partId}
                  </Link>
                </td>
                <td>{getDisplayQty(request)}</td>
                <td>
                  {request.urgency ? (
                    <span className={`fo-badge fo-badge-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
                  ) : (
                    <span className="fo-badge">Needs planning</span>
                  )}
                </td>
                <td className="fo-muted">
                  {request.purchasingStartedAt ? new Date(request.purchasingStartedAt).toLocaleString() : "—"}
                </td>
                <td className="fo-muted">
                  {request.lastPurchasingUpdateAt
                    ? `${request.vendorContacted ? "Vendor contacted" : "No vendor contact yet"} -- ${new Date(
                        request.lastPurchasingUpdateAt
                      ).toLocaleString()}`
                    : "No update yet"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </LoadingEmptyState>

      <h3>All Assigned Work ({allAssignedWork.length})</h3>
      <p className="fo-muted">
        Every Reorder Request currently assigned to a Parts Associate, regardless of who it's assigned to --
        oversight only, no action control here. Your own assignments above are a subset of this list.
      </p>
      {allAssignedWorkError ? (
        <p className="fo-muted">Unable to load All Assigned Work ({allAssignedWorkError}).</p>
      ) : (
        <LoadingEmptyState
          loading={allAssignedWorkLoading}
          isEmpty={allAssignedWork.length === 0}
          loadingText="Loading All Assigned Work..."
          emptyText="No requests are currently assigned to anyone."
        >
          <table className="fo-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Qty</th>
                <th>Urgency</th>
                <th>Status</th>
                <th>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {allAssignedWork.map((request) => (
                <tr key={request.id}>
                  <td>
                    <Link to={`/inventory/${request.partId}?requestId=${request.id}`}>
                      {getCatalogItem(request.partId)?.name ?? request.partId}
                    </Link>
                  </td>
                  <td>{getDisplayQty(request)}</td>
                  <td>
                    {request.urgency ? (
                      <span className={`fo-badge fo-badge-${request.urgency.toLowerCase()}`}>{request.urgency}</span>
                    ) : (
                      <span className="fo-badge">Needs planning</span>
                    )}
                  </td>
                  <td className="fo-muted">
                    {request.status === REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS ? "In Progress" : "Waiting"}
                  </td>
                  <td className="fo-muted">
                    {request.assignedAt ? new Date(request.assignedAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </LoadingEmptyState>
      )}

      <h3>Parts Catalog</h3>
      <p className="fo-muted">
        {PARTS_CATALOG.length} parts in catalog. Stock position and reorder status are derived from the inventory
        ledger (same source as the Operations dashboard's Inventory Health panel) -- catalog data is a static
        baseline, not live stock, until a part has ledger activity.
      </p>

      <FilterBar options={filterOptions} activeKey={category} onChange={handleCategoryChange} />

      <LoadingEmptyState loading={loading} isEmpty={false} loadingText="Loading stock position..." emptyText="">
        <>
          <table className="fo-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Available</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {pagedParts.map((part) => {
                const health = healthByPartId.get(part.sku);
                return (
                  <tr key={part.sku}>
                    <td>
                      <Link to={`/inventory/${part.sku}`}>{part.name}</Link>
                    </td>
                    <td className="fo-muted">{part.sku}</td>
                    <td className="fo-muted">{part.category}</td>
                    <td>{health ? health.stock.availableStock : `${part.warehouseQty} (baseline)`}</td>
                    <td>
                      {!health ? (
                        <span className="fo-muted">No ledger activity</span>
                      ) : hasUsageHistory(health.usage) ? (
                        <span className={`fo-badge fo-badge-${health.recommendation.urgency.toLowerCase()}`}>
                          {health.recommendation.urgency}
                        </span>
                      ) : (
                        <span className="fo-badge">Needs planning</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="disp-board-toolbar" style={{ justifyContent: "flex-end" }}>
            <button type="button" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="fo-muted">
              Page {currentPage + 1} of {pageCount}
            </span>
            <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      </LoadingEmptyState>
    </div>
  );
}
