// HIERARCHICAL VISIBILITY -- turning "who am I" into "whose work can I see".
//
// roleHierarchy.ts describes the organisation tree. This is what makes it do
// something: given an authenticated principal, it resolves the set of EMPLOYEES
// whose records that principal may see, by walking down from every Role they hold.
//
// THE RULE, from the Owner (2026-08-19): anyone above sees what is below them, and
// people at the same level in different branches see nothing of each other. So a
// Sales Manager sees their salespeople; an Operations Manager sees the whole
// operations side; neither sees the other.
//
// VISIBILITY IS NOT AUTHORITY. This never grants a capability. It answers "which
// records does a capability I ALREADY hold reach". A principal with no read
// capability sees nothing regardless of how senior their position is, and a
// principal with a read capability but no position still sees their own work. Both
// halves are required, and this module is only ever the second one.
//
// ALWAYS SERVER-SIDE. The employeeId <-> uid join happens here, from stored
// roleAssignments, because a client cannot be trusted to assert which employee it
// is or which Roles it holds. A client-side filter over a fuller result set is not
// a filter at all -- the data was already sent.

import { descendantsOf, NON_HIERARCHICAL_ROLES } from "./roleHierarchy";

/**
 * PURE. Every Role whose holders are visible to a viewer holding `viewerRoleIds`.
 *
 * Deliberately does NOT include the viewer's own Roles: a salesperson does not see
 * other salespeople, and two sales managers do not see each other. Peer visibility
 * is a separate decision nobody has made, and defaulting it on would be the
 * expensive direction to be wrong in.
 *
 * Capability-specific Roles (crmActivityContributor, the cycle-count Roles, and so
 * on) contribute nothing: they are grants, not positions, so holding one neither
 * widens what their holder sees nor makes that holder visible to anyone.
 */
export function visibleRoleIdsFor(viewerRoleIds: readonly string[]): ReadonlySet<string> {
  const visible = new Set<string>();
  for (const roleId of viewerRoleIds ?? []) {
    if (!roleId || NON_HIERARCHICAL_ROLES.has(roleId)) continue;
    for (const beneath of descendantsOf(roleId)) visible.add(beneath);
  }
  return visible;
}

/** One principal's stored position: the active Roles they hold, and who they are. */
export interface PrincipalPosition {
  readonly principalUid: string;
  readonly employeeId: string | null;
  readonly roleIds: readonly string[];
}

/**
 * PURE. The employeeIds a viewer may see.
 *
 * `population` is every principal with their Roles -- normally the whole employee
 * directory, which is small in this system and does not justify a per-record query.
 *
 * The viewer's OWN employeeId is always included. Someone must be able to see their
 * own work regardless of position, and a leaf Role with nobody beneath it would
 * otherwise resolve to an empty set and hide the viewer from themselves.
 *
 * Fail-closed everywhere else: an unknown viewer, a viewer with no Roles, or a
 * viewer holding only capability-specific Roles resolves to their own records and
 * nothing more.
 */
export function visibleEmployeeIdsFor(
  viewerUid: string,
  population: readonly PrincipalPosition[],
): ReadonlySet<string> {
  const out = new Set<string>();
  const viewer = (population ?? []).find((p) => p.principalUid === viewerUid);
  if (!viewer) return out; // unknown principal sees nothing, not everything

  if (viewer.employeeId) out.add(viewer.employeeId);

  const visibleRoles = visibleRoleIdsFor(viewer.roleIds);
  if (visibleRoles.size === 0) return out;

  for (const person of population) {
    if (!person.employeeId) continue;
    if (person.principalUid === viewerUid) continue;
    if ((person.roleIds ?? []).some((r) => visibleRoles.has(r))) out.add(person.employeeId);
  }
  return out;
}

/**
 * Does `viewerUid` may see records owned by `subjectEmployeeId`?
 *
 * The question every owner-scoped read actually asks, expressed once so callers do
 * not each re-derive it and drift.
 */
export function canSeeEmployeeRecords(
  viewerUid: string,
  subjectEmployeeId: string | null | undefined,
  population: readonly PrincipalPosition[],
): boolean {
  if (!subjectEmployeeId) return false; // an unowned record is not "visible to everyone"
  return visibleEmployeeIdsFor(viewerUid, population).has(subjectEmployeeId);
}

/**
 * Reads the population from Firestore: every user with their ACTIVE role assignments.
 *
 * Kept separate from the pure functions above so the rules can be tested without a
 * database, matching this repository's "pure logic lives apart from its IO" pattern.
 *
 * `db` is injected rather than imported so this module never opens its own
 * connection and can be exercised against the emulator or a fake.
 */
export async function loadPrincipalPositions(db: FirebaseFirestore.Firestore): Promise<PrincipalPosition[]> {
  const [usersSnap, assignmentsSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("roleAssignments").where("status", "==", "active").get(),
  ]);

  const rolesByUid = new Map<string, string[]>();
  for (const doc of assignmentsSnap.docs) {
    const data = doc.data() as { principalUid?: string; roleId?: string };
    if (!data.principalUid || !data.roleId) continue;
    const list = rolesByUid.get(data.principalUid) ?? [];
    list.push(data.roleId);
    rolesByUid.set(data.principalUid, list);
  }

  return usersSnap.docs.map((doc) => {
    const data = doc.data() as { employeeId?: string };
    return {
      principalUid: doc.id,
      employeeId: typeof data.employeeId === "string" ? data.employeeId : null,
      roleIds: rolesByUid.get(doc.id) ?? [],
    };
  });
}
