import { useMemo, useRef, useState } from "react";
import { getCatalogItem, PARTS_CATALOG } from "../../data/partsCatalog";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import { useInventoryActionsForPart } from "../../hooks/useInventoryActions";
import { requestReorderForRecommendation } from "../../domain/inventoryReorderRequests";
import { INVENTORY_ACTION_TYPE } from "../../domain/constants";
import InventoryHealthPanel from "../operations/panels/InventoryHealthPanel";
import WorkspaceHeader from "../../shared/ui/WorkspaceHeader";
import FilterBar from "../../shared/ui/FilterBar";
import LoadingEmptyState from "../../shared/ui/LoadingEmptyState";

// Issue #100 PR 2b (docs/specifications/inventory-nav-access-alignment.md,
// docs/implementation-plans/inventory-nav-access-alignment.md) -- the
// dedicated /inventory-role/warehouse surface for an ACTIVE, reciprocally
// linked WAREHOUSE_MANAGER technician. Route/nav gating (App.jsx,
// navConfig.js's operationalRoleAccess) already keeps this component from
// ever mounting for admin/dispatcher or an ineligible technician, so no
// role check is repeated here -- same convention every other role-gated
// screen in this app follows (e.g. TechnicianDashboard.jsx).
//
// Reuses, unchanged: useInventoryLedger() (PR 1a's inventory_transactions
// read), InventoryHealthPanel.jsx (Operations/PartsList's own renderer),
// RequestReorderControl.jsx (via InventoryHealthPanel's existing
// onRequestReorder prop -- already recognizes WAREHOUSE_MANAGER
// eligibility for the NEEDS_PLANNING manual-quantity path), and
// useInventoryActionsForPart(partId) (PR 2a's inventory_actions read).
//
// Inventory Health is rendered TWICE, deliberately: a read-only "Inventory
// Health" view of every entry (satisfies "Catalog and inventory-health
// visibility"), and a separate, filtered "Needs Planning" section with
// onRequestReorder wired (satisfies "RequestReorderControl reuse for the
// Needs Planning/manual-reorder path" -- and ONLY that path). This is not
// cosmetic: firestore.rules' reorder_requests create rule requires
// isAdminOrDispatcher() for the READY branch (analytics-computed,
// urgency-based) and canSubmitManualZeroHistoryQuantity() -- which
// WAREHOUSE_MANAGER satisfies -- only for the NEEDS_PLANNING branch.
// Wiring onRequestReorder across ALL entries (as PartsList.jsx's own
// "Inventory Operational Queue" does for admin/dispatcher) would render a
// "Request Reorder" button on READY/urgency rows that always fails with
// permission-denied for this role -- a real bug, not just noise, caught in
// this PR's own review pass before merge.
// Not reused: PartsList.jsx / PartDetail.jsx themselves (admin/dispatcher
// surfaces, explicitly out of scope) and useReorderRequests() -- this
// role has no reorder_requests read grant (Rules impact section of the
// Specification lists only PARTS_MANAGER/PARTS_ASSOCIATE branches), so
// "already requested" tracking below is local-session-only, same
// UX-nicety-not-enforcement posture RequestReorderControl.jsx's own
// header comment already documents for the READY/NEEDS_PLANNING split.
//
// Part Activity's "By" column is deliberately omitted: the Specification
// states useEmployeeDirectory() is not imported by any new surface, and
// every inventory_actions entry a WAREHOUSE_MANAGER can read was created
// by an admin/dispatcher (Rules: `allow create: if isAdminOrDispatcher()`)
// -- there's no directory-free way to show a real name, and a raw uid
// would violate this app's "no raw IDs in human-facing flows" convention.
function useCategories() {
  return useMemo(() => {
    const set = new Set(PARTS_CATALOG.map((part) => part.category));
    return ["ALL", ...[...set].sort()];
  }, []);
}

const PAGE_SIZE = 25;

const INVENTORY_ACTION_LABEL = {
  [INVENTORY_ACTION_TYPE.RECEIVE_STOCK]: "Stock Received (log only)",
  [INVENTORY_ACTION_TYPE.ADJUST_STOCK]: "Stock Adjustment (log only)",
  [INVENTORY_ACTION_TYPE.CORRECT_MISTAKE]: "Correction Note (log only)",
};

