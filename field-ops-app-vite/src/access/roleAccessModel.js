// ROLE -> WHAT IT CAN ACTUALLY DO. Pure, no I/O, no JSX, unit-tested.
//
// The question this answers is the one that keeps going unanswered: pick a role, and say
// what that role really gets. Not what a spreadsheet intended, not what someone remembers
// granting -- what the live access contracts say, read together.
//
// GRANT IS NOT ACTIVATION, and conflating them is the single most expensive mistake this
// model can make. A capability registered `active: false` in the permission catalog DENIES
// FOR EVERYONE regardless of who holds it. So a role can carry a capability id and still be
// unable to do the thing. Any screen that renders a granted-but-inert capability as a plain
// tick tells an administrator that access exists when it does not -- and the administrator
// then spends their time debugging the wrong layer.
//
// That is why `granted` and `effective` are separate outputs here, and why `inert` is a
// first-class category rather than a footnote.

import { PERMISSION_CATALOG } from "./permissionCatalog.ts";
import { OBJECT_PERMISSIONS, VERBS, cellState } from "./objectPermissionMap.js";

const catalogById = () => {
  const m = new Map();
  for (const p of PERMISSION_CATALOG) m.set(p.id, p);
  return m;
};

/** Registered ids that are ACTIVE (a missing `active` means active; only `false` is inert). */
export function activeCapabilityIds() {
  return new Set(PERMISSION_CATALOG.filter((p) => p.active !== false).map((p) => p.id));
}

/**
 * One role's access, resolved against the catalog.
 *
 * Returns:
 *   granted    — every id the role definition names, in catalog order
 *   effective  — granted AND active: what the role can actually do today
 *   inert      — granted but registered active:false: held, and denies anyway
 *   unknown    — named by the role but ABSENT from the catalog. A grant pointing at nothing.
 *                Surfaced rather than filtered out, because a typo'd id is indistinguishable
 *                from a missing one when you silently drop both.
 */
export function resolveRoleAccess(role) {
  const byId = catalogById();
  const active = activeCapabilityIds();
  const held = [...new Set(role?.permissions ?? [])];

  const granted = [];
  const unknown = [];
  for (const id of held) {
    const def = byId.get(id);
    if (!def) {
      unknown.push(id);
      continue;
    }
    granted.push({
      id,
      description: def.description ?? null,
      domain: domainOf(id),
      active: active.has(id),
    });
  }
  granted.sort((a, b) => a.id.localeCompare(b.id));
  unknown.sort();

  return {
    roleId: role?.id ?? null,
    roleName: role?.name ?? null,
    description: role?.description ?? null,
    granted,
    effective: granted.filter((g) => g.active),
    inert: granted.filter((g) => !g.active),
    unknown,
  };
}

/** Domain = the id's first segment. `salesOrder.fulfill` -> `salesOrder`. */
export function domainOf(id) {
  const i = String(id).indexOf(".");
  return i > 0 ? String(id).slice(0, i) : String(id);
}

/** Granted capabilities grouped by domain, each group sorted, groups sorted by name. */
export function groupByDomain(granted) {
  const groups = new Map();
  for (const g of granted) {
    if (!groups.has(g.domain)) groups.set(g.domain, []);
    groups.get(g.domain).push(g);
  }
  return [...groups.entries()]
    .map(([domain, capabilities]) => ({ domain, capabilities }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

/**
 * The role's CRED reach over the business objects, reusing the SAME mapping the Objects
 * grid renders (objectPermissionMap). One table, two views — a second mapping here would
 * eventually disagree with the grid about what "Read on Accounts" means, which is this
 * codebase's most-repeated defect.
 */
export function roleObjectMatrix(role) {
  return OBJECT_PERMISSIONS.map((entry) => ({
    object: entry.object,
    domain: entry.domain,
    rulesOnly: entry.rulesOnly ?? null,
    verbs: Object.fromEntries(VERBS.map((v) => [v, cellState(role, entry, v)])),
  }));
}

/**
 * System-wide diagnostics across every role supplied.
 *
 * These are the findings a person cannot get by reading one role at a time, and each one has
 * already cost real time in this system:
 *
 *   inertGrants      — a role holds it and it denies anyway. Looks like access, is not.
 *   unreachable      — in the catalog, granted to NO supplied role. Nobody can do it, and
 *                      nothing says so; it reads as available capability.
 *   unknownGrants    — a role names an id the catalog does not define. A grant into thin air.
 *   rolesWithNothing — a role that grants no capability at all. Sometimes correct (the
 *                      least-privilege baseline) and sometimes a role that was defined and
 *                      never filled in; the screen shows it and lets a human tell which.
 */
export function accessDiagnostics(roles) {
  const active = activeCapabilityIds();
  const grantedAnywhere = new Set();
  const inertGrants = [];
  const unknownGrants = [];
  const rolesWithNothing = [];
  const byId = catalogById();

  for (const role of roles) {
    const ids = [...new Set(role?.permissions ?? [])];
    if (ids.length === 0) rolesWithNothing.push(role.id);
    for (const id of ids) {
      grantedAnywhere.add(id);
      if (!byId.has(id)) {
        unknownGrants.push({ roleId: role.id, id });
        continue;
      }
      if (!active.has(id)) inertGrants.push({ roleId: role.id, id });
    }
  }

  const unreachable = PERMISSION_CATALOG.filter((p) => !grantedAnywhere.has(p.id)).map((p) => ({
    id: p.id,
    // An unreachable capability that is ALSO inert is doubly unavailable, and saying which
    // is which stops someone "fixing" it by granting a capability that would still deny.
    active: p.active !== false,
  }));

  return {
    inertGrants: inertGrants.sort((a, b) => a.id.localeCompare(b.id)),
    unreachable: unreachable.sort((a, b) => a.id.localeCompare(b.id)),
    unknownGrants: unknownGrants.sort((a, b) => a.id.localeCompare(b.id)),
    rolesWithNothing: rolesWithNothing.sort(),
    catalogSize: PERMISSION_CATALOG.length,
    activeCount: PERMISSION_CATALOG.filter((p) => p.active !== false).length,
  };
}
