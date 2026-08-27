// EI-P1d-1 -- render tests (vitest + jsdom) for the Truck Inventory workspace. The
// component reads ONLY an injected source and composes via pure modules, so NO Firebase /
// service mocks are needed. Proves: honest not-connected default; denied / LOADING /
// sanitized ERROR states; empty state; fleet -> truck detail with governed pass-through and
// NO computed "available"; the accessVersion BOUNDARY KEY (prior-version data vanishes
// synchronously and cannot reappear until a matching-version source is supplied); governed
// Status pick-list ("Unavailable" for ungoverned values) + a governed Condition filter; and
// the presentation-only (movement-disabled) scan review. Fixtures live here only.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import TruckInventory from "../src/modules/inventory/TruckInventory.jsx";

afterEach(cleanup);

const OPTS = { fleetStatus: ["ACTIVE", "IDLE"], equipmentStatus: ["LOADED"], equipmentCondition: ["New", "Used"] };
const mkTruck = (over = {}) => ({
  id: "TRK-204", technician: "Marcus Bell", location: "Downtown", homeWarehouse: "Main WH", status: "ACTIVE",
  metrics: { inventoryValue: "$48,250", serializedCount: 6, partsCount: 42, discrepancies: 1, lastReconciliation: "2h ago" },
  serializedEquipment: [{ assetId: "EQ-1", internalSku: "TST-1003", manufacturer: "Taylor", model: "C713", serial: "SN1", condition: "New", status: "LOADED", destination: "Diner", currentLocation: "On TRK-204" }],
  parts: [{ internalSku: "TST-1007", description: "Gasket", bin: "T-A1", onHand: 5, reserved: 2 }], // available absent
  manifest: null, reconciliation: null, activity: [],
  ...over,
});
const readySource = (version, trucks = [mkTruck()]) => ({ connected: true, status: "ready", accessVersion: version, options: OPTS, trucks });

describe("TruckInventory workspace", () => {
  it("default inert source renders an HONEST not-connected surface (never blank)", () => {
    render(<TruckInventory />);
    expect(screen.getByText(/not available yet/i)).toBeTruthy();
    expect(screen.getByText(/Nothing here is simulated/i)).toBeTruthy();
  });

  it("denied source states a PERMISSION fact, never inventory and never a retryable error", () => {
    // Lists P2: a denial is not an error somebody can fix by trying again, so it no longer wears
    // FailureState role="alert" copy. It says whose boundary it is, keeps the page frame, and
    // shows no trucks. The old assertion matched the word "unavailable" in the failure title --
    // which is the sentence UNAVAILABLE owns, and giving it to a denial is what made the two
    // indistinguishable.
    render(<TruckInventory source={{ connected: false, status: "denied", trucks: [] }} />);
    expect(screen.getByText(/not able to view Truck Inventory/i)).toBeTruthy();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    // The page frame survives the denial -- a denial that renders as a blank screen reads as a
    // broken product rather than as a boundary.
    expect(screen.getByText("Truck Inventory")).toBeTruthy();
    expect(screen.queryByLabelText(/Truck fleet/i)).toBeNull();
  });

  it("loading source renders a loading state", () => {
    render(<TruckInventory source={{ status: "loading" }} />);
    expect(screen.getByText(/Loading truck inventory/i)).toBeTruthy();
  });

  it("error source renders a SANITIZED failure -- never a raw error", () => {
    render(<TruckInventory source={{ status: "error", message: "RAW-BOOM-9000" }} />);
    expect(screen.getByText(/Something went wrong loading Truck Inventory/i)).toBeTruthy();
    // The load-bearing half, unchanged: the raw message never reaches the screen.
    expect(screen.queryByText(/RAW-BOOM-9000/)).toBeNull();
    // ...and it IS announced as a failure, which is the half that separates it from the denial
    // above. Both keep the frame; only one is retryable.
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("connected-but-empty source renders 'No trucks recorded'", () => {
    render(<TruckInventory source={{ connected: true, status: "ready", accessVersion: 1, options: OPTS, trucks: [] }} accessVersion={1} />);
    expect(screen.getByText(/No trucks recorded/i)).toBeTruthy();
  });

  it("READY source lists the fleet, opens a truck, and NEVER computes 'available'", () => {
    render(<TruckInventory source={readySource(1)} accessVersion={1} />);
    expect(screen.getByText("TRK-204")).toBeTruthy();
    expect(screen.getByText("$48,250")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /TRK-204/ }));
    expect(screen.getByText("EQ-1")).toBeTruthy();
    expect(screen.getByText("TST-1007")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy(); // on-hand
    expect(screen.queryByText("3")).toBeNull(); // computed available (5-2) is NEVER derived
  });

  it("accessVersion boundary key: prior-version fleet vanishes synchronously and cannot reappear until a matching source is supplied", () => {
    const { rerender } = render(<TruckInventory source={readySource(1)} accessVersion={1} />);
    expect(screen.getByText("TRK-204")).toBeTruthy();
    // Access changes; the SAME (v1) source is now stale -> synchronously LOADING, fleet gone.
    rerender(<TruckInventory source={readySource(1)} accessVersion={2} />);
    expect(screen.getByText(/Loading truck inventory/i)).toBeTruthy();
    expect(screen.queryByText("TRK-204")).toBeNull();
    // Prior data cannot reappear until a source matching the NEW access version is supplied.
    rerender(<TruckInventory source={readySource(2)} accessVersion={2} />);
    expect(screen.getByText("TRK-204")).toBeTruthy();
  });

  it("governed Status pick-list: an ungoverned status renders 'Unavailable'", () => {
    render(<TruckInventory source={readySource(1, [mkTruck({ id: "TRK-9", status: "WEIRD" })])} accessVersion={1} />);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("WEIRD")).toBeNull();
  });

  it("governed Condition filter offers only governed options on the equipment tab", () => {
    render(<TruckInventory source={readySource(1)} accessVersion={1} />);
    fireEvent.click(screen.getByRole("button", { name: /TRK-204/ }));
    const conditionSelect = screen.getByRole("combobox", { name: /Condition/i });
    const optionText = within(conditionSelect).getAllByRole("option").map((o) => o.textContent);
    expect(optionText).toContain("New");
    expect(optionText).toContain("Used");
    expect(optionText).not.toContain("WEIRD");
  });

  it("scan review is presentation-only — movement is disabled", () => {
    render(<TruckInventory source={readySource(1)} accessVersion={1} />);
    fireEvent.click(screen.getByRole("button", { name: /Scan/ }));
    const dialog = screen.getByRole("dialog", { name: /Scan review/i });
    expect(within(dialog).getByText(/never moves inventory/i)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Confirm/i }).disabled).toBe(true);
  });
});
