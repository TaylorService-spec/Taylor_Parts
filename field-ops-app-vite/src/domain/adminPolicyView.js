// Administration → Roles & Permissions — the PURE view model.
//
// ════════════════════ WHAT THIS COMPUTES, AND WHAT IT MUST NOT ════════════════════
//
// It computes DISPLAY STATE: is this cell granted, denied, inherited from the object, explicitly
// overridden, or governed by no capability at all. That is a presentation question and it belongs
// on the client.
//
// IT DOES NOT DECIDE ACCESS. The effective CRED comes from the server, already resolved by
// functions/src/adminPolicy/effectiveObjectAccess.ts, and is passed in. A second implementation of
// the resolution rules living here is exactly the defect this codebase keeps re-learning: two
// answers to one question, drifting apart, with the UI's answer being the one people trust because
// it is the one they can see.
//
// So the contract is narrow on purpose. Give it what the server said; it tells you how to draw it.
//
// ════════════════════ FIVE CELL STATES, NOT TWO ════════════════════
//
//   granted        the Role holds this verb
//   denied         it does not, and nothing explains that beyond the policy itself
//   inherited      the value came from the Object, because the field states no opinion
//   overridden     the field states its own opinion, which won
//   unavailable    no capability governs this object/verb pair, so it cannot be granted to anyone
//
// The fifth state is why this module exists rather than a boolean. Drawing "nobody can ever have
// this" as an unticked box invites an administrator to go and request access that does not exist to
// give -- the same failure the existing RoleObjectGrid was built to stop, now carried down to the
// field level where there are far more of them.
//
// ════════════════════ THE DOORWAY, SHOWN HONESTLY ════════════════════
//
// A field whose own override grants a verb the OBJECT denies is drawn as `blockedByObject`, not as
// granted. The server already resolves it to a denial; showing it as granted would tell an
// administrator they had configured something they had not. This is the one place the client
// carries knowledge of the doorway rule, and it carries it to EXPLAIN a server decision rather than
// to make one.

export const CELL_STATE = Object.freeze({
  GRANTED: "granted",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  BLOCKED_BY_OBJECT: "blockedByObject",
});

export const INHERITANCE = Object.freeze({
  INHERITED: "inherited",
  OVERRIDDEN: "overridden",
});

export const VERBS = Object.freeze(["C", "R", "E", "D"]);

export const VERB_LABEL = Object.freeze({
  C: "Create",
  R: "Read",
  E: "Edit",
  D: "Delete",
});

/** Words for each state, so every surface says the same thing about the same fact. */
export const STATE_LABEL = Object.freeze({
  [CELL_STATE.GRANTED]: "Granted",
  [CELL_STATE.DENIED]: "Not granted",
  [CELL_STATE.UNAVAILABLE]: "No capability governs this — it cannot be granted to any role",
  [CELL_STATE.BLOCKED_BY_OBJECT]: "Set on the field, but the object denies it — no access is granted",
});

export const INHERITANCE_LABEL = Object.freeze({
  [INHERITANCE.INHERITED]: "Inherited from the object",
  [INHERITANCE.OVERRIDDEN]: "Set on this field",
});

const isBool = (v) => v === true || v === false;

/**
 * One Object row.
 *
 * @param cred        the server-resolved CRED for this Role on this Object
 * @param governed    which verbs any capability governs at all; absent means "all four"
 */
export function buildObjectRow({ key, label, domain = null, cred = {}, governed = null } = {}) {
  const cells = {};
  for (const verb of VERBS) {
    if (governed && governed[verb] === false) {
      cells[verb] = { state: CELL_STATE.UNAVAILABLE, inheritance: null };
      continue;
    }
    cells[verb] = {
      state: cred[verb] === true ? CELL_STATE.GRANTED : CELL_STATE.DENIED,
      inheritance: null,
    };
  }
  return Object.freeze({ kind: "object", key, label, domain, cells: Object.freeze(cells) });
}

/**
 * One Field row beneath its Object.
 *
 * @param effective  the server-resolved CRED for this Role on this Field, doorway already applied
 * @param objectCred the server-resolved CRED for the parent Object, used to EXPLAIN, never to decide
 * @param override   the stored partial override, or null. A verb absent from it is inherited.
 */
