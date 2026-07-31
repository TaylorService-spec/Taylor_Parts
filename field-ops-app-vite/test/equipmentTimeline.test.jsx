// INV-EQ-P2 -- component tests (vitest + jsdom) for the Equipment Activity Timeline.
// Proves it renders service events newest-first with source tags + WO links, shows an
// honest inventory-not-connected status without fabricating rows, honors loading/
// unavailable/empty/partial states, renders injected inventory rows when READY, and is
// accessible. Run via `npm run test:components`.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EquipmentTimeline from "../src/modules/equipment/EquipmentTimeline";

const WOs = [
  { id: "w1", equipmentId: "E", woNumber: "WO-1", status: "CLOSED", type: "Repair", createdAt: 100 },
  { id: "w2", equipmentId: "E", woNumber: "WO-2", status: "OPEN", type: "PM", createdAt: 300 },
];
const withRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);
afterEach(cleanup);

describe("EquipmentTimeline", () => {
  it("renders service events newest-first with source tags + WO links; inventory not connected note", () => {
    withRouter(<EquipmentTimeline workOrders={WOs} equipmentId="E" />);
    expect(screen.getByRole("heading", { name: /activity timeline/i })).toBeTruthy();
    expect(screen.getByText(/inventory history .* is not yet connected|not yet connected/i)).toBeTruthy();
    const list = screen.getByRole("list", { name: /equipment activity timeline/i });
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["WO-2", "WO-1"]); // newest-first
    expect(links[0].getAttribute("href")).toMatch(/work-orders\/w2$/);
    expect(list.querySelectorAll('[data-timeline-source="service"]').length).toBe(2);
    expect(screen.getAllByText("Service").length).toBe(2); // source tags
  });

  it("loading shows a loading indicator", () => {
    withRouter(<EquipmentTimeline workOrders={[]} equipmentId="E" workOrdersLoading />);
    expect(screen.getByText(/loading activity/i)).toBeTruthy();
  });

  it("a sanitized read failure is treated as unavailable (not denial)", () => {
    withRouter(<EquipmentTimeline workOrders={[]} equipmentId="E" workOrdersError="temporary glitch" />);
    expect(screen.getByText(/activity unavailable/i)).toBeTruthy();
  });

  it("empty when the equipment has no service activity and inventory is inert", () => {
    withRouter(<EquipmentTimeline workOrders={[]} equipmentId="E" />);
    expect(screen.getByText(/no activity yet/i)).toBeTruthy();
    expect(screen.getByText(/not yet connected/i)).toBeTruthy(); // still honest about inventory
  });

  it("denied inventory source shows the denied note (no fabricated rows)", () => {
    withRouter(<EquipmentTimeline workOrders={WOs} equipmentId="E" inventorySource={{ status: "denied", events: [] }} />);
    expect(screen.getByText(/not able to view inventory history/i)).toBeTruthy();
  });

  it("renders injected inventory rows when the source is READY (Inventory-tagged)", () => {
    const inventorySource = { connected: true, status: "ready", events: [{ at: 999, kind: "RECEIVED" }] };
    withRouter(<EquipmentTimeline workOrders={WOs} equipmentId="E" inventorySource={inventorySource} />);
    expect(screen.queryByText(/not yet connected/i)).toBeNull(); // connected -> no honest-unavailable note
    expect(screen.getByText("RECEIVED")).toBeTruthy();
    expect(screen.getByText("Inventory")).toBeTruthy(); // inventory source tag
    // inventory event (999) sorts newest-first, above the service rows
    const list = screen.getByRole("list", { name: /equipment activity timeline/i });
    const first = list.querySelector("li");
    expect(first.getAttribute("data-timeline-source")).toBe("inventory");
  });
});
