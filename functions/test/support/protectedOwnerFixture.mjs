// TEST FIXTURE ONLY: seed a protected Owner holder the way tenant bootstrap seeds the first Administrator --
// straight through the repository transaction, with an access-version bump -- because ordinary role
// administration can no longer appoint the protected Owner (Controller ruling 2026-09-27: assignRole refuses
// PROTECTED_OWNER_MEMBERSHIP) and Owner succession is a separate lifecycle operation that does not exist yet.
//
// This is a fixture, not a product path: it is not exported by any source module and no command reaches it.

/** Give `principalId` an ACTIVE, GLOBAL assignment of the protected `owner` Role in `tenantId`. Returns the assignment. */
export async function seedProtectedOwner(repo, { tenantId, principalId, performedBy = "fixture:protected-owner" }) {
  const ownerRole = await repo.getRoleByKey(tenantId, "owner");
  if (!ownerRole) throw new Error("fixture: tenant has no owner Role");
  return repo.transact({ tenantId, uid: performedBy }, async (tx) => {
    const accessVersion = await tx.bumpAccessVersion(principalId);
    return tx.createAssignment({
      principalId,
      roleId: ownerRole.id,
      scopeType: "global",
      scopeValue: null,
      status: "active",
      grantedBy: performedBy,
      grantedAt: new Date().toISOString(),
      accessVersionAtGrant: accessVersion,
    });
  });
}
