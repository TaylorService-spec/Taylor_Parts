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

/**
 * Registered ids the CATALOG marks active. A missing `active` means active; only `false` is inert.
 *
 * This is the catalogue's answer, not the environment's. On its own it is incomplete -- see
 * operableCapabilityIds below, which is the one a screen should ask.
 */
export function activeCapabilityIds() {
  return new Set(PERMISSION_CATALOG.filter((p) => p.active !== false).map((p) => p.id));
}

/**
 * Registered ids that are OPERABLE IN THIS ENVIRONMENT -- catalogue-active, PLUS anything this
 * environment activates through the governed per-environment override.
 *
 * ============================ WHY THIS EXISTS ============================
 *
 * `active: false` in the catalog does NOT mean "inert everywhere". It means "inert unless the
 * environment activates it", and that second half is how every capability shipped since the
 * activation programme reaches anybody at all. A screen reading only the catalog reports a
 * capability as denied while the backend resolver -- reading the same override set -- allows it.
 *
 * Data Import made the gap visible: `admin.dataImport.stage` and `.execute` are registered
 * active:false, held by Administrator through the derived catalogue grant, and ACTIVATED in
 * platform-sandbox. The inspector called them inert while the product ran them.
 *
 * ============================ WHAT IS NOT DUPLICATED HERE ============================
 *
 * The override set is CONSUMED, never recomputed. `config/capabilityActivationOverrides.js`
 * bakes it at build time from the ONE registry via resolveEnvironment.mjs, which is role-keyed
 * (production resolves to []) and already intersects the declaration with the eligibility
 * allow-list. So production cannot be widened from here, and an environment cannot activate a
 * capability nobody made eligible -- neither rule is re-implemented in this file.
 *
 * INTERSECTED WITH THE CATALOG all the same. An override naming an id the catalog does not
 * define must not conjure a capability into existence; it stays an unknown grant, which is the
 * category that already exists for exactly that.
 */
export function operableCapabilityIds(activationOverrides = EMPTY_OVERRIDES) {
  const operable = activeCapabilityIds();
  const registered = catalogById();
  for (const id of activationOverrides) {
    if (registered.has(id)) operable.add(id);
  }
  return operable;
}

/**
 * The default: NO environment activation.
 *
 * Deliberately the conservative direction. A caller that forgets to pass the environment's set
 * under-reports what a role can do, which is a visible wrong answer somebody chases. The
 * opposite default would over-report -- telling an administrator authority exists where it does
 * not, which is the failure this whole model was built to prevent.
 */
