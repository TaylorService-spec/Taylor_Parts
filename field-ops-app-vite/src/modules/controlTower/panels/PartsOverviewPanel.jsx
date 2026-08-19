import { useMemo, useState } from "react";
import { assertPanelProps } from "../../../domain/controlTower/types";
import { snapshotPartName, snapshotPartSku } from "../../../domain/workOrderInventorySnapshot";
import { Button } from "../../../shared/ui/primitives/index.js";

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
        // Aggregate by the SAFE string sku so a malformed legacy sku (object/array) can never
        // become a Map key or reach React output. The raw recorded snapshot name is kept and
        // resolved safely at render (snapshotPartName below); the first valid recorded name
        // across Work Orders for a sku wins.
        const sku = snapshotPartSku(item);
        const existing = totals.get(sku) ?? { sku, name: item.name, qtyPlanned: 0 };
        existing.qtyPlanned += item.qtyPlanned;
        existing.name = existing.name || item.name;
        totals.set(sku, existing);
      });
    });

    return [...totals.values()].sort((a, b) => b.qtyPlanned - a.qtyPlanned);
  }, [workOrders]);

  return (
    <div className="tech-overview tech-overview--compact">
      <div className="fo-controltower-panel__header">
        <h3>🧰 Parts Overview</h3>
        <Button variant="tertiary" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "Show" : "Hide"}
        </Button>
      </div>

      {!collapsed && (
        <>
          {aggregated.length === 0 ? (
            <p className="fo-muted">No planned parts across current Work Orders.</p>
          ) : (
            aggregated.map(({ sku, name, qtyPlanned }) => (
              <div key={sku}>
                {snapshotPartName({ name, sku })} ({sku}) &times;{qtyPlanned} (Planned)
              </div>
            ))
          )}
          <div className="fo-muted">No usage tracking yet.</div>
        </>
      )}
    </div>
  );
}
