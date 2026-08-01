// EI-P1d-1 -- render tests (vitest + jsdom) for the Truck Inventory workspace. The
// component reads ONLY an injected source and composes via pure modules, so NO Firebase /
// service mocks are needed. Proves: honest not-connected default, denied failure, empty
// state, fleet -> truck detail navigation, governed pass-through with NO computed
// "available", and the presentation-only (movement-disabled) scan review. Fixtures live
// here in the test only -- never in production.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import TruckInventory from "../src/modules/inventory/TruckInventory.jsx";

afterEach(cleanup);

const truck = {
  id: "TRK-204", technician: "Marcus Bell", location: "Downtown", homeWarehouse: "Main WH", status: "ACTIVE",
  metrics: { inventoryValue: "$48,250", serializedCount: 6, partsCount: 42, discrepancies: 1, lastReconciliation: "2h ago" },
  serializedEquipment: [{ assetId: "EQ-1", internalSku: "TST-1003", manufacturer: "Taylor", model: "C713", serial: "SN1", condition: "New", status: "LOADED", destination: "Diner", currentLocation: "On TRK-204" }],
  parts: [{ internalSku: "TST-1007", description: "Gasket", bin: "T-A1", onHand: 5, reserved: 2 }], // available absent
  manifest: null, reconciliation: null, activity: [],
};
const READY = { connected: true, status: "ready", trucks: [truck] };

describe("TruckInventory workspace", () => {
  it("default inert source renders an HONEST not-connected surface (never blank)", () => {
    render(<TruckInventory />);
    expect(screen.getByText(/not available yet/i)).toBeTruthy();
    expect(screen.getByText(/Nothing here is simulated/i)).toBeTruthy();
  });

  it("denied source renders a failure state, never inventory", () => {
    render(<TruckInventory source={{ connected: false, status: "denied", trucks: [] }} />);
    expect(screen.getByText(/unavailable/i)).toBeTruthy();
  });

  it("connected-but-empty source renders 'No trucks recorded'", () => {
    render(<TruckInventory source={{ connected: true, status: "ready", trucks: [] }} />);
    expect(screen.getByText(/No trucks recorded/i)).toBeTruthy();
  });

  it("READY source lists the fleet, opens a truck, and NEVER computes 'available'", () => {
    render(<TruckInventory source={READY} />);
    // Fleet card shows governed metrics verbatim.
    expect(screen.getByText("TRK-204")).toBeTruthy();
    expect(screen.getByText("$48,250")).toBeTruthy();
    // Open the truck.
    fireEvent.click(screen.getByRole("button", { name: /TRK-204/ }));
    // Inventory tab: equipment + parts.
    expect(screen.getByText("EQ-1")).toBeTruthy();
    expect(screen.getByText("TST-1007")).toBeTruthy();
    // on-hand 5 shows; the computed available (5-2=3) is NEVER derived -> "3" is absent.
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.queryByText("3")).toBeNull();
  });

  it("scan review is presentation-only — movement is disabled", () => {
    render(<TruckInventory source={READY} />);
    fireEvent.click(screen.getByRole("button", { name: /Scan/ }));
    const dialog = screen.getByRole("dialog", { name: /Scan review/i });
    expect(within(dialog).getByText(/never moves inventory/i)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: /Confirm/i });
    expect(confirm.disabled).toBe(true);
  });
});
