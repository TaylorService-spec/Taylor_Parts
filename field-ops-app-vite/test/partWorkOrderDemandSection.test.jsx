// Part -> Work Order Demand section (Wave 7 Item 3) -- component tests (vitest + jsdom). Proves the
// loading/denied/unavailable/empty/populated states render distinctly, the WO link navigates to the
// governed Work Order surface, the "showing N of M" disclosure only appears when the scan actually was
// capped, and no raw Firebase UID reaches the DOM (this card renders no actor at all).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PartWorkOrderDemandSection from "../src/modules/inventory/PartWorkOrderDemandSection.jsx";
import { usePartWorkOrderDemand } from "../src/hooks/usePartWorkOrderDemand.js";

vi.mock("../src/hooks/usePartWorkOrderDemand.js", async () => {
  const actual = await vi.importActual("../src/hooks/usePartWorkOrderDemand.js");
  return { ...actual, usePartWorkOrderDemand: vi.fn() };
});

const withRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
afterEach(cleanup);

describe("PartWorkOrderDemandSection", () => {
  it("renders a loading state", () => {
    usePartWorkOrderDemand.mockReturnValue({ status: "LOADING" });
    withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    expect(screen.getByText(/Loading Work Order demand/)).toBeTruthy();
  });

  it("renders a denied state distinctly, never as empty", () => {
    usePartWorkOrderDemand.mockReturnValue({ status: "DENIED" });
    withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    expect(screen.getByText(/don't have access to Work Order demand/)).toBeTruthy();
    expect(screen.queryByText(/No open Work Order/)).toBeNull();
  });

  it("renders an unavailable state on a failed read", () => {
    usePartWorkOrderDemand.mockReturnValue({ status: "UNAVAILABLE" });
    withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    expect(screen.getByText(/temporarily unavailable/)).toBeTruthy();
  });

  it("renders an honest empty state when no open Work Order needs this part", () => {
    usePartWorkOrderDemand.mockReturnValue({
      status: "READY",
      workOrders: [{ id: "wo1", status: "SCHEDULED", inventorySnapshot: [{ partId: "P-OTHER", qtyPlanned: 1 }] }],
      scannedCount: 1,
      totalOpenWorkOrders: 1,
    });
    withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    expect(screen.getByText(/No open Work Order currently needs this part/)).toBeTruthy();
  });

  it("renders demand rows with a working link to the governed Work Order surface", () => {
    usePartWorkOrderDemand.mockReturnValue({
      status: "READY",
      workOrders: [
        {
          id: "wo1",
          woNumber: "WO-2026-000123",
          status: "SCHEDULED",
          customerId: "cust-1",
          inventorySnapshot: [{ partId: "P-1", qtyPlanned: 4, qtyUsed: 1 }],
        },
      ],
      scannedCount: 1,
      totalOpenWorkOrders: 1,
    });
    withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    const link = screen.getByRole("link", { name: "WO-2026-000123" });
    expect(link.getAttribute("href")).toBe("/service/work-orders/wo1");
    expect(screen.getByText("SCHEDULED")).toBeTruthy();
    expect(screen.getByText("cust-1")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // remaining
  });

  it("shows an unknown quantity honestly rather than a fabricated zero", () => {
    usePartWorkOrderDemand.mockReturnValue({
      status: "READY",
      workOrders: [
        { id: "wo1", woNumber: "WO-1", status: "SCHEDULED", inventorySnapshot: [{ partId: "P-1" /* no qty fields */ }] },
      ],
      scannedCount: 1,
      totalOpenWorkOrders: 1,
    });
    withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("discloses 'showing N of M' only when the bounded scan was actually capped", () => {
    usePartWorkOrderDemand.mockReturnValue({
      status: "READY",
      workOrders: [{ id: "wo1", woNumber: "WO-1", status: "SCHEDULED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }] }],
      scannedCount: 1,
      totalOpenWorkOrders: 50, // more open WOs exist than were scanned
    });
    withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    expect(screen.getByText(/Showing the most recent 1 of 50 open Work Orders/)).toBeTruthy();
  });

  it("omits the disclosure when the scan covered every open Work Order", () => {
    usePartWorkOrderDemand.mockReturnValue({
      status: "READY",
      workOrders: [{ id: "wo1", woNumber: "WO-1", status: "SCHEDULED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }] }],
      scannedCount: 1,
      totalOpenWorkOrders: 1,
    });
    withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    expect(screen.queryByText(/Showing the most recent/)).toBeNull();
  });

  it("excludes terminal Work Orders from the demand list even if returned by the read", () => {
    usePartWorkOrderDemand.mockReturnValue({
      status: "READY",
      workOrders: [{ id: "wo1", woNumber: "WO-1", status: "COMPLETED", inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }] }],
      scannedCount: 1,
      totalOpenWorkOrders: 1,
    });
    withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    expect(screen.getByText(/No open Work Order currently needs this part/)).toBeTruthy();
    expect(screen.queryByText("WO-1")).toBeNull();
  });

  it("never renders a raw Firebase UID (this card renders no actor identity at all)", () => {
    usePartWorkOrderDemand.mockReturnValue({
      status: "READY",
      workOrders: [
        {
          id: "wo1",
          woNumber: "WO-1",
          status: "SCHEDULED",
          customerId: "cust-1",
          inventorySnapshot: [{ partId: "P-1", qtyPlanned: 1 }],
        },
      ],
      scannedCount: 1,
      totalOpenWorkOrders: 1,
    });
    const { container } = withRouter(<PartWorkOrderDemandSection partId="P-1" />);
    // A raw Firebase Auth UID is a 28-char alphanumeric token; nothing rendered here should look like one.
    expect(container.textContent).not.toMatch(/\b[A-Za-z0-9]{28}\b/);
  });
});
