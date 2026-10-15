"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPLIED_AUTHORITY_FIELDS = void 0;
exports.assertNoSuppliedAuthority = assertNoSuppliedAuthority;
exports.withDirectCapabilityGrants = withDirectCapabilityGrants;
exports.resolveEmployeeAdministrationActor = resolveEmployeeAdministrationActor;
const postgresPolicyRepository_1 = require("../../adminPolicy/postgresPolicyRepository");
const employmentAccessEligibility_1 = require("../../adminPolicy/employmentAccessEligibility");
const capabilityAuthority_1 = require("../../eosOps/capabilityAuthority");
const entitledActionAuthority_1 = require("../../eosOps/entitledActionAuthority");
const conditionalEntitlement_1 = require("../../eosOps/conditionalEntitlement");
const employeeCommandKernel_1 = require("./employeeCommandKernel");
/**
 * Field and flag names that would SUPPLY authority instead of naming a target.
 *
 * `principalId` is deliberately ABSENT: the Employee administration commands name a TARGET Principal
 * for the Employee<->Principal link, and the transport already refuses `principalId` in a body, which
 * is why those commands spell their target `linkedPrincipalId` / `newPrincipalId` /
 * `expectedCurrentPrincipalId` and never `principalId`.
 */
exports.SUPPLIED_AUTHORITY_FIELDS = Object.freeze([
    "capabilities", "capability", "entitlements", "entitlement", "grant", "grants", "heldRoleKeys",
    "heldRoles", "permission", "permissions", "role", "roleKeys", "roles", "securityRole", "securityRoles",
]);
/**
 * Refuse a caller that states authority. Runs before any connection is opened, so the refusal costs
 * no read and cannot be confused with a database answer.
 */
function assertNoSuppliedAuthority(named) {
    const supplied = exports.SUPPLIED_AUTHORITY_FIELDS.filter((f) => named.includes(f));
    if (supplied.length > 0) {
        throw new employeeCommandKernel_1.EmployeeCommandError("AUTHORITY_ARGUMENT_REFUSED", "FORBIDDEN", `${supplied.join(", ")} would SUPPLY authority. The administering Principal's Roles are READ FROM `
            + "PostgreSQL from its active assignments and its capabilities resolved from eos_policy.role_capabilities "
            + "and eos_policy.principal_capabilities; no Role, capability, entitlement or grant is ever accepted as "
            + "an argument, because an asserted capability set makes the governed command's own gate decorative.");
    }
}
const isResolvedActor = (actor) => {
    const a = actor;
    return !!a && (0, employeeCommandKernel_1.ID_SHAPE)(a.tenantId) && (0, employeeCommandKernel_1.ID_SHAPE)(a.principalId) && a.capabilities instanceof Set
        && (0, conditionalEntitlement_1.hasResolvedEntitlements)(a);
};
/** One memoized resolution per actor, and a rejection is memoized too: an outage never becomes an allow. */
function memoize(resolve) {
    let pending;
    return () => (pending ??= resolve());
}
/**
 * The SAME actor, with this Principal's DIRECT capability grants counted.
 *
 * Returns the actor unchanged when the Role-resolved set already carries `requiredCapability` (the
 * lazy order), when the actor is not a resolved actor at all (the command kernel refuses it, and
 * refusing there keeps one refusal in one place), or when the Principal holds no direct grant.
 *
 * `capabilityKeysOf(await actor.entitlements())` still EQUALS `actor.capabilities` on the way out:
 * both sides take the union, so the two resolvers cannot drift apart.
 */
async function withDirectCapabilityGrants(pool, actor, requiredCapability) {
    if (!isResolvedActor(actor) || actor.capabilities.has(requiredCapability))
        return actor;
    // SINCE LANE DX the transport's resolution (capabilityAuthority.resolveOperationalCapabilities) already counts
    // direct exceptions, WITH their conditions. A key it placed in `conditionallyHeld` is conditioned: it must never
    // be promoted into the flat set here, so the actor is returned unchanged and the command refuses it flat.
    const conditionallyHeld = actor.conditionallyHeld;
    if (conditionallyHeld instanceof Set && conditionallyHeld.has(requiredCapability))
        return actor;
    let direct;
    try {
        // The Principal's unexpired direct grants WITH the PRINCIPAL-cell conditions from PostgreSQL: a conditioned
        // direct grant is an entitlement with its condition, never a flat key.
        const conditions = await (0, entitledActionAuthority_1.postgresGrantConditionProvider)(pool)(actor.tenantId);
        direct = await (0, entitledActionAuthority_1.resolveDirectEntitlements)(pool, actor.tenantId, actor.principalId, conditions);
    }
    catch {
        // FAIL CLOSED. An unreadable grant store is not "no direct grants": it is an authority that
        // could not be consulted, and the command must refuse rather than decide without it.
        throw new employeeCommandKernel_1.EmployeeCommandError("DIRECT_GRANT_AUTHORITY_UNAVAILABLE", "FAILED", "the direct capability grants of the administering Principal could not be read");
    }
    if (direct.length === 0)
        return actor;
    const unconditioned = direct.filter((e) => e.condition === null).map((e) => e.capabilityKey);
    const capabilities = new Set([...actor.capabilities, ...unconditioned]);
    const roleEntitlements = actor.entitlements;
    return Object.freeze({
        tenantId: actor.tenantId,
        principalId: actor.principalId,
        capabilities,
        // The entitlements this request already resolved, plus the direct grants with the PRINCIPAL grantor and their
        // condition kept -- de-duplicated, because the transport's resolver may already carry them.
        entitlements: memoize(async () => {
            const resolved = await roleEntitlements();
            const seen = new Set(resolved.map((e) => `${e.grantor.kind}:${e.grantor.principalId ?? e.grantor.roleKey}|${e.capabilityKey}`));
            return Object.freeze([...resolved, ...direct.filter((e) => !seen.has(`PRINCIPAL:${e.grantor.principalId}|${e.capabilityKey}`))]);
        }),
    });
}
/**
 * Resolve a NAMED administering Principal to an actor, entirely from PostgreSQL.
 *
 * The operator entry point's authority, and the only resolution besides the transport's. It refuses
 * -- never narrows -- an unknown Principal, a disabled Principal, or a Principal with no ACTIVE
 * membership in the named tenant. A Principal holding zero Roles and zero direct grants resolves
 * successfully with an EMPTY capability set: "authenticated but authorized for nothing", which the
 * command's own gate then refuses with CAPABILITY_REQUIRED. That refusal is the gate working, and it
 * is never fixed by handing the caller a set.
 */
