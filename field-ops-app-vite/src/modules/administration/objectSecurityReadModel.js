// THE CANONICAL SECURITY READ MODEL, in the shape the PostgreSQL authority already answers in.
//
// ════════════════════ WHAT THIS IS FOR ════════════════════
//
// The EOS API serves three projections of ONE authority, plus the inventory the first two are read
// against (functions/src/adminPolicy/objectSecurityAuthority.ts). Those payloads are correct and
// they are NOT renderable as they stand:
//
//   getRoleSecurity             objects: { workOrder: ["create", "dispatch"] }  -- keys, no labels
//   getPrincipalEffectiveAccess objects: { workOrder: ["dispatch"] }            -- keys, no labels
//
// A screen given only that can do one of two things: show an administrator `workOrder.lifecycle.
// dispatch`, or invent a label for it. The first is an implementation identifier used as a human
// interface; the second is a SECOND label vocabulary, which this repository has already paid for
// once (see the deleted titleCase() in modules/workOrders/WorkOrderDetailPage.jsx, which disagreed
// with the governed vocabulary on two of five values).
//
// So this module JOINS the inventory -- which carries the canonical `displayLabel`, `actionKind`
// and `capabilityKey` for every governed action -- onto the two projections that omit it, and
// normalises all three into one shape. It derives NO access. Every grant, every provenance and
// every ordering here came from the server.
//
// ════════════════════ WHAT IT MUST NEVER DO ════════════════════
//
//   decide access                 a client-only permission check is never sufficient; these are for
//                                 DISPLAY -- showing what the server answered
//   invent a label                a missing displayLabel is a DEFECT (capabilities.display_label is
//                                 NOT NULL since migration 1761350400000), not a state to paper
//                                 over with a humanised action key
//   show a capability key as the name   the key is audit detail, never the administrator's word
//   turn a refusal into an empty model  `null` in, `null` out. A grid drawn from an empty model
//                                 reads as "nobody holds anything", which on a security screen is
//                                 the worst available lie
//   re-sort                       the server orders actions CRUD-first then business then admin,
//                                 and objects alphabetically. A second ordering is a second answer
//   fold in a business fact       Work Eligibility, Operational Scope and the linked Employee are
//                                 absent from the Principal payload BY THE SERVER'S DESIGN

/** What a row is called when the server sent no label. Never a humanised key, never the key. */
export const UNLABELLED_ACTION = "Unlabelled action";

/** What an Object is called when the inventory does not know it. Never the raw object key alone. */
export const UNKNOWN_OBJECT = "Unregistered Object";

const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/**
 * The administrator-facing name of one action, and the key kept beside it for audit.
 *
 * `labelMissing` is surfaced rather than smoothed over: the column is NOT NULL in PostgreSQL, so a
 * blank one means the payload did not come from the canonical catalog, and a screen that quietly
 * rendered something plausible would hide that.
 */
export function actionDisplay(action) {
  const label = str(action?.displayLabel);
  const capabilityKey = str(action?.capabilityKey);
  return Object.freeze({
    name: label || UNLABELLED_ACTION,
    capabilityKey: capabilityKey || null,
    labelMissing: label.length === 0,
  });
}

/**
 * The inventory, indexed for joining: objectKey -> { label, supportsDelete, actions by actionKey }.
 *
 * Built from `listObjectsWithActions`. A null inventory is not an empty index -- the callers below
 * refuse to build a model without one, because a join against nothing would silently produce a
 * model in which every action is unlabelled.
 */
export function indexInventory(objectsWithActions) {
  if (!Array.isArray(objectsWithActions)) return null;
  const byObject = new Map();
  for (const entry of objectsWithActions) {
    const key = str(entry?.key);
    if (!key) continue;
    const actions = new Map();
    for (const action of Array.isArray(entry?.actions) ? entry.actions : []) {
      const actionKey = str(action?.actionKey);
      if (!actionKey) continue;
      actions.set(actionKey, Object.freeze({
        actionKey,
        actionKind: str(action?.actionKind) || null,
        displayLabel: str(action?.displayLabel) || null,
        capabilityKey: str(action?.capabilityKey) || null,
      }));
    }
    byObject.set(key, Object.freeze({
      objectKey: key,
      label: str(entry?.label) || null,
      supportsDelete: entry?.supportsDelete === true,
      actions,
    }));
  }
  return byObject;
}

// ════════════════════ OBJECT VIEW ════════════════════

/**
 * Object -> actions -> Role grants AND Principal grants, from `getObjectSecurityMatrix`.
 *
 * The matrix payload is already complete -- it carries the label, the kind and the capability key
 * on every row -- so this normalises rather than joins. What it ADDS is the counting an
 * administrator reads the grid for: which actions nobody holds at all, and the union of every Role
 * and Principal that reaches this Object.
 */