function PartActivityPanel({ partId, onClose }) {
  const { data: actions, loading } = useInventoryActionsForPart(partId);
  const partName = getCatalogItem(partId)?.name ?? partId;

  return (
    <div className="fo-card">
      <div className="fo-workspace-header">
        <h3 className="fo-workspace-header-title">Part Activity -- {partName}</h3>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <LoadingEmptyState
        loading={loading}
        isEmpty={actions.length === 0}
        loadingText="Loading part activity..."
        emptyText="No logged activity yet for this part."
      >
        <div className="fo-table-scroll">
          <table className="fo-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Qty</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <tr key={action.id}>
                  <td>{INVENTORY_ACTION_LABEL[action.transactionType] ?? action.transactionType}</td>
                  <td>{action.quantityDelta > 0 ? `+${action.quantityDelta}` : action.quantityDelta}</td>
                  <td className="fo-muted">{action.reason ?? "—"}</td>
                  <td className="fo-muted">{action.createdAt ? new Date(action.createdAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </LoadingEmptyState>
    </div>
  );
}

export default function WarehouseManagerHome() {
  const { healthEntries, loading, error } = useInventoryLedger();
  const categories = useCategories();
  const [category, setCategory] = useState("ALL");
  const [page, setPage] = useState(0);
  const [selectedPartId, setSelectedPartId] = useState(null);
  const [justRequestedPartIds, setJustRequestedPartIds] = useState(() => new Set());
  const [submittingPartId, setSubmittingPartId] = useState(null);
  const [reorderError, setReorderError] = useState(null);
  // Focus restoration: the triggering "View Activity" button that opened
  // the inline Part Activity panel, so closing it (button or keyboard)
  // returns focus there instead of dropping it to <body> -- same
  // trigger-restore convention this app's ConfirmDialog/Modal flows
  // already establish, applied here even though this panel isn't a modal.
  const lastTriggerRef = useRef(null);

  function handleClosePartActivity() {
    setSelectedPartId(null);
    lastTriggerRef.current?.focus();
  }

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

  const needsPlanningEntries = useMemo(
    () => healthEntries.filter((entry) => entry.recommendation.recommendationStatus === "NEEDS_PLANNING"),
    [healthEntries]
  );

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
    count: cat === "ALL" ? PARTS_CATALOG.length : PARTS_CATALOG.filter((part) => part.category === cat).length,
  }));

  return (
    <div className="fo-panel">
      <WorkspaceHeader title="Warehouse Manager" />

      <p className="fo-muted">
        Parts ranked by urgency, from the same analytics used by the Operations dashboard's Inventory Health panel.
        Read-only -- Reorder Requests for these analytics-computed recommendations are submitted by Purchasing, not
        here.
      </p>
      {error ? (
        <p className="fo-muted">Unable to load inventory health right now. Try again shortly.</p>
      ) : (
        <LoadingEmptyState loading={loading} isEmpty={false} loadingText="Loading inventory health..." emptyText="">
          <InventoryHealthPanel healthEntries={healthEntries} />
        </LoadingEmptyState>
      )}

      <p className="fo-muted">
        Parts with no usage history yet -- enter a manual reorder quantity to submit a Reorder Request.
      </p>
      {reorderError && <p className="fo-muted">{reorderError}</p>}
      {error ? (
        <p className="fo-muted">Unable to load Needs Planning right now. Try again shortly.</p>
      ) : (
        <LoadingEmptyState
          loading={loading}
          isEmpty={needsPlanningEntries.length === 0}
          loadingText="Loading Needs Planning..."
          emptyText="No parts currently need planning."
        >
          <InventoryHealthPanel
            healthEntries={needsPlanningEntries}
            title="Needs Planning"
            onRequestReorder={handleRequestReorder}
            requestedPartIds={justRequestedPartIds}
            submittingPartId={submittingPartId}
            emptyText="No parts currently need planning."
          />
        </LoadingEmptyState>
      )}

      <h3>Parts Catalog</h3>
      <p className="fo-muted">
        {PARTS_CATALOG.length} parts in catalog. Select a part to view its read-only activity log.
      </p>

      <FilterBar options={filterOptions} activeKey={category} onChange={handleCategoryChange} />

      {error ? (
        <p className="fo-muted">Unable to load stock position right now. Try again shortly.</p>
      ) : (
        <LoadingEmptyState loading={loading} isEmpty={false} loadingText="Loading stock position..." emptyText="">
          <>
            <div className="fo-table-scroll">
              <table className="fo-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>SKU</th>
                    <th>Category</th>
                    <th>Available</th>
                    <th>Risk</th>
                    <th>Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedParts.map((part) => {
                    const health = healthByPartId.get(part.sku);
                    return (
                      <tr key={part.sku}>
                        <td>{part.name}</td>
                        <td className="fo-muted">{part.sku}</td>
                        <td className="fo-muted">{part.category}</td>
                        <td>{health ? health.stock.availableStock : `${part.warehouseQty} (baseline)`}</td>
                        <td>
                          {!health ? (
                            <span className="fo-muted">No ledger activity</span>
                          ) : health.recommendation.urgency ? (
                            <span className={`fo-badge fo-badge-${health.recommendation.urgency.toLowerCase()}`}>
                              {health.recommendation.urgency}
                            </span>
                          ) : (
                            <span className="fo-badge">Needs planning</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            aria-label={`View Activity for ${part.name}`}
                            onClick={(e) => {
                              lastTriggerRef.current = e.currentTarget;
                              setSelectedPartId(part.sku);
                            }}
                          >
                            View Activity
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

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
      )}

      {selectedPartId && (
        <PartActivityPanel partId={selectedPartId} onClose={handleClosePartActivity} />
      )}
    </div>
  );
}
