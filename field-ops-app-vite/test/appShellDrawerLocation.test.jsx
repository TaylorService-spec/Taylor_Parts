// site-work round-4 item D, Fix 1 -- the mobile drawer previously closed ONLY
// via a rail <NavLink>'s onClick (AppShell's handleNavigate) or the
// drawer-breakpoint media-query flip. Browser back/forward, a <Navigate
// replace> redirect, and an in-content <Link> all change location.pathname
// without ever calling handleNavigate, and each one used to strand the
// drawer open over the new page underneath. This proves AppShell now closes
// the drawer on ANY location change while in drawer mode, driven by
// useLocation rather than by how the navigation happened.
//
// AppHeader is mocked to a bare open-toggle -- its own internals (auth,
// notifications, canonical part names) are exercised by appHeaderNotificationNames.test.jsx
// and are irrelevant here; this test is about AppShell's own drawer-close effect.
// AppRail is real (no firebase-touching dependency) so the drawer's content is genuine.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";

vi.mock("../src/shared/ui/AppHeader", () => ({
  default: ({ onOpenNav }) => (
    <button type="button" onClick={onOpenNav}>
      Open nav
    </button>
  ),
}));

import AppShell from "../src/navigation/AppShell";
import { ROLES, ROLE_NAV_ACCESS } from "../src/domain/constants";

afterEach(cleanup);

// jsdom does not implement scrollIntoView; AppRail's own active-item effect
// calls it unconditionally on mount, unrelated to what this file tests.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// Forces AppShell's useIsDrawer() into drawer mode regardless of jsdom's
// actual viewport, matching the < 900px treatment this fix targets.
function mockDrawerMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

// Stands in for an in-content <Link> or a <Navigate replace> redirect: a
// navigation that happens from WITHIN the workspace, never through the rail's
// onClick handler that AppShell's handleNavigate is wired to.
function InContentNavigator() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/inventory")}>
      Go elsewhere
    </button>
  );
}

const renderShell = (initialPath = "/dashboard") =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppShell role={ROLES.ADMIN} allowedLegacyKeys={ROLE_NAV_ACCESS[ROLES.ADMIN]}>
        <InContentNavigator />
      </AppShell>
    </MemoryRouter>,
  );

describe("AppShell drawer close-on-location-change (Fix 1)", () => {
  it("closes the open drawer when location.pathname changes via a route not driven by the rail's onClick", () => {
    mockDrawerMatchMedia();
    renderShell("/dashboard");

    fireEvent.click(screen.getByText("Open nav"));
    expect(screen.getByRole("dialog", { name: "Application navigation" })).toBeTruthy();

    fireEvent.click(screen.getByText("Go elsewhere"));
    expect(screen.queryByRole("dialog", { name: "Application navigation" })).toBeNull();
  });

  it("does not error / stays closed when the drawer was never opened and location changes", () => {
    mockDrawerMatchMedia();
    renderShell("/dashboard");
    expect(screen.queryByRole("dialog", { name: "Application navigation" })).toBeNull();
    fireEvent.click(screen.getByText("Go elsewhere"));
    expect(screen.queryByRole("dialog", { name: "Application navigation" })).toBeNull();
  });
});
