// OD-3 -- RENDER gate for the three Operations dashboard panels' canonical name resolution
// (vitest + jsdom). Each panel is now a pure presentational component that receives a
// `resolveName(partId)` from Operations (one shared canonical read -- never an independent
// read per panel). These tests prove each panel renders the resolved name and, when
// resolveName degrades (fail-closed), the raw partId -- never the static-catalog name.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import ProcurementPanel from "../src/modules/operations/panels/ProcurementPanel.jsx";
import ExecutionInsightsPanel from "../src/modules/operations/panels/ExecutionInsightsPanel.jsx";

afterEach(() => cleanup());

// resolveName variants: canonical (maps the known partId to a canonical name) vs fail-closed
// (returns the raw partId, exactly what the hook yields under any BLOCKED canonical read).
const canonical = (id) => (id === "TST-9001" ? "CANONICAL-NAME-A" : id);
const failClosed = (id) => id;

describe("Operations panels (OD-3) -- resolveName-based canonical name resolution", () => {
  it("ProcurementPanel: canonical name when resolved; raw partId when fail-closed", () => {
    const procurementDrafts = [{ partId: "TST-9001", recommendedQuantity: 3, urgency: "HIGH", suggestedSupplierId: null, estimatedUnitPrice: null, estimatedTotalCost: null }];
    const { rerender } = render(<ProcurementPanel purchaseOrders={[]} suppliers={[]} procurementDrafts={procurementDrafts} resolveName={canonical} />);
    expect(screen.getByText("CANONICAL-NAME-A")).toBeTruthy();
    rerender(<ProcurementPanel purchaseOrders={[]} suppliers={[]} procurementDrafts={procurementDrafts} resolveName={failClosed} />);
    expect(screen.getByText("TST-9001")).toBeTruthy();
  });

  it("ExecutionInsightsPanel: canonical name when resolved; raw partId when fail-closed", () => {
    const consumptionSnapshot = { parts: [{ partId: "TST-9001", totalQuantityUsed: 2, frequency: 1 }] };
    const props = { technicianVolume: [], technicianName: (id) => id };
    const { rerender } = render(<ExecutionInsightsPanel {...props} consumptionSnapshot={consumptionSnapshot} resolveName={canonical} />);
    expect(screen.getByText("CANONICAL-NAME-A")).toBeTruthy();
    rerender(<ExecutionInsightsPanel {...props} consumptionSnapshot={consumptionSnapshot} resolveName={failClosed} />);
    expect(screen.getByText("TST-9001")).toBeTruthy();
  });
});
