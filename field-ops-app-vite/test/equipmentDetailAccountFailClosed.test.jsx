// site-work #4 (useaccount-no-snapshot-error-handler) -- RENDER tests
// (vitest + jsdom) for EquipmentDetail's Customer field.
//
// useAccount() used to expose no error state at all, so EquipmentDetail's
// Customer cell could only render "Loading..." or, once loading settled
// either way, "Unknown customer" -- a denied/failed Account read rendered
// identically to a genuinely unset accountId. useAccount now exposes
// { account, loading, error, retry } and this cell must show an actionable
// "Customer unavailable" failure (with Retry) on a failed read, reserving
// "Unknown customer" for a CONFIRMED absence (successful read, no account).
//
// useEquipmentDoc, useWorkOrdersForEquipment, useAccount, and
// useLocationsForAccount are mocked (no Firebase, no network) so each state
// can be driven directly; heavy children unrelated to this contract are
// stubbed to keep the render narrow.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useEquipment", () => ({
  useEquipmentDoc: vi.fn(),
  useWorkOrdersForEquipment: vi.fn(),
}));
vi.mock("../src/hooks/useAccount", () => ({ useAccount: vi.fn() }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({ useLocationsForAccount: vi.fn() }));
vi.mock("../src/modules/equipment/EquipmentTimeline", () => ({ default: () => null }));
vi.mock("../src/modules/equipment/InventoryControlSection", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useParams: () => ({ equipmentId: "eq-1" }) };
});

import { useEquipmentDoc, useWorkOrdersForEquipment } from "../src/hooks/useEquipment";
import { useAccount } from "../src/hooks/useAccount";
import { useLocationsForAccount } from "../src/hooks/useLocationsForAccount";
import EquipmentDetail from "../src/modules/equipment/EquipmentDetail.jsx";

const EQUIPMENT = { id: "eq-1", accountId: "acct-1", manufacturer: "Taylor", model: "C709", status: "ACTIVE" };
const PERMISSION_ERROR_COPY = "You do not have permission to view these customers.";

function renderDetail() {
  return render(
    <MemoryRouter>
      <EquipmentDetail />
    </MemoryRouter>
  );
}

function stubBaseHooks() {
  useEquipmentDoc.mockReturnValue({ equipment: EQUIPMENT, loading: false, error: null });
  useWorkOrdersForEquipment.mockReturnValue({ data: [], loading: false, error: null });
  useLocationsForAccount.mockReturnValue({ data: [], loading: false, error: null, retry: vi.fn() });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EquipmentDetail -- Customer cell Account read fail-closed (site-work #4)", () => {
  it("loading: shows the loading placeholder, not a failure or 'Unknown customer'", () => {
    stubBaseHooks();
    useAccount.mockReturnValue({ account: null, loading: true, error: null, retry: vi.fn() });
    renderDetail();
    const cell = document.querySelector("[data-equipment-account]");
    expect(cell.textContent).toMatch(/loading/i);
    expect(cell.textContent).not.toMatch(/unknown customer/i);
  });

  it("failed read: renders 'Customer unavailable' with Retry, never 'Unknown customer'", () => {
    stubBaseHooks();
    const retry = vi.fn();
    useAccount.mockReturnValue({ account: null, loading: false, error: PERMISSION_ERROR_COPY, retry });
    renderDetail();
    const cell = document.querySelector("[data-equipment-account]");
    expect(cell.textContent).toContain(PERMISSION_ERROR_COPY);
    expect(cell.textContent).not.toMatch(/unknown customer/i);
    expect(cell.querySelector('[role="alert"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("confirmed absence: successful read, no account => 'Unknown customer', not a failure", () => {
    stubBaseHooks();
    useAccount.mockReturnValue({ account: null, loading: false, error: null, retry: vi.fn() });
    renderDetail();
    const cell = document.querySelector("[data-equipment-account]");
    expect(cell.textContent).toMatch(/unknown customer/i);
    expect(cell.querySelector('[role="alert"]')).toBeNull();
  });

  it("resolved: a successful read with an account renders its name as a link", () => {
    stubBaseHooks();
    useAccount.mockReturnValue({
      account: { id: "acct-1", name: "Acme Foods" },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    renderDetail();
    const cell = document.querySelector("[data-equipment-account]");
    expect(cell.textContent).toContain("Acme Foods");
    expect(cell.querySelector('[role="alert"]')).toBeNull();
  });
});