const EMPTY_OVERRIDES = Object.freeze(new Set());

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
export function resolveRoleAccess(role, { activationOverrides = EMPTY_OVERRIDES } = {}) {
  const byId = catalogById();
  const catalogActive = activeCapabilityIds();
  const operable = operableCapabilityIds(activationOverrides);
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
      // The CATALOG's answer, kept so the two can be told apart rather than merged into one
      // flag that could no longer explain itself.
      active: catalogActive.has(id),
      // The answer that decides which list this lands in.
      operable: operable.has(id),
      // True only for the interesting case: inert in the catalog, reachable here anyway. The
      // screen says so out loud, because "active" and "active BECAUSE THIS ENVIRONMENT SAYS SO"
      // are different facts and an administrator planning production needs the difference.
      activatedByEnvironment: !catalogActive.has(id) && operable.has(id),
    });
  }
  granted.sort((a, b) => a.id.localeCompare(b.id));
  unknown.sort();

  return {
    roleId: role?.id ?? null,
    roleName: role?.name ?? null,
    description: role?.description ?? null,
    granted,
    effective: granted.filter((g) => g.operable),
    inert: granted.filter((g) => !g.operable),
    // Called out separately so a reader can see at a glance how much of this role's reach
    // depends on an environment setting rather than on the catalog.
    environmentActivated: granted.filter((g) => g.activatedByEnvironment),
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
export function accessDiagnostics(roles, { activationOverrides = EMPTY_OVERRIDES } = {}) {
  // The SAME question resolveRoleAccess asks, asked the same way. A diagnostics panel counting
  // catalogue-inert while the list beside it counts environment-operable would put two numbers
  // on one screen that disagree -- and the reader has no way to know which is answering theirs.
  const active = operableCapabilityIds(activationOverrides);
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

// ─────────────────────────────────────────────────────────────────────────────
// THE OBJECT SIDE.
//
// Everything above reads the model from a ROLE: pick a role, see its reach. The Objects grid
// does the same — it is role-first, one role at a time across every object.
//
// That leaves "who can delete a Sales Order?" answerable only by selecting each of sixteen
// roles in turn and reading one column. The question is ordinary and the answer is in the same
// data; it simply had no view. These functions are that view, built on the SAME
// objectPermissionMap the grid renders, so the two can never disagree about what a verb means.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One object's full picture: for each verb, the capabilities behind it and every supplied role
 * that holds at least one of them.
 *
 * `state` per verb:
 *   noCapability — nothing in the catalog governs it. NOT the same as "nobody was granted it",
 *                  and never rendered the same way: one is a gap in the model, the other is a
 *                  decision about people.
 *   nobody       — capabilities exist and no supplied role holds any. Someone could be granted
 *                  this; nobody has been.
 *   held         — at least one role can do it.
 */
export function objectAccess(entry, roles) {
  const active = activeCapabilityIds();
  const byId = catalogById();

  const verbs = {};
  for (const verb of VERBS) {
    const ids = entry[verb] ?? [];
    const capabilities = ids.map((id) => ({
      id,
      // A capability the mapping names but the catalog does not define. Same reasoning as the
      // role side: a typo and a deletion are indistinguishable once both are dropped.
      known: byId.has(id),
      active: active.has(id),
      heldBy: roles.filter((r) => (r?.permissions ?? []).includes(id)).map((r) => r.id),
    }));
    const holders = [...new Set(capabilities.flatMap((c) => c.heldBy))].sort();
    verbs[verb] = {
      capabilities,
      holders,
      state: ids.length === 0 ? "noCapability" : holders.length === 0 ? "nobody" : "held",
      // Every capability behind this verb is registered inactive, so even the roles listed as
      // holders cannot perform it. Holders WITHOUT the ability to act is precisely the state a
      // plain tick misrepresents.
      allInert: ids.length > 0 && capabilities.every((c) => !c.active),
    };
  }

  return {
    object: entry.object,
    domain: entry.domain,
    rulesOnly: entry.rulesOnly ?? null,
    verbs,
  };
}

/** Every object, resolved. */
export function objectAccessAll(roles) {
  return OBJECT_PERMISSIONS.map((entry) => objectAccess(entry, roles));
}

/**
 * Object-side diagnostics — the findings that only appear reading down the object axis.
 *
 *   ungoverned      — objects the capability model does not govern for ANY verb. Some are
 *                     governed by firestore.rules instead (marked), which is a different
 *                     mechanism rather than an absence; the rest are genuine model gaps.
 *   nobodyCan       — object/verb pairs where capabilities exist and no role holds them. A
 *                     capability nobody was given, as opposed to one that does not exist.
 *   inertOnly       — object/verb pairs whose every backing capability is inactive, so the
 *                     roles shown as holders still cannot act.
 */
export function objectDiagnostics(roles) {
  const all = objectAccessAll(roles);
  const ungoverned = [];
  const nobodyCan = [];
  const inertOnly = [];

  for (const o of all) {
    if (VERBS.every((v) => o.verbs[v].state === "noCapability")) {
      ungoverned.push({ object: o.object, domain: o.domain, rulesOnly: o.rulesOnly });
    }
    for (const v of VERBS) {
      if (o.verbs[v].state === "nobody") nobodyCan.push({ object: o.object, verb: v });
      if (o.verbs[v].allInert) inertOnly.push({ object: o.object, verb: v });
    }
  }

  return { ungoverned, nobodyCan, inertOnly };
}
