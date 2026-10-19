// HIERARCHICAL VISIBILITY -- the Firestore loader. The pure rules (visibleRoleIdsFor, visibleEmployeeIdsFor, canSeeEmployeeRecords, PrincipalPosition)
// live in ./hierarchicalVisibilityCore so the EOS API process (functions/src/eosOps/performanceGoalReads.ts) can use them WITHOUT reaching a Firestore
// collection accessor (test/platformQaEosApiFirebaseFootprint.test.mjs). Every export is unchanged for existing callers.

export * from "./hierarchicalVisibilityCore";
import type { PrincipalPosition } from "./hierarchicalVisibilityCore";

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
