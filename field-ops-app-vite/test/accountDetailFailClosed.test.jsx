// site-work #4 (useaccount-no-snapshot-error-handler) + #8
// (account-contacts-ignores-error) -- RENDER tests (vitest + jsdom).
//
// useAccount() used to pass NO error callback to onSnapshot and only ever
// called setLoading(false) from the success branch, so a denied/failed
// Account read hung AccountDetail on "Loading customer..." forever. It now
// exposes { account, loading, error, retry } (src/hooks/useAccount.js) and
// AccountDetail must render a distinct, actionable "Customer unavailable"
// failure -- never conflated with the CONFIRMED-absence "This customer could
// not be found." message, which only applies to a successful read that found
// no such Account.
//
// Separately, AccountDetail's Contacts section used to branch only on
// `contacts.length === 0`, ignoring the `contactsError` useContactsForAccount
// already exposed -- so a denied Contacts read rendered the false "No
// contacts yet" empty state (hiding real Contacts). It must now mirror the
// Locations section's existing fail-closed pattern.
//
// useAccount, useLocationsForAccount, useContactsForAccount, and
// useEmployeeDirectory are mocked (no Firebase, no network) so each state can
// be driven directly. Heavy child sections that are irrelevant to this
// surface's fail-closed contract are stubbed to keep the render narrow.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useAccount", () => ({ useAccount: vi.fn() }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({ useLocationsForAccount: vi.fn() }));
vi.mock("../src/hooks/useContactsForAccount", () => ({ useContactsForAccount: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({ byUserId: {}, loading: false, error: null }),
}));
vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "u1" }, role: "admin", employeeId: "emp-1", displayName: "Test User", loading: false }),
}));
vi.mock("../src/modules/accounts/ServiceActivitySection", () => ({ default: () => null }));
vi.mock("../src/modules/accounts/FinancialSummarySection", () => ({ default: () => null }));
vi.mock("../src/modules/accounts/FinancialForecastSection", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useParams: () => ({ accountId: "acct-1" }) };
});
// updateAccount is mocked at the domain boundary (same technique
// test/accountPageComponents.test.jsx already uses for createContact/
// createLocation) so the blocked-write regression test below can drive
// AccountDetail's real handleEditSubmit against a controlled resolved value
// without any Firebase/network dependency.
vi.mock("../src/domain/accounts.js", async (orig) => {
  const actual = await orig();
  return { ...actual, updateAccount: (...args) => mockUpdateAccount(...args) };
});
const mockUpdateAccount = vi.fn();

import { useAccount } from "../src/hooks/useAccount";
import { useLocationsForAccount } from "../src/hooks/useLocationsForAccount";
import { useContactsForAccount } from "../src/hooks/useContactsForAccount";
import AccountDetail from "../src/modules/accounts/AccountDetail.jsx";

const PERMISSION_ERROR_COPY = "You do not have permission to view these customers.";

function renderDetail() {
  return render(
    <MemoryRouter>
      <AccountDetail />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUpdateAccount.mockReset();
});

