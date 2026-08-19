// Row 43 fix -- Jobs.jsx's "New Work Order" primary action must stay in lockstep
// with App.jsx's own gate on the /service/work-orders/new route
// (previewHasPermission("workOrder.create", role, { fallback: admin/dispatcher })).
//
// Before the fix, Jobs.jsx rendered an unconditional <Link to="/service/work-orders/new">
// for every role that can reach the "Job Assignments" page -- including technician
// (granted the "jobs" legacyKey in ROLE_NAV_ACCESS). But App.jsx only mounts that route
// for a role holding workOrder.create (only admin/dispatcher via the fallback), so a
// technician clicking the button fell through to the top-level catch-all and was
// silently bounced to /dashboard. This test proves a technician now sees a protected,
// explained control (no live link to a route that doesn't exist for them), while
// admin/dispatcher keep the real link.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const auth = vi.hoisted(() => ({ role: "technician" }));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: auth.role }) }));

// Real previewHasPermission wiring, but with a minimal compatibility-role map so the
// resolver behaves exactly like the production one for the permissions this test cares
// about: technician holds ONLY workOrder.transition, never workOrder.create.
vi.mock("../src/access/compatibilityRoles", () => ({
  COMPATIBILITY_ROLES: {
    technician: { id: "technician", permissions: ["workOrder.transition"] },
    admin: { id: "admin", permissions: ["workOrder.create", "workOrder.transition"] },
    dispatcher: { id: "dispatcher", permissions: ["workOrder.create", "workOrder.transition"] },
  },
}));

vi.mock("../src/hooks/useWorkOrders", () => ({ useWorkOrders: () => ({ data: [], loading: false, error: null }) }));

import Jobs from "../src/modules/jobs/Jobs.jsx";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const renderJobs = () => render(<MemoryRouter><Jobs /></MemoryRouter>);

describe("Jobs.jsx New Work Order action gate (Row 43)", () => {
  it("technician (no workOrder.create): renders a protected control, NOT a link to the unmounted route", () => {
    auth.role = "technician";
    renderJobs();
    // No live link to a route App.jsx never mounts for this role.
    expect(screen.queryByRole("link", { name: /new work order/i })).toBeNull();
    // Instead, a disabled/protected control that explains why.
    const button = screen.getByRole("button", { name: /new work order/i });
    expect(button.disabled).toBe(true);
  });

  it("dispatcher (workOrder.create via fallback): still renders the real link", () => {
    auth.role = "dispatcher";
    renderJobs();
    const link = screen.getByRole("link", { name: /new work order/i });
    expect(link.getAttribute("href")).toBe("/service/work-orders/new");
  });

  it("admin (workOrder.create granted): still renders the real link", () => {
    auth.role = "admin";
    renderJobs();
    const link = screen.getByRole("link", { name: /new work order/i });
    expect(link.getAttribute("href")).toBe("/service/work-orders/new");
  });
});
