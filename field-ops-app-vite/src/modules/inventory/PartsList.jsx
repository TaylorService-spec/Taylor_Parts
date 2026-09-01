import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PARTS_CATALOG } from "../../data/partsCatalog";
import { fetchPartMasterList } from "../../services/partMasterQueries";
import { buildPartsCatalogRows, canonicalNameBySku, partNamesBoundaryKey, selectCanonicalReadForKey, isCatalogBlocked, partCatalogRoute } from "../../domain/partsCatalogView";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import {
  useReorderRequests,
  useReorderRequestsByStatus,
  useReorderRequestsAssignedTo,
  useReorderRequestsByStatuses,
  useReorderRequestsHistory,
  useReorderRequestById,
  fetchReorderRequestsHistoryPage,
} from "../../hooks/useReorderRequests";
import { requestReorderForRecommendation, getDisplayQty } from "../../domain/inventoryReorderRequests";
import { REORDER_REQUEST_STATUS } from "../../domain/constants";
import { useAuth } from "../../auth/AuthContext";
import { useEmployeeDirectory } from "../../hooks/useEmployeeDirectory";
import GlobalSearch from "../../shared/search/GlobalSearch";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";
import InventoryHealthPanel from "../operations/panels/InventoryHealthPanel";
import ReorderWarehouseSelect from "../../shared/inventory/ReorderWarehouseSelect.jsx";
import { useReorderWarehouseOptions } from "../../hooks/useReorderWarehouseOptions";
import { formatTimestamp, formatAge } from "../../domain/displayTimestamp.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import PartsInfoDisclosure from "./PartsInfoDisclosure.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import { Button } from "../../shared/ui/primitives/index.js";
import { partsAttentionItems } from "../../domain/partsAttentionProjection.js";
import { useManufacturerCatalog } from "../../hooks/useManufacturerCatalog";
import { MANUFACTURER_CATALOG_VIEW_STATE, manufacturerCatalogViewState, manufacturerNameById } from "../../domain/manufacturerCatalogView";
import {
  partsAttentionByPartId,
  partsCollectionSummary,
  partsCollectionViews,
  applyPartsCollectionView,
  partsCollectionRow,
  sortPartsCollectionRows,
  PARTS_COLLECTION_VIEW,
  PARTS_COLLECTION_SORT,
  PARTS_COLLECTION_SORT_LABEL,
} from "../../domain/partsNorthStar.js";
import PartWriteModal from "../../shared/partMaster/PartWriteModal.jsx";
import ManagerQueuePanel from "../../shared/reorder/ManagerQueuePanel.jsx";
import { RequestCards, AssignedRequestDetail } from "../../shared/reorder/AssociateRequestPanel.jsx";
import AssignedWorkOversightTable from "../../shared/reorder/AssignedWorkOversightTable.jsx";

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
// Read-only. INV-CONVERGENCE-E C1 -- the Parts Catalog identity/metadata
// source is the GOVERNED compatibility-adapter output: the live canonical
// `parts` read (fetchPartMasterList, PR 1.9 -- the same one-shot authorized
// read) composed with the static catalog through buildPartsWorkspace(), via
// the pure domain/partsCatalogView.buildPartsCatalogRows(). The static
// PARTS_CATALOG remains the compatibility INPUT to that composition (not a
// parallel source of truth). OD-3 (2026-07-30): every partId -> name display on
// this surface (catalog, reorder/history tables, and the embedded Inventory Health
// panel) now resolves through one governed `resolveName` derived from CANONICAL_MATCH
// rows -- canonical name, else the raw partId, NEVER a static-catalog name -- and the
// canonical read is access-version boundary-key guarded. Canonical is authoritative;
// a denied/unavailable/incomplete canonical read renders an explicit BLOCKED
// state (never an empty list, never a silent static fallback). Stock position
// still comes from useInventoryLedger() (one-shot inventory_transactions read +
// the existing pure analytics), keyed by partId == sku, unchanged. No new
// Firestore query surface, no new computed math. PartDetail's source is NOT
// changed by C1.
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
// S-INV-PARTS (metadata program ledger) -- INVESTIGATED, NOT MIGRATED onto the metadata
// list runtime (useMetadataList/MetadataListGrid over partIndexList/partEntity,
// src/metadata/definitions/part.js), unlike Warehouses.jsx and Suppliers.jsx. This is a
// reported DECLINE, not a skipped item -- three independent blockers, none resolvable
// from this file alone (writeScope for this lane is this module + one test file; the
// fixes below all live in src/domain/** or the metadata registry itself, out of scope):
//
// 1. THE DATA ALREADY FLOWING HERE DOES NOT CARRY partIndexList'S COLUMNS.
//    domain/partsCatalogView.js's buildPartsCatalogRows() -- the ONE governed read this
//    page performs for catalog identity (fetchPartMasterList, unbounded, composed with
//    the static catalog) -- flattens each row to exactly { sku, name, category,
//    warehouseQty, identityState }. partIndexList declares internalPartNumber, name,
//    status, stockingClass, stockingUnit, controlType: four of those six fields
//    (internalPartNumber, status, stockingClass, controlType) are read off the raw Part
//    document by the adapter and then DROPPED before they ever reach this component.
//    Rendering those columns honestly would require either a second live read of `parts`
//    (forbidden -- "do not double-read; reuse data already flowing") or editing
//    domain/partsCatalogView.js to carry them through, which is out of this lane's
//    writeScope. Reported precisely rather than rendering blank columns.
//
// 2. SEARCH CANNOT BE PRESERVED THROUGH THE RUNTIME. shared/search/searchProviders.js's
//    `parts` provider substring-matches sku/name/category against the FULL catalog
//    (catalogRows, from the same unbounded fetchPartMasterList read) -- true substring
//    matching over every Part in the collection. The metadata list runtime has no
//    free-text/CONTAINS filter operator anywhere in its contract (listViewDefinition.js
//    declares only EQUALS/IN/ARRAY_CONTAINS/ARRAY_CONTAINS_ANY), and useMetadataList
//    pages via cursor (partIndexList.pageSize: 50) rather than reading everything at
//    once. Backing this page's search off the runtime's rows would either silently
//    narrow every search to whatever page(s) happen to be loaded (a real regression in
//    what a query matches, not merely a UX one) or require a second, redundant read to
//    keep a full-catalog copy around for search alone. Per this lane's explicit
//    instruction, a weaker search is a stop condition, not a tradeoff to ship quietly.
//
// 3. THE CATALOG ROW SET ITSELF IS A GOVERNED RECONCILIATION, NOT A PLAIN LIST.
//    domain/partsCatalogView.js's composeGovernedPartsWorkspace() enforces a
//    full-accounting invariant (every canonical Part must resolve to exactly one row;
//    any identity ambiguity BLOCKs the whole catalog rather than silently dropping or
//    duplicating a Part) that has no equivalent in the generic metadata list runtime --
//    a plain INDEX read has no concept of reconciling two sources. resolveName (used
//    throughout this page: the operational queue, the manager/associate queues, History)
//    depends on this same composed, CANONICAL_MATCH-filtered row set via
//    canonicalNameBySku(). Classifying this surface as a plain A_ENTITY_LIST undersells
//    what it actually does; it is closer in shape to S-INV-TRANSFERS's "lifecycle
//    composite, not a list" reclassification than to Warehouses/Suppliers.
//
// No code below this comment changed as a result of this investigation -- forcing a
// partial move that silently dropped columns, weakened search, or duplicated the read
// would each violate a stated non-negotiable, and the reconciliation logic that would
// need to move (or be duplicated) for a real fix lives outside this lane's writeScope.
const ALL_ASSIGNED_WORK_STATUSES = [
  REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE,
  REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS,
];

