// H14 -- WorkOrderDetailPage.jsx used to drop useAccount's and
// useFirestoreCollection's { error, loading } entirely (destructuring only
// { account } / { data: technicians }), and useWorkOrder itself exposed no
// error at all. A denied Account read rendered the raw customerId in place
// of a name with no indication anything failed; a denied Technicians read
// rendered as if the collection were empty; and a denied Work Order read
// left the page on "Loading work order…" forever.
//
// These tests pin the fix: each denied/failed read must render a visible
// FailureState, never a silent fallback or an endless spinner.
// useWorkOrder/useAccount/useLocation/useFirestoreCollection are mocked (no
// Firebase, no network) so each state can be driven directly, mirroring
// test/dispatchSurfacesErrorState.test.jsx and
// test/accountDetailFailClosed.test.jsx.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useWorkOrder", () => ({ useWorkOrder: vi.fn() }));
vi.mock("../src/hooks/useAccount", () => ({ useAccount: vi.fn() }));
vi.mock("../src/hooks/useLocation", () => ({ useLocation: vi.fn() }));
vi.mock("../src/hooks/useFirestoreCollection", () => ({ useFirestoreCollection: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: "dispatcher" }) }));
vi.mock("../src/modules/controlTower/WorkOrderDetail", () => ({ default: () => <div data-testid="wo-detail" /> }));
vi.mock("../src/modules/workOrders/WorkOrderPartsPlanEditor", () => ({ default: () => null }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return { ...actual, useParams: () => ({ workOrderId: "wo-1" }) };
});

import { useWorkOrder } from "../src/hooks/useWorkOrder";
import { useAccount } from "../src/hooks/useAccount";
import { useLocation as useLocationDoc } from "../src/hooks/useLocation";
import { useFirestoreCollection } from "../src/hooks/useFirestoreCollection";
import WorkOrderDetailPage from "../src/modules/workOrders/WorkOrderDetailPage";

const RESOLVED_WORK_ORDER = {
  workOrder: { id: "wo-1", woNumber: "WO-1", customerId: "acct-1", locationId: "loc-1" },
  loading: false,
  error: null,
  retry: vi.fn(),
};
const RESOLVED_ACCOUNT = { account: { id: "acct-1", name: "Acme Foods" }, loading: false, error: null };
const RESOLVED_LOCATION = { location: { id: "loc-1", name: "Main St" }, loading: false, error: null };
const RESOLVED_TECHS = { data: [], loading: false, error: null };

function renderPage() {
  return render(
    <MemoryRouter>
      <WorkOrderDetailPage />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkOrderDetailPage -- Work Order read fail-closed (H14)", () => {
  it("loading: shows the loading state, not a failure or not-found", () => {
    useWorkOrder.mockReturnValue({ workOrder: null, loading: true, error: null, retry: vi.fn() });
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
    useLocationDoc.mockReturnValue(RESOLVED_LOCATION);
    useFirestoreCollection.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    expect(screen.getByText(/loading work order/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a denied/failed Work Order read renders a visible failure with Retry -- never an endless spinner", () => {
    const retry = vi.fn();
    useWorkOrder.mockReturnValue({
      workOrder: null,
      loading: false,
      error: "You do not have permission to view these work orders.",
      retry,
    });
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
    useLocationDoc.mockReturnValue(RESOLVED_LOCATION);
    useFirestoreCollection.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("You do not have permission to view these work orders.")).toBeTruthy();
    expect(screen.queryByText(/could not be found/i)).toBeNull();
    expect(screen.queryByTestId("wo-detail")).toBeNull();
  });

  it("confirmed absence: successful read, no such Work Order => not-found message, not the failed-read copy", () => {
    useWorkOrder.mockReturnValue({ workOrder: null, loading: false, error: null, retry: vi.fn() });
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
    useLocationDoc.mockReturnValue(RESOLVED_LOCATION);
    useFirestoreCollection.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    expect(screen.getByText(/this work order could not be found/i)).toBeTruthy();
  });

  it("resolved: renders the work order detail, not a failure", () => {
    useWorkOrder.mockReturnValue(RESOLVED_WORK_ORDER);
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
    useLocationDoc.mockReturnValue(RESOLVED_LOCATION);
    useFirestoreCollection.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    // The assertion used to be getByTestId("wo-detail") — a handle on the legacy WorkOrderDetail
    // card, which the approved North Star composition replaces. The INVARIANT it was protecting is
    // unchanged and asserted here directly: a resolved read renders the RECORD, identified by its
    // governed reference as the page's h1, and raises no alert.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("WO-1");
    expect(screen.getByText("Acme Foods")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("WorkOrderDetailPage -- Account/Technicians reads fail-closed (H14)", () => {
  it("a denied Account read renders a visible failure, not a blank/raw-id customer name", () => {
    useWorkOrder.mockReturnValue(RESOLVED_WORK_ORDER);
    useAccount.mockReturnValue({
      account: null,
      loading: false,
      error: "You do not have permission to view these customers.",
    });
    useLocationDoc.mockReturnValue(RESOLVED_LOCATION);
    useFirestoreCollection.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("You do not have permission to view these customers.")).toBeTruthy();
  });

  it("a denied Technicians read renders a visible failure, not a silent empty list", () => {
    useWorkOrder.mockReturnValue(RESOLVED_WORK_ORDER);
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
    useLocationDoc.mockReturnValue(RESOLVED_LOCATION);
    useFirestoreCollection.mockReturnValue({ data: [], loading: false, error: { code: "permission-denied" } });
    renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/technician list/i)).toBeTruthy();
  });

  it("no errors: no failure banners render", () => {
    useWorkOrder.mockReturnValue(RESOLVED_WORK_ORDER);
    useAccount.mockReturnValue(RESOLVED_ACCOUNT);
    useLocationDoc.mockReturnValue(RESOLVED_LOCATION);
    useFirestoreCollection.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