async function resolveEmployeeAdministrationActor(pool, request) {
    assertNoSuppliedAuthority(Object.keys(request ?? {}));
    const { tenantId, principalId } = request ?? {};
    if (!(0, employeeCommandKernel_1.ID_SHAPE)(tenantId) || !(0, employeeCommandKernel_1.ID_SHAPE)(principalId)) {
        throw new employeeCommandKernel_1.EmployeeCommandError("ADMINISTRATOR_REQUIRED", "FORBIDDEN", "a tenant id and an administering Principal id are required; neither is inferred");
    }
    const member = await pool.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active'`, [tenantId, principalId]);
    if (member.rows.length === 0) {
        throw new employeeCommandKernel_1.EmployeeCommandError("ADMINISTRATOR_NOT_ACTIVE_MEMBER", "FORBIDDEN", "the administering Principal must be an ACTIVE Principal with an ACTIVE membership in this tenant");
    }
    // EMPLOYMENT ACCESS ELIGIBILITY (DQ-007): the same rule, the same relations, as principal resolution -- an
    // administering Principal linked to a non-eligible Employee administers nothing, whatever Roles remain assigned.
    const ineligible = (0, employmentAccessEligibility_1.employeeAccessIneligibility)(await new postgresPolicyRepository_1.PostgresPolicyRepository(pool).getLinkedEmployeeAccessFact(tenantId, principalId));
    if (ineligible) {
        throw new employeeCommandKernel_1.EmployeeCommandError("ADMINISTRATOR_NOT_ACCESS_ELIGIBLE", "FORBIDDEN", `the administering Principal is refused: ${ineligible}`);
    }
    // ACTIVE, GLOBAL, NON-STALE assignments only (Pass 9 S3) -- the runtime's rule (loadPrincipalPolicy
    // .qualifyingRoleIds). A SCOPED assignment is decided only against a record's business context, which an operator
    // command has none of, so it contributes nothing here; counting it would make "Role @ Company X" tenant-wide.
    const heldRoleKeys = (await pool.query(`SELECT DISTINCT r.key AS key FROM eos_policy.user_role_assignments a
       JOIN eos_policy.roles r ON r.id = a.role_id
       LEFT JOIN eos_policy.principal_access_versions v ON v.tenant_id = a.tenant_id AND v.principal_id = a.principal_id
      WHERE a.tenant_id = $1 AND a.principal_id = $2 AND a.status = 'active' AND r.tenant_id = $1
        AND a.scope_type = 'global' AND a.access_version_at_grant <= coalesce(v.access_version, 0)
      ORDER BY r.key`, [tenantId, principalId])).rows.map((r) => r.key);
    // BOTH grant relations, because the Owner's standing ruling is that a direct Principal grant counts -- resolved
    // by THE runtime capability resolution (lane DX), with conditions from PostgreSQL, so a conditioned grant of
    // either kind is never flat here and an expired direct exception confers nothing.
    const resolved = await (0, capabilityAuthority_1.resolveOperationalCapabilities)(pool, tenantId, principalId, heldRoleKeys, (0, entitledActionAuthority_1.postgresGrantConditionProvider)(pool));
    const directCapabilityKeys = Object.freeze(resolved.directGrants.map((g) => g.capabilityKey));
    return Object.freeze({
        tenantId,
        principalId,
        capabilities: resolved.capabilities,
        conditionallyHeld: resolved.conditionallyHeld,
        entitlements: resolved.entitlements,
        heldRoleKeys: Object.freeze(heldRoleKeys),
        directCapabilityKeys,
    });
}
//# sourceMappingURL=employeeAdministrationAuthority.js.map