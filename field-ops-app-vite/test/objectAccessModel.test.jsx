// OBJECT-SIDE ACCESS MODEL + the by-object view (vitest + jsdom).
//
// The role side answers "what does this role get". This is the other axis: "who can do this to
// this object", which was answerable only by selecting each of sixteen roles in turn and reading
// one column. Same data, no view — until now.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import AdminObjects from "../src/modules/administration/AdminObjects.jsx";
import { objectAccess, objectAccessAll, objectDiagnostics } from "../src/access/roleAccessModel.js";
import { OBJECT_PERMISSIONS, VERBS } from "../src/access/objectPermissionMap.js";
import { PERMISSION_CATALOG } from "../src/access/permissionCatalog.ts";
import { COMPATIBILITY_ROLES } from "../src/access/compatibilityRoles.ts";
import { GOVERNED_BUSINESS_ROLES } from "../src/access/governedBusinessRoles.ts";

afterEach(cleanup);

const ROLES = Object.values({ ...COMPATIBILITY_ROLES, ...GOVERNED_BUSINESS_ROLES });

// ------------------------------------------------------------ three states, never two

describe("objectAccess (a gap in the model is not a decision about people)", () => {
  it("noCapability when nothing in the catalog governs the verb", () => {
    const entry = { object: "X", domain: "D", C: [], R: [], E: [], D: [] };
    const o = objectAccess(entry, ROLES);
    for (const v of VERBS) {
      expect(o.verbs[v].state).toBe("noCapability");
      expect(o.verbs[v].holders).toEqual([]);
    }
  });

  it("nobody when capabilities exist and no SUPPLIED role holds them", () => {
    // Distinct from noCapability: someone COULD be granted this. Collapsing the two sends
    // people either to request access nobody can have, or to fix a model gap with a grant.
    //
    // The roles are supplied deliberately rather than taken from the full set. Writing this
    // against every defined role first revealed something worth recording: across the whole
    // role set, EVERY catalog capability is currently held by someone, so there is no naturally
    // unheld id to reach for. That is a fact about today's grants, not a property of the model
    // — a capability added tomorrow starts unheld — so the state has to exist and be tested
    // even though nothing currently occupies it.
    const id = COMPATIBILITY_ROLES.admin.permissions[0];
    const rolesWithoutIt = [{ id: "hollow", permissions: [] }];
    const o = objectAccess({ object: "X", domain: "D", C: [id], R: [], E: [], D: [] }, rolesWithoutIt);
    expect(o.verbs.C.state).toBe("nobody");
    expect(o.verbs.C.capabilities).toHaveLength(1);
    expect(o.verbs.C.capabilities[0].known).toBe(true);
  });

  it("every catalog capability is currently held by some defined role", () => {
    // Recorded as an assertion rather than a comment, because it is load-bearing for reading
    // the diagnostics: an empty "nobody can do it" list means the grants are complete, NOT that
    // the check is broken. If a future capability lands ungranted, this fails and says so.
    const unheld = PERMISSION_CATALOG.map((p) => p.id).filter(
      (id) => !ROLES.some((r) => (r.permissions ?? []).includes(id))
    );
    expect(unheld).toEqual([]);
  });

  it("held, and names exactly the roles that hold it", () => {
    const id = COMPATIBILITY_ROLES.admin.permissions[0];
    const o = objectAccess({ object: "X", domain: "D", C: [id], R: [], E: [], D: [] }, ROLES);
    expect(o.verbs.C.state).toBe("held");
    expect(o.verbs.C.holders).toContain("admin");
    for (const roleId of o.verbs.C.holders) {
      const role = ROLES.find((r) => r.id === roleId);
      expect(role.permissions).toContain(id);
    }
  });
});

// ------------------------------------------------------------ holders who cannot act

describe("objectAccess (a holder count can misrepresent authority)", () => {
  it("allInert when every backing capability is inactive", () => {
    const inert = PERMISSION_CATALOG.find((p) => p.active === false);
    expect(inert).toBeTruthy();
    const holder = ROLES.find((r) => (r.permissions ?? []).includes(inert.id));
    const o = objectAccess({ object: "X", domain: "D", C: [inert.id], R: [], E: [], D: [] }, ROLES);
    expect(o.verbs.C.allInert).toBe(true);
    if (holder) {
      // The dangerous shape: holders exist AND none of them can act.
      expect(o.verbs.C.holders.length).toBeGreaterThan(0);
      expect(o.verbs.C.state).toBe("held");
    }
  });

  it("not allInert when at least one backing capability is active", () => {
    const active = PERMISSION_CATALOG.find((p) => p.active !== false);
    const inert = PERMISSION_CATALOG.find((p) => p.active === false);
    const o = objectAccess({ object: "X", domain: "D", C: [active.id, inert.id], R: [], E: [], D: [] }, ROLES);
    expect(o.verbs.C.allInert).toBe(false);
  });

  it("marks a capability the mapping names but the catalog does not define", () => {
    const o = objectAccess({ object: "X", domain: "D", C: ["not.real"], R: [], E: [], D: [] }, ROLES);
    expect(o.verbs.C.capabilities[0].known).toBe(false);
  });
});

