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
// useWorkOrder and the technician directory are mocked (no Firebase, no
// network) so each state can be driven directly, mirroring
// test/dispatchSurfacesErrorState.test.jsx and
// test/accountDetailFailClosed.test.jsx.
//
// P1-4 (technician job context): the page no longer reads the CRM Account or
// Location at all -- customer/site names come from the governed Work Order
// projection (customerName/locationName). The "denied Account read" state is
// therefore retired; its intent (no raw id, honest unavailability) is pinned
// below on the null-name case. useAccount/useLocation stay mocked as SPIES so a
// regression that re-adds the CRM read is caught.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useWorkOrder", () => ({ useWorkOrder: vi.fn() }));
vi.mock("../src/hooks/useAccount", () => ({ useAccount: vi.fn() }));
vi.mock("../src/hooks/useLocation", () => ({ useLocation: vi.fn() }));
vi.mock("../src/services/crmApiClient.js", async (orig) => ({ ...(await orig()), callCrmApi: vi.fn() }));
// Work Order cutover: the page resolves assignee names against the governed, Employee-keyed directory.
vi.mock("../src/hooks/useWorkOrderTechnicianDirectory.js", () => ({ useWorkOrderTechnicianDirectory: vi.fn() }));
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
import { useWorkOrderTechnicianDirectory } from "../src/hooks/useWorkOrderTechnicianDirectory.js";
import { callCrmApi } from "../src/services/crmApiClient.js";
import WorkOrderDetailPage from "../src/modules/workOrders/WorkOrderDetailPage";

const RESOLVED_WORK_ORDER = {
  workOrder: { id: "wo-1", woNumber: "WO-1", customerId: "acct-1", customerName: "Acme Foods", locationId: "loc-1", locationName: "Main St" },
  loading: false,
  error: null,
  retry: vi.fn(),
};
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
    useWorkOrderTechnicianDirectory.mockReturnValue(RESOLVED_TECHS);
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
    useWorkOrderTechnicianDirectory.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("You do not have permission to view these work orders.")).toBeTruthy();
    expect(screen.queryByText(/could not be found/i)).toBeNull();
    expect(screen.queryByTestId("wo-detail")).toBeNull();
  });

  it("confirmed absence: successful read, no such Work Order => not-found message, not the failed-read copy", () => {
    useWorkOrder.mockReturnValue({ workOrder: null, loading: false, error: null, retry: vi.fn() });
    useWorkOrderTechnicianDirectory.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    expect(screen.getByText(/this work order could not be found/i)).toBeTruthy();
  });

  it("resolved: renders the work order detail, not a failure", () => {
    useWorkOrder.mockReturnValue(RESOLVED_WORK_ORDER);
    useWorkOrderTechnicianDirectory.mockReturnValue(RESOLVED_TECHS);
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

describe("WorkOrderDetailPage -- customer/site context and Technicians read fail-closed (H14, P1-4)", () => {
  it("customer/site come from the Work Order projection: no CRM read is issued", () => {
    useWorkOrder.mockReturnValue(RESOLVED_WORK_ORDER);
    useWorkOrderTechnicianDirectory.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    expect(screen.getAllByText("Acme Foods").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Main St").length).toBeGreaterThan(0);
    expect(useAccount).not.toHaveBeenCalled();
    expect(useLocationDoc).not.toHaveBeenCalled();
    expect(callCrmApi).not.toHaveBeenCalled();
  });

  it("an unresolved customer/site name renders 'reference unavailable' -- never the raw id, never 'not available to you'", () => {
    useWorkOrder.mockReturnValue({
      ...RESOLVED_WORK_ORDER,
      workOrder: { id: "wo-1", woNumber: "WO-1", customerId: "acct-1", locationId: "loc-1" },
    });
    useWorkOrderTechnicianDirectory.mockReturnValue(RESOLVED_TECHS);
    const { container } = renderPage();
    expect(screen.getByText("Customer — reference unavailable")).toBeTruthy();
    expect(screen.getByText("Site — reference unavailable")).toBeTruthy();
    expect(container.textContent).not.toContain("acct-1");
    expect(container.textContent).not.toContain("loc-1");
    expect(container.textContent).not.toMatch(/not available to you/i);
  });

  it("a denied Technicians read renders a visible failure, not a silent empty list", () => {
    useWorkOrder.mockReturnValue(RESOLVED_WORK_ORDER);
    useWorkOrderTechnicianDirectory.mockReturnValue({ data: [], loading: false, error: { code: "permission-denied" } });
    renderPage();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/technician list/i)).toBeTruthy();
  });

  it("no errors: no failure banners render", () => {
    useWorkOrder.mockReturnValue(RESOLVED_WORK_ORDER);
    useWorkOrderTechnicianDirectory.mockReturnValue(RESOLVED_TECHS);
    renderPage();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
