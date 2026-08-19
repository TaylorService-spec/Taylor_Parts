// M15 -- the reconciliation guard in domain/warehouseReconciliationEngine.ts fires on
// EVERY live call today (bin stock always carries warehouseId; no ledger write anywhere
// sets it -- see functions/src/types/inventoryTransaction.ts). Pre-fix, that guard
// returned a bare `[]`, and WarehousePanel.jsx rendered totalDiscrepancies === 0 as "No
// discrepancies between physical stock and ledger-derived expectation" -- a clean bill of
// health for a check that structurally never ran. These tests prove the panel now renders
// CANNOT_EVALUATE and a genuinely-clean EVALUATED result as two DIFFERENT messages. They
// fail against the pre-fix WarehousePanel, which only ever branched on
// `reconciliationReport.totalDiscrepancies === 0` and had no CANNOT_EVALUATE branch at all.
//
// Also covers M-OPS-1: InventoryHealthPanel's omittedBinStockCount disclosure -- a part
// with recorded bin stock but zero ledger history is silently absent from healthEntries
// (computeAvailableStockByPart iterates transactions only), so the panel must say how many
// were left out instead of presenting the table as a complete inventory picture.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import WarehousePanel from "../src/modules/operations/panels/WarehousePanel.jsx";
import InventoryHealthPanel from "../src/modules/operations/panels/InventoryHealthPanel.jsx";
import { detectStockDiscrepancies, generateReconciliationReport } from "../src/domain/warehouseReconciliationEngine.ts";

afterEach(() => cleanup());

const WAREHOUSES = [{ id: "WH-1", name: "Main Warehouse" }];
const resolveName = (id) => id;

function renderWarehousePanel(reconciliationReport) {
  return render(
    <WarehousePanel
      warehouses={WAREHOUSES}
      stockLocations={[]}
      transferOrderDocs={[]}
      reconciliationReport={reconciliationReport}
      resolveName={resolveName}
    />,
  );
}

describe("WarehousePanel -- M15 CANNOT_EVALUATE vs genuinely-clean rendering", () => {
  it("CANNOT_EVALUATE renders an operator-facing 'could not run' message, never the clean-result message", () => {
    // This is exactly what live Operations.jsx produces today: bin stock carries
    // warehouseId, the ledger carries none.
    const detection = detectStockDiscrepancies({
      warehouseStock: [{ id: "S1", warehouseId: "WH-1", partId: "PART-1", quantity: 10, binCode: "A1" }],
      ledgerConsumption: [{ partId: "PART-1", quantity: 3 }],
    });
    const report = generateReconciliationReport(detection);
    expect(report.status).toBe("CANNOT_EVALUATE");

    renderWarehousePanel(report);
    expect(screen.queryByText(/No discrepancies between physical stock/i)).toBeNull();
    expect(screen.getByText(/Reconciliation cannot run/i)).toBeTruthy();
    expect(screen.getByText(/isn.t a clean result|is not a clean result/i)).toBeTruthy();
  });

  it("a genuinely-clean EVALUATED result renders the original clean-result message, not the cannot-run message", () => {
    const detection = detectStockDiscrepancies({ warehouseStock: [], ledgerConsumption: [] });
    const report = generateReconciliationReport(detection);
    expect(report.status).toBe("EVALUATED");

    renderWarehousePanel(report);
    expect(screen.getByText("No discrepancies between physical stock and ledger-derived expectation.")).toBeTruthy();
    expect(screen.queryByText(/Reconciliation cannot run/i)).toBeNull();
  });

  it("a report with no status field at all (legacy caller/mock) still renders the clean-result branch, not a crash", () => {
    // Guards backward compatibility with existing mocks in other suites that stub
    // generateReconciliationReport as `() => ({ totalDiscrepancies: 0 })`.
    renderWarehousePanel({ totalDiscrepancies: 0 });
    expect(screen.getByText("No discrepancies between physical stock and ledger-derived expectation.")).toBeTruthy();
  });

  it("CANNOT_EVALUATE message uses role=status so it's announced, matching the panel's other disclosures", () => {
    const report = generateReconciliationReport(
      detectStockDiscrepancies({
        warehouseStock: [{ id: "S1", warehouseId: "WH-1", partId: "PART-1", quantity: 10, binCode: "A1" }],
        ledgerConsumption: [{ partId: "PART-1", quantity: 3 }],
      }),
    );
    renderWarehousePanel(report);
    expect(screen.getByText(/Reconciliation cannot run/i).closest("[role='status']")).toBeTruthy();
  });
});

const healthEntry = (partId) => ({
  partId,
  stock: { availableStock: 5 },
  usage: { avgDailyUsage: 1.5, totalConsumed: 3 },
  recommendation: { urgency: "HIGH", daysRemaining: 3.3, recommendedOrderQty: 10, recommendationStatus: "READY" },
});

describe("InventoryHealthPanel -- M-OPS-1 omitted-parts disclosure", () => {
  it("discloses the count of parts with bin stock but no ledger history, singular wording for 1", () => {
    render(<InventoryHealthPanel healthEntries={[healthEntry("PART-1")]} omittedBinStockCount={1} />);
    expect(screen.getByText(/1 part with recorded bin stock but no ledger transaction history is not shown/i)).toBeTruthy();
  });

  it("discloses the count with plural wording for more than 1", () => {
    render(<InventoryHealthPanel healthEntries={[healthEntry("PART-1")]} omittedBinStockCount={3} />);
    expect(screen.getByText(/3 parts with recorded bin stock but no ledger transaction history are not shown/i)).toBeTruthy();
  });

  it("shows no disclosure at all when nothing was omitted (0)", () => {
    render(<InventoryHealthPanel healthEntries={[healthEntry("PART-1")]} omittedBinStockCount={0} />);
    expect(screen.queryByText(/not shown below/i)).toBeNull();
  });

  it("shows no disclosure when the prop is omitted entirely (legacy/other callers unaffected)", () => {
    render(<InventoryHealthPanel healthEntries={[healthEntry("PART-1")]} />);
    expect(screen.queryByText(/not shown below/i)).toBeNull();
  });

  it("disclosure still renders even when healthEntries itself is empty (all parts were omitted)", () => {
    render(<InventoryHealthPanel healthEntries={[]} omittedBinStockCount={2} />);
    expect(screen.getByText(/2 parts with recorded bin stock but no ledger transaction history are not shown/i)).toBeTruthy();
    expect(screen.getByText("No ledger activity yet -- nothing to forecast.")).toBeTruthy();
  });
});
