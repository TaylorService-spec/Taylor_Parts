// OWNER NAMES WITHOUT THE EMPLOYEE DIRECTORY (UI corrections integration gate, 2026-10-08).
//
// Sellers and dispatchers read Accounts, Opportunities and Sales Orders but do not hold employee.record.read (the Employee
// directory is Administration's). Regression coverage for how those pages name people:
//   * a Sales Order's Owner and Accountable resolve through resolveEmployeeDisplayNames for EXACTLY the ids on the record --
//     the directory read (listEmployees) and the Firestore `employees` listener are both mocked to THROW;
//   * a former Employee keeps their name; an id the server does not name renders "reference unavailable", never the id;
//     a refused read fails closed;
//   * the Account owner picker offers what searchAccountOwnerCandidates answers (typed, 2+ characters) and produces the
//     EOS_CRM owner (Employee id only) the CRM write takes.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";

const workspace = vi.fn();
vi.mock("../src/services/workspaceApiClient.js", () => ({ callWorkspaceApi: (...a) => workspace(...a) }));
vi.mock("../src/services/workforceApiClient.js", () => ({ workforceApiClient: { call: () => { throw new Error("the Employee directory must not be read"); } } }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({ useEmployeeDirectory: () => { throw new Error("Firestore employee directory must not be read"); } }));
vi.mock("../src/hooks/useEmployeeDirectory.js", () => ({ useEmployeeDirectory: () => { throw new Error("Firestore employee directory must not be read"); } }));
vi.mock("../src/hooks/useSalesOrder.js", () => ({ useSalesOrder: vi.fn() }));
vi.mock("../src/hooks/useAccountNames.js", () => ({
  ACCOUNT_NAMES_STATUS: { IDLE: "IDLE", LOADING: "LOADING", READY: "READY", DENIED: "DENIED", ERROR: "ERROR" },
  useAccountNamesWithStatus: () => ({ names: new Map([["ACCT-1", "Harbor Grill Restaurant Group"]]), status: "READY" }),
  useAccountNames: () => new Map([["ACCT-1", "Harbor Grill Restaurant Group"]]),
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" }, loading: false }) }));

import SalesOrderDetail from "../src/modules/sales/SalesOrderDetail.jsx";
import AccountForm from "../src/modules/accounts/AccountForm.jsx";
import { useSalesOrder } from "../src/hooks/useSalesOrder.js";
import { resetGovernedEmployeeDirectory } from "../src/hooks/useGovernedEmployeeDirectory.js";
import { isCompleteAccountOwner } from "../src/domain/commercialProfile.js";

const NAMES = { "EMP-1": "Morgan Reyes", "EMP-2": "Avery Chen", "EMP-3": "Jordan Blake" };
const CANDIDATES = [{ employeeId: "EMP-2", displayName: "Avery Chen" }, { employeeId: "EMP-1", displayName: "Morgan Reyes" }];

beforeEach(() => {
  resetGovernedEmployeeDirectory();
  workspace.mockReset();
  workspace.mockImplementation(async (op, input) => {
    if (op === "resolveEmployeeDisplayNames") {
      return { ok: true, result: { names: input.employeeIds.filter((id) => NAMES[id]).map((id) => ({ key: id, displayName: NAMES[id] })) } };
    }
    if (op === "searchAccountOwnerCandidates") return { ok: true, result: { candidates: CANDIDATES } };
    return { ok: false, code: "UNKNOWN_OPERATION" };
  });
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

describe("Sales Order owner names -- the record's people only, never the Employee directory", () => {
  it("resolves Owner and Accountable by asking for exactly those two ids", async () => {
    useSalesOrder.mockReturnValue(salesOrder({ accountableEmployeeId: "EMP-2" }));
    const { container } = renderOrder();
    await waitFor(() => expect(fact(container, "Owner")).toBe("Morgan Reyes"));
    expect(fact(container, "Accountable")).toBe("Avery Chen");
    expect(workspace).toHaveBeenCalledWith("resolveEmployeeDisplayNames", { employeeIds: ["EMP-1", "EMP-2"] });
    expect(container.textContent).not.toContain("EMP-1");
  });

  it("a former Employee who still owns the order resolves by name", async () => {
    useSalesOrder.mockReturnValue(salesOrder({ ownerEmployeeId: "EMP-3" }));
    const { container } = renderOrder();
    await waitFor(() => expect(fact(container, "Owner")).toBe("Jordan Blake"));
  });

  it("an owner the server does not name renders 'reference unavailable', never the raw Employee id", async () => {
    useSalesOrder.mockReturnValue(salesOrder({ ownerEmployeeId: "EMP-UNNAMED" }));
    const { container } = renderOrder();
    await waitFor(() => expect(workspace).toHaveBeenCalled());
    await waitFor(() => expect(fact(container, "Owner")).toBe("reference unavailable"));
    expect(container.textContent).not.toContain("EMP-UNNAMED");
  });

  it("a refused read leaves the owner unresolved (fail closed), not named from elsewhere", async () => {
    workspace.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    useSalesOrder.mockReturnValue(salesOrder());
    const { container } = renderOrder();
    await waitFor(() => expect(fact(container, "Owner")).toBe("reference unavailable"));
  });
});

describe("Account owner picker -- the owners the CRM write accepts, from the server", () => {
  it("types 2+ characters, offers searchAccountOwnerCandidates' answer, and a pick becomes the EOS_CRM owner", async () => {
    const onSubmit = vi.fn();
    render(<AccountForm initialValues={{ name: "Zephyr Creamery", accountOwner: { assignedToEmployeeId: "EMP-1", assignedToDisplayName: "Morgan Reyes", source: "EOS_CRM" } }}
      onSubmit={onSubmit} onCancel={() => {}} submitLabel="Save Changes" />);
    const current = () => document.body.textContent.replace(/\s+/g, " ");
    await waitFor(() => expect(current()).toMatch(/Current Owner\s*:\s*Morgan Reyes/));
    expect(workspace).toHaveBeenCalledWith("resolveEmployeeDisplayNames", { employeeIds: ["EMP-1"] });
    const input = screen.getByRole("combobox", { name: "Account Owner" });
    fireEvent.change(input, { target: { value: "av" } });
    await waitFor(() => expect(workspace).toHaveBeenCalledWith("searchAccountOwnerCandidates", { query: "av" }), { timeout: 2000 });
    const option = await screen.findByRole("option", { name: /Avery Chen/ });
    await act(async () => { fireEvent.pointerDown(option); fireEvent.click(option); });
    await waitFor(() => expect(current()).toMatch(/Current Owner\s*:\s*Avery Chen/));
    expect(workspace).toHaveBeenCalledWith("resolveEmployeeDisplayNames", { employeeIds: ["EMP-2"] });
    expect(isCompleteAccountOwner({ assignedToEmployeeId: "EMP-2", assignedToDisplayName: "Avery Chen", source: "EOS_CRM" })).toBe(true);
  });

  it("AccountForm no longer offers the Firestore assignment picker or writes a Firebase uid pair", () => {
    const form = readFileSync("src/modules/accounts/AccountForm.jsx", "utf8");
    expect(form).not.toMatch(/EmployeeAssignmentPicker|useAssignableEmployees|assignedToUserId/);
    expect(form).toMatch(/searchAccountOwnerCandidates/);
    expect(form).toMatch(/source: "EOS_CRM"/);
  });
});