export function buildObjectSecurityReadModel(matrix) {
  if (!isObject(matrix) || !Array.isArray(matrix.actions)) return null;
  const objectKey = str(matrix.objectKey);
  if (!objectKey) return null;

  const actions = matrix.actions.map((row) => {
    const display = actionDisplay(row);
    const roleKeys = Object.freeze(list(row?.roleKeys));
    const principalIds = Object.freeze(list(row?.principalIds));
    return Object.freeze({
      actionKey: str(row?.actionKey),
      actionKind: str(row?.actionKind) || null,
      // The name an administrator reads, and the key they cite in an audit. Both, never one.
      displayLabel: display.name,
      capabilityKey: display.capabilityKey,
      labelMissing: display.labelMissing,
      roleKeys,
      principalIds,
      granteeCount: roleKeys.length + principalIds.length,
      // "Nobody holds Dispatch" is the row an administrator came to find. It is a FALSE value on a
      // present row, never an absent row.
      granted: roleKeys.length + principalIds.length > 0,
    });
  });

  const roleKeys = new Set();
  const principalIds = new Set();
  for (const a of actions) {
    for (const k of a.roleKeys) roleKeys.add(k);
    for (const p of a.principalIds) principalIds.add(p);
  }

  return Object.freeze({
    view: "OBJECT",
    objectKey,
    label: str(matrix.label) || null,
    supportsDelete: matrix.supportsDelete === true,
    actions: Object.freeze(actions),
    summary: Object.freeze({
      actionCount: actions.length,
      grantedActionCount: actions.filter((a) => a.granted).length,
      ungrantedActionKeys: Object.freeze(actions.filter((a) => !a.granted).map((a) => a.actionKey)),
      roleKeys: Object.freeze([...roleKeys].sort()),
      principalIds: Object.freeze([...principalIds].sort()),
      unlabelledActionKeys: Object.freeze(actions.filter((a) => a.labelMissing).map((a) => a.actionKey)),
    }),
  });
}

// ════════════════════ ROLE VIEW ════════════════════

/**
 * Role -> Objects -> actions, from `getRoleSecurity` JOINED to the inventory.
 *
 * The server sends `{ roleKey, name, objects: { objectKey: [actionKey] } }` -- grant facts with no
 * vocabulary. Everything human about the result comes from the inventory, and anything the
 * inventory cannot explain is REPORTED rather than dropped:
 *
 *   unknownObjectKeys   the Role holds an action on an Object the tenant's inventory does not list
 *   unknownActionKeys   the Role holds an action the canonical catalog does not declare
 *
 * Both are impossible through the database's foreign keys and reachable through a stale payload.
 * Dropping either would show an administrator a Role with LESS access than it has.
 */
export function buildRoleSecurityReadModel(roleSecurity, objectsWithActions) {
  if (!isObject(roleSecurity) || !isObject(roleSecurity.objects)) return null;
  const roleKey = str(roleSecurity.roleKey);
  if (!roleKey) return null;
  const inventory = indexInventory(objectsWithActions);
  if (!inventory) return null;

  const unknownObjectKeys = [];
  const objects = [];
  // The server already sorted its object keys; Object.entries preserves that insertion order.
  for (const [objectKey, actionKeys] of Object.entries(roleSecurity.objects)) {
    const known = inventory.get(objectKey) ?? null;
    if (!known) unknownObjectKeys.push(objectKey);
    const unknownActionKeys = [];
    const actions = list(actionKeys).map((actionKey) => {
      const meta = known?.actions.get(actionKey) ?? null;
      if (!meta) unknownActionKeys.push(actionKey);
      const display = actionDisplay(meta);
      return Object.freeze({
        actionKey,
        actionKind: meta?.actionKind ?? null,
        displayLabel: display.name,
        capabilityKey: display.capabilityKey,
        labelMissing: display.labelMissing,
        // Every action in this projection is one the Role HOLDS: the server sent the grants, not
        // the inventory. An ungranted action does not appear here at all, which is why the Object
        // view -- not this one -- is where "nobody holds Dispatch" is read.
        granted: true,
      });
    });
    objects.push(Object.freeze({
      objectKey,
      label: known?.label ?? UNKNOWN_OBJECT,
      known: Boolean(known),
      actions: Object.freeze(actions),
      unknownActionKeys: Object.freeze(unknownActionKeys),
    }));
  }

  const actionCount = objects.reduce((n, o) => n + o.actions.length, 0);
  return Object.freeze({
    view: "ROLE",
    roleKey,
    name: str(roleSecurity.name) || null,
    objects: Object.freeze(objects),
    summary: Object.freeze({
      objectCount: objects.length,
      actionCount,
      unknownObjectKeys: Object.freeze(unknownObjectKeys),
      unlabelledActionKeys: Object.freeze(
        objects.flatMap((o) => o.actions.filter((a) => a.labelMissing).map((a) => a.actionKey)),
      ),
    }),
  });
}