export function buildFieldRow({ key, label, effective = {}, objectCred = {}, override = null } = {}) {
  const cells = {};
  for (const verb of VERBS) {
    const stated = override && isBool(override[verb]) ? override[verb] : null;
    const inheritance = stated === null ? INHERITANCE.INHERITED : INHERITANCE.OVERRIDDEN;

    // The doorway, shown rather than re-decided. The server already returned a denial here; this
    // only distinguishes "the policy says no" from "you set yes and the object overruled it", which
    // an administrator cannot otherwise tell apart and would keep trying to fix.
    if (stated === true && objectCred[verb] !== true) {
      cells[verb] = { state: CELL_STATE.BLOCKED_BY_OBJECT, inheritance };
      continue;
    }

    cells[verb] = {
      state: effective[verb] === true ? CELL_STATE.GRANTED : CELL_STATE.DENIED,
      inheritance,
    };
  }
  return Object.freeze({ kind: "field", key, label, cells: Object.freeze(cells) });
}

/**
 * The whole grid for one Role: objects, each with its fields.
 *
 * Fields are attached to their object rather than returned flat, because the expand/collapse
 * affordance is the only thing that makes 394 field rows readable and a flat list would have to
 * rebuild that grouping anyway.
 */
export function buildRolePolicyGrid({ objects = [], fieldsByObjectKey = {} } = {}) {
  return Object.freeze(
    objects.map((object) =>
      Object.freeze({
        ...buildObjectRow(object),
        fields: Object.freeze(
          (fieldsByObjectKey[object.key] ?? []).map((field) =>
            buildFieldRow({ ...field, objectCred: object.cred ?? {} }),
          ),
        ),
      }),
    ),
  );
}

/**
 * A one-line summary of what a Role actually holds, for the Role selector.
 *
 * Counts OBJECTS with any grant, and separately the fields that DEPART from their object. The
 * second number is the one that matters when reviewing a Role: an object row is a decision someone
 * made once, and every override is a decision someone made deliberately and may have forgotten.
 */
export function summarizeRoleGrid(grid = []) {
  let objectsWithAccess = 0;
  let overriddenFields = 0;
  let blockedFields = 0;
  for (const object of grid) {
    if (VERBS.some((v) => object.cells[v]?.state === CELL_STATE.GRANTED)) objectsWithAccess += 1;
    for (const field of object.fields ?? []) {
      if (VERBS.some((v) => field.cells[v]?.inheritance === INHERITANCE.OVERRIDDEN)) overriddenFields += 1;
      if (VERBS.some((v) => field.cells[v]?.state === CELL_STATE.BLOCKED_BY_OBJECT)) blockedFields += 1;
    }
  }
  return Object.freeze({ objectsWithAccess, overriddenFields, blockedFields });
}

/**
 * A person's assignments, grouped for the Users screen.
 *
 * ADDITIVE, AND SAID SO. Multi-role union means holding two Roles adds their access together; a
 * screen that listed them without saying that invites the reading that the last one wins. The
 * grouping keeps each assignment SEPARATELY removable, because a person may legitimately hold the
 * same Role at two scopes and "remove their salesperson role" would otherwise remove both.
 */
export function buildAssignmentList(assignments = [], rolesById = {}) {
  const active = assignments.filter((a) => a?.status === "active");
  return Object.freeze({
    additive: true,
    count: active.length,
    items: Object.freeze(
      active.map((a) =>
        Object.freeze({
          assignmentId: a.id,
          roleKey: rolesById[a.roleId]?.key ?? null,
          roleName: rolesById[a.roleId]?.name ?? "(unknown role)",
          scopeLabel: a.scopeValue ? `${a.scopeType}: ${a.scopeValue}` : a.scopeType,
          grantedBy: a.grantedBy ?? null,
          grantedAt: a.grantedAt ?? null,
          // The exact handle the revoke command needs. Never (principal, role).
          removable: true,
        }),
      ),
    ),
    // Disabled assignments are HISTORY, not access. Shown separately or not at all, never mixed in
    // with the live ones where they would read as access somebody still has.
    disabledCount: assignments.length - active.length,
  });
}

/**
 * A workflow, summarized for the Workflows list.
 *
 * The ACTIVE version is the published one with the highest number; drafts are listed separately
 * because a draft changes nothing about how records move and presenting them together would imply
 * it does.
 */
export function summarizeWorkflow({ workflow, versions = [] } = {}) {
  const published = versions.filter((v) => v.status === "PUBLISHED");
  const active = published.reduce((max, v) => (!max || v.version > max.version ? v : max), null);
  const drafts = versions.filter((v) => v.status === "DRAFT");
  return Object.freeze({
    key: workflow?.key ?? null,
    name: workflow?.name ?? null,
    objectKey: workflow?.objectKey ?? null,
    activeVersion: active ? active.version : null,
    // An unpublished workflow is not "version 0" -- it has no active version, and saying so plainly
    // is the difference between "nothing runs this yet" and "something runs an empty definition".
    activeVersionLabel: active ? `v${active.version}` : "Not published",
    draftVersions: Object.freeze(drafts.map((d) => d.version)),
    versionCount: versions.length,
  });
}
