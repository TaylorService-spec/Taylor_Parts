// CRM-8, PLATFORM-SANDBOX BUILD: the Account owner precondition as the record page experiences it.
//
// updateAccount names `expectedCurrentOwnerEmployeeId` (the owner the edit was OPENED with) on every owner change; the
// server refuses the whole command with 412 ACCOUNT_OWNER_CHANGED_SINCE_READ when the locked owner differs. The page
// must then say plainly that nothing was saved, re-read the Account and its ownership history, keep the form open
// with the person's typed values, and NOT resubmit. When the person saves again, the precondition is the re-read owner.
//
// `__APP_CRM_VIA_EOS_API__` is set on globalThis before AccountDetail is imported (the boolean vite.config.js bakes
// into a platform-sandbox bundle). The writer itself is covered in crmClientCutover.test.jsx.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

globalThis.__APP_CRM_VIA_EOS_API__ = true;

const firestoreCalls = [];
vi.mock("firebase/firestore", () => new Proxy({}, {
  has: (_t, name) => name !== "then" && typeof name !== "symbol",
  get: (_t, name) => (name === "then" || typeof name === "symbol" ? undefined : (...args) => { firestoreCalls.push(name === "collection" || name === "doc" ? `${name}:${args[1]}` : name); return {}; }),
}));
vi.mock("../src/firebase/firebase", () => ({ db: {}, auth: { currentUser: null }, functions: {} }));
vi.mock("../src/firebase/firebase.js", () => ({ db: {}, auth: { currentUser: null }, functions: {} }));

const mockUseAccount = vi.fn();
vi.mock("../src/hooks/useAccount", () => ({ useAccount: (...a) => mockUseAccount(...a) }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({ useLocationsForAccount: () => ({ data: [], loading: false, error: null, retry: vi.fn() }) }));
vi.mock("../src/hooks/useContactsForAccount", () => ({ useContactsForAccount: () => ({ data: [], loading: false, error: null, retry: vi.fn() }) }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({ byUserId: new Map(), byEmployeeId: new Map([["e-1", { displayName: "Ada One" }], ["e-2", { displayName: "Bea Two" }], ["e-3", { displayName: "Cy Three" }]]), loading: false, error: null }),
}));
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "u1" }, role: "admin", employeeId: "emp-1", displayName: "Test User", loading: false }),
}));
vi.mock("../src/shared/assignment/EmployeeAssignmentPicker", () => ({
  default: ({ onSelect }) => <button type="button" onClick={() => onSelect({ employeeId: "e-2", userId: "u-2", displayName: "Bea Two" })}>Pick Bea</button>,
}));
const historyRenders = [];
vi.mock("../src/modules/accounts/crm/eosApi/AccountOwnershipHistorySection.jsx", () => ({
  default: (props) => { historyRenders.push(props.refreshKey); return null; },
}));
vi.mock("../src/modules/accounts/ServiceActivitySection", () => ({ default: () => null }));
vi.mock("../src/modules/accounts/FinancialSummarySection", () => ({ default: () => null }));
vi.mock("../src/modules/accounts/FinancialForecastSection", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig()), useParams: () => ({ accountId: "acct-1" }) }));
const mockUpdateAccount = vi.fn();
vi.mock("../src/domain/accounts.js", async (orig) => ({ ...(await orig()), updateAccount: (...args) => mockUpdateAccount(...args) }));

const { default: AccountDetail } = await import("../src/modules/accounts/AccountDetail.jsx");

afterEach(() => {
  cleanup();
  mockUpdateAccount.mockReset();
  mockUseAccount.mockReset();
  historyRenders.length = 0;
  firestoreCalls.length = 0;
});

const accountOwnedBy = (employeeId) => ({
  id: "acct-1", name: "Acme Foods", status: "ACTIVE", relationshipTypes: [], lineOfBusiness: [],
  accountOwner: employeeId ? { assignedToEmployeeId: employeeId, source: "EOS_CRM" } : null,
});

describe("412 ACCOUNT_OWNER_CHANGED_SINCE_READ on the record page", () => {
  it("nothing saved, Account + history re-read, typed values kept, no resubmit; the next save uses the re-read owner", async () => {
    const retry = vi.fn();
    let current = accountOwnedBy("e-1");
    mockUseAccount.mockImplementation(() => ({ account: current, loading: false, error: null, retry, checkedAt: 1 }));
    mockUpdateAccount.mockRejectedValueOnce(Object.assign(new Error("the Account's owner changed since it was read; re-read the Account and decide again"),
      { code: "ACCOUNT_OWNER_CHANGED_SINCE_READ", status: 412 }));

    firestoreCalls.length = 0; // module-load collection references of the legacy stores are not reads or writes
    const view = render(<MemoryRouter><AccountDetail /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Edit customer" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick Bea" }));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "call ahead" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText(/^Nothing was saved: this customer's owner changed after you opened it\./)).toBeTruthy();
    expect(mockUpdateAccount).toHaveBeenCalledTimes(1);
    expect(mockUpdateAccount.mock.calls[0][1].ownershipChange).toMatchObject({ previousOwnerEmployeeId: "e-1" });
    expect(retry).toHaveBeenCalledTimes(1);
    // Still editing, with the typed values.
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();
    expect(screen.getByLabelText("Notes").value).toBe("call ahead");
    await new Promise((r) => setTimeout(r, 30));
    expect(mockUpdateAccount).toHaveBeenCalledTimes(1);

    // The re-read answers with the owner someone else set; the person decides again.
    current = accountOwnedBy("e-3");
    view.rerender(<MemoryRouter><AccountDetail /></MemoryRouter>);
    mockUpdateAccount.mockResolvedValueOnce({ id: "acct-1" });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(mockUpdateAccount).toHaveBeenCalledTimes(2));
    expect(mockUpdateAccount.mock.calls[1][1]).toMatchObject({
      notes: "call ahead",
      accountOwner: { assignedToEmployeeId: "e-2" },
      ownershipChange: { previousOwnerEmployeeId: "e-3" },
    });
    // Saved: the form closes, and the ownership history (not shown while editing) renders re-read -- bumped once for the
    // refused save and once for this one.
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit customer" })).toBeTruthy());
    expect(historyRenders.at(-1)).toBe(2);
    expect(retry).toHaveBeenCalledTimes(2);
    // The page's non-CRM sections (e.g. work orders) still read Firestore in this build; the CRM flow must add no
    // Firestore write and no read of a CRM collection.
    expect(firestoreCalls.filter((c) => /^(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction)$/.test(c) || /^(collection|doc):(accounts|contacts|locations)$/.test(c))).toEqual([]);
    expect(firestoreCalls.length).toBeGreaterThan(0); // the recorder is live
  });

  it("any other refusal does not re-read", async () => {
    const retry = vi.fn();
    mockUseAccount.mockImplementation(() => ({ account: accountOwnedBy("e-1"), loading: false, error: null, retry, checkedAt: 1 }));
    mockUpdateAccount.mockRejectedValueOnce(Object.assign(new Error("this command requires customer.record.update"), { code: "CAPABILITY_REQUIRED", status: 403 }));
    render(<MemoryRouter><AccountDetail /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Edit customer" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText(/\(CAPABILITY_REQUIRED\)\.$/)).toBeTruthy();
    expect(retry).not.toHaveBeenCalled();
  });
});
