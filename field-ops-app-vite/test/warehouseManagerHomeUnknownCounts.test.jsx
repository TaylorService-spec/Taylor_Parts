// UNKNOWN IS NOT ZERO on the Warehouse Manager home. While the canonical catalog read is pending and
// the inventory ledger read has FAILED, the header must not state "Catalog 0" / "Needs Planning 0" --
// both rows are forced to [] in those states, and a count over [] is not a measurement.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Both catalog read entry points are mocked as never-settling so this proof does not depend on which
// one the component calls (the Catalog cutover renames it).
vi.mock("../src/services/partMasterQueries", () => ({
  fetchPartMasterList: vi.fn(() => new Promise(() => {})), searchParts: vi.fn(() => new Promise(() => {})), isCatalogReadRefused: () => false,
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useInventoryLedger", () => ({
  useInventoryLedger: () => ({ healthEntries: [], loading: false, error: new Error("denied") }),
}));
vi.mock("../src/hooks/useInventoryActions", () => ({ useInventoryActionsForPart: () => ({ data: [], loading: false }) }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({ requestReorderForRecommendation: vi.fn() }));
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));

import WarehouseManagerHome from "../src/modules/inventoryRole/WarehouseManagerHome.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const bandValue = (label) => {
  const dt = [...document.querySelectorAll("dt")].find((n) => n.textContent.trim() === label);
  return dt?.nextElementSibling?.textContent ?? null;
};

describe("WarehouseManagerHome — counts it has not measured are not zero", () => {
  it("a pending catalog and a failed ledger show '—', never 0", () => {
    render(<WarehouseManagerHome />);
    expect(bandValue("Catalog")).toBe("—");
    expect(bandValue("Needs Planning")).toBe("—");
  });
});
