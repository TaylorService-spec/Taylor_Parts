// site-work round-4 item D, Fixes 2 + 3.
//
// Fix 3: navConfig.js exports findActiveServiceGroupKey (documented as
// driving the active-group highlight, and unit-tested in
// serviceNavGroups.test.mjs) but AppRail never called it -- the Service
// group's <div role="group"> carried no active styling at all. This proves
// AppRail now wires it in: the group containing the current route gets
// aria-current + the active class, sibling groups do not.
//
// Fix 2: the scroll-active-item-into-view effect depended on
// [activeDomainPath] only, so switching between two items WITHIN the same
// already-expanded domain (e.g. Service > Scheduling -> Service > Warranty)
// never re-ran it. This proves scrollIntoView fires again on an in-domain
// route change, not just a domain change.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";

import AppRail from "../src/navigation/AppRail";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants";

afterEach(cleanup);

// jsdom does not implement scrollIntoView; AppRail's own active-item effect
// calls it unconditionally on mount/route-change. The scroll-behavior test
// below temporarily swaps in a spy and restores this default afterward.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// AppRail reads the current location itself (useLocation), so re-rendering
// the whole tree at a new initial entry is not enough to simulate an
// in-app navigation for the scrollIntoView assertion -- Routes/Route below
// give it a real router match to react to across a rerender.
function Harness({ path }) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <AppRail
              role={ROLES.ADMIN}
              allowedLegacyKeys={ROLE_NAV_ACCESS[ROLES.ADMIN]}
              activeDomainPath="service"
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("AppRail active Service group (Fix 3)", () => {
  it("marks the Dispatch group active for /service/scheduling, not Work Management", () => {
    render(<Harness path="/service/scheduling" />);
    const dispatchGroup = screen.getByRole("group", { name: "Dispatch" });
    const workManagementGroup = screen.getByRole("group", { name: "Work Management" });
    expect(dispatchGroup.getAttribute("aria-current")).toBe("true");
    expect(dispatchGroup.className).toMatch(/fo-rail__group--active/);
    expect(workManagementGroup.getAttribute("aria-current")).toBeNull();
    expect(workManagementGroup.className).not.toMatch(/fo-rail__group--active/);
  });

  it("marks Work Management active for /service (the group landing)", () => {
    render(<Harness path="/service" />);
    const workManagementGroup = screen.getByRole("group", { name: "Work Management" });
    expect(workManagementGroup.getAttribute("aria-current")).toBe("true");
  });

  it("marks Technician Workspace active for /service/coordinated-mission", () => {
    render(<Harness path="/service/coordinated-mission" />);
    const twGroup = screen.getByRole("group", { name: "Technician Workspace" });
    expect(twGroup.getAttribute("aria-current")).toBe("true");
  });
});

// A real in-app navigation (via useNavigate, same MemoryRouter/history the
// whole time) from one Service item to another WITHOUT leaving the domain --
// MemoryRouter only honors `initialEntries` on first mount, so re-rendering
// a fresh <Harness path=".."/> at a later path is not equivalent to an
// actual navigation and would not exercise the effect the same way a real
// route change does.
function NavigableHarness() {
  return (
    <MemoryRouter initialEntries={["/service/scheduling"]}>
      <Routes>
        <Route path="*" element={<NavigableRail />} />
      </Routes>
    </MemoryRouter>
  );
}
function NavigableRail() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/service/warranty")}>
        Go to Warranty
      </button>
      <AppRail
        role={ROLES.ADMIN}
        allowedLegacyKeys={ROLE_NAV_ACCESS[ROLES.ADMIN]}
        activeDomainPath="service"
      />
    </>
  );
}

describe("AppRail in-domain active-item scroll (Fix 2)", () => {
  it("scrolls the newly active item into view when switching items within the same expanded Service domain", () => {
    const scrollIntoView = vi.fn();
    const origScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<NavigableHarness />);
      const callsAfterFirstMount = scrollIntoView.mock.calls.length;
      expect(callsAfterFirstMount).toBeGreaterThan(0);

      // Same domain (service), different item -- Scheduling (Dispatch group)
      // -> Warranty (Work Management group) -- this is exactly the
      // within-domain case the old [activeDomainPath]-only dependency array
      // missed: activeDomainPath stays "service" the whole time.
      fireEvent.click(screen.getByText("Go to Warranty"));
      expect(scrollIntoView.mock.calls.length).toBeGreaterThan(callsAfterFirstMount);
    } finally {
      window.HTMLElement.prototype.scrollIntoView = origScrollIntoView;
    }
  });
});
