// PART 11A -- regression pinning the fix for Available Equipment's location column, which PR #1029
// left rendering the raw `currentLocationId` scalar (functions/src/serializedAsset/
// serializedAssetReadService.ts returns no display label; see
// src/domain/availableEquipmentGovernedProjection.js's "LOCATION-SHAPE DISCREPANCY" header). This
// wires a SEPARATE trusted resolver (src/hooks/useLocationDisplaySource.js ->
// functions/src/inventoryLocation/locationDisplayReadService.ts) that turns a WAREHOUSE/MOBILE id
// into a real display label; anything else (CUSTOMER, an unresolved id, a denied/unavailable
// resolver read) keeps rendering the raw id -- never a fabricated type or label.
//
// Mocks BOTH governed hooks directly (established render-test convention in this codebase -- see
// availableEquipmentGovernedRead.test.jsx), never Firebase/network.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

// The raw location id can legitimately appear TWICE (the row AND the location filter <select>
// option) -- these helpers scope assertions to the row LIST specifically, so the filter's option
// text never produces a false positive/negative for what the ROW itself renders.
function rowList() {
  return screen.getByRole("list", { name: /available serialized assets/i });
}

vi.mock("../src/hooks/useAvailableEquipmentSource", () => ({ useAvailableEquipmentSource: vi.fn() }));
vi.mock("../src/hooks/useLocationDisplaySource", () => ({ useLocationDisplaySource: vi.fn() }));

import { useAvailableEquipmentSource } from "../src/hooks/useAvailableEquipmentSource";
import { useLocationDisplaySource } from "../src/hooks/useLocationDisplaySource";
import AvailableEquipment from "../src/modules/equipment/AvailableEquipment";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ONE_ASSET = (location) => [
  { serialNo: "SN-1", partId: "P-1", currentEquipmentId: null, availableForAssignment: true, status: "AVAILABLE", location },
];

describe("Available Equipment location column -- the raw-id defect is gone when a governed label resolves", () => {
  it("a WAREHOUSE-resolved location renders the governed label, not the raw id", () => {
    useAvailableEquipmentSource.mockReturnValue({ connected: true, status: "ready", assets: ONE_ASSET("WH-9f2c8a1b") });
    useLocationDisplaySource.mockReturnValue({
      connected: true,
      status: "ready",
      displayMap: new Map([["WH-9f2c8a1b", { locationId: "WH-9f2c8a1b", type: "WAREHOUSE", label: "Main Warehouse" }]]),
    });
    render(<AvailableEquipment />);
    expect(within(rowList()).getByText(/Main Warehouse/)).toBeTruthy();
    expect(within(rowList()).queryByText(/WH-9f2c8a1b/)).toBeNull();
  });

  it("a MOBILE(truck)-resolved location renders the truck's display label, not the raw id", () => {
    useAvailableEquipmentSource.mockReturnValue({ connected: true, status: "ready", assets: ONE_ASSET("MLOC-77aa11") });
    useLocationDisplaySource.mockReturnValue({
      connected: true,
      status: "ready",
      displayMap: new Map([["MLOC-77aa11", { locationId: "MLOC-77aa11", type: "MOBILE", label: "Truck 204" }]]),
    });
    render(<AvailableEquipment />);
    expect(within(rowList()).getByText(/Truck 204/)).toBeTruthy();
    expect(within(rowList()).queryByText(/MLOC-77aa11/)).toBeNull();
  });
});

describe("Available Equipment location column -- unresolved / ungoverned categories keep the honest raw-id fallback (never fabricated)", () => {
  it("an id the resolver could not place (UNRESOLVED, e.g. CUSTOMER) still shows the raw id -- no guessed type/label", () => {
    useAvailableEquipmentSource.mockReturnValue({ connected: true, status: "ready", assets: ONE_ASSET("CUST-loc-42") });
    useLocationDisplaySource.mockReturnValue({
      connected: true,
      status: "ready",
      displayMap: new Map([["CUST-loc-42", { locationId: "CUST-loc-42", type: "UNRESOLVED", label: null }]]),
    });
    render(<AvailableEquipment />);
    expect(within(rowList()).getByText(/CUST-loc-42/)).toBeTruthy();
  });

  it("the location resolver DENIED does not fail the whole Available Equipment tab -- rows still render with the raw id", () => {
    useAvailableEquipmentSource.mockReturnValue({ connected: true, status: "ready", assets: ONE_ASSET("WH-9f2c8a1b") });
    useLocationDisplaySource.mockReturnValue({ connected: false, status: "denied", displayMap: new Map() });
    render(<AvailableEquipment />);
    expect(screen.queryByRole("alert")).toBeNull(); // location-resolver denial is not an Available Equipment failure
    expect(within(rowList()).getByText(/WH-9f2c8a1b/)).toBeTruthy();
  });

  it("the location resolver UNAVAILABLE (transient failure) also degrades gracefully to the raw id", () => {
    useAvailableEquipmentSource.mockReturnValue({ connected: true, status: "ready", assets: ONE_ASSET("WH-9f2c8a1b") });
    useLocationDisplaySource.mockReturnValue({ connected: false, status: "unavailable", displayMap: new Map() });
    render(<AvailableEquipment />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(rowList()).getByText(/WH-9f2c8a1b/)).toBeTruthy();
  });

  it("an asset with no location at all renders with neither a fabricated label nor a crash", () => {
    useAvailableEquipmentSource.mockReturnValue({
      connected: true,
      status: "ready",
      assets: [{ serialNo: "SN-2", partId: "P-2", currentEquipmentId: null, availableForAssignment: true, status: "AVAILABLE", location: null }],
    });
    useLocationDisplaySource.mockReturnValue({ connected: true, status: "ready", displayMap: new Map() });
    render(<AvailableEquipment />);
    expect(screen.getByText(/SN-2/)).toBeTruthy();
  });
});

describe("Available Equipment location column -- no raw leakage", () => {
  it("no raw Firebase code, collection path, or uid ever reaches the DOM regardless of resolver state", () => {
    const RAW = /permission-denied|functions\/|firestore\/|FirebaseError|mobile_locations\/|warehouses\/|serialized_assets\//;
    useAvailableEquipmentSource.mockReturnValue({ connected: true, status: "ready", assets: ONE_ASSET("WH-9f2c8a1b") });
    useLocationDisplaySource.mockReturnValue({ connected: false, status: "unavailable", displayMap: new Map() });
    const { container } = render(<AvailableEquipment />);
    expect(container.textContent).not.toMatch(RAW);
  });
});
