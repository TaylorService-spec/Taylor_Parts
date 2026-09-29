// UNKNOWN IS NOT ZERO on the Parts Manager and Parts Associate homes: while a reorder-request read is
// loading or has failed, the header counts render "—", never a measured-looking 0. The hook module is
// mocked with every name either home reads (current and post-cutover), each returning a FAILED read.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("../src/services/partMasterQueries", () => ({
  fetchPartMasterList: vi.fn(() => new Promise(() => {})), searchParts: vi.fn(() => new Promise(() => {})), isCatalogReadRefused: () => false,
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useInventoryLedger", () => ({ useInventoryLedger: () => ({ healthEntries: [], loading: false, error: null }) }));
vi.mock("../src/hooks/useReorderRequests", () => {
  const failed = () => ({ data: [], loading: false, error: new Error("denied") });
  return {
    useReorderRequestsByStatus: failed, useReorderRequestsByStatuses: failed, useReviewedRequestsHistory: failed,
    useReorderRequestsAssignedTo: failed, useMyAssignedReorderRequests: failed,
    useReorderRequestById: () => ({ data: null, loading: false }),
  };
});
vi.mock("../src/hooks/useAssignableEmployees", () => ({ useAssignableEmployees: () => ({ employees: [] }) }));
vi.mock("../src/hooks/useReorderPurchaseOrders", () => ({ usePurchaseOrderForReorderRequest: () => ({ data: null, loading: false }) }));
vi.mock("../src/hooks/useReorderPurchaseOrderVoids", () => ({ useReorderPurchaseOrderVoid: () => ({ data: null, loading: false }) }));
vi.mock("../src/domain/inventoryReorderRequests", () => ({
  assignReorderRequest: vi.fn(), startPurchasing: vi.fn(), updatePurchasingProgress: vi.fn(), receiveReorderRequest: vi.fn(), getDisplayQty: () => 3,
}));
vi.mock("../src/domain/reorderPurchaseOrders", () => ({ recordPurchaseOrder: vi.fn() }));
vi.mock("../src/modules/operations/panels/InventoryHealthPanel", () => ({ default: () => null }));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({ default: () => null }));
vi.mock("../src/shared/ui/WorkspaceHeader", () => ({ default: () => null }));
vi.mock("../src/modules/inventory/PartsList", () => ({ formatAssignmentAge: () => "1d", default: () => null }));

import PartsManagerHome from "../src/modules/inventoryRole/PartsManagerHome.jsx";
import PartsAssociateHome from "../src/modules/inventoryRole/PartsAssociateHome.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const bandValue = (label) => {
  const dt = [...document.querySelectorAll("dt")].find((n) => n.textContent.trim() === label);
  return dt?.nextElementSibling?.textContent ?? null;
};

describe("Parts homes — counts over a failed read are not zero", () => {
  it("PartsManagerHome: Queue and Assigned show '—'", () => {
    render(<PartsManagerHome />);
    expect(bandValue("Queue")).toBe("—");
    expect(bandValue("Assigned")).toBe("—");
  });
  it("PartsAssociateHome: Waiting and In Progress show '—'", () => {
    render(<PartsAssociateHome />);
    expect(bandValue("Waiting")).toBe("—");
    expect(bandValue("In Progress")).toBe("—");
  });
});
