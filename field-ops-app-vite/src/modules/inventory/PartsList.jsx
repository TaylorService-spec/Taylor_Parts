import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PARTS_CATALOG } from "../../data/partsCatalog";
import { useInventoryLedger } from "../../hooks/useInventoryLedger";
import GlobalSearch from "../../shared/search/GlobalSearch";

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
// Read-only, Phase 1 scope only: every value below comes from
// PARTS_CATALOG (static reference data, not Firestore) or
// useInventoryLedger() (the same one-shot inventory_transactions read
// + pure analytics functions Operations.jsx's Inventory Health panel
// already uses). No new Firestore query, no new computed math. The
// dedicated, filterable "needs reorder" actionable workflow is
// Sprint 2.1.2 scope, not this screen -- the category filter here is
// a plain browse/narrow filter, not that workflow.
const PAGE_SIZE = 25;

function useCategories() {
  return useMemo(() => {
    const set = new Set(PARTS_CATALOG.map((part) => part.category));
    return ["ALL", ...[...set].sort()];
  }, []);
}

export default function PartsList() {
  const { healthEntries, loading } = useInventoryLedger();
  const categories = useCategories();
  const [category, setCategory] = useState("ALL");
  const [page, setPage] = useState(0);

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

  return (
    <div className="fo-panel">
      <div className="disp-board-toolbar" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Parts</h2>
        <GlobalSearch providerKeys={["parts"]} context={{ parts: PARTS_CATALOG }} placeholder="Search parts..." />
      </div>

      <p className="fo-muted">
        {PARTS_CATALOG.length} parts in catalog. Stock position and reorder status are derived from the inventory
        ledger (same source as the Operations dashboard's Inventory Health panel) -- catalog data is a static
        baseline, not live stock, until a part has ledger activity.
      </p>

      <div className="disp-board-toolbar">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            className={category === cat ? "fo-nav-btn fo-nav-btn-active" : "fo-nav-btn"}
            onClick={() => handleCategoryChange(cat)}
          >
            {cat === "ALL" ? "All Categories" : cat}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="fo-muted">Loading stock position...</p>
      ) : (
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
      )}
    </div>
  );
}
