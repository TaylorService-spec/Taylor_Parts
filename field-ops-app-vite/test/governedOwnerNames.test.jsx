// OWNER NAMES FROM THE GOVERNED EMPLOYEE DIRECTORY (UI corrections integration gate, 2026-10-08).
//
// Regression coverage for the Firestore -> EOS employee-directory move on the commercial pages:
//   * a Sales Order's Owner and Accountable resolve to PEOPLE through EMP-RT-01 listEmployees (the real hook, driven through
//     a mocked workforce client) -- never through the Firestore `employees` listener, which is mocked here to THROW;
//   * an owner the server leaves out (outside the caller's reach) renders "reference unavailable", never the raw id;
//   * the Account owner picker offers governed Employees only (ACTIVE / CONTRACTOR), with no Firebase uid, and the owner it
//     produces is the complete EOS_CRM owner the CRM write accepts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";

const listEmployees = vi.fn();
vi.mock("../src/services/workforceApiClient.js", () => ({ workforceApiClient: { call: (...a) => listEmployees(...a) } }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => { throw new Error("Firestore employee directory must not be read"); } }));
vi.mock("../src/hooks/useEmployeeDirectory.js", () => ({ useEmployeeDirectory: () => { throw new Error("Firestore employee directory must not be read"); } }));
vi.mock("../src/hooks/useSalesOrder.js", () => ({ useSalesOrder: vi.fn() }));
vi.mock("../src/hooks/useAccountNames.js", () => ({
  ACCOUNT_NAMES_STATUS: { IDLE: "IDLE", LOADING: "LOADING", READY: "READY", DENIED: "DENIED", ERROR: "ERROR" },
  useAccountNamesWithStatus: () => ({ names: new Map([["ACCT-1", "Harbor Grill Restaurant Group"]]), status: "READY" }),
  useAccountNames: () => new Map([["ACCT-1", "Harbor Grill Restaurant Group"]]),
}));

import SalesOrderDetail from "../src/modules/sales/SalesOrderDetail.jsx";
import { useSalesOrder } from "../src/hooks/useSalesOrder.js";
import { resetGovernedEmployeeDirectory } from "../src/hooks/useGovernedEmployeeDirectory.js";
import { useGovernedAssignableEmployees } from "../src/hooks/useGovernedAssignableEmployees.js";
import { isCompleteAccountOwner } from "../src/domain/commercialProfile.js";

const EMPLOYEES = [
  { employeeId: "EMP-1", displayName: "Morgan Reyes", employmentStatus: "ACTIVE", operatingCompanyId: "taylor" },
  { employeeId: "EMP-2", displayName: "Avery Chen", employmentStatus: "CONTRACTOR", operatingCompanyId: "taylor" },
  { employeeId: "EMP-3", displayName: "Jordan Blake", employmentStatus: "TERMINATED", operatingCompanyId: "taylor" },
];

beforeEach(() => {
  resetGovernedEmployeeDirectory();
  listEmployees.mockReset();
  listEmployees.mockResolvedValue({ ok: true, result: { items: EMPLOYEES, nextCursor: null } });
});

function salesOrder(overrides = {}) {
  return { loading: false, errorStatus: null, refetch: vi.fn(), result: { status: "ready", salesOrder: {
    id: "SO-42", salesOrderNumber: "SO-2026-000042", accountId: "ACCT-1", sourceOpportunityId: "OPP-7", ownerEmployeeId: "EMP-1",
    salesChannel: "RETAIL", state: "CONFIRMED", customerPO: "PO-1", notes: null, serviceWorkOrderIds: [],
    lines: [{ lineId: "line-1", kind: "PART", ref: "PRT-9", orderedQty: 4, allocatedQty: 0, fulfilledQty: 0, billedQty: 0 }], ...overrides } } };
}
const renderOrder = () => render(
  <MemoryRouter initialEntries={["/customers/opportunities/sales-order/SO-42"]}>
    <Routes><Route path="/customers/opportunities/sales-order/:salesOrderId" element={<SalesOrderDetail hasCapability={() => true} />} /></Routes>
  </MemoryRouter>);
const fact = (container, label) => [...container.querySelectorAll(".ns-identity__fact")]
  .find((n) => n.querySelector(".ns-identity__fact-label")?.textContent === label)?.querySelector(".ns-identity__fact-value")?.textContent;

describe("Sales Order owner names -- governed directory", () => {
  it("resolves Owner and Accountable to people through listEmployees, never the Firestore directory", async () => {
    useSalesOrder.mockReturnValue(salesOrder({ accountableEmployeeId: "EMP-2" }));
    const { container } = renderOrder();
    await waitFor(() => expect(fact(container, "Owner")).toBe("Morgan Reyes"));
    expect(fact(container, "Accountable")).toBe("Avery Chen");
    expect(listEmployees).toHaveBeenCalledWith("listEmployees", expect.objectContaining({ limit: 200 }));
    expect(container.textContent).not.toContain("EMP-1");
  });

  it("a former Employee who still owns the order resolves by name (every employment status is listed)", async () => {
    useSalesOrder.mockReturnValue(salesOrder({ ownerEmployeeId: "EMP-3" }));
    const { container } = renderOrder();
    await waitFor(() => expect(fact(container, "Owner")).toBe("Jordan Blake"));
  });

  it("an owner outside the caller's reach renders 'reference unavailable', never the raw Employee id", async () => {
    useSalesOrder.mockReturnValue(salesOrder({ ownerEmployeeId: "EMP-OUT-OF-REACH" }));
    const { container } = renderOrder();
    await waitFor(() => expect(listEmployees).toHaveBeenCalled());
    await waitFor(() => expect(fact(container, "Owner")).toBe("reference unavailable"));
    expect(container.textContent).not.toContain("EMP-OUT-OF-REACH");
  });

  it("a refused directory read leaves the owner unresolved (fail closed), not named from elsewhere", async () => {
    listEmployees.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    useSalesOrder.mockReturnValue(salesOrder());
    const { container } = renderOrder();
    await waitFor(() => expect(fact(container, "Owner")).toBe("reference unavailable"));
  });
});

describe("Account owner picker -- governed assignable Employees", () => {
  it("offers ACTIVE and CONTRACTOR Employees only, sorted by name, with no Firebase uid", async () => {
    const { result } = renderHook(() => useGovernedAssignableEmployees());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.employees.map((e) => [e.employeeId, e.displayName, e.userId])).toEqual([
      ["EMP-2", "Avery Chen", null], ["EMP-1", "Morgan Reyes", null],
    ]);
    expect(result.current.error).toBe(null);
  });

  it("a refused read offers nobody and reports the refusal", async () => {
    listEmployees.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const { result } = renderHook(() => useGovernedAssignableEmployees());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.employees).toEqual([]);
    expect(result.current.error).toBe("FORBIDDEN");
  });

  it("the owner it produces is the complete EOS_CRM owner; AccountForm wires the governed source", () => {
    expect(isCompleteAccountOwner({ assignedToEmployeeId: "EMP-1", assignedToDisplayName: "Morgan Reyes", source: "EOS_CRM" })).toBe(true);
    const form = readFileSync("src/modules/accounts/AccountForm.jsx", "utf8");
    expect(form).toMatch(/useEmployees=\{useGovernedAssignableEmployees\}/);
    expect(form).toMatch(/source: "EOS_CRM"/);
    expect(form).not.toMatch(/assignedToUserId/);
  });
});
