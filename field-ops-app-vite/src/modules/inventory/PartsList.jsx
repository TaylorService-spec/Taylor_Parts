import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PARTS_CATALOG } from "../../data/partsCatalog";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import { useReorderRequests } from "../../hooks/useReorderRequests";
import { createReorderRequest } from "../../domain/inventoryReorderRequests";
import GlobalSearch from "../../shared/search/GlobalSearch";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";
import InventoryHealthPanel from "../operations/panels/InventoryHealthPanel";

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
const PAGE_SIZE = 25;
const ACTIONABLE_URGENCIES = new Set(["CRITICAL", "HIGH"]);

const QUEUE_FILTER_OPTIONS = [
  { key: "ACTIONABLE", label: "Critical & High" },
  { key: "ALL", label: "Show All" },
];

function useCategories() {
  return useMemo(() => {
    const set = new Set(PARTS_CATALOG.map((part) => part.category));
    return ["ALL", ...[...set].sort()];
  }, []);
}

export default function PartsList() {
  const { healthEntries, loading } = useInventoryLedger();
  const { data: pendingRequests } = useReorderRequests();
  const categories = useCategories();
  const [category, setCategory] = useState("ALL");
  const [page, setPage] = useState(0);
  const [queueFilter, setQueueFilter] = useState("ACTIONABLE");
  const [justRequestedPartIds, setJustRequestedPartIds] = useState(() => new Set());

  const queueEntries = useMemo(() => {
    if (queueFilter === "ALL") return healthEntries;
    return healthEntries.filter((entry) => ACTIONABLE_URGENCIES.has(entry.recommendation.urgency));
  }, [healthEntries, queueFilter]);

  const requestedPartIds = useMemo(() => {
    const set = new Set(justRequestedPartIds);
    for (const request of pendingRequests) set.add(request.partId);
    return set;
  }, [pendingRequests, justRequestedPartIds]);

  async function handleRequestReorder(partId, recommendation) {
    await createReorderRequest({
      partId,
      urgency: recommendation.urgency,
      recommendedQty: Math.ceil(recommendation.recommendedOrderQty),
    });
    setJustRequestedPartIds((prev) => new Set(prev).add(partId));
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

  const filterOptions = categories.map((cat) => ({
    key: cat,
    label: cat === "ALL" ? "All Categories" : cat,
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
      <FilterBar options={QUEUE_FILTER_OPTIONS} activeKey={queueFilter} onChange={setQueueFilter} />
      <LoadingEmptyState loading={loading} isEmpty={false} loadingText="Loading operational queue..." emptyText="">
        <InventoryHealthPanel
          healthEntries={queueEntries}
          title="Needs Reorder"
          onRequestReorder={handleRequestReorder}
          requestedPartIds={requestedPartIds}
        />
      </LoadingEmptyState>

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
                      {health ? (
                        <span className={`fo-badge fo-badge-${health.recommendation.urgency.toLowerCase()}`}>
                          {health.recommendation.urgency}
                        </span>
                      ) : (
                        <span className="fo-muted">No activity yet</span>
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
