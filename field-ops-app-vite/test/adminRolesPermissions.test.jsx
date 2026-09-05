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
import { CAPABILITY_ACTIVATION_OVERRIDE_SET } from "../src/config/capabilityActivationOverrides";

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

describe("it answers for THIS environment, not for the catalog alone", () => {
  // THE DEFECT. `active: false` in the catalog does not mean inert everywhere -- it means inert
  // unless the environment activates it. This screen read only the catalog, so it reported a
  // capability as denied while the backend resolver, reading the same override set, allowed it.
  //
  // Data Import made it visible: admin.dataImport.stage/.execute are catalogue-inactive, held by
  // Administrator through the derived grant, and ACTIVATED in platform-sandbox.
  //
  // The environment is INJECTED rather than set on the shared vitest define, which is `[]` on
  // purpose because other suites depend on it. A screen whose environment behaviour could only
  // be tested by changing a global would not get tested.
  const ACTIVATED = ["admin.dataImport.stage", "admin.dataImport.execute"];
  const asSandbox = {
    activationOverrides: new Set(ACTIVATED),
    environmentId: "platform-sandbox",
  };

  it("shows an environment-activated capability under 'Can actually do', not under inert", () => {
    render(<AdminRolesPermissions {...asSandbox} />);

    const canDo = screen.getByLabelText("Capabilities this role can use");
    for (const id of ACTIVATED) {
      expect(within(canDo).getAllByText(id).length).toBeGreaterThan(0);
    }

    // And NOT in the inert section. Present in both would be worse than absent from one: the
    // screen would be contradicting itself.
    const inert = screen.queryByLabelText("Granted but inert");
    if (inert) {
      for (const id of ACTIVATED) expect(within(inert).queryByText(id)).toBeNull();
    }
  });

  it("the SAME screen in an environment without the override shows them as inert", () => {
    // Production's reading, rendered by the same component with the same catalog. Nothing about
    // the catalog changed to make the sandbox answer true, which is what keeps production safe.
    render(<AdminRolesPermissions activationOverrides={new Set()} environmentId="taylor-parts-production" />);

    const inert = screen.getByLabelText("Granted but inert");
    for (const id of ACTIVATED) {
      expect(within(inert).getAllByText(id).length).toBeGreaterThan(0);
    }
    const canDo = screen.getByLabelText("Capabilities this role can use");
    for (const id of ACTIVATED) expect(within(canDo).queryByText(id)).toBeNull();
  });

  it("says WHY it is reachable, rather than silently promoting it", () => {
    render(<AdminRolesPermissions {...asSandbox} />);
    // "active" and "active BECAUSE THIS ENVIRONMENT SAYS SO" are different facts, and an
    // administrator planning production needs to see which lines would move.
    expect(screen.getAllByText(/active in platform-sandbox/i).length).toBeGreaterThan(0);
  });

  it("the environment genuinely changes the answer", () => {
    const withEnv = resolveRoleAccess(COMPATIBILITY_ROLES.admin, {
      activationOverrides: new Set(ACTIVATED),
    });
    const withoutEnv = resolveRoleAccess(COMPATIBILITY_ROLES.admin, { activationOverrides: new Set() });
    // Otherwise this whole suite would pass against a screen that still ignored the overrides.
    expect(withEnv.effective.length).toBe(withoutEnv.effective.length + ACTIVATED.length);

    render(<AdminRolesPermissions {...asSandbox} />);
    expect(screen.getAllByText(String(withEnv.effective.length)).length).toBeGreaterThan(0);
  });

  it("defaults to the GOVERNED build-time set, not to an empty one", () => {
    // The default is what production and the sandbox actually run. If the screen defaulted to
    // no overrides, every environment would read as production and the defect would be back
    // with a passing test suite beside it.
    render(<AdminRolesPermissions />);
    const rendered = resolveRoleAccess(COMPATIBILITY_ROLES.admin, {
      activationOverrides: CAPABILITY_ACTIVATION_OVERRIDE_SET,
    });
    expect(screen.getAllByText(String(rendered.effective.length)).length).toBeGreaterThan(0);
  });

  it("the catalog is NOT rewritten to achieve any of this", () => {
    // The requirement, asserted where it would be violated: nothing flips a catalogue flag, and
    // nothing adds these ids to a role by hand.
    for (const id of ACTIVATED) {
      expect(PERMISSION_CATALOG.find((p) => p.id === id).active).toBe(false);
      expect(COMPATIBILITY_ROLES.admin.permissions).toContain(id);
    }
  });
});
