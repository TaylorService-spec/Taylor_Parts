import { useEffect, useMemo, useRef, useState } from "react";
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
import { hasUsageHistory } from "../../domain/inventoryAnalyticsEngine";
import { formatTimestamp, formatAge } from "../../domain/displayTimestamp.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { inventoryUrgencyTone } from "../../domain/inventoryUrgencyTone.js";
import PartWriteModal from "../../shared/partMaster/PartWriteModal.jsx";

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
  const { healthEntries, loading } = useInventoryLedger();

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
  useEffect(() => {
    const token = ++tokenRef.current;
    let cancelled = false;
    setStored({ key: currentKey, read: null });
    fetchPartMasterList().then((result) => {
      if (cancelled || token !== tokenRef.current) return;
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
  // Concise, single-sentence summary for the role="status" live region
  // below -- deliberately NOT the whole table's content. Covers all four
  // states (loading/error/empty/populated), matching LoadingEmptyState's
  // own visible-text states one-to-one without duplicating its logic.
  const allAssignedWorkStatusMessage = allAssignedWorkError
    ? `Unable to load All Assigned Work (${allAssignedWorkError}).`
    : allAssignedWorkLoading
      ? "Loading All Assigned Work..."
      : allAssignedWork.length === 0
        ? "No requests are currently assigned to anyone."
        : `All Assigned Work: ${allAssignedWork.length} request${allAssignedWork.length === 1 ? "" : "s"} loaded.`;

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
  const [page, setPage] = useState(0);
  const [queueFilter, setQueueFilter] = useState("ACTIONABLE");
  // Wave 6 -- master-data-in-Parts. `writeDeps` lets tests/preview inject a mocked
  // client without touching partMasterCommandClient/firebase (same seam PartMasterList
  // and PartWriteModal already use).
  const [newPartOpen, setNewPartOpen] = useState(false);
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
      const partName = resolveName(partId);
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
    if (category === "ALL") return catalogRows;
    return catalogRows.filter((part) => part.category === category);
  }, [category, catalogRows]);

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

  return (
    <WorkspaceShell
      title="Parts"
      actions={
        <ActionRail
          start={<GlobalSearch providerKeys={["parts"]} context={{ parts: catalogRows }} placeholder="Search parts..." />}
          primary={
            <button type="button" className="fo-btn-primary" onClick={() => setNewPartOpen(true)}>
              New Part
            </button>
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
            setCatalogRefreshToken((t) => t + 1);
          }}
        />
      )}
      {/* Wave 6 -- Parts UX redesign (parts-ux-redesign-blueprint.md). Groups the page's
          existing sections under WORK / PARTS / FLOW headings, per Decision #43's own plan
          to converge the Parts workspace around what a user needs to DO, look UP, or track
          through the LIFECYCLE, rather than the order features shipped historically. This is
          presentation-only: every section below keeps its exact existing heading, data
          source, hook, and link -- nothing is removed, hidden, or deduplicated in this slice
          (deduplicating the role-Home surfaces' near-identical queues is a separate,
          bounded follow-up, not bundled into this reorganization). */}
      <h2 id="parts-group-work">Work</h2>
      <p className="fo-muted">What needs action, what's assigned to you, and what your team is handling.</p>

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
          resolveName={resolveName}
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
                    {resolveName(request.partId)}
                  </Link>
                </td>
                <td>{getDisplayQty(request)}</td>
                <td>
                  {request.urgency ? (
                    <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={request.urgency} />
                  ) : (
                    <StatusPill tone="unknown" label="Needs planning" />
                  )}
                </td>
                <td className="fo-muted">
                  {formatTimestamp(request.reviewedAt, { unknown: "—" })}
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
                    {resolveName(request.partId)}
                  </Link>
                </td>
                <td>{getDisplayQty(request)}</td>
                <td>
                  {request.urgency ? (
                    <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={request.urgency} />
                  ) : (
                    <StatusPill tone="unknown" label="Needs planning" />
                  )}
                </td>
                <td className="fo-muted">
                  {formatTimestamp(request.assignedAt, { unknown: "—" })}
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
                    {resolveName(request.partId)}
                  </Link>
                </td>
                <td>{getDisplayQty(request)}</td>
                <td>
                  {request.urgency ? (
                    <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={request.urgency} />
                  ) : (
                    <StatusPill tone="unknown" label="Needs planning" />
                  )}
                </td>
                <td className="fo-muted">
                  {formatTimestamp(request.purchasingStartedAt, { unknown: "—" })}
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
      {/* Final Review correction: a role="status" region must announce a SHORT
          state summary, not wrap the entire interactive table -- wrapping the
          table would make a screen reader read out the whole populated table
          on every re-render, not just the transition itself. This paragraph is
          the ONLY thing inside the live region; the table below sits in normal
          document flow, outside it, and is navigated into deliberately by a
          screen reader user rather than announced wholesale. Present in the DOM
          unconditionally (not conditionally rendered away) so a screen reader
          picks up the region before the first transition, not only after.
          role="status" (implicit aria-live="polite") matches this codebase's
          existing announcement convention (see EmployeeAssignmentPicker.jsx's
          status/warning regions) rather than introducing a raw aria-live
          attribute nowhere else uses. */}
      <p role="status" className="fo-sr-only">{allAssignedWorkStatusMessage}</p>
      {allAssignedWorkError ? (
        <p className="fo-muted">Unable to load All Assigned Work ({allAssignedWorkError}).</p>
      ) : (
        <LoadingEmptyState
          loading={allAssignedWorkLoading}
          isEmpty={allAssignedWork.length === 0}
          loadingText="Loading All Assigned Work..."
          emptyText="No requests are currently assigned to anyone."
        >
          {/* Responsive behavior (Specification's "Responsive behavior" section):
              this table gains an Assignee column beyond the page's other,
              narrower tables -- wrapped in its own horizontally-scrollable
              container on narrow viewports, matching the shared .fo-panel
              overflow-x:auto pattern already established for this whole page,
              but scoped to just this table so scrolling it doesn't drag the
              rest of the page's other tables sideways with it. */}
          <div className="fo-table-scroll">
              <table className="fo-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Qty</th>
                    <th>Urgency</th>
                    <th>Status</th>
                    <th>Assignee</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {allAssignedWork.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <Link to={`/inventory/${request.partId}?requestId=${request.id}`}>
                          {resolveName(request.partId)}
                        </Link>
                      </td>
                      <td>{getDisplayQty(request)}</td>
                      <td>
                        {request.urgency ? (
                          <StatusPill tone={inventoryUrgencyTone(request.urgency)} label={request.urgency} />
                        ) : (
                          <StatusPill tone="unknown" label="Needs planning" />
                        )}
                      </td>
                      <td className="fo-muted">
                        {request.status === REORDER_REQUEST_STATUS.PURCHASING_IN_PROGRESS ? "In Progress" : "Waiting"}
                      </td>
                      <td className="fo-muted">
                        {resolveAssigneeDisplay(
                          request.assignedToUserId,
                          employeeDirectory,
                          employeeDirectoryLoading,
                          employeeDirectoryError
                        )}
                      </td>
                      <td className="fo-muted">{formatAssignmentAge(request.assignedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </LoadingEmptyState>
      )}

      <h2 id="parts-group-parts">Parts</h2>
      <p className="fo-muted">Look up a part -- identity, category, stock, and reorder risk.</p>

      <h3>Parts Catalog</h3>
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
      <p className="fo-muted">
        {catalogRows.length} parts in catalog. Stock position and reorder status are derived from the inventory
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
                      <Link to={partCatalogRoute(part)}>{part.name}</Link>
                    </td>
                    <td className="fo-muted">{part.sku}</td>
                    <td className="fo-muted">{part.category}</td>
                    <td>{health ? health.stock.availableStock : `${part.warehouseQty} (baseline)`}</td>
                    <td>
                      {!health ? (
                        <span className="fo-muted">No ledger activity</span>
                      ) : hasUsageHistory(health.usage) ? (
                        <StatusPill tone={inventoryUrgencyTone(health.recommendation.urgency)} label={health.recommendation.urgency} />
                      ) : (
                        <StatusPill tone="unknown" label="Needs planning" />
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
      </>
      )}

      <h2 id="parts-group-flow">Flow</h2>
      <p className="fo-muted">Where reorder requests have already landed in the lifecycle.</p>

      <h3>History ({historyData.length})</h3>
      <p className="fo-muted">Cancelled, Voided, Received, and Rejected Reorder Requests, newest first.</p>

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

          <div className="disp-board-toolbar" style={{ justifyContent: "center" }}>
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
    </WorkspaceShell>
  );
}