describe("AccountDetail -- Account read fail-closed (site-work #4)", () => {
  it("loading: shows the loading state, not a failure or not-found", () => {
    useAccount.mockReturnValue({ account: null, loading: true, error: null, retry: vi.fn() });
    useLocationsForAccount.mockReturnValue({ data: [], error: null, retry: vi.fn() });
    useContactsForAccount.mockReturnValue({ data: [], loading: false, error: null });
    renderDetail();
    expect(screen.getByText(/loading customer/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("failed read: renders 'Customer unavailable' with Retry, never the not-found message", () => {
    const retry = vi.fn();
    useAccount.mockReturnValue({ account: null, loading: false, error: PERMISSION_ERROR_COPY, retry });
    useLocationsForAccount.mockReturnValue({ data: [], error: null, retry: vi.fn() });
    useContactsForAccount.mockReturnValue({ data: [], loading: false, error: null });
    renderDetail();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/customer unavailable/i)).toBeTruthy();
    expect(screen.getByText(PERMISSION_ERROR_COPY)).toBeTruthy();
    expect(screen.queryByText(/this customer could not be found/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("confirmed absence: successful read, no such Account => not-found message, not the failed-read copy", () => {
    useAccount.mockReturnValue({ account: null, loading: false, error: null, retry: vi.fn() });
    useLocationsForAccount.mockReturnValue({ data: [], error: null, retry: vi.fn() });
    useContactsForAccount.mockReturnValue({ data: [], loading: false, error: null });
    renderDetail();
    expect(screen.getByText(/this customer could not be found/i)).toBeTruthy();
    // Distinct from the FAILED-read branch: no "Customer unavailable" title and no Retry
    // action -- the not-found copy offers "Back to Customers" instead.
    expect(screen.queryByText(/customer unavailable/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("resolved: a successful read with data renders the customer, not a failure", () => {
    useAccount.mockReturnValue({
      account: { id: "acct-1", name: "Acme Foods", relationshipTypes: [], lineOfBusiness: [] },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    useLocationsForAccount.mockReturnValue({ data: [], error: null, retry: vi.fn() });
    useContactsForAccount.mockReturnValue({ data: [], loading: false, error: null });
    renderDetail();
    expect(screen.getByText("Acme Foods")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/customer unavailable/i)).toBeNull();
  });
});

describe("AccountDetail -- Contacts read fail-closed (site-work #8)", () => {
  const RESOLVED_ACCOUNT = {
    account: { id: "acct-1", name: "Acme Foods", relationshipTypes: [], lineOfBusiness: [] },
    loading: false,
    error: null,
    retry: vi.fn(),
  };

  it("failed Contacts read: renders an error, never the false 'No contacts yet' empty state", () => {
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
    useLocationsForAccount.mockReturnValue({ data: [], error: null, retry: vi.fn() });
    useContactsForAccount.mockReturnValue({
      data: [],
      loading: false,
      error: "You do not have permission to view these contacts.",
    });
    renderDetail();
    expect(screen.getByText("You do not have permission to view these contacts.")).toBeTruthy();
    expect(screen.queryByText(/no contacts yet/i)).toBeNull();
  });

  it("genuinely empty Contacts (no error): still shows the honest empty state", () => {
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
    useLocationsForAccount.mockReturnValue({ data: [], error: null, retry: vi.fn() });
    useContactsForAccount.mockReturnValue({ data: [], loading: false, error: null });
    renderDetail();
    expect(screen.getByText(/no contacts yet/i)).toBeTruthy();
  });
});

// Regression: handleEditSubmit (AccountDetail.jsx) used to await updateAccount()
// and unconditionally call setIsEditing(false) afterward -- but updateAccount()
// RESOLVES `{ blocked: true }` (it does not reject) when a demo/panic write-block
// is active, so a blocked save closed the edit form exactly as if it had
// succeeded, discarding the user's edits with no error shown. Every sibling write
// handler in this file (handleAddLocation, handleAddContact) already checks
// `created?.blocked` and throws; handleEditSubmit must do the same so
// AccountForm's own catch/saveError UI renders an honest failure instead.
describe("AccountDetail -- Edit save fail-closed on a blocked write", () => {
  const RESOLVED_ACCOUNT = {
    account: { id: "acct-1", name: "Acme Foods", relationshipTypes: [], lineOfBusiness: [] },
    loading: false,
    error: null,
    retry: vi.fn(),
  };

  function setUpResolvedAccount() {
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
    useLocationsForAccount.mockReturnValue({ data: [], error: null, retry: vi.fn() });
    useContactsForAccount.mockReturnValue({ data: [], loading: false, error: null });
  }

  it("a blocked save keeps the edit form open and shows the safe error -- never a silent false success", async () => {
    setUpResolvedAccount();
    mockUpdateAccount.mockResolvedValue({ blocked: true });
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mockUpdateAccount).toHaveBeenCalledTimes(1));
    // The form must still be open (blocked write did not close it) --
    // before the fix this assertion fails because setIsEditing(false) ran
    // unconditionally and the form unmounted.
    await waitFor(() =>
      expect(screen.getByText("Saving is disabled in this mode -- no changes were made.")).toBeTruthy()
    );
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();
    // The read-only Account Summary (rendered only when NOT editing) never appears.
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("a successful save closes the edit form as before", async () => {
    setUpResolvedAccount();
    mockUpdateAccount.mockResolvedValue({ id: "acct-1" });
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mockUpdateAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
  });
});
