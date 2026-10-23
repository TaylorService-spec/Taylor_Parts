// EOS Insight -- Inventory Lifecycle: the page draws the server's figures and decides nothing. A refused section says why, a
// missing ratio is "—", the company filter re-scopes every section, and every chart has a table view.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ECharts needs real layout; jsdom has none. The chart itself is proven in the browser -- here, only that each one is asked for.
vi.mock("../src/shared/ui/charts/EChart.jsx", async (orig) => ({
  ...(await orig()),
  default: ({ label }) => <div data-testid="chart">{label}</div>,
}));
const { default: InventoryLifecycle } = await import("../src/modules/analysis/InventoryLifecycle.jsx");

const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const zeros = months.map(() => 0);
const result = (over = {}) => ({
  scope: { operatingCompanyId: "consolidated", companies: ["taylor", "ventana"], warehouses: 2 }, asOf: "2026-10-23T12:00:00.000Z", timeZone: "America/Phoenix", months,
  kpis: { onHand: 1629, received12: 4393, issued12: 4080, turns: 2.63, daysOfSupply: null, dormantShare: 0.2953, scrapRate: 0.0075, issuedTrend: zeros },
  flow: { series: [{ stage: "RECEIVED", label: "Received", direction: "IN", values: months.map(() => 300) }, { stage: "ISSUED", label: "Issued", direction: "OUT", values: months.map(() => -280) }], byMovementType: [] },
  onHandTrend: months.map(() => 1600),
  age: { dormantDays: 180, buckets: [{ key: "0-30", label: "0–30 days", units: 1148, positions: 26 }, { key: "365+", label: "Over 365 days", units: 178, positions: 6 }] },
  slowMovers: { dormantDays: 180, namesWithheld: false, rows: [{ partId: "P-1033", partNumber: "P-1033", name: "Track roller", onHand: 56, lastActivity: "2026-04-14T12:00:00.000Z", daysIdle: 192, issued12: 3 }] },
  leadTime: { status: "REFUSED", reason: "requires receivingOrder.record.read" },
  definitions: { onHand: "Σ on hand", turns: "t", daysOfSupply: "d", stockAge: "a", dormantShare: "s", scrapRate: "r", leadTime: "l" },
  ...over,
});

describe("InventoryLifecycle", () => {
  it("draws the server's figures, says why a section is refused, and never shows a missing ratio as zero", async () => {
    const callApi = vi.fn(async () => ({ ok: true, result: result() }));
    const { container } = render(<InventoryLifecycle callApi={callApi} />);
    await screen.findByText("1,629");
    expect(callApi).toHaveBeenCalledWith("readInventoryLifecycle", { operatingCompanyId: "consolidated" });
    expect(container.textContent).toMatch(/29\.5%/);
    expect(container.textContent).toMatch(/nothing issued in 90 days/);   // daysOfSupply null -> "—" with its reason
    expect(container.textContent).toMatch(/Not available to you — requires receivingOrder.record.read/);
    expect(container.textContent).toMatch(/Track roller/);
    expect(screen.getAllByTestId("chart")).toHaveLength(3);                 // flow, on hand, age; lead time refused
    expect(container.querySelectorAll("details.ins-table-view")).toHaveLength(3);
  });

  it("re-scopes every section to the chosen company", async () => {
    const callApi = vi.fn(async (_op, input) => ({ ok: true, result: result(input.operatingCompanyId === "ventana" ? { kpis: { ...result().kpis, onHand: 478 } } : {}) }));
    render(<InventoryLifecycle callApi={callApi} />);
    await screen.findByText("1,629");
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "ventana" } });
    await waitFor(() => expect(screen.getByText("478")).toBeTruthy());
    expect(callApi).toHaveBeenLastCalledWith("readInventoryLifecycle", { operatingCompanyId: "ventana" });
  });

  it("shows a refusal of the whole read as the server's words, not an empty dashboard", async () => {
    render(<InventoryLifecycle callApi={async () => ({ ok: false, message: "requires inventory.transaction.read" })} />);
    await screen.findByText("requires inventory.transaction.read");
  });
});
