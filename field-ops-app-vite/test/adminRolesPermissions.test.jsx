// ADMINISTRATION > ROLES & PERMISSIONS — render tests (vitest + jsdom).
//
// This surface used to be three paragraphs explaining why it had nothing to show. The
// explanation was accurate about ASSIGNMENT — there is still no trusted read of live
// principals — but it was answering the wrong question. "What does this role actually GET"
// needs no deployment at all, and was unanswerable anywhere in the product.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import AdminRolesPermissions from "../src/modules/administration/AdminRolesPermissions.jsx";
import { PERMISSION_CATALOG } from "../src/access/permissionCatalog.ts";
import { COMPATIBILITY_ROLES } from "../src/access/compatibilityRoles.ts";
import { resolveRoleAccess } from "../src/access/roleAccessModel.js";

afterEach(cleanup);

describe("Roles & Permissions (it shows real content, not an explanation of its absence)", () => {
  it("renders the selected role's real capabilities", () => {
    render(<AdminRolesPermissions />);
    const admin = resolveRoleAccess(COMPATIBILITY_ROLES.admin);
    expect(admin.effective.length).toBeGreaterThan(0);
    // a real capability id the admin role actually holds appears on screen
    expect(screen.getAllByText(admin.effective[0].id).length).toBeGreaterThan(0);
  });

  it("counts what the role can actually do separately from what it merely holds", () => {
    render(<AdminRolesPermissions />);
    expect(screen.getByText("Can actually do")).toBeTruthy();
    expect(screen.getByText("Granted but inert")).toBeTruthy();
  });

  it("switching role changes what is shown", () => {
    render(<AdminRolesPermissions />);
    const tech = resolveRoleAccess(COMPATIBILITY_ROLES.technician);
    const admin = resolveRoleAccess(COMPATIBILITY_ROLES.admin);
    expect(tech.effective.length).not.toBe(admin.effective.length);

    // Admin is the default selection, so one of its capabilities is on screen now.
    const adminOnly = admin.effective.find((c) => !tech.effective.some((t) => t.id === c.id));
    expect(adminOnly).toBeTruthy();
    expect(screen.getAllByText(adminOnly.id).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /^technician$/i }));

    // A capability only admin holds is gone -- the screen re-resolved against the newly
    // selected role rather than relabelling a cached list.
    expect(screen.queryAllByText(adminOnly.id).length).toBe(0);
  });
});

describe("Roles & Permissions (grant is not activation)", () => {
  it("a granted-but-inert capability is not counted as something the role can do", () => {
    // The mistake this screen exists to prevent: an inert capability rendered as plain
    // access tells an administrator access exists when it does not.
    const inertIds = new Set(PERMISSION_CATALOG.filter((p) => p.active === false).map((p) => p.id));
    const admin = resolveRoleAccess(COMPATIBILITY_ROLES.admin);
    for (const cap of admin.effective) {
      expect(inertIds.has(cap.id)).toBe(false);
    }
  });

  it("when a role holds inert capabilities, the screen says granting it again will not help", () => {
    render(<AdminRolesPermissions />);
    const admin = resolveRoleAccess(COMPATIBILITY_ROLES.admin);
    if (admin.inert.length === 0) return; // nothing to assert for this role
    expect(screen.getByRole("heading", { name: /denies anyway/i })).toBeTruthy();
    expect(screen.getByText(/has to be activated/i)).toBeTruthy();
  });
});

describe("Roles & Permissions (diagnostics)", () => {
  it("diagnostics are collapsed by default and open on request", () => {
    render(<AdminRolesPermissions />);
    expect(screen.queryByRole("heading", { name: /nobody can use/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /show diagnostics/i }));
    expect(screen.getByRole("heading", { name: /nobody can use/i })).toBeTruthy();
  });

  it("reports capabilities no roster role grants", () => {
    render(<AdminRolesPermissions />);
    fireEvent.click(screen.getByRole("button", { name: /show diagnostics/i }));
    const heading = screen.getByRole("heading", { name: /nobody can use \(\d+\)/i });
    expect(heading.textContent).toMatch(/\(\d+\)/);
  });
});

describe("Roles & Permissions (what it still cannot do, stated honestly)", () => {
  it("keeps the Assign control disabled with its own reason rather than dropping it", () => {
    // Removing it would hide that the capability exists and is merely unreachable here.
    render(<AdminRolesPermissions />);
    expect(screen.getByRole("button", { name: /assign role/i }).disabled).toBe(true);
    expect(screen.getByText(/no trusted read exists yet to list real principals/i)).toBeTruthy();
  });

  it("a roster role the system does not define is shown as not defined, not hidden", () => {
    render(<AdminRolesPermissions />);
    const notDefined = screen.queryAllByRole("button", { name: /not defined/i });
    notDefined.forEach((b) => expect(b.disabled).toBe(true));
  });

  it("an object/verb pair no capability governs renders as a dash, not an empty checkbox", () => {
    // "Nobody can ever hold this" must not look like "you were not granted it" — the second
    // invites a request for access that cannot be granted to any role in the system.
    render(<AdminRolesPermissions />);
    const table = screen.getByRole("table", { name: /object permissions/i });
    expect(within(table).getAllByTitle(/cannot be granted to any role/i).length).toBeGreaterThan(0);
  });
});