// Inventory Operational Queue, PR C (docs/specifications/inventory-
// operational-queue.md). Every terminal Reorder Request status --
// History only ever grows (nothing here is reachable again once it
// lands in one of these), the exact set useReorderRequestsHistory()
// queries via the C0-deployed `reorder_requests(status, createdAt)`
// index.
const HISTORY_STATUSES = [
  REORDER_REQUEST_STATUS.CANCELLED,
  REORDER_REQUEST_STATUS.VOIDED,
  REORDER_REQUEST_STATUS.RECEIVED,
  REORDER_REQUEST_STATUS.REJECTED,
];
// A small, explicit page size (not the Specification's illustrative 25) --
// matching this codebase's own established precedent for making
// pagination/end-of-history deterministically testable against a
// reasonably-sized fixture, without needing dozens of seeded documents
// (see SERVICE_ACTIVITY_PAGE_SIZE, domain/accountWorkOrders.js).
const HISTORY_PAGE_SIZE = 10;
const HISTORY_STATUS_LABEL = {
  [REORDER_REQUEST_STATUS.CANCELLED]: "Cancelled",
  [REORDER_REQUEST_STATUS.VOIDED]: "Voided",
  [REORDER_REQUEST_STATUS.RECEIVED]: "Received",
  [REORDER_REQUEST_STATUS.REJECTED]: "Rejected",
};

// Inventory Operational Queue, PR C, Final Review correction. A
// deterministic TEST SEAM for History's loading/error/genuinely-empty/
// Load-More-failure states -- network-level interception was confirmed
// unreliable for this hook (its getDocs() call is multiplexed through
// this page's already-open onSnapshot WebChannel, not a discrete
// interceptable request; see useReorderRequests.js's own header comment
// on fetchReorderRequestsHistoryPage for the full investigation).
// Instead, useReorderRequestsHistory()'s own `fetchPageImpl` injection
// point is used to substitute a deterministic implementation, driving
// the SAME hook and the SAME rendered component tree production traffic
// uses -- no component-level bypass, no fake DOM.
//
// Gated on BOTH import.meta.env.DEV (completely absent from any
// production build, dead-code-eliminated by Vite -- same safety
// posture as firebase.js's own `?emulator=1` gate) AND an explicit,
// unguessable-by-accident query param (?historyTest=...) that does
// nothing unless a value from HISTORY_TEST_MODES is present. Inert by
// default; never reachable outside a dev-mode session that opts in
// explicitly.
const HISTORY_TEST_MODES = new Set(["error", "empty", "loading", "error-loadmore"]);

function buildHistoryTestFetchImpl(mode) {
  if (mode === "error") {
    return async () => {
      const err = new Error("Simulated test failure -- initial load");
      err.code = "test-injected-failure";
      throw err;
    };
  }
  if (mode === "empty") {
    return async () => ({ docs: [], lastVisible: null, size: 0 });
  }
  if (mode === "loading") {
    // A promise that never resolves -- the hook's `loading` state has no
    // path to ever leave `true` for this fetch, letting a test observe
    // the Loading state deterministically instead of racing a real,
    // fast-resolving fetch.
    return () => new Promise(() => {});
  }
  if (mode === "error-loadmore") {
    // The FIRST fetch (no cursor -- the initial page) delegates to the
    // real implementation, so real fixture data loads normally; only a
    // SUBSEQUENT fetch (cursor present -- a Load More click) fails. This
    // is what makes "existing rows survive a Load More failure"
    // deterministically testable: the initial success is real, not
    // faked, and only the pagination step is forced to fail.
    return async (args) => {
      if (args.cursor) {
        const err = new Error("Simulated test failure -- Load More");
        err.code = "test-injected-failure";
        throw err;
      }
      return fetchReorderRequestsHistoryPage(args);
    };
  }
  return undefined;
}

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

// Inventory Operational Queue, PR A (docs/specifications/inventory-
// operational-queue.md's "All Assigned Work" row shape: "...and age").
// Pure -- directly testable without a rendering environment, same
// rationale as this codebase's other extracted pure formatters
// (filterEmployeesBySearch(), applyPartsAssociateSecurityRoleEligibility()).
// A relative-elapsed-time summary, distinct from and in addition to a
// raw locale timestamp -- "age" means how long a request has been
// assigned, not merely when it happened.
export function formatAssignmentAge(assignedAtMs, nowMs = Date.now()) {
  // Delegates to the shared honest formatter. This used to do its own arithmetic
  // with Math.max(0, now - value), which turns an epoch-zero or otherwise unusable
  // timestamp into a confident "19933d ago" -- about 54 years, printed on a request
  // made this week. A Parts Manager reported it as data they had to mentally flag as
  // false rather than read. An unusable timestamp is Unknown, not an age.
  return formatAge(assignedAtMs, nowMs, { unknown: "—" });
}

// Inventory Operational Queue, PR A, Final Review correction: this app's
// shared resolveActorDisplayName() (hooks/useEmployeeDirectory.js) falls
// back to the raw uid when the directory has no linked Employee for it --
// an established, accepted convention at every OTHER call site in this
// app (PartDetail.jsx's Assigned to/Ordered by/Received by/etc.), where
// exposing the raw uid was reviewed and accepted. "All Assigned Work" is
// held to a stricter bar here (cross-user oversight, shown to a manager
// who may not recognize a raw Firebase uid at all) -- never a raw uid,
// full stop, whether unresolved, still loading, or the directory itself
// failed to load. Pure -- directly testable, same rationale as this
// file's other extracted formatters. Deliberately does NOT call
// resolveActorDisplayName() at all (rather than calling it and then
// pattern-matching its result to detect "was this a uid"), since the raw
// uid is opaque here -- there is no reliable way to tell a resolved name
// from a uid-shaped display name after the fact.
export function resolveAssigneeDisplay(userId, employeeDirectory, directoryLoading, directoryError) {
  if (!userId) return "—";
  if (directoryLoading || directoryError) return "Unknown assignee";
  return employeeDirectory?.get(userId)?.displayName ?? "Unknown assignee";
}

