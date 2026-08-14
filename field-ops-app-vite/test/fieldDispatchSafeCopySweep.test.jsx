// site-work r3 L (safe-copy sweep) -- RENDER gate (vitest + jsdom) proving three
// field/dispatch surfaces no longer leak a raw Firebase/Functions error string:
//
//   1. useAssignedWorkOrders.js -- used to pass the raw onSnapshot error object
//      straight through as `error`; TechnicianDashboard.jsx and FieldMode.jsx
//      then rendered it via `error.message`. It now wraps the error through
//      loadErrorMessage (the same helper useCurrentTechnician.js and
//      useContactsForAccount.js use for their read failures), so `error` is
//      already a safe string.
//   2. FieldMode.jsx's advance() -- used to surface `err?.message` verbatim on
//      a failed transitionWorkOrder(); now routes through
//      workflowActionErrorMessage(), matching TechnicianWorkOrderActions.jsx.
//   3. DispatcherBoard.jsx's handleDispatchDrop -- used to surface
//      `err.message` verbatim on a failed transitionWorkOrder(); now routes
//      through workflowActionErrorMessage(), matching Dispatch.jsx's assign().
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const RAW_MESSAGE = "FirebaseError: permission-denied at documents/fieldops_wos/abc123XYZ456uid789";
const RAW = /permission-denied|functions\/|firestore\/|FirebaseError|documents\/|[A-Za-z0-9]{20,}/;

// --- shared mocks -----------------------------------------------------

const transitionWorkOrder = vi.fn();
vi.mock("../src/services/workOrderService", () => ({
  transitionWorkOrder: (...args) => transitionWorkOrder(...args),
  subscribeAssignedWorkOrders: vi.fn(() => () => {}),
}));

vi.mock("../src/hooks/useCurrentTechnician", () => ({
  useCurrentTechnician: () => ({
    technicianId: "tech1",
    technician: { id: "tech1", name: "Tech One" },
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));

vi.mock("../src/hooks/useWorkOrderFieldContext", () => ({
  useWorkOrderFieldContext: () => ({ context: null, denied: true, loading: false }),
}));

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: "dispatcher", operationalRoles: [] }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.resetModules();
});

// --- 1. useAssignedWorkOrders read-error wrapping ----------------------

describe("useAssignedWorkOrders -- safe error copy (site-work r3 L)", () => {
  it("wraps a raw onSnapshot error through loadErrorMessage, not the raw object", async () => {
    const { subscribeAssignedWorkOrders } = await import("../src/services/workOrderService");
    subscribeAssignedWorkOrders.mockImplementation((technicianId, onData, onError) => {
      onError({ code: "permission-denied", message: RAW_MESSAGE });
      return () => {};
    });

    const { useAssignedWorkOrders } = await import("../src/hooks/useAssignedWorkOrders");
    let captured;
    function Probe() {
      captured = useAssignedWorkOrders("tech1");
      return null;
    }
    render(<Probe />);

    await waitFor(() => expect(captured.loading).toBe(false));
    expect(typeof captured.error).toBe("string");
    expect(captured.error).not.toMatch(RAW);
  });
});

describe("TechnicianDashboard -- safe error copy (site-work r3 L)", () => {
  it("a denied assigned-work-orders read never leaks the raw error", async () => {
    vi.doMock("../src/hooks/useAssignedWorkOrders", () => ({
      useAssignedWorkOrders: () => ({ data: [], loading: false, error: "You're not allowed to view this. Nothing was changed." }),
    }));
    const { default: TechnicianDashboard } = await import("../src/modules/technicianDashboard/TechnicianDashboard.jsx");
    render(
      <MemoryRouter>
        <TechnicianDashboard />
      </MemoryRouter>
    );
    const text = screen.getByText(/Couldn't load your Work Orders/i).textContent;
    expect(text).not.toMatch(RAW);
  });
});

describe("FieldMode -- safe error copy for assigned-work-orders read (site-work r3 L)", () => {
  it("a denied assigned-work-orders read never leaks the raw error", async () => {
    vi.doMock("../src/hooks/useAssignedWorkOrders", () => ({
      useAssignedWorkOrders: () => ({ data: [], loading: false, error: "You're not allowed to view this. Nothing was changed." }),
    }));
    const { default: FieldMode } = await import("../src/modules/mobile/FieldMode.jsx");
    render(<FieldMode />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).not.toMatch(RAW);
  });
});

// --- 2. FieldMode advance() action-error wrapping -----------------------

describe("FieldMode -- safe error copy for a failed action (site-work r3 L)", () => {
  it("a raw transitionWorkOrder failure never leaks err.message; safe copy shown instead", async () => {
    const assignedWorkOrder = {
      id: "wo1",
      woNumber: "WO-2026-000001",
      status: "DISPATCHED",
      assignedTechId: "tech1",
      inventorySnapshot: [],
    };
    vi.doMock("../src/hooks/useAssignedWorkOrders", () => ({
      useAssignedWorkOrders: () => ({ data: [assignedWorkOrder], loading: false, error: null }),
    }));
    transitionWorkOrder.mockRejectedValueOnce(new Error(RAW_MESSAGE));

    const { default: FieldMode } = await import("../src/modules/mobile/FieldMode.jsx");
    render(<FieldMode />);

    const actionButton = await screen.findByRole("button", { name: /accept|en route|arrived|start|complete/i });
    fireEvent.click(actionButton);

    const failure = await waitFor(() => {
      const el = document.querySelector(".fo-job__failure");
      expect(el).toBeTruthy();
      return el;
    });
    const text = failure.textContent;
    expect(text).not.toMatch(RAW);
    expect(text).toMatch(/nothing was changed/i);
  });
});

// --- 3. DispatcherBoard handleDispatchDrop action-error wrapping --------

describe("DispatcherBoard -- safe error copy for a failed dispatch (site-work r3 L)", () => {
  it("a raw transitionWorkOrder failure never leaks err.message; safe copy shown instead", async () => {
    vi.doMock("../src/hooks/useWorkOrders", () => ({
      useWorkOrders: () => ({
        data: [
          {
            id: "wo1",
            woNumber: "WO-2026-000002",
            status: "SCHEDULED",
            type: "Repair",
            customerId: "cust1",
          },
        ],
        loading: false,
        error: null,
      }),
    }));
    vi.doMock("../src/hooks/useFirestoreCollection", () => ({
      useFirestoreCollection: () => ({ data: [{ id: "tech1", name: "Tech One" }], loading: false, error: null }),
    }));
    transitionWorkOrder.mockRejectedValueOnce(new Error(RAW_MESSAGE));

    const { default: DispatcherBoard } = await import("../src/modules/dispatcherBoard/DispatcherBoard.jsx");
    render(
      <MemoryRouter>
        <DispatcherBoard />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText(/WO-2026-000002/i));

    const select = await screen.findByLabelText("Select technician to dispatch");
    fireEvent.change(select, { target: { value: "tech1" } });
    fireEvent.click(screen.getByRole("button", { name: "Dispatch" }));

    const alert = await waitFor(() => {
      const el = screen.getByRole("alert");
      expect(el.textContent.trim().length).toBeGreaterThan(0);
      return el;
    });
    const text = alert.textContent;
    expect(text).not.toMatch(RAW);
    expect(text).toMatch(/nothing was changed/i);
  });
});
