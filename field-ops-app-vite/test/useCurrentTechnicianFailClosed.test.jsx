// site-work #3 (usecurrenttechnician-no-snapshot-error-handler) -- RENDER
// tests (vitest + jsdom).
//
// useCurrentTechnician() used to pass NO error callback to either of its two
// onSnapshot listeners (users/{uid} then fieldops_technicians/{technicianId})
// and only ever called setLoading(false) from the success branches, so a
// denied/failed read on EITHER hop hung FieldMode and TechnicianDashboard on
// "Loading your day..." / "Loading your Work Orders..." forever, with no
// error surfaced and no way to retry.
//
// It now exposes { technicianId, technician, loading, error, retry }
// (src/hooks/useCurrentTechnician.js) and both consumers must render a
// distinct, actionable failure -- never the infinite spinner -- when `error`
// is set, with a Retry control wired to `retry`.
//
// useCurrentTechnician and useAssignedWorkOrders are mocked (no Firebase, no
// network) so loading / failed-read / resolved can be driven directly, same
// convention as test/dispatchSurfacesErrorState.test.jsx.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/hooks/useCurrentTechnician", () => ({ useCurrentTechnician: vi.fn() }));
vi.mock("../src/hooks/useAssignedWorkOrders", () => ({ useAssignedWorkOrders: vi.fn() }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: vi.fn() }));

import { useCurrentTechnician } from "../src/hooks/useCurrentTechnician";
import { useAssignedWorkOrders } from "../src/hooks/useAssignedWorkOrders";
import { useAuth } from "../src/auth/AuthContext";
import FieldMode from "../src/modules/mobile/FieldMode";
import TechnicianDashboard from "../src/modules/technicianDashboard/TechnicianDashboard";

const PERMISSION_ERROR_COPY = "You do not have permission to view these technician profiles.";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FieldMode -- useCurrentTechnician fail-closed", () => {
  it("shows loading, not an error or the empty day, while the technician read is in flight", () => {
    useCurrentTechnician.mockReturnValue({
      technicianId: null,
      loading: true,
      error: null,
      retry: vi.fn(),
    });
    useAssignedWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    render(<FieldMode />);
    expect(screen.getByText(/loading your day/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a Retry-able alert, not an infinite spinner, when the technician read fails", () => {
    const retry = vi.fn();
    useCurrentTechnician.mockReturnValue({
      technicianId: null,
      loading: false,
      error: PERMISSION_ERROR_COPY,
      retry,
    });
    useAssignedWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    render(<FieldMode />);
    expect(screen.queryByText(/loading your day/i)).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(new RegExp(PERMISSION_ERROR_COPY))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the normal Field Mode surface once the technician resolves", () => {
    useCurrentTechnician.mockReturnValue({
      technicianId: "tech-1",
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    useAssignedWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    render(<FieldMode />);
    expect(screen.queryByText(/loading your day/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("My Day")).toBeTruthy();
  });
});

describe("TechnicianDashboard -- useCurrentTechnician fail-closed", () => {
  function renderDashboard() {
    return render(
      <MemoryRouter>
        <TechnicianDashboard />
      </MemoryRouter>
    );
  }

  it("shows loading, not an error or the unlinked-account message, while the technician read is in flight", () => {
    useAuth.mockReturnValue({ operationalRoles: [] });
    useCurrentTechnician.mockReturnValue({
      technician: null,
      loading: true,
      error: null,
      retry: vi.fn(),
    });
    useAssignedWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    renderDashboard();
    expect(screen.getByText(/loading your work orders/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a Retry-able alert, not an infinite spinner or the 'not linked' message, when the technician read fails", () => {
    const retry = vi.fn();
    useAuth.mockReturnValue({ operationalRoles: [] });
    useCurrentTechnician.mockReturnValue({
      technician: null,
      loading: false,
      error: PERMISSION_ERROR_COPY,
      retry,
    });
    useAssignedWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    renderDashboard();
    expect(screen.queryByText(/loading your work orders/i)).toBeNull();
    expect(screen.queryByText(/isn't linked to a technician record/i)).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(new RegExp(PERMISSION_ERROR_COPY))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the normal dashboard once the technician resolves", () => {
    useAuth.mockReturnValue({ operationalRoles: [] });
    useCurrentTechnician.mockReturnValue({
      technician: { id: "tech-1", name: "Test Tech", status: "AVAILABLE" },
      loading: false,
      error: null,
      retry: vi.fn(),
    });
    useAssignedWorkOrders.mockReturnValue({ data: [], loading: false, error: null });
    renderDashboard();
    expect(screen.queryByText(/loading your work orders/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/hi, test tech/i)).toBeTruthy();
  });
});
