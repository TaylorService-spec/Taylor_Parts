import { useMemo, useState } from "react";
import { useWorkOrders } from "../../hooks/useWorkOrders";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { TECHNICIANS_COLLECTION } from "../../domain/constants";
import { useAuth } from "../../auth/AuthContext";
import QueueKPIBar from "./kpis/QueueKPIBar";
import SavedViews from "./filters/SavedViews";
import QuickFilters from "./filters/QuickFilters";
import SearchBox from "./filters/SearchBox";
import WorkOrderQueue from "./queue/WorkOrderQueue";
import WorkOrderPreview from "./preview/WorkOrderPreview";
import { SAVED_VIEWS, QUICK_FILTERS, EMPTY_STATE_MESSAGES, DEFAULT_EMPTY_STATE_MESSAGE } from "./filters/viewsConfig";
import { matchesSearch } from "./filters/searchConfig";

// Epic 2 Phase 2A -- Dispatcher Operations Workspace. Read-only: no
// scheduling/dispatch/technician-workflow actions live here (that's
// Phase 2B+, gated the same way as everywhere else in Epic 2 -- see
// docs/epics/EPIC-2.md). This component is the ONLY place in this
// workspace that opens Firestore listeners -- exactly two:
// useWorkOrders() (all Work Orders) and useFirestoreCollection
// (technicians, for name resolution) -- every child widget receives
// data as props, matching Control Tower's existing "one listener
// owner, every child just renders" convention.
//
// Saved Views + Quick Filters + Search all apply client-side, over
// this single Work Order subscription -- not as separate Firestore
// queries per view/filter, satisfying "no duplicate Firestore
// listeners" for what would otherwise be 7+7 possible query
// combinations.
export default function DispatcherWorkspace() {
  const { data: workOrders, loading } = useWorkOrders();
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);
  const { technicianId } = useAuth();

  const [savedViewKey, setSavedViewKey] = useState("all");
  const [quickFilterKey, setQuickFilterKey] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const filterCtx = useMemo(() => ({ technicianId, technicians }), [technicianId, technicians]);

  const filtered = useMemo(() => {
    const savedView = SAVED_VIEWS.find((v) => v.key === savedViewKey) ?? SAVED_VIEWS[0];
    const quickFilter = QUICK_FILTERS.find((f) => f.key === quickFilterKey) ?? QUICK_FILTERS[0];

    return workOrders.filter(
      (wo) => savedView.filter(wo, filterCtx) && quickFilter.filter(wo, filterCtx) && matchesSearch(wo, searchQuery, filterCtx)
    );
  }, [workOrders, savedViewKey, quickFilterKey, searchQuery, filterCtx]);

  const emptyMessage =
    (quickFilterKey !== "all" && EMPTY_STATE_MESSAGES[quickFilterKey]) ||
    (savedViewKey !== "all" && EMPTY_STATE_MESSAGES[savedViewKey]) ||
    EMPTY_STATE_MESSAGES.all ||
    DEFAULT_EMPTY_STATE_MESSAGE;

  const selectedWorkOrder = filtered.find((wo) => wo.id === selectedId) ?? null;

  return (
    <div className="fo-panel fo-dispatcher-workspace">
      <h2>Dispatcher Workspace</h2>

      <QueueKPIBar workOrders={workOrders} />

      <SavedViews activeKey={savedViewKey} onSelect={setSavedViewKey} />
      <div className="fo-workspace-toolbar">
        <QuickFilters activeKey={quickFilterKey} onSelect={setQuickFilterKey} />
        <SearchBox onDebouncedChange={setSearchQuery} />
      </div>

      <div className="fo-workspace-body">
        <div className="fo-workspace-queue">
          <WorkOrderQueue
            workOrders={filtered}
            loading={loading}
            technicians={technicians}
            selectedId={selectedId}
            onSelect={setSelectedId}
            emptyMessage={emptyMessage}
          />
        </div>
        <div className="fo-workspace-preview">
          <WorkOrderPreview workOrder={selectedWorkOrder} technicians={technicians} />
        </div>
      </div>
    </div>
  );
}
