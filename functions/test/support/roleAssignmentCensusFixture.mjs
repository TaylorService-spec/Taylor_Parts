// A small, SYNTHETIC two-store world for the Security Role assignment census. Shared by the offline proofs
// (in-memory policy + array legacy reader) and the integration proofs (real PostgreSQL + Firestore emulator), so
// both describe exactly the same facts. No real uid, name or email appears here.
export const CENSUS_TENANT_KEY = "census-tenant";
export const CENSUS_TENANT_ID = "tenant-census";
export const CENSUS_ACTOR = "uid-census-fixture";

/** The Role keys the fixture tenant holds. `salesManager` is deliberately ABSENT so a legacy grant of it has no key. */
export const TENANT_ROLE_KEYS = Object.freeze(["admin", "generalManager", "partsManager", "reportViewer", "technician"]);

/**
 * Legacy `roleAssignments` documents.
 *   u-matched     global admin, also in PostgreSQL                  -> matched (conditioned: refused)
 *   u-matched     reportViewer at location wh-1                      -> scoped refusal; PG holds it GLOBAL -> diff both ways
 *   u-nomember    partsManager global, Principal exists, membership disabled
 *   u-noprincipal generalManager global, no Principal at all
 *   u-matched     salesManager global, no tenant Role key
 *   u-future      generalManager global, granted AFTER the legacy access version -> not qualifying (legacy rule)
 *   u-disabled    partsManager disabled, PG holds it ACTIVE -> active status mismatch
 *   bad-1 / bad-2 malformed (no principalUid; unknown scope type)
 */
export const LEGACY_ASSIGNMENTS = Object.freeze([
  { id: "ra-01", data: { principalUid: "u-matched", roleId: "admin", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 } },
  { id: "ra-02", data: { principalUid: "u-matched", roleId: "reportViewer", scope: { type: "location", value: "wh-1" }, status: "active", accessVersionAtGrant: 2 } },
  { id: "ra-03", data: { principalUid: "u-nomember", roleId: "partsManager", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 } },
  { id: "ra-04", data: { principalUid: "u-noprincipal", roleId: "generalManager", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 } },
  { id: "ra-05", data: { principalUid: "u-matched", roleId: "salesManager", scope: { type: "global" }, status: "active", accessVersionAtGrant: 3 } },
  { id: "ra-06", data: { principalUid: "u-future", roleId: "generalManager", scope: { type: "global" }, status: "active", accessVersionAtGrant: 9 } },
  { id: "ra-07", data: { principalUid: "u-disabled", roleId: "partsManager", scope: { type: "global" }, status: "disabled", accessVersionAtGrant: 1 } },
  { id: "bad-1", data: { roleId: "admin", scope: { type: "global" }, status: "active", accessVersionAtGrant: 1 } },
  { id: "bad-2", data: { principalUid: "u-matched", roleId: "admin", scope: { type: "galaxy" }, status: "active", accessVersionAtGrant: 1 } },
]);

/** Legacy `users` documents: an accessVersion counter and the legacy `role` string (reported separately). */
export const LEGACY_USERS = Object.freeze([
  { id: "u-matched", data: { role: "admin", accessVersion: 5 } },
  { id: "u-future", data: { role: "dispatcher", accessVersion: 2 } },
  { id: "u-disabled", data: { accessVersion: 1 } },
  { id: "u-roleonly", data: { role: "technician" } },
  { id: "u-badrole", data: { role: 7 } },
]);

export const LEGACY_PRIVILEGED_REQUESTS = Object.freeze([
  { id: "pr-1", data: { status: "PENDING_APPROVAL", roleId: "admin" } },
  { id: "pr-2", data: { status: "PENDING_APPROVAL", roleId: "owner" } },
  { id: "pr-3", data: { status: "APPROVED", roleId: "admin" } },
]);

/** An array-backed legacy reader. READ paths only, like the real one. */
export function arrayLegacyReader({ assignments = LEGACY_ASSIGNMENTS, users = LEGACY_USERS, requests = LEGACY_PRIVILEGED_REQUESTS } = {}) {
  const copy = (docs) => docs.map((d) => ({ id: d.id, data: structuredClone(d.data) }));
  return {
    listRoleAssignmentDocuments: async () => copy(assignments),
    listUserProfileDocuments: async () => copy(users),
    listPrivilegedRoleRequestDocuments: async () => copy(requests),
  };
}

/**
 * Build the PostgreSQL side through the policy PORT, so it works for the in-memory and the Postgres adapter alike.
 * `createTenant` is skipped when the tenant row already exists (the Postgres proofs insert it directly).
 */
export async function seedPolicyWorld(repo, { createTenant = true } = {}) {
  return repo.transact({ tenantId: CENSUS_TENANT_ID, uid: CENSUS_ACTOR }, async (tx) => {
    if (createTenant) await tx.createTenant({ key: CENSUS_TENANT_KEY, name: "Census Tenant" });
    const roleId = {};
    for (const key of TENANT_ROLE_KEYS) {
      roleId[key] = (await tx.createRole({ key, name: key, description: null, origin: "SYSTEM", protected: false })).id;
    }
    const principal = async (subject, membershipStatus = "active") => {
      const p = await tx.createPrincipal({ externalSubject: subject, identityProvider: "firebase" });
      await tx.createTenantMembership(p.id, membershipStatus);
      return p.id;
    };
    const matched = await principal("u-matched");
    await principal("u-nomember", "disabled");
    const disabled = await principal("u-disabled");
    const pgOnly = await principal("u-pgonly");
    const grant = async (principalId, key, { scopeType = "global", scopeValue = null, status = "active", at = 0 } = {}) =>
      tx.createAssignment({ principalId, roleId: roleId[key], scopeType, scopeValue, status, grantedBy: CENSUS_ACTOR, grantedAt: "2026-09-01T00:00:00.000Z", accessVersionAtGrant: at });
    await tx.bumpAccessVersion(matched);
    await grant(matched, "admin", { at: 1 });
    await grant(matched, "reportViewer", { at: 1 }); // global in PG, location-scoped in legacy
    await tx.bumpAccessVersion(disabled);
    await grant(disabled, "partsManager", { at: 1 });
    await grant(pgOnly, "technician", { scopeType: "location", scopeValue: "wh-9", at: 4 }); // scoped + from the future
    return { roleId };
  });
}
