// BIN-P2R -- the retired `stock_locations` operator surface, and the false-clean it must never
// become.
//
// ============================ WHAT THIS REPLACES ============================
//
// This file supersedes reconciliationHonestyM15.test.jsx. M15 proved that WarehousePanel rendered
// CANNOT_EVALUATE and a genuinely-clean EVALUATED result as two DIFFERENT messages, because the
// reconciliation guard fired on every live call and a bare `[]` had been rendering as a clean bill
// of health for a check that structurally never ran.
//
// BIN-P2R removes the thing being reconciled. `stock_locations` is retired (Decision #160 /
// ADR-014): nothing ever wrote it, it disagreed with the ledger in both directions wherever it was
// seeded, and BIN-P2 removed every backend reader. The panel's bin-stock table and Reconciliation
// section were its last operator-facing consumers.
//
// ============================ WHY DELETED, NOT EMPTIED ============================
//
// The tempting shortcut was to keep the component and pass `warehouseStock: []`. That would have
// been WORSE than the defect M15 fixed: the M15 scope guard only fires when bin stock is PRESENT,
// so an empty array flips the panel from an honest "the check did not run" to "No discrepancies" --
// a clean result asserted about a comparison nobody performed.
//
// So the tests below are inverted. They no longer prove the panel distinguishes two reconciliation
// messages; they prove it renders NEITHER, and that no code path can resurrect the clean one.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// vitest transforms this module, so import.meta.url is not a file: URL here. Resolve from the
// package root instead -- vitest runs with field-ops-app-vite as cwd.
const src = (rel) => readFileSync(resolve(process.cwd(), rel), "utf8");
import WarehousePanel from "../src/modules/operations/panels/WarehousePanel.jsx";
import InventoryHealthPanel from "../src/modules/operations/panels/InventoryHealthPanel.jsx";

afterEach(() => cleanup());

const WAREHOUSES = [{ id: "WH-1", name: "Main Warehouse" }];

describe("WarehousePanel -- the stock_locations surface is gone, not emptied", () => {
  it("renders NO reconciliation verdict of any kind -- neither the clean one nor the cannot-run one", () => {
    render(<WarehousePanel warehouses={WAREHOUSES} transferOrderDocs={[]} />);
    expect(screen.queryByText(/No discrepancies/i)).toBeNull();
    expect(screen.queryByText(/Reconciliation cannot run/i)).toBeNull();
    expect(screen.queryByText(/discrepanc/i)).toBeNull();
  });

  it("renders no bin-level stock table", () => {
    render(<WarehousePanel warehouses={WAREHOUSES} transferOrderDocs={[]} />);
    expect(screen.queryByText(/bin-level stock/i)).toBeNull();
    expect(screen.queryByText(/^Reconciliation$/)).toBeNull();
  });

  it("still renders the CURRENT governed Transfer Orders view -- only the retired surface was removed", () => {
    render(<WarehousePanel warehouses={WAREHOUSES} transferOrderDocs={[]} />);
    expect(screen.getByText("Transfer Orders")).toBeTruthy();
  });

  it("cannot be handed stock or a reconciliation report -- the props no longer exist", () => {
    // The false-clean is unreachable BY SHAPE, not by discipline: a caller passing the old props
    // gets them ignored, because the component reads neither.
    render(
      <WarehousePanel
        warehouses={WAREHOUSES}
        transferOrderDocs={[]}
        stockLocations={[{ id: "s1", warehouseId: "WH-1", partId: "P-1", binCode: "A1", quantity: 5 }]}
        reconciliationReport={{ status: "EVALUATED", totalDiscrepancies: 0, discrepancies: [] }}
      />,
    );
    expect(screen.queryByText(/No discrepancies/i)).toBeNull();
    expect(screen.queryByText("P-1")).toBeNull();
  });

  it("the source imports no reconciliation engine and no stock_locations reader", () => {
    const source = src("src/modules/operations/panels/WarehousePanel.jsx");
    expect(source).not.toMatch(/warehouseReconciliationEngine/);
    expect(source).not.toMatch(/stockLocations/);
    expect(source).not.toMatch(/reconciliationReport/);
  });
});

describe("InventoryHealthPanel -- the bin-stock omission disclosure is gone with its source", () => {
  const healthEntry = (partId) => ({
    partId,
    stock: { availableStock: 5 },
    usage: { totalConsumed: 0, avgDailyUsage: 0, windowDays: 30 },
    recommendation: { urgency: "LOW", daysRemaining: 30, recommendedOrderQty: 0 },
  });

  it("makes no claim about parts omitted for having bin stock without ledger history", () => {
    // That disclosure counted parts present in stock_locations but absent from the ledger. With
    // stock_locations retired there is no such set to count, and asserting one would be fiction.
    render(<InventoryHealthPanel healthEntries={[healthEntry("PART-1")]} />);
    expect(screen.queryByText(/recorded bin stock/i)).toBeNull();
  });

  it("ignores a stale omittedBinStockCount prop rather than rendering it", () => {
    render(<InventoryHealthPanel healthEntries={[healthEntry("PART-1")]} omittedBinStockCount={3} />);
    expect(screen.queryByText(/recorded bin stock/i)).toBeNull();
  });
});

describe("the client cannot reach stock_locations at all", () => {
  it("operationsQueries exposes no stock_locations reader", () => {
    const source = src("src/services/operationsQueries.ts");
    expect(source).not.toMatch(/stock_locations/);
    expect(source).not.toMatch(/fetchStockLocations/);
  });

  it("Operations composes nothing from stock_locations", () => {
    const source = src("src/modules/operations/Operations.jsx");
    expect(source).not.toMatch(/fetchStockLocations/);
    expect(source).not.toMatch(/stockLocations/);
    expect(source).not.toMatch(/detectStockDiscrepancies/);
    expect(source).not.toMatch(/reconciliationReport/);
  });

  it("Firestore Rules grant no read on stock_locations, in EITHER governed copy", () => {
    for (const rel of ["../firestore.rules", "firestore.rules"]) {
      const rules = src(rel);
      // Absent means deny-all -- the same posture bins / bin_code_claims / bin_placements use.
      expect(rules).not.toMatch(/match \/stock_locations\//);
      // And the neighbours this narrowing must not have touched:
      expect(rules).toMatch(/match \/warehouses\//);
      expect(rules).toMatch(/match \/transfer_orders\//);
    }
  });
});