// ════════════════════ PRINCIPAL VIEW ════════════════════

/** A capability reached both ways is ONE row that says so, never two rows. The server's word. */
export const ACCESS_SOURCE_LABEL = Object.freeze({
  ROLE: "Through a Security Role",
  DIRECT: "Granted directly",
  ROLE_AND_DIRECT: "Through a Security Role and directly",
});

/**
 * Principal -> Roles + direct grants -> effective access, from `getPrincipalEffectiveAccess`.
 *
 * `effective` already carries the label, the kind, the capability key and the PROVENANCE of every
 * capability, so the join here supplies only the Object's own label. The grouping by Object is a
 * REGROUPING of the server's own rows, and it is checked against the grouping the server sent in
 * `objects`: if the two disagree, `groupingMatchesServer` is false and the screen must say so
 * rather than pick one. Two answers to "what does this person hold" is the condition this whole
 * subsystem exists to end.
 *
 * A PRINCIPAL, not an Employee. Work Eligibility, Operational Scope and the linked Employee are not
 * in the payload and must not be joined on here.
 */
export function buildPrincipalAccessReadModel(access, objectsWithActions) {
  if (!isObject(access) || !Array.isArray(access.effective)) return null;
  const principalId = str(access.principalId);
  if (!principalId) return null;
  const inventory = indexInventory(objectsWithActions);
  if (!inventory) return null;

  const byObject = new Map();
  const bySource = { ROLE: 0, DIRECT: 0, ROLE_AND_DIRECT: 0 };
  for (const cap of access.effective) {
    const objectKey = str(cap?.objectKey);
    const actionKey = str(cap?.actionKey);
    if (!objectKey || !actionKey) continue;
    const source = str(cap?.source);
    if (source in bySource) bySource[source] += 1;
    const display = actionDisplay(cap);
    if (!byObject.has(objectKey)) byObject.set(objectKey, []);
    byObject.get(objectKey).push(Object.freeze({
      actionKey,
      actionKind: str(cap?.actionKind) || null,
      displayLabel: display.name,
      capabilityKey: display.capabilityKey,
      labelMissing: display.labelMissing,
      source: source || null,
      sourceLabel: ACCESS_SOURCE_LABEL[source] ?? null,
      granted: true,
    }));
  }

  const objects = [...byObject.entries()].map(([objectKey, actions]) => {
    const known = inventory.get(objectKey) ?? null;
    return Object.freeze({
      objectKey,
      label: known?.label ?? UNKNOWN_OBJECT,
      known: Boolean(known),
      actions: Object.freeze(actions),
    });
  });

  // The server's own grouping, re-derived here from its own rows. Equal, or the model says not.
  const serverGrouping = isObject(access.objects) ? access.objects : null;
  const derived = Object.fromEntries(
    objects.map((o) => [o.objectKey, o.actions.map((a) => a.actionKey).slice().sort()]),
  );
  const groupingMatchesServer = serverGrouping !== null && (() => {
    const mineKeys = Object.keys(derived).sort();
    const theirKeys = Object.keys(serverGrouping).sort();
    if (mineKeys.length !== theirKeys.length) return false;
    if (mineKeys.some((k, i) => k !== theirKeys[i])) return false;
    return mineKeys.every((k) => {
      const mine = derived[k];
      const theirs = list(serverGrouping[k]).slice().sort();
      return mine.length === theirs.length && mine.every((v, i) => v === theirs[i]);
    });
  })();

  return Object.freeze({
    view: "PRINCIPAL",
    principalId,
    roleKeys: Object.freeze(list(access.roles)),
    // Capability IDS, which is what the server sends for a direct grant. They are deliberately NOT
    // rendered as access: the DIRECT and ROLE_AND_DIRECT rows in `effective` are the readable form
    // of the same fact, and an id an administrator cannot resolve is not an answer.
    directGrantCount: list(access.directGrants).length,
    objects: Object.freeze(objects),
    groupingMatchesServer,
    summary: Object.freeze({
      objectCount: objects.length,
      capabilityCount: access.effective.length,
      bySource: Object.freeze({ ...bySource }),
      roleCount: list(access.roles).length,
      unlabelledActionKeys: Object.freeze(
        objects.flatMap((o) => o.actions.filter((a) => a.labelMissing).map((a) => a.actionKey)),
      ),
    }),
  });
}
