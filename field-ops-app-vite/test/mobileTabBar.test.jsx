// THE THUMB BAR, mounted (vitest + jsdom).
//
// The destination rules are proved pure in test/mobilePrimaryNav.test.mjs. These cover what only the
// rendered bar can show: that it is phone-only, that it gets out of the way of the keyboard, that
// the selected tab is ANNOUNCED and not merely coloured, and that "More" opens the existing drawer
// rather than being a route of its own.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MobileTabBar from "../src/navigation/MobileTabBar.jsx";
import { SHELL_DESTINATIONS, MOBILE_NAV_SHELL } from "../src/navigation/mobilePrimaryNav.js";

afterEach(cleanup);

const TECH = SHELL_DESTINATIONS[MOBILE_NAV_SHELL.TECHNICIAN];

const mount = ({ path = "/service/technician-workspace", destinations = TECH, forcePhone = true, forceTyping = false, onOpenDrawer = vi.fn() } = {}) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <MobileTabBar destinations={destinations} onOpenDrawer={onOpenDrawer} deps={{ forcePhone, forceTyping }} />
    </MemoryRouter>,
  );
  return onOpenDrawer;
};

// ═══════════════════════════════════════════ phone only

describe("where it appears", () => {
  it("renders on a phone", () => {
    mount();
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeTruthy();
  });

  it("UNMOUNTS above phone widths rather than hiding", () => {
    // A hidden-but-mounted bar still lands in the tab order and in the accessibility tree, so a
    // desktop keyboard user would tab through four invisible destinations.
    mount({ forcePhone: false });
    expect(screen.queryByRole("navigation", { name: /primary/i })).toBeNull();
  });

  it("renders nothing when there are no destinations", () => {
    mount({ destinations: [] });
    expect(screen.queryByRole("navigation", { name: /primary/i })).toBeNull();
  });
});

// ═══════════════════════════════════════════ the keyboard

describe("when the on-screen keyboard is open", () => {
  it("GETS OUT OF THE WAY -- a fixed bottom bar and a keyboard fight over the same space", () => {
    // The bar loses that fight: it would sit on top of the field being typed into, or push the
    // submit button out of reach. Detected by FOCUS, not by viewport height -- height heuristics are
    // wrong on exactly the devices that matter, since a short landscape phone looks identical to a
    // portrait phone with the keyboard up.
    mount({ forceTyping: true });
    expect(screen.queryByRole("navigation", { name: /primary/i })).toBeNull();
  });

  it("comes back when typing ends", () => {
    mount({ forceTyping: false });
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeTruthy();
  });
});

// ═══════════════════════════════════════════ the selected tab

describe("the selected destination", () => {
  it("is ANNOUNCED, not merely coloured", () => {
    // aria-current is what a screen-reader user gets. Colour alone says nothing to them, and says
    // very little on a washed-out screen in daylight either.
    mount({ path: "/service/scan" });
    const scan = screen.getByRole("link", { name: "Scan" });
    expect(scan.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  it("stays selected on a child route", () => {
    mount({ path: "/service/scan/put-away" });
    expect(screen.getByRole("link", { name: "Scan" }).getAttribute("aria-current")).toBe("page");
  });

  it("selects NOTHING when the user is somewhere else", () => {
    // Lighting the wrong tab tells the operator they are somewhere they are not.
    mount({ path: "/administration/users" });
    for (const name of ["Home", "Jobs", "Scan"]) {
      expect(screen.getByRole("link", { name }).getAttribute("aria-current")).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════ More

describe("More", () => {
  it("OPENS THE EXISTING DRAWER rather than being a route", () => {
    // This is what stops the bar becoming a second navigation model to keep in step with the rail.
    const onOpenDrawer = mount();
    const more = screen.getByRole("button", { name: "More" });
    fireEvent.click(more);
    expect(onOpenDrawer).toHaveBeenCalledTimes(1);
  });

  it("is a button, not a link — it navigates nowhere", () => {
    mount();
    expect(screen.queryByRole("link", { name: "More" })).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
  });
});

// ═══════════════════════════════════════════ every destination is reachable

describe("reachability", () => {
  it("every technician destination is present and operable", () => {
    mount();
    for (const label of ["Home", "Jobs", "Scan"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
  });

  it("the warehouse bar shows its three, and no fourth", () => {
    mount({ destinations: SHELL_DESTINATIONS[MOBILE_NAV_SHELL.WAREHOUSE], path: "/dashboard" });
    expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Scan" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /jobs|tasks|inventory|parts/i })).toBeNull();
  });
});