// ------------------------------------------------------------ consistency with the grid

describe("the two axes cannot disagree", () => {
  it("every object in the map is resolved, in the map order", () => {
    const rows = objectAccessAll(ROLES);
    expect(rows.map((r) => r.object)).toEqual(OBJECT_PERMISSIONS.map((e) => e.object));
  });

  it("a role listed as a holder really does hold a backing capability", () => {
    for (const row of objectAccessAll(ROLES)) {
      for (const v of VERBS) {
        for (const roleId of row.verbs[v].holders) {
          const role = ROLES.find((r) => r.id === roleId);
          const backing = row.verbs[v].capabilities.map((c) => c.id);
          expect(backing.some((id) => role.permissions.includes(id))).toBe(true);
        }
      }
    }
  });
});

// ------------------------------------------------------------ diagnostics

describe("objectDiagnostics", () => {
  it("ungoverned objects have no capability for any verb", () => {
    const d = objectDiagnostics(ROLES);
    for (const o of d.ungoverned) {
      const entry = OBJECT_PERMISSIONS.find((e) => e.object === o.object);
      for (const v of VERBS) expect((entry[v] ?? []).length).toBe(0);
    }
  });

  it("distinguishes rules-governed objects from genuine model gaps", () => {
    // Governed by a different mechanism is not the same as ungoverned, and treating them the
    // same would report firestore.rules coverage as a hole.
    const d = objectDiagnostics(ROLES);
    const rulesGoverned = d.ungoverned.filter((o) => o.rulesOnly);
    for (const o of rulesGoverned) {
      expect(OBJECT_PERMISSIONS.find((e) => e.object === o.object).rulesOnly).toBeTruthy();
    }
  });

  it("nobodyCan entries have capabilities but no holders", () => {
    const d = objectDiagnostics(ROLES);
    const rows = objectAccessAll(ROLES);
    for (const x of d.nobodyCan) {
      const cell = rows.find((r) => r.object === x.object).verbs[x.verb];
      expect(cell.capabilities.length).toBeGreaterThan(0);
      expect(cell.holders).toEqual([]);
    }
  });

  it("inertOnly entries are exactly the allInert cells", () => {
    const d = objectDiagnostics(ROLES);
    const rows = objectAccessAll(ROLES);
    const expected = [];
    for (const r of rows) for (const v of VERBS) if (r.verbs[v].allInert) expected.push(`${r.object}:${v}`);
    expect(d.inertOnly.map((x) => `${x.object}:${x.verb}`)).toEqual(expected);
  });
});

// ------------------------------------------------------------ the surface

describe("Objects screen (by-object view)", () => {
  const openByObject = () => {
    render(<AdminObjects />);
    fireEvent.click(screen.getByRole("button", { name: /by object/i }));
  };

  it("defaults to the role view and switches on request", () => {
    render(<AdminObjects />);
    expect(screen.getByRole("group", { name: /select a role/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /by object/i }));
    expect(screen.queryByRole("group", { name: /select a role/i })).toBeNull();
  });

  it("lists every object with a holder count per verb", () => {
    openByObject();
    const table = screen.getByRole("table");
    for (const entry of OBJECT_PERMISSIONS.slice(0, 5)) {
      expect(within(table).getAllByText(entry.object).length).toBeGreaterThan(0);
    }
  });

  it("selecting an object reveals the capabilities behind each verb and who holds them", () => {
    // The thing the role-first grid structurally cannot show: WHICH capability backs a tick.
    openByObject();
    fireEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(screen.getByText("customer.record.read")).toBeTruthy();
    expect(screen.getAllByText(/held by/i).length).toBeGreaterThan(0);
  });

  it("renders diagnostics for ungoverned objects and unheld verbs", () => {
    openByObject();
    expect(screen.getByRole("heading", { name: /does not govern/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /nobody can do it/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /held, but inert/i })).toBeTruthy();
  });

  it("says read-only in both views", () => {
    openByObject();
    expect(screen.getByText(/Read-only/i)).toBeTruthy();
  });
});
