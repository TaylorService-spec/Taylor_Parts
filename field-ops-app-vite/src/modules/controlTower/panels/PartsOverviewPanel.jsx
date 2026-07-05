import { useMemo, useState } from "react";
import { assertPanelProps } from "../../../domain/controlTower/types";
import { getCatalogItem } from "../../../data/partsCatalog";

// Epic 1.1 Inventory Visual Layer -- read-only, collapsible rollup of
// planned parts demand across every currently-loaded Work Order's
// inventorySnapshot (workOrder.inventorySnapshot -- optional,
// non-authoritative, see docs/architecture/ADR-002-work-order-engine.md
// and the Inventory Visual Layer design spec). Same panel convention as
// AtRiskPanel/DispatchQueuePanel/OverloadedTechPanel: takes only
// { jobs, technicians, workOrders } and never fetches Firestore or
// mutates anything -- jobs/technicians are unused here but kept for
// prop-shape consistency, per ControlTower.jsx's documented invariant
// (every panel receives exactly this shape).
//
// This is NOT an inventory system: no stock validation, no "add to
// inventory" actions, no backend writes. Purely a display aggregate.
export default function PartsOverviewPanel({ jobs, technicians, workOrders }) {
  if (import.meta.env.DEV) assertPanelProps({ jobs, technicians, workOrders });

  const [collapsed, setCollapsed] = useState(false);

  const aggregated = useMemo(() => {
    const totals = new Map();

    workOrders.forEach((wo) => {
      (wo.inventorySnapshot ?? []).forEach((item) => {
        if (!item.qtyPlanned) return;
        const existing = totals.get(item.sku) ?? { sku: item.sku, name: item.name, qtyPlanned: 0 };
        existing.qtyPlanned += item.qtyPlanned;
        existing.name = existing.name || item.name;
        totals.set(item.sku, existing);
      });
    });

    return [...totals.values()].sort((a, b) => b.qtyPlanned - a.qtyPlanned);
  }, [workOrders]);

  return (
    <div className="tech-overview tech-overview--compact">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>🧰 Parts Overview</h3>
        <button type="button" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      {!collapsed && (
        <>
          {aggregated.length === 0 ? (
            <p className="fo-muted">No planned parts across current Work Orders.</p>
          ) : (
            aggregated.map(({ sku, name, qtyPlanned }) => (
              <div key={sku}>
                {name || getCatalogItem(sku)?.name || sku} ({sku}) &times;{qtyPlanned} (Planned)
              </div>
            ))
          )}
          <div className="fo-muted">No usage tracking yet.</div>
        </>
      )}
    </div>
  );
}
