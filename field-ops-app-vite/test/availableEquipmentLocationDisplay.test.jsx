// Available Equipment's location column after the EQUIPMENT ACTIVATION (Controller, 2026-10-01): the governed EOS read
// (/operations/equipment listAvailableEquipmentUnits) returns each unit WITH its warehouse name and bin code, so no second
// resolver runs and no Firebase location-display callable exists. A labelled unit renders its label; an unlabelled one
// renders a stated absence -- never the raw internal location key.
//
// Pure mapping (toAvailableAsset) + one render, with the source hook injected through its `call` seam -- never network.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useWholeUnitParts", () => ({
  useWholeUnitParts: () => ({ parts: [], loading: false, denied: false, unavailable: false }),
}));

import { toAvailableAsset, useAvailableEquipmentSource } from "../src/hooks/useAvailableEquipmentSource";
import { renderHook } from "@testing-library/react";

afterEach(() => cleanup());

const UNIT_IN_BIN = { partId: "PRT-UNIT", serialNumber: "SN-1", status: "AVAILABLE", locationType: "BIN", locationId: "bin_abc",
  warehouseId: "taylor-main", warehouseName: "Taylor Main", binCode: "MAIN-A-1-1", operatingCompanyKey: "taylor" };
const UNIT_IN_WAREHOUSE = { ...UNIT_IN_BIN, serialNumber: "SN-2", locationType: "WAREHOUSE", locationId: "taylor-main", binCode: null };
const UNLABELLED = { ...UNIT_IN_BIN, serialNumber: "SN-3", warehouseName: null, binCode: null, locationId: "wh-internal-key" };

describe("toAvailableAsset -- the governed label travels with the unit", () => {
  it("a BIN unit is labelled warehouse / bin; a WAREHOUSE unit by its warehouse", () => {
    expect(toAvailableAsset(UNIT_IN_BIN).locationLabel).toBe("Taylor Main / MAIN-A-1-1");
    expect(toAvailableAsset(UNIT_IN_WAREHOUSE).locationLabel).toBe("Taylor Main");
  });
  it("an unlabelled unit carries NO label -- the raw key is never promoted to one", () => {
    const a = toAvailableAsset(UNLABELLED);
    expect(a.locationLabel).toBeNull();
    expect(a.location).toBe("wh-internal-key");
  });
  it("only AVAILABLE is available for assignment; a RESERVED unit is listed but not offered", () => {
    expect(toAvailableAsset(UNIT_IN_BIN).availableForAssignment).toBe(true);
    expect(toAvailableAsset({ ...UNIT_IN_BIN, status: "RESERVED" }).availableForAssignment).toBe(false);
  });
});

describe("useAvailableEquipmentSource -- the EOS read, its refusal and its failure", () => {
  it("READY maps every unit; DENIED and UNAVAILABLE are distinct, never an empty list", async () => {
    const ok = renderHook(() => useAvailableEquipmentSource({ call: async () => ({ ok: true, result: { units: [UNIT_IN_BIN, UNIT_IN_WAREHOUSE] } }) }));
    await waitFor(() => expect(ok.result.current.status).toBe("ready"));
    expect(ok.result.current.assets.map((a) => a.serialNo)).toEqual(["SN-1", "SN-2"]);
    const denied = renderHook(() => useAvailableEquipmentSource({ call: async () => ({ ok: false, code: "FORBIDDEN" }) }));
    await waitFor(() => expect(denied.result.current.status).toBe("denied"));
    const down = renderHook(() => useAvailableEquipmentSource({ call: async () => ({ ok: false, code: "UNREACHABLE" }) }));
    await waitFor(() => expect(down.result.current.status).toBe("unavailable"));
  });
});

describe("AvailableEquipment renders the governed label, never the raw key", () => {
  it("shows 'Taylor Main / MAIN-A-1-1' and does not render the bin id", async () => {
    vi.resetModules();
    vi.doMock("../src/hooks/useAvailableEquipmentSource", () => ({
      useAvailableEquipmentSource: () => ({ connected: true, status: "ready", assets: [toAvailableAsset(UNIT_IN_BIN)] }),
    }));
    const { default: AvailableEquipment } = await import("../src/modules/equipment/AvailableEquipment");
    const { container } = render(<MemoryRouter><AvailableEquipment /></MemoryRouter>);
    const table = container.querySelector("table");
    expect(table.textContent).toContain("Taylor Main / MAIN-A-1-1");
    expect(table.textContent).not.toContain("bin_abc");
    vi.doUnmock("../src/hooks/useAvailableEquipmentSource");
  });
});
