import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { workOrderEntity, workOrderIndexList } from "../../metadata/definitions/workOrder.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import { useListCriteria } from "../../hooks/useListCriteria.js";
import { useAccountReferenceResolver } from "../../hooks/useAccountReferenceResolver.js";
import { useWorkOrderSearch } from "../../hooks/useWorkOrderSearch.js";
import { useAccountPicker } from "../../hooks/useAccountPicker";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { resolveTechnicianIdentity } from "../../domain/actorDisplayName";
import { REFERENCE_STATE } from "../../metadata/referenceResolution.js";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import {
  AddFilter, ActiveCriteria, SortControl, ListEmptyState, DroppedCriteriaNotice,
} from "../../metadata/MetadataListControls.jsx";
import {
  addFilter, removeFilter, clearFilters, setSort, makeCriterion, describeDropped, describeRefusal,
} from "../../metadata/listUrlState.js";
import { OBJECT_LIST_KEY } from "../../navigation/objectRoutes.js";
import WorkspaceShell from "../../shared/ui/WorkspaceShell.jsx";
import ActionRail from "../../shared/ui/ActionRail.jsx";
import FilterBar from "../../shared/ui/FilterBar";
import { Button } from "../../shared/ui/primitives";
import {
  WORK_ORDER_STATUS_GROUPS,
  activeStatusGroupKey,
} from "../../domain/workOrderStatusGroups.js";

// Work Orders — the list, now on the canonical metadata runtime.
//
// ══════════════════════ WHAT MOVED, AND WHAT DELIBERATELY DID NOT ══════════════════════
//
// This screen used to hold an UNFILTERED `onSnapshot` over the whole `fieldops_wos`
// collection (useWorkOrders → subscribeToWorkOrders) and do all filtering and counting in
// memory. Rows now come from a bounded, cursor-paged metadata query.
//
// `useWorkOrders` IS UNCHANGED AND STILL LIVE. Dispatch, the Dispatcher Board, Control
// Tower, Job Assignments and Scheduling all read it, and they are REALTIME OPERATIONAL
// SURFACES: a board that shows a job five seconds late is a board that sends the wrong
// technician. Replacing that subscription with paged reads would have been this package
// making a dispatch decision under cover of a list migration. Two surfaces, two contracts —
// a realtime board and a bounded list — rather than one read primitive forced to do both.
//
// ══════════════════════ THE SEARCH BOX IS A REAL QUERY NOW ══════════════════════
//
// GlobalSearch's `workOrders` provider filters an array the caller supplies. The only
// caller that could supply a complete one was the whole-collection subscription this page
// no longer holds — so leaving it would have meant a box that searched FIFTY ROWS and said
// "no results" about a Work Order that exists. LIST PAGE ≠ SEARCH CORPUS.
//
// domain/workOrderSearch.js is the replacement: a bounded Firestore prefix query on
// `woNumber`, which is machine-generated in one closed format, so a Work Order on page
// nine is still findable by its number. What it does NOT search — customer name, complaint
// text — is recorded as WORK_ORDER_TEXT_SEARCH_GAP rather than implied to work.
//
// ══════════════════════ THE STATUS CHIPS LOST THEIR COUNTS, ON PURPOSE ══════════════════
//
// They used to read "Open (34)", counted from the full in-memory array. A count over a
// bounded page is a claim about the business derived from one screenful, and it is wrong
// in the direction that looks reassuring. Accounts has a governed server-side summary for
// exactly this; Work Orders has none, so the chips filter and no longer count. A missing
// number is a smaller loss than a confident wrong one.

// A group is applied as `status IN [...]`, which Firestore serves from the same
// (status, createdAt DESC) composite an equality uses — so the chips cost no new index.
// The groups themselves live in domain/workOrderStatusGroups.js, with the lifecycle
// coverage proof: every status belongs to exactly one chip.
const GROUP_BY_KEY = new Map(WORK_ORDER_STATUS_GROUPS.map((g) => [g.key, g]));

