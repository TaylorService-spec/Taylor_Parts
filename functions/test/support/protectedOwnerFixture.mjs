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

/**
 * TEST FIXTURE ONLY (DECISIONS #SAE): the same protected-Owner standing as seedProtectedOwner, written with plain SQL for the suites that build their tenant by hand (no repository,
 * no Administration). `q(sql, params)` is any query function. Creates the protected `owner` Role if the tenant has none, ONE active global assignment of it for the Principal, and --
 * when `employeeId` is given -- the Employee (ACTIVE unless `employeeStatus`) and its active link, which the exemption requires. Returns { assignmentId, roleId }.
 */
export async function seedProtectedOwnerRows(q, { tenantId, principalId, employeeId = null, company = "taylor", employeeStatus = "ACTIVE", protectedRole = true }) {
  await q(`INSERT INTO eos_policy.roles (id, tenant_id, key, name, origin, protected, created_by, updated_by)
           VALUES ($1, $2, 'owner', 'Owner', 'SYSTEM', $3, 'fixture', 'fixture') ON CONFLICT (tenant_id, key) DO NOTHING`, [`role-owner-${tenantId}`, tenantId, protectedRole]);
  const roleId = (await q(`SELECT id FROM eos_policy.roles WHERE tenant_id = $1 AND key = 'owner'`, [tenantId])).rows[0].id;
  const assignmentId = `a-owner-${principalId}`;
  await q(`INSERT INTO eos_policy.user_role_assignments (id, tenant_id, principal_id, role_id, scope_type, scope_value, status, granted_by, access_version_at_grant, created_by, updated_by)
           VALUES ($1, $2, $3, $4, 'global', NULL, 'active', 'fixture', 0, 'fixture', 'fixture')`, [assignmentId, tenantId, principalId, roleId]);
  if (employeeId) {
    await q(`INSERT INTO eos_workforce.employees (id, tenant_id, employment_status, operating_company_id, updated_at) VALUES ($1, $2, $3, $4, '2020-01-01T00:00:00Z')
             ON CONFLICT DO NOTHING`, [employeeId, tenantId, employeeStatus, company]);
    await q(`INSERT INTO eos_policy.employee_principal_links (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, asserted_by, assertion_reason, status)
             VALUES ($1, $2, $3, $4, $5, 'OPERATOR_ASSERTED', 'fixture', 'SAE fixture', 'active')`, [`lnk-owner-${employeeId}`, tenantId, principalId, employeeId, company]);
  }
  return { assignmentId, roleId };
}
