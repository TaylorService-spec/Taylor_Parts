// site-work round-2 #4 (appheader-discards-reorder-error) -- RENDER tests
// (vitest + jsdom), following test/dispatchSurfacesErrorState.test.jsx's convention.
//
// AppHeader.jsx used to call useReorderRequests()/useReorderRequestsByStatus()(x2)/
// useReorderRequestsAssignedTo() and destructure only `{ data }` from each, discarding
// the `error` every one of those hooks already exposes (hooks/useReorderRequests.js's
// W2 notes). A failed reorder-request subscription rendered the exact same "no pending
// reorder requests" / undercounted bell as a genuinely empty queue -- an admin/
// dispatcher could miss real reorder-request activity with no indication a read failed.
//
// These tests pin the fix at both layers: AppHeader combines the four hooks' errors and
// threads the result into NotificationPanel (mirrored by mocking the reorder hooks and
// rendering AppHeader), and NotificationPanel itself renders a distinct, alert-role
// failure state instead of its empty/count state when `error` is truthy (mirrored by
// rendering NotificationPanel directly).
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const PERMISSION_ERROR = { code: "permission-denied" };

vi.mock("../src/auth/AuthContext", () => ({
  useAuth: () => ({ user: { uid: "u1", email: "a@b.c" }, role: "admin", logout: () => {} }),
}));
vi.mock("../src/access/navPermissionPreview", () => ({ createPermissionPreviewer: () => () => true }));
vi.mock("../src/access/resolveEffectivePermission", () => ({ resolveEffectivePermission: () => ({}) }));
vi.mock("../src/access/compatibilityRoles", () => ({ COMPATIBILITY_ROLES: {} }));
vi.mock("../src/hooks/useCanonicalPartNames", () => ({
  useCanonicalPartNames: () => ({ resolveName: (id) => id }),
}));

const reorderHooks = vi.hoisted(() => ({
  requests: { data: [], error: null },
  byStatus: { data: [], error: null },
  assignedTo: { data: [], error: null },
}));
vi.mock("../src/hooks/useReorderRequests", () => ({
  useReorderRequests: vi.fn(() => reorderHooks.requests),
  useReorderRequestsByStatus: vi.fn(() => reorderHooks.byStatus),
  useReorderRequestsAssignedTo: vi.fn(() => reorderHooks.assignedTo),
}));

import AppHeader from "../src/shared/ui/AppHeader.jsx";
import NotificationPanel from "../src/shared/ui/NotificationPanel.jsx";
import { partsAttentionItems, groupPartsAttentionItemsBySection } from "../src/domain/partsAttentionProjection.js";

const sectionsFor = (requests) => groupPartsAttentionItemsBySection(partsAttentionItems(requests));

afterEach(() => {
  cleanup();
  reorderHooks.requests = { data: [], error: null };
  reorderHooks.byStatus = { data: [], error: null };
  reorderHooks.assignedTo = { data: [], error: null };
});

const renderHeader = () =>
  render(
    <MemoryRouter>
      <AppHeader />
    </MemoryRouter>
  );

describe("AppHeader -- a failed reorder-request subscription is not swallowed into the empty bell", () => {
  it("useReorderRequests() erroring surfaces the failure indication, not a false empty/zero bell", () => {
    reorderHooks.requests = { data: [], error: PERMISSION_ERROR };
    renderHeader();
    expect(screen.getByRole("button", { name: /Notifications, couldn't load/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Notifications/i }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/no pending reorder requests/i)).toBeNull();
  });

  it("useReorderRequestsByStatus() (e.g. Ready for Parts Manager / Purchasing Started) erroring surfaces the failure indication", () => {
    reorderHooks.byStatus = { data: [], error: PERMISSION_ERROR };
    renderHeader();
    expect(screen.getByRole("button", { name: /Notifications, couldn't load/i })).toBeTruthy();
  });

  it("useReorderRequestsAssignedTo() (Assigned to You) erroring surfaces the failure indication", () => {
    reorderHooks.assignedTo = { data: [], error: PERMISSION_ERROR };
    renderHeader();
    expect(screen.getByRole("button", { name: /Notifications, couldn't load/i })).toBeTruthy();
  });

  it("still shows the honest empty state (no false failure indication) when every hook succeeds with no data", () => {
    renderHeader();
    const button = screen.getByRole("button", { name: "Notifications" });
    expect(button.textContent).toBe("Notifications");
    fireEvent.click(button);
    expect(screen.getByText(/no pending reorder requests/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("NotificationPanel -- error prop takes priority over the empty/count state", () => {
  const renderPanel = (props) =>
    render(
      <MemoryRouter>
        <NotificationPanel {...props} />
      </MemoryRouter>
    );
  const openDropdown = () => fireEvent.click(screen.getByRole("button", { name: /Notifications/i }));

  it("renders an alert-role failure state, not '(0)'/'No pending reorder requests.', when error is truthy", () => {
    renderPanel({ sections: sectionsFor([]), error: PERMISSION_ERROR });
    const button = screen.getByRole("button", { name: /Notifications, couldn't load/i });
    expect(button.textContent).not.toContain("(0)");
    openDropdown();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/no pending reorder requests/i)).toBeNull();
  });

  it("error takes priority even when some sections already have real data (no confidently-wrong partial count)", () => {
    renderPanel({
      sections: sectionsFor([{ id: "r1", partId: "TST-9001", status: "PENDING_REVIEW", urgency: "HIGH" }]),
      error: PERMISSION_ERROR,
    });
    const button = screen.getByRole("button", { name: /Notifications, couldn't load/i });
    expect(button.textContent).not.toContain("(1)");
    openDropdown();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("still shows the honest empty state when there is no error", () => {
    renderPanel({ sections: sectionsFor([]), error: null });
    expect(screen.getByRole("button", { name: "Notifications" }).textContent).toBe("Notifications");
    openDropdown();
    expect(screen.getByText(/no pending reorder requests/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still shows the honest count when there is no error and requests exist", () => {
    renderPanel({ sections: sectionsFor([{ id: "r1", partId: "TST-9001", status: "PENDING_REVIEW", urgency: "HIGH" }]), error: null });
    expect(screen.getByRole("button", { name: "Notifications" }).textContent).toContain("(1)");
  });
});