export default function WorkOrdersList() {
  const navigate = useNavigate();

  // CRITERIA LIVE IN THE URL, keyed as `workOrders` — the same key WorkOrderDetailPage's
  // "Back to Work Orders" already reads (navigation/listStateMemory.js), so narrowing the
  // list, opening a job and coming back returns the list that was narrowed.
  const { criteria, apply } = useListCriteria(workOrderIndexList, workOrderEntity, OBJECT_LIST_KEY.WORK_ORDERS);

  // DERIVED from the criteria rather than held beside them, so the chip and the filter
  // chips cannot disagree about what is applied.
  const groupKey = activeStatusGroupKey(
    criteria.filters.find((f) => f.fieldId === "status")?.value ?? null,
  );

  const selectGroup = (key) => {
    const group = GROUP_BY_KEY.get(key);
    if (!group?.statuses) {
      apply(removeFilter(criteria, "status", "IN"));
      return;
    }
    apply(addFilter(criteria, makeCriterion({
      fieldId: "status", operator: "IN", value: group.statuses, valueLabel: group.label,
    })));
  };

  // THE FEEDBACK PASS, as on Sales Orders: the account resolver needs the ids the loaded
  // rows point at, and those rows come from the list hook — so the resolver cannot exist
  // before the call that produces them. Rows land, state updates, names resolve.
  const [resolvableRows, setResolvableRows] = useState([]);
  const { resolveReference: resolveAccount } = useAccountReferenceResolver(resolvableRows);

  // THE CUSTOMER FILTER IS A PICKER OF NAMES.
  //
  // Without this it rendered a free-text box, so "filter by Customer" meant "type a Firestore
  // document id" — which nobody knows, which made the field unusable, and which left the filter
  // menu effectively offering ONE choice. The same fix was made on the Equipment register in this
  // same package and not carried here.
  const accountPicker = useAccountPicker();
  const valueOptions = useMemo(() => ({
    customerId: (accountPicker.options ?? []).map((a) => ({ value: a.id, label: a.name })),
  }), [accountPicker.options]);

  // Technicians are bounded reference data (one small collection), so one read serves the
  // whole page rather than one per row.
  const { data: technicians, loading: techLoading, error: techError } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const resolveReference = useCallback((fieldId, id) => {
    if (fieldId !== "assignedTechId") return resolveAccount(fieldId, id);
    // Delegated to the ONE technician vocabulary rather than a `find(...)?.name ?? id`
    // written here — that fallback is exactly how a raw id reaches a screen.
    const identity = resolveTechnicianIdentity(id, { technicians, loading: techLoading, error: techError });
    if (identity.state === "loading") return { state: REFERENCE_STATE.LOADING };
    if (identity.state === "error") return { state: REFERENCE_STATE.ERROR };
    if (identity.state === "resolved") return { state: REFERENCE_STATE.FOUND, label: identity.name };
    return { state: REFERENCE_STATE.NOT_FOUND };
  }, [resolveAccount, technicians, techLoading, techError]);

  const { presentation, rows, loadMore, retry, descriptorErrors } = useMetadataList(workOrderIndexList, workOrderEntity, {
    filters: criteria.filters,
    sort: criteria.sort,
    resolveReference,
  });

  // `rows` is hook state, so its identity is stable between fetches and this cannot loop.
  useEffect(() => { setResolvableRows(rows ?? []); }, [rows]);

  const droppedMessage = useMemo(() => {
    const fromUrl = describeDropped(criteria.dropped);
    if (fromUrl) return fromUrl;
    // Dropped and refused are different outcomes: dropped leaves a list that renders and
    // is broader than asked for; refused runs no query at all.
    return describeRefusal(descriptorErrors, "work orders");
  }, [criteria, descriptorErrors]);

  // Sorting by an OPTIONAL timestamp excludes every record missing it. Said on the screen,
  // where the shorter list is, rather than only in the gap register.
  const sortedByScheduled = criteria.sort?.some?.((s) => s.fieldId === "scheduledStart");

  const [searchTerm, setSearchTerm] = useState("");
  const search = useWorkOrderSearch(searchTerm);

  const actions = (
    <ActionRail
      primary={
        <Link to="/service/work-orders/new">
          <Button variant="primary">+ New Work Order</Button>
        </Link>
      }
    />
  );

  return (
    <WorkspaceShell title="Work Orders" actions={actions}>
      <div className="fo-global-search" role="search">
        <input
          type="search"
          placeholder="Search by work order number (starts with)…"
          aria-label="Search work orders by number — matches numbers starting with what you type"
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
                {search.results.map((wo) => (
                  <button
                    key={wo.id}
                    type="button"
                    className="fo-global-search-result"
                    onClick={() => { setSearchTerm(""); navigate(`/service/work-orders/${wo.id}`); }}
                  >
                    {/* The NUMBER, never the document id. A result with no number is not
                        rendered as a key — it is the one row this box cannot name. */}
                    <span>{wo.woNumber ?? "Work order number unavailable"}</span>
                  </button>
                ))}
                {search.truncated && <div className="fo-muted fo-global-search-empty">{search.message}</div>}
              </>
            )}
          </div>
        )}
      </div>

      <FilterBar
        options={WORK_ORDER_STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label }))}
        activeKey={groupKey}
        onChange={selectGroup}
        label="Work order status groups"
      />

      {/* THE ONE SHARED FILTER AND SORT EXPERIENCE, from the Work Order metadata. */}
      <div className="fo-listctl">
        <AddFilter
          def={workOrderIndexList}
          entity={workOrderEntity}
          valueOptions={valueOptions}
          onAdd={(c) => apply(addFilter(criteria, c))}
        />
        <SortControl
          entity={workOrderEntity}
          criteria={criteria}
          onSort={(fieldId, direction) => apply(setSort(criteria, fieldId, direction))}
        />
      </div>
      <ActiveCriteria
        criteria={criteria}
        entity={workOrderEntity}
        onRemove={(fieldId, operator) => apply(removeFilter(criteria, fieldId, operator))}
        onClear={() => apply(clearFilters(criteria))}
      />

      <DroppedCriteriaNotice message={droppedMessage} />

      {sortedByScheduled && (
        <p className="fo-warning" role="status">
          Sorted by Scheduled, so this shows scheduled work only. Work orders with no scheduled
          date cannot appear in this order — sort by Created to see all of them.
        </p>
      )}

      {presentation?.state === "FILTERED" ? (
        <ListEmptyState criteria={criteria} onClear={() => apply(clearFilters(criteria))} />
      ) : (
        <MetadataListGrid
          presentation={presentation}
          caption="Work Orders"
          onRowClick={(id) => navigate(`/service/work-orders/${id}`)}
          onLoadMore={loadMore}
          onRetry={retry}
        />
      )}
    </WorkspaceShell>
  );
}
