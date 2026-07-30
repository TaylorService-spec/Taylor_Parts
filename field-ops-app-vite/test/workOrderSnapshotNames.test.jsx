// OD-3 -- RENDER gate for the Work Order snapshot-name cohort (vitest + jsdom): WorkOrderDetail,
// PartsOverviewPanel, ExecutionCapture, TechnicianWorkOrderCard. Proves each displays the
// AUTHORITATIVE recorded snapshot name, degrades to the raw SKU when the snapshot name is
// missing, performs NO catalog lookup (getCatalogItem is mocked to a sentinel that must never
// appear), and -- for WorkOrderDetail -- uses snapshot category/unit or the neutral fallback.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// If any component still consulted the static catalog, this sentinel would surface. It must not.
vi.mock("../src/data/partsCatalog", () => ({
  PARTS_CATALOG: [],
  getCatalogItem: () => ({ name: "STATIC-LEAK-NAME", category: "STATIC-LEAK-CAT", unit: "STATIC-LEAK-UNIT" }),
}));
// ExecutionCapture action seam.
vi.mock("../src/services/workOrderService", () => ({ updateWorkOrderExecutionData: vi.fn() }));
// PartsOverviewPanel DEV prop assertion.
vi.mock("../src/domain/controlTower/types", () => ({ assertPanelProps: () => {} }));
// WorkOrderDetail heavy non-inventory deps.
vi.mock("../src/domain/workOrderScoring", () => ({ computeWorkOrderSignalFromDoc: () => ({ metadata: { state: "OPEN", isCancelled: false, reasons: [] } }) }));
vi.mock("../src/domain/timelineBuilder", () => ({ buildTimeline: () => [] }));
vi.mock("../src/domain/eventModel", () => ({ describeEvent: () => "" }));
vi.mock("../src/domain/eventTypes", () => ({ EVENT_ICON: {} }));
vi.mock("../src/modules/controlTower/WorkOrderActions", () => ({ default: () => null }));

import WorkOrderDetail from "../src/modules/controlTower/WorkOrderDetail.jsx";
import PartsOverviewPanel from "../src/modules/controlTower/panels/PartsOverviewPanel.jsx";
import ExecutionCapture from "../src/modules/technicianDashboard/ExecutionCapture.jsx";
import TechnicianWorkOrderCard from "../src/modules/technicianDashboard/TechnicianWorkOrderCard.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const noStaticLeak = () => {
  expect(document.body.textContent.includes("STATIC-LEAK-NAME")).toBe(false);
  expect(document.body.textContent.includes("STATIC-LEAK-CAT")).toBe(false);
  expect(document.body.textContent.includes("STATIC-LEAK-UNIT")).toBe(false);
};

describe("Work Order snapshot-name cohort (OD-3)", () => {
  it("TechnicianWorkOrderCard: recorded snapshot name; name-less item -> SKU; no static leak", () => {
    const workOrder = {
      id: "wo1", woNumber: "WO-1", status: "OPEN", priority: "HIGH",
      inventorySnapshot: [{ sku: "TST-9001", name: "RECORDED-A", qtyPlanned: 2 }, { sku: "TST-9002", qtyPlanned: 1 }],
    };
    render(<TechnicianWorkOrderCard workOrder={workOrder} isSelected={false} onSelect={() => {}} />);
    expect(screen.getByText(/RECORDED-A/)).toBeTruthy();
    expect(screen.getByText(/TST-9002/)).toBeTruthy();      // name-less -> SKU
    noStaticLeak();
  });

  it("ExecutionCapture: recorded snapshot name; name-less item -> SKU; qty action controls preserved; no static leak", () => {
    const workOrder = {
      id: "wo1", inventorySnapshot: [{ sku: "TST-9001", name: "RECORDED-A", qtyPlanned: 3, qtyUsed: 1 }, { sku: "TST-9002", qtyPlanned: 2 }], executionLog: [],
    };
    render(<ExecutionCapture workOrder={workOrder} />);
    expect(screen.getByText(/RECORDED-A/)).toBeTruthy();
    expect(screen.getByText(/TST-9002/)).toBeTruthy();
    // action controls preserved: +/- increment buttons render for the planned parts
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    noStaticLeak();
  });

  it("PartsOverviewPanel: aggregated recorded names; name-less -> SKU; no static leak", () => {
    const workOrders = [
      { inventorySnapshot: [{ sku: "TST-9001", name: "RECORDED-A", qtyPlanned: 2 }, { sku: "TST-9002", qtyPlanned: 1 }] },
    ];
    render(<PartsOverviewPanel jobs={[]} technicians={[]} workOrders={workOrders} />);
    expect(screen.getByText(/RECORDED-A/)).toBeTruthy();
    expect(screen.getByText(/TST-9002/)).toBeTruthy();
    noStaticLeak();
  });

  it("WorkOrderDetail: planned uses snapshot name/category/unit or neutral fallback; used uses snapshot name; no static leak", () => {
    const workOrder = {
      id: "wo1", woNumber: "WO-1", status: "OPEN", priority: "HIGH", createdAt: 1, events: [],
      inventorySnapshot: [
        { sku: "TST-9001", name: "RECORDED-A", category: "Valves", unit: "each", qtyPlanned: 2, qtyUsed: 1 },
        { sku: "TST-9002", qtyPlanned: 3 }, // no name/category/unit -> SKU + "—" + "unit(s)"
      ],
    };
    render(<WorkOrderDetail workOrder={workOrder} jobs={[]} role="dispatcher" technicians={[]} customerName="Acme" locationLabel="Site" />);
    const text = document.body.textContent;
    // planned item 1: recorded name + snapshot category + snapshot unit (fragmented text nodes)
    expect(text.includes("RECORDED-A")).toBe(true);
    expect(text.includes("(TST-9001, Valves)")).toBe(true);
    expect(text.includes("each")).toBe(true);
    // planned item 2: name-less -> SKU, neutral category "—", neutral unit "unit(s)"
    expect(text.includes("(TST-9002, —)")).toBe(true);
    expect(text.includes("unit(s)")).toBe(true);
    noStaticLeak();
  });
});