// INV-CONVERGENCE-E C1 -- explicit, non-empty BLOCKED copy for the Parts Catalog
// section when the canonical read cannot be validly composed. Never an empty
// table, never a silent static fallback. Mirrors PartMasterList.jsx's denied/
// unavailable wording.
function catalogBlockedMessage(status) {
  if (status === "BLOCKED_PERMISSION") {
    return "You do not have access to the canonical Parts catalog. Contact an administrator if you believe this is an error.";
  }
  if (status === "BLOCKED_UNAVAILABLE") {
    return "The canonical Parts catalog is currently unavailable. Try again later.";
  }
  // BLOCKED_INCOMPLETE_INPUT
  return "The Parts catalog could not be verified against the canonical source, so no parts are shown (an incomplete catalog is never displayed). Try again later.";
}

export default function PartsList({ accessVersion, writeDeps } = {}) {
  const { user } = useAuth();
  const {
    byUserId: employeeDirectory,
    loading: employeeDirectoryLoading,
    error: employeeDirectoryError,
  } = useEmployeeDirectory();
  const { healthEntries, loading, error: healthError } = useInventoryLedger();

  // INV-CONVERGENCE-E C1 -- live canonical `parts` read (one-shot, PR 1.9's
  // fetchPartMasterList; no new query surface). null until the first read
  // resolves. Mapped to the canonicalRead status contract the pure
  // buildPartsCatalogRows() consumes (OK / PERMISSION_DENIED / UNAVAILABLE).
  // Stored TAGGED with the (uid, accessVersion) boundary key it was produced under; `null`
  // read until the first resolve. OD-3 access-version boundary guard: a same-UID access
  // change re-reads (effect keyed on the boundary key) with a request token + cancel flag
  // (stale completions dropped), and at render the stored read is selected ONLY on an exact
  // key match -- else `null` (LOADING) synchronously, so stale-boundary names never paint in
  // the catalog OR the reorder/history tables OR the embedded Inventory Health panel.
  const currentKey = partNamesBoundaryKey(user?.uid, accessVersion);
  const [stored, setStored] = useState({ key: currentKey, read: null });
  const tokenRef = useRef(0);
  // Wave 6 -- master-data-in-Parts. Bumped after a governed New Part create so the
  // SAME canonical read this page already performs re-fetches -- no second read
  // surface, no cache bypass, just the existing effect re-running.
  const [catalogRefreshToken, setCatalogRefreshToken] = useState(0);
  // WHEN THIS PAGE LAST READ THE CATALOGUE -- not when the catalogue last changed.
  //
  // Frame 1a puts "Read-checked 9:41 AM" beside Refresh. The distinction matters enough to state:
  // this is stamped when THIS CLIENT'S read resolves, so it answers "how old is what I am looking
  // at" and nothing else. It is not a freshness guarantee, not a server timestamp, and not a claim
  // that the underlying records were unchanged since -- none of which any read on this page
  // establishes. Null until the first read lands, so it never shows a time for data not yet held.
  const [readCheckedAt, setReadCheckedAt] = useState(null);
  const handleCatalogRefresh = useCallback(() => setCatalogRefreshToken((t) => t + 1), []);
  useEffect(() => {
    const token = ++tokenRef.current;
    let cancelled = false;
    setStored({ key: currentKey, read: null });
    fetchPartMasterList().then((result) => {
      if (cancelled || token !== tokenRef.current) return;
      setReadCheckedAt(new Date());
      // Pass `invalid` through so the shared composer fails closed on any malformed canonical document
      // (never silently dropped) -- see domain/partsCatalogView composeGovernedPartsWorkspace step 1b.
      const read = result.ok
        ? { status: "OK", rows: result.parts, invalid: result.invalid }
        : { status: result.code === "permission-denied" ? "PERMISSION_DENIED" : "UNAVAILABLE" };
      setStored({ key: currentKey, read });
    });
    return () => {
      cancelled = true;
    };
  }, [currentKey, catalogRefreshToken]);
  const canonicalRead = selectCanonicalReadForKey(stored, currentKey, null);
  const canonicalLoading = canonicalRead === null;
  // Governed catalog composition (pure). While the read is in flight we pass a
  // LOADING sentinel (composes to BLOCKED with rows:[]) but render the loading
  // state, not the blocked banner (canonicalLoading gate below).
  const catalog = useMemo(
    () => buildPartsCatalogRows({ canonicalRead: canonicalRead ?? { status: "LOADING" }, staticCatalog: PARTS_CATALOG }),
    [canonicalRead]
  );
  const catalogRows = catalog.rows;
  // OD-3 (Owner decision, 2026-07-30): canonical name only (CANONICAL_MATCH rows), else the
  // raw partId -- NEVER a static-catalog name. Derived from the already-composed catalog rows
  // (no second read, no second compose). Empty under LOADING/BLOCKED -> degrades to partId.
  const resolveName = useMemo(() => {
    const map = canonicalNameBySku(catalogRows);
    return (partId) => map.get(partId) ?? partId;
  }, [catalogRows]);

  const { data: pendingRequests } = useReorderRequests();
  const { data: partsManagerQueue, loading: partsManagerLoading, error: partsManagerError } = useReorderRequestsByStatus(
    REORDER_REQUEST_STATUS.READY_FOR_PARTS_MANAGER
  );
  const { data: partsAssociateWaiting, loading: partsAssociateWaitingLoading, error: partsAssociateWaitingError } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.ASSIGNED_TO_PARTS_ASSOCIATE
  );
  const { data: partsAssociateInProgress, loading: partsAssociateInProgressLoading, error: partsAssociateInProgressError } = useReorderRequestsAssignedTo(
    user?.uid,
    REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS
  );
  const {
    data: allAssignedWork,
    loading: allAssignedWorkLoading,
    error: allAssignedWorkError,
  } = useReorderRequestsByStatuses(ALL_ASSIGNED_WORK_STATUSES);
  // Wave 6 -- queue consolidation. Which assigned-to-me request's detail panel (if any) is
  // open -- same shared AssignedRequestDetail PartsAssociateHome.jsx uses, same focus-
  // restoration convention (the triggering "View" button regains focus on close).
  const [selectedAssociateRequestId, setSelectedAssociateRequestId] = useState(null);
  const associateLastTriggerRef = useRef(null);
  function handleSelectAssociateRequest(requestId, triggerEl) {
    associateLastTriggerRef.current = triggerEl;
    setSelectedAssociateRequestId(requestId);
  }
  function handleCloseAssociateRequest() {
    setSelectedAssociateRequestId(null);
    associateLastTriggerRef.current?.focus();
  }
  // Inventory Operational Queue, PR C -- Reorder Request History.
  // Test-seam wiring (see HISTORY_TEST_MODES/buildHistoryTestFetchImpl
  // above for the full rationale) -- import.meta.env.DEV is
  // statically known at build time, so this whole branch is
  // dead-code-eliminated from any production bundle; searchParams'
  // ?historyTest= value is otherwise inert (undefined -> the hook's own
  // real default fetchPageImpl is used, unchanged).
  const [historySearchParams] = useSearchParams();
  const historyTestMode = import.meta.env.DEV ? historySearchParams.get("historyTest") : null;
  const historyFetchPageImpl = useMemo(
    () => (historyTestMode && HISTORY_TEST_MODES.has(historyTestMode) ? buildHistoryTestFetchImpl(historyTestMode) : undefined),
    [historyTestMode]
  );
  const {
    data: historyData,
    loading: historyLoading,
    error: historyError,
    isEndOfHistory: historyIsEndOfHistory,
    loadMore: historyLoadMore,
  } = useReorderRequestsHistory({
    statuses: HISTORY_STATUSES,
    pageSize: HISTORY_PAGE_SIZE,
    fetchPageImpl: historyFetchPageImpl,
  });
  // Distinguishes the INITIAL load failing (nothing to show at all -- the
  // whole section becomes the error state, per the Specification's "never
  // an empty table" requirement) from a later "Load More" call failing
  // (already-loaded rows stay visible; only the pagination control's own
  // area reflects the failure) -- a load-more failure must never blank
  // out real, already-fetched history data.
  const historyInitialLoadFailed = historyError && historyData.length === 0;
  const historyStatusMessage = historyInitialLoadFailed
    ? `Unable to load History (${historyError}).`
    : historyLoading && historyData.length === 0
      ? "Loading History..."
      : historyData.length === 0
        ? "No terminal Reorder Requests yet."
        : `History: ${historyData.length} request${historyData.length === 1 ? "" : "s"} loaded${historyIsEndOfHistory ? ", end of history" : ""}.`;

  // Exact-ID lookup, independent of History's own loaded pages/pagination
  // state (Specification: "a known exact id is always reachable... without
  // 'Load More'-ing through the entire history"). An explicit "Find"
  // action, not auto-detection of the input's shape -- this repo's seeded/
  // real Reorder Request ids aren't a fixed, sniffable format.
  const [historyLookupInput, setHistoryLookupInput] = useState("");
  const [historyLookupId, setHistoryLookupId] = useState(null);
  const {
    data: historyLookupResult,
    loading: historyLookupLoading,
    error: historyLookupError,
  } = useReorderRequestById(historyLookupId);

  function handleHistoryLookupSubmit(e) {
    e.preventDefault();
    setHistoryLookupId(historyLookupInput.trim() || null);
  }
  function handleHistoryLookupClear() {
    setHistoryLookupId(null);
    setHistoryLookupInput("");
  }

  const categories = useMemo(() => {
    const set = new Set(catalogRows.map((part) => part.category));
    return ["ALL", ...[...set].sort()];
  }, [catalogRows]);
  const [category, setCategory] = useState("ALL");
  const [view, setView] = useState(PARTS_COLLECTION_VIEW.ALL);
  const [sort, setSort] = useState(PARTS_COLLECTION_SORT.PART_NUMBER);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [page, setPage] = useState(0);
  const [queueFilter, setQueueFilter] = useState("ACTIONABLE");
  // Wave 6 -- master-data-in-Parts. `writeDeps` lets tests/preview inject a mocked
  // client without touching partMasterCommandClient/firebase (same seam PartMasterList
  // and PartWriteModal already use).
  const [newPartOpen, setNewPartOpen] = useState(false);
  const [justRequestedPartIds, setJustRequestedPartIds] = useState(() => new Set());
  const [submittingPartId, setSubmittingPartId] = useState(null);
  const [reorderError, setReorderError] = useState(null);
  // WORKSTREAM 2B -- the governed Warehouse this queue is requesting FOR. One choice for the
  // whole panel, because the queue is a list of parts and not a list of warehouses. Starts
  // empty and is never defaulted: an unstated warehouse leaves every Request Reorder button
  // off, which is honest, where a silent default would author a company fact nobody chose.
  const [reorderWarehouseId, setReorderWarehouseId] = useState("");
  // R-17. The trusted projection, not a warehouses collection LIST -- see the hook's header.
  const reorderWarehouses = useReorderWarehouseOptions(true);

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

  // `warehouseId` arrives from the control that was gated on it, not from this page's state
  // read a second time -- so the value that enabled the button is the value that is written.
  // It is passed straight through to the trusted command, which re-reads the warehouse and
  // derives the operating company itself. Nothing here interprets it.
  async function handleRequestReorder(partId, recommendation, manualQty, warehouseId) {
    setSubmittingPartId(partId);
    setReorderError(null);
    try {
      await requestReorderForRecommendation({ partId, warehouseId, recommendation, manualQty });
      setJustRequestedPartIds((prev) => new Set(prev).add(partId));
    } catch (err) {
      const partName = resolveName(partId);
      setReorderError(`Could not request reorder for ${partName}: ${err.message}`);
    } finally {
      setSubmittingPartId(null);
    }
  }


  // ── FRAME 1a (ND-30). Composed from facts this page ALREADY holds: the governed catalogue rows
  //    and the reorder_requests behind `pendingRequests`. No new read, no new state, no quantity.
  const manufacturerCatalog = useManufacturerCatalog();
  const manufacturerNames = useMemo(() => {
    // Same governed resolution the record uses. A part with no manufacturer id resolves to nothing
    // and the cell says so -- it never borrows another field to look populated.
    return manufacturerCatalogViewState(manufacturerCatalog) === MANUFACTURER_CATALOG_VIEW_STATE.READY
      ? manufacturerNameById(manufacturerCatalog.result.manufacturers)
      : new Map();
  }, [manufacturerCatalog]);

  const attentionByPartId = useMemo(
    () => partsAttentionByPartId(partsAttentionItems(pendingRequests ?? [])),
    [pendingRequests],
  );
  const collectionSummary = useMemo(
    () => partsCollectionSummary(catalogRows, attentionByPartId),
    [catalogRows, attentionByPartId],
  );
  const collectionViews = useMemo(
    () => partsCollectionViews(catalogRows, attentionByPartId),
    [catalogRows, attentionByPartId],
  );

  const filteredParts = useMemo(() => {
    // View first, then category, then sort. Both filters are over rows already loaded; neither
    // queries, and a view is a filter rather than a state (ND-30).
    const inView = applyPartsCollectionView(catalogRows, view, attentionByPartId);
    const inCategory = category === "ALL" ? inView : inView.filter((part) => part.category === category);
    const q = catalogQuery.trim().toLowerCase();
    const matched = q
      ? inCategory.filter((part) =>
          `${part.internalPartNumber ?? ""} ${part.name ?? ""} ${part.description ?? ""} ${part.category ?? ""}`
            .toLowerCase()
            .includes(q),
        )
      : inCategory;
    return sortPartsCollectionRows(matched, sort);
  }, [catalogRows, view, attentionByPartId, category, sort, catalogQuery]);

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
    count: cat === "ALL" ? catalogRows.length : catalogRows.filter((part) => part.category === cat).length,
  }));

  // ══════════ WORK AND FLOW, IN THE SECONDARY RAIL (Parts P1v2, Frame 1a) ══════════
  //
  // ND-30's scope boundary said "do not relocate the Work group / the Flow group". The Owner
  // AMENDED it on 2026-08-31 to the narrow reading: the boundary protects ROUTE OWNERSHIP and
  // FUNCTIONAL PRESENCE, not visual placement within /inventory. So both groups stay on this route,
  // keep every hook, panel, queue and command they had, and become visually subordinate to the
  // catalogue -- which is what Frame 1a draws and what the Owner approved.
  //
  // WHY DISCLOSURES RATHER THAN THE SUMMARY LINES THE FRAME DRAWS. Frame 1a shows each queue as a
  // single line ("Waiting -- none", "Team work -- none") because the frame's fixture has them all
  // empty but one. A one-line summary is the correct RESTING state; it is not a correct state for a
  // queue that HAS work, because these panels carry governed commands -- Assign from the Parts
  // Manager queue, the associate request detail, Request Reorder -- and the amendment forbids
  // removing their functions from this workspace. A <details> is both at once: one line when there
  // is nothing, the real panel when there is, opened by default exactly when it holds work. Native
  // element, no new state, and nothing is behind a link to a route that does not exist.
  const railCount = (n) => (n > 0 ? String(n) : "none");
  const partsRail = (
    <div className="ns-parts-rail">
      <section className="ns-parts-rail__group" aria-labelledby="parts-group-work">
        <h2 id="parts-group-work" className="ns-parts-rail__heading">
          My work
        </h2>

        <details className="ns-parts-rail__item" open={queueEntries.length > 0}>
          <summary>
            Needs reorder <span className="ns-parts-rail__count">{railCount(queueEntries.length)}</span>
          </summary>
          <p className="fo-muted ns-parts-rail__note">
            Parts ranked by urgency, from the same analytics used by the Operations dashboard&rsquo;s
            Inventory Health panel.
          </p>
          {/* CHIPS, NOT VIEWS -- unchanged from the pre-P1v2 composition and for the unchanged
              reason: this row chooses a slice of the Inventory Health PANEL, not a view of a
              collection, so it must not wear the collection views markup. */}
          <FilterBar
            variant="chips"
            options={queueFilterOptionsWithCounts}
            activeKey={queueFilter}
            onChange={setQueueFilter}
          />
          <ReorderWarehouseSelect
            id="parts-queue-reorder-warehouse"
            options={reorderWarehouses.options}
            loading={reorderWarehouses.loading}
            error={reorderWarehouses.error}
            value={reorderWarehouseId}
            onChange={setReorderWarehouseId}
          />
          {reorderError && <p className="fo-muted">{reorderError}</p>}
          <LoadingEmptyState
            loading={loading}
            failed={!!healthError}
            isEmpty={false}
            loadingText="Loading operational queue..."
            failedText="Unable to load the operational queue right now. Try again shortly."
            emptyText=""
          >
            <InventoryHealthPanel
              healthEntries={queueEntries}
              title="Needs Reorder"
              resolveName={resolveName}
              onRequestReorder={handleRequestReorder}
              requestedPartIds={requestedPartIds}
              submittingPartId={submittingPartId}
              reorderWarehouseId={reorderWarehouseId}
              emptyText={QUEUE_FILTER_EMPTY_TEXT[queueFilter]}
            />
          </LoadingEmptyState>
        </details>

        {/* The SAME actionable ManagerQueuePanel PartsManagerHome.jsx uses -- an admin/dispatcher can
            Assign directly from here. Unchanged by the move into the rail: same component, same
            props, same server-enforced authority. */}
        <details className="ns-parts-rail__item" open={partsManagerQueue.length > 0}>
          <summary>
            Parts Manager queue{" "}
            <span className="ns-parts-rail__count">{railCount(partsManagerQueue.length)}</span>
          </summary>
          <ManagerQueuePanel
            queue={partsManagerQueue}
            resolveName={resolveName}
            loading={partsManagerLoading}
            error={partsManagerError}
            title="Parts Manager Queue"
            description="Reorder Requests approved by Inventory review, now handed off to the Parts Manager for fulfillment."
          />
        </details>

        <details className="ns-parts-rail__item" open={partsAssociateWaiting.length > 0}>
          <summary>
            Waiting <span className="ns-parts-rail__count">{railCount(partsAssociateWaiting.length)}</span>
          </summary>
          <LoadingEmptyState
            loading={partsAssociateWaitingLoading}
            failed={!!partsAssociateWaitingError}
            isEmpty={partsAssociateWaiting.length === 0}
            loadingText="Loading your assigned requests..."
            failedText="Unable to load your assigned requests right now. Try again shortly."
            emptyText="No requests currently waiting on you."
          >
            <RequestCards
              requests={partsAssociateWaiting}
              resolveName={resolveName}
              onSelect={handleSelectAssociateRequest}
            />
          </LoadingEmptyState>
        </details>

        <details className="ns-parts-rail__item" open={partsAssociateInProgress.length > 0}>
          <summary>
            In progress{" "}
            <span className="ns-parts-rail__count">{railCount(partsAssociateInProgress.length)}</span>
          </summary>
          <LoadingEmptyState
            loading={partsAssociateInProgressLoading}
            failed={!!partsAssociateInProgressError}
            isEmpty={partsAssociateInProgress.length === 0}
            loadingText="Loading your in-progress purchasing..."
            failedText="Unable to load your in-progress purchasing right now. Try again shortly."
            emptyText="No purchasing currently in progress."
          >
            <RequestCards
              requests={partsAssociateInProgress}
              resolveName={resolveName}
              onSelect={handleSelectAssociateRequest}
            />
          </LoadingEmptyState>
        </details>

        {/* Cross-user oversight. Stays CLOSED by default even when populated: every row in it is
            already represented by the two disclosures above for the viewer's own work, and the panel
            says so itself ("Your own assignments above are a subset of this list"). */}
        <details className="ns-parts-rail__item">
          <summary>
            Team work <span className="ns-parts-rail__count">{railCount(allAssignedWork.length)}</span>
          </summary>
          <p className="fo-muted ns-parts-rail__note">
            Every Reorder Request currently assigned to a Parts Associate, regardless of who it is
            assigned to. Your own assignments above are a subset of this list.
          </p>
          <AssignedWorkOversightTable
            requests={allAssignedWork}
            resolveName={resolveName}
            resolveAssigneeDisplay={(userId) =>
              resolveAssigneeDisplay(userId, employeeDirectory, employeeDirectoryLoading, employeeDirectoryError)
            }
            loading={allAssignedWorkLoading}
            error={allAssignedWorkError}
          />
        </details>

        {/* The associate request detail is a DIALOG, not a rail row -- it stays outside the
            disclosures so opening a request from either queue composes the same way it did before. */}
        {selectedAssociateRequestId && (
          <AssignedRequestDetail
            requestId={selectedAssociateRequestId}
            resolveName={resolveName}
            onClose={handleCloseAssociateRequest}
          />
        )}
      </section>

      <section className="ns-parts-rail__group" aria-labelledby="parts-group-flow">
        <h2 id="parts-group-flow" className="ns-parts-rail__heading">
          Flow
        </h2>
        <details className="ns-parts-rail__item">
          <summary>
            History <span className="ns-parts-rail__count">{railCount(historyData.length)}</span>
          </summary>
          <p className="fo-muted ns-parts-rail__note">
            Cancelled, Voided, Received and Rejected Reorder Requests, newest first.
          </p>

          <form className="fo-inline-form" onSubmit={handleHistoryLookupSubmit}>
            <label htmlFor="history-lookup-input">Find by exact request ID</label>
            <input
              id="history-lookup-input"
              type="text"
              value={historyLookupInput}
              onChange={(e) => setHistoryLookupInput(e.target.value)}
              placeholder="Reorder Request document ID"
            />
            <button type="submit" disabled={!historyLookupInput.trim()}>
              Find
            </button>
            {historyLookupId && (
              <button type="button" onClick={handleHistoryLookupClear}>
                Clear
              </button>
            )}
          </form>
          {historyLookupId && (
            <p role="status" className="fo-muted">
              {historyLookupLoading
                ? "Looking up request..."
                : historyLookupError === "not_found"
                  ? `No Reorder Request found with ID "${historyLookupId}".`
                  : historyLookupError
                    ? `Unable to look up request (${historyLookupError}).`
                    : historyLookupResult && (
                        <>
                          Found:{" "}
                          <Link to={`/inventory/${historyLookupResult.partId}?requestId=${historyLookupResult.id}`}>
                            {resolveName(historyLookupResult.partId)}
                          </Link>{" "}
                          -- {HISTORY_STATUS_LABEL[historyLookupResult.status] ?? historyLookupResult.status}
                        </>
                      )}
            </p>
          )}

          <p role="status" className="fo-sr-only">
            {historyStatusMessage}
          </p>
          {historyInitialLoadFailed ? (
            <p className="fo-muted">Unable to load History ({historyError}).</p>
          ) : (
            <LoadingEmptyState
              loading={historyLoading && historyData.length === 0}
              isEmpty={historyData.length === 0}
              loadingText="Loading History..."
              emptyText="No terminal Reorder Requests yet."
            >
              <div className="fo-table-scroll">
                <table className="fo-table">
                  <thead>
                    <tr>
                      <th>Part</th>
                      <th>Qty</th>
                      <th>Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.map((request) => (
                      <tr key={request.id}>
                        <td>
                          <Link to={`/inventory/${request.partId}?requestId=${request.id}`}>
                            {resolveName(request.partId)}
                          </Link>
                        </td>
                        <td>{getDisplayQty(request)}</td>
                        <td className="fo-muted">{HISTORY_STATUS_LABEL[request.status] ?? request.status}</td>
                        <td className="fo-muted">{formatTimestamp(request.createdAt, { unknown: "—" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="disp-board-toolbar fo-parts__toolbar--center">
                {historyError ? (
                  <p className="fo-muted">
                    Unable to load more History ({historyError}).{" "}
                    <button type="button" onClick={historyLoadMore}>
                      Retry
                    </button>
                  </p>
                ) : historyIsEndOfHistory ? (
                  <span className="fo-muted">End of history.</span>
                ) : (
                  <button type="button" onClick={historyLoadMore} disabled={historyLoading}>
                    {historyLoading ? "Loading..." : "Load More"}
                  </button>
                )}
              </div>
            </LoadingEmptyState>
          )}
        </details>
      </section>
    </div>
  );

  // WHERE THIS SITS, in the record family's own grammar. Frame 1a opens the workspace with the same
  // breadcrumb and rule pair the Part record already opens with, so that entering the collection and
  // opening one of its records do not read as two different products.
  //
  // THE RIGHT SIDE STATES WHEN THIS WAS READ, and only that. It is the client's own read time --
  // never a claim about how current the underlying records are, which is a fact no read on this page
  // establishes -- sitting beside the refresh this page already had.
  return (
    <WorkspaceShell
      crumb={
        <>
          {/* THE RECORD'S OWN MARKUP, not a second dialect of it. PartDetail already opens with
              `.ns-page__utility` + `.ns-page__context` + `.ns-rulepair`; the workspace reuses those
              exact classes so the two surfaces share one implementation as well as one look. */}
          <div className="ns-page__utility">
            <span className="ns-page__context">
              Inventory <span aria-hidden="true">→</span> Parts
            </span>
            <span>
              {readCheckedAt
                ? `Read-checked ${readCheckedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : "Reading the catalogue…"}
              {" · "}
              <button type="button" className="fo-link-btn" onClick={handleCatalogRefresh}>
                Refresh
              </button>
            </span>
          </div>
          <div className="ns-rulepair" />
        </>
      }
      title="Parts"
      supporting={partsRail}
      actions={
        <ActionRail
          start={<GlobalSearch providerKeys={["parts"]} context={{ parts: catalogRows }} placeholder="Search part number, description, or category" />}
          primary={
            <Button variant="primary" onClick={() => setNewPartOpen(true)}>
              New Part
            </Button>
          }
        />
      }
      className="fo-parts-list"
    >
      {newPartOpen && (
        <PartWriteModal
          mode="create"
          writeDeps={writeDeps}
          onClose={() => setNewPartOpen(false)}
          onSaved={() => {
            setNewPartOpen(false);
            handleCatalogRefresh();
          }}
        />
      )}
      {/* ══════════ FRAME 1a LEADS THE PAGE (ND-30, corrected 2026-08-30) ══════════

          It did not, and that was this build's call rather than the ruling's. ND-30 said do not
          RELOCATE the Work and Flow groups; it said nothing about order, and leaving the existing
          order untouched put the catalogue seventh -- behind six reorder-queue panels, five of
          them empty. Parts opened on nothing. In the design, the catalogue IS the page.

          So the catalogue leads and its identity is the PAGE's: the shell's title, then the count
          line, the views, the toolbar, the table. There is no second heading -- Frame 1a has one
          title, and "Parts Catalog" as a section name was an artefact of composing it as a panel.

          Nothing is relocated off /inventory. Work and Flow keep their exact composition, their
          headings, their hooks and their governed reorder queues -- they follow rather than
          precede. The route does not become a collection-only page. */}
      {/* data-parts-catalog IS THE CONTRACT. The live gate used to find this surface by matching an
          h3 reading "Parts Catalog" -- a heading the design was free to remove, and did. Anchoring
          a gate on a heading the ruling may rename is how two checks came to measure different
          tables. An explicit hook says "this is the catalogue" and survives the next rename. */}
      <div className="ns-workspace" data-parts-catalog>
        <header className="ns-workspace__head">
          <div className="ns-workspace__titleblock">
            {/* NO SECOND TITLE. The shell already renders "Parts" as the page title, and Frame 1a
                has one. "Parts Catalog" was an artefact of composing this as a panel among panels;
                now that the catalogue leads the page, repeating the name would state the subject
                twice and teach the reader to skim both.

                COUNTED FOR WHAT IT IS: this page performs a whole-collection read, so the number is
                the catalogue -- and the label says so rather than implying a company-wide inventory
                universe nobody measured. */}
            <p className="ns-workspace__summary" data-parts-summary>
              <strong className="ns-workspace__count">
                {collectionSummary.total}{" "}
                <span className="ns-workspace__count-label">{collectionSummary.totalLabel}</span>
              </strong>
              {" · "}
              {collectionSummary.active} active
              {/* NO "N STATUS NOT RECORDED" SEGMENT. Frame 1a draws three segments -- total, active,
                  needs attention -- and its own fixture contains a part whose status is unrecorded,
                  so the omission is the design's decision rather than an artefact of its data.
                  Recorded as an INTENTIONAL presentation removal, on the same footing as Recommended
                  reorder qty and Risk leaving the record (Owner ruling 4).

                  The fact is not lost and was not the summary's to carry alone: every such row still
                  says "Not recorded" in its own Status cell, `partsCollectionSummary` still computes
                  `statusUnknown`, and the projection test still pins it. What left is one segment of
                  a header line, not a governed count. */}
              {collectionSummary.needsAttention > 0 ? (
                <>
                  {" · "}
                  <span className="is-attention">
                    {collectionSummary.needsAttention}{" "}
                    {collectionSummary.needsAttention === 1 ? "needs" : "need"} attention
                  </span>
                </>
              ) : null}
            </p>
          </div>
        </header>

        {/* VIEW CHIPS. Each is a filter over rows already loaded -- a presentation filter, never a
            state machine, and never a backend concept (ND-30). Counts ride along because a chip
            without one asks the reader to click to find out whether clicking was worth it. */}
        {/* CHIPS, NOT THE COLLECTION VIEWS ROW — and the distinction is load-bearing.

            ND-30 asks for view chips here. The shipped Lists P2 COMPOSE contract says only a
            declared collection PAGE may wear the collection views markup, and ND-30 is equally clear
            that /inventory must NOT become one. Rendering the collection chrome would have made
            this page claim an identity the same ruling withholds from it.

            Both hold at once through FilterBar's chips variant: the reader gets the views and
            their counts, and the page does not declare itself a collection. The chip row IS the
            presentation; the collection markup was never the requirement.

            variant="chips" is also the caller obligation listsP2Compose enforces -- a
            non-collection surface must declare itself rather than inherit the views default. */}
        {/* THE TAB RAIL, WHICH ALREADY EXISTED. Frame 1a draws the views as underlined tabs rather
            than pills, and the handoff named that as an implementation seam against the Lists P2
            COMPOSE contract. There was no seam: `.ns-tabrail` is the shared workspace tab control
            (Equipment uses it), it is NOT the collection-views markup, and so wearing it does not make
            /inventory declare itself a collection page -- which is the thing ND-30 withholds.

            It also carries the hover both halves of, which the chips did not: `.fo-filter-btn:hover`
            set a colour and let the global `button:hover` supply a dark fill underneath it. */}
        <div className="ns-tabrail" role="tablist" aria-label="Parts views">
          {collectionViews.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              className={`ns-tabrail__tab${view === v.key ? " ns-tabrail__tab--on" : ""}`}
              onClick={() => {
                setView(v.key);
                setPage(0);
              }}
            >
              {v.label}{" "}
              <span className={v.isAttention && v.count > 0 ? "is-attention" : "fo-muted"}>{v.count}</span>
            </button>
          ))}
        </div>

        <div className="ns-toolbar">
          <label className="ns-toolbar__search">
            <span className="ns-visually-hidden">Search the parts catalogue</span>
            {/* The placeholder names only what this filter actually matches -- part number,
                description and category are all carried on the composed row. Barcodes and aliases
                are NOT searched and are not claimed: that needs the identifier read, which is
                registered active:false and granted to nobody. */}
            <input
              type="search"
              value={catalogQuery}
              onChange={(e) => {
                setCatalogQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search part number, description, or category"
            />
          </label>
          {/* FILTER. Category was a second chip row; Frame 1a draws ONE chip row and a Filter
              control, and two rows of chips on one panel state two collections where there is
              one. The options and their counts are unchanged — only the affordance moved. */}
          <label className="fo-muted">
            Filter{" "}
            <select value={category} onChange={(e) => handleCategoryChange(e.target.value)}>
              {filterOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label} ({opt.count})
                </option>
              ))}
            </select>
          </label>
          <label className="fo-muted">
            Sort{" "}
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(0);
              }}
            >
              {Object.values(PARTS_COLLECTION_SORT).map((key) => (
                <option key={key} value={key}>
                  {PARTS_COLLECTION_SORT_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* NO SCAN BUTTON, and the reason is recorded rather than the element quietly dropped.
            ND-30 permits the Scan entry point "where the existing governed scanner/navigation
            supports it". The scanner is a Service-domain nav item gated by isNavItemVisible, which
            needs the role, the legacy-key set and the operational context -- none of which reach
            this component (useAuth exposes user/role/operationalRoles only). Rendering an ungated
            link would offer a surface the reader may not hold, which is worse than its absence.
            Threading the access context into this page is its own change. */}
      {/* INV-CONVERGENCE-E C1 -- three explicit states for the governed catalog:
          (1) canonical read in flight -> loading; (2) canonical read blocked
          (denied/unavailable/incomplete) -> a clear BLOCKED banner, never an empty
          table and never a silent static fallback; (3) READY -> the composed 200-row
          catalog. Categories/counts/search/table all read the composed rows. */}
      {canonicalLoading ? (
        <p className="fo-muted">Loading parts catalog…</p>
      ) : isCatalogBlocked(catalog.status) ? (
        <p className="fo-muted">{catalogBlockedMessage(catalog.status)}</p>
      ) : (
      <>


      <LoadingEmptyState
        loading={loading}
        failed={!!healthError}
        isEmpty={false}
        loadingText="Loading stock position..."
        failedText="Unable to load stock position right now. Try again shortly."
        emptyText=""
      >
        <>
          {/* fo-table--stack: BELOW THE PHONE BREAKPOINT EACH ROW BECOMES A LABELLED CARD.
              This table was the last migrated list still compressing its columns into ~320px, which
              is what PARTS PHONE-CARD READABILITY recorded: nothing overflowed, and nothing was
              readable either. The modifier is the same one the shared metadata grid already uses;
              `data-label` on every cell is what carries the column heading into the card, so a
              value is never orphaned from the field it belongs to. Scroll stays the right answer
              at a desk, which is why the scroll container above it is unchanged. */}
          <table className="fo-table fo-table--stack">
            <thead>
              {/* FRAME 1a's grammar, P1v2: Part · Category · Control · Status · Attention.
                  On hand is absent and stays absent -- ND-25.

                  MANUFACTURER IS NOT GONE; IT MOVED INTO THE PART CELL. As its own column it read
                  "Not recorded" on 25 of 25 rows and spent 194px doing it -- a column that is
                  governed, will populate one day, and does not earn its width today. Folded in
                  beside the description it costs nothing when absent and reads naturally when
                  present, which is what P1v2 draws. */}
              <tr>
                <th>Part</th>
                <th>Category</th>
                <th>Control</th>
                <th>Status</th>
                <th>Attention</th>
              </tr>
            </thead>
            <tbody>
              {pagedParts.map((part) => {
                const row = partsCollectionRow(part, { manufacturerNames, attentionByPartId });
                return (
                  <tr key={part.sku}>
                    {/* RECOGNITION OVER IDS. The link carries the human name; the Part Number rides
                        beneath it, which is Frame 1a’s own arrangement and keeps one identity column
                        rather than two. ND-26: a row with no canonical document has NO Part Number
                        and says so -- it never falls back to the document key. */}
                    {/* THE PART NUMBER LEADS, with the description beneath it -- Frame 1a’s own
                        arrangement. That is recognition over IDs, not a contradiction of it: after
                        ND-26 the number IS the human-facing business identity, and it is what a
                        person reads off a shelf label. The document key appears nowhere.

                        A row with no canonical document has no Part Number and says so; the
                        description then leads, because a part with a name and no number is still
                        recognisable. The key is never substituted. */}
                    <td data-label="Part">
                      <Link to={partCatalogRoute(part)}>
                        {row.partNumber ?? row.name ?? "Unnamed part"}
                      </Link>
                      {/* DESCRIPTION, THEN MANUFACTURER, THEN THE CONTROL MARKER -- Frame 1a's second
                          line. Each part of it renders ONLY when the fact is recorded: an absent
                          manufacturer contributes nothing rather than a "Not recorded" that used to
                          be repeated down a whole column. A NAME, never the manufacturer id, and
                          never another field borrowed to make the line look populated. */}
                      <div className="fo-muted" data-part-number={row.partNumber ?? ""}>
                        {row.partNumber
                          ? row.name
                          : <span className="ns-state--na">Part Number not recorded</span>}
                        {row.manufacturer ? ` · ${row.manufacturer}` : null}
                        {/* PHONE ONLY, where Category and Control have no columns to live in.
                            Frame 1a-mobile folds the category onto this second line; Control rides
                            with it rather than being dropped, because a serialized part must not
                            look like every other part on the handheld that is used in the aisle --
                            that is the one device where the distinction has operational
                            consequence. Hidden at desk widths, where both have their own columns
                            and repeating them would be the ND-32 duplication again. */}
                        <span className="ns-row__phone">
                          {row.category ? ` · ${row.category}` : null}
                          {row.control ? ` · ${row.control}` : null}
                        </span>
                        {/* AND NO INLINE "· serialized" MARKER, though Frame 1a draws one. Control
                            is still its own column on this table and already says "Serialized" for
                            exactly these rows, so the marker would state one fact twice in one row.
                            That is the concatenation ND-32 refused on the Equipment register, for
                            the same reason and in the same words: an attribute that has a column
                            does not also ride in the identity cell. Manufacturer folds in precisely
                            BECAUSE its column is gone (ruling 6/W7); Control's is not. */}
                      </div>
                    </td>
                    <td data-label="Category" className="fo-muted">
                      {row.category ?? <span className="ns-state--na">Not recorded</span>}
                    </td>
                    {/* WORDS, from the one vocabulary. A stored token never reaches the reader. */}
                    <td data-label="Control" className="fo-muted">
                      {row.control ?? <span className="ns-state--na">Not recorded</span>}
                    </td>
                    <td data-label="Status">
                      {row.status ?? <span className="ns-state--na">Not recorded</span>}
                    </td>
                    {/* ATTENTION, from the governed reorder-request projection and nothing else --
                        no risk score, no prioritisation, no invented urgency (ND-30). Its words are
                        the projection’s own sectionLabel. A part with nothing outstanding shows a
                        dash, which is a statement that the projection was consulted. */}
                    <td data-label="Attention">
                      {row.attention ? (
                        <span className={row.attention.actionRequired ? "is-attention" : "fo-muted"}>
                          {row.attention.label}
                        </span>
                      ) : (
                        // NOTHING, not a dash. Frame 1a leaves the cell empty when the projection
                        // has nothing to say, and a column of 23 dashes is noise in the one column a
                        // parts manager scans for work. The dash was defended as "a statement that
                        // the projection was consulted" -- but that statement is made once, in the
                        // header's own "N need attention", and does not need repeating on every row
                        // that is fine. `data-label` still carries the heading into the phone card.
                        null
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="disp-board-toolbar fo-parts__toolbar--end">
            <button type="button" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            {/* WHAT IS ON SCREEN, AND WHAT THERE IS -- both, because Frame 1a's footer reads "62
                parts" over an unpaged list and this list IS paged.
                Owner ruling 5 (W10): Design controls the visual grammar, not permission to remove
                operational collection scaling. The frame was drawn against a 62-row fixture; the
                production catalogue is ~1,400 parts. So pagination stays, and the count states the
                range as well as the total -- because "62 parts" alone, over 25 rows, would tell the
                reader the page IS the catalogue. */}
            {/* THE COUNT IS VISIBLE; THE EXPLANATION IS BEHIND THE (i) — Frame 1a's own footer, and
                Owner ruling B §4. The ND-25 material about why there is no quantity column was
                rendering as three permanent lines under the collection; it is not deleted, it is
                one tap away, exactly where the frame draws the control. */}
            <span className="fo-muted">
              Showing {filteredParts.length === 0 ? 0 : currentPage * PAGE_SIZE + 1}–
              {Math.min((currentPage + 1) * PAGE_SIZE, filteredParts.length)} of {filteredParts.length}{" "}
              {filteredParts.length === 1 ? "part" : "parts"}
              <PartsInfoDisclosure label="The catalogue — what this list counts, and what it does not show" align="end">
                This count is the whole catalogue, not a company-wide inventory universe: the page
                performs a whole-collection read and pages through it. No stock quantity is shown
                here — the governed balance read is single-part, so there is no list-scale quantity
                to answer from, and the static catalogue is a baseline rather than a count. Attention
                comes from the governed reorder-request projection and nothing else. Search matches
                the part number, description and category carried on each row; barcodes and aliases
                need the identifier read, which is not active in this environment.
              </PartsInfoDisclosure>
            </span>
            <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>

          {/* AND NO PARAGRAPH HERE. It lives behind the (i) beside the count, and only there.
              Owner ruling B §4: "Do NOT render that explanation permanently underneath the
              collection." It was rendered in BOTH places on 096d320b -- the disclosure was added and
              the paragraph was not removed, so the same ND-25 text stood twice on one page. That is
              the defect this removes; nothing is lost, because the (i) carries a superset of it. */}
        </>
      </LoadingEmptyState>
      </>
      )}
      </div>


    </WorkspaceShell>
  );
}
