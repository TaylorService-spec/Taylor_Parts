"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOVERNED_LINK_SOURCE = exports.PRINCIPAL_LINK_RELINK_ACTION = exports.PRINCIPAL_LINK_REVOKE_ACTION = exports.PRINCIPAL_LINK_ESTABLISH_ACTION = void 0;
exports.linkEmployeePrincipal = linkEmployeePrincipal;
exports.unlinkEmployeePrincipal = unlinkEmployeePrincipal;
exports.relinkEmployeePrincipal = relinkEmployeePrincipal;
const node_crypto_1 = require("node:crypto");
const employeeCommandKernel_1 = require("./employeeCommandKernel");
const employeeAdministrationAuthority_1 = require("./employeeAdministrationAuthority");
const employeeAdministrationInput_1 = require("./employeeAdministrationInput");
exports.PRINCIPAL_LINK_ESTABLISH_ACTION = "employee.principalLink.establish";
exports.PRINCIPAL_LINK_REVOKE_ACTION = "employee.principalLink.revoke";
exports.PRINCIPAL_LINK_RELINK_ACTION = "employee.principalLink.relink";
/**
 * The only link source a governed command may write. The vocabulary's other term,
 * RECIPROCAL_FIREBASE_UID_LINK, is a DERIVED fact belonging to the one-time migration that derived
 * it; a command driven by a named administrator is an assertion, and an assertion has an author.
 */
exports.GOVERNED_LINK_SOURCE = "OPERATOR_ASSERTED";
/**
 * The partial unique indexes are the last line of defence against two concurrent links. Each command
 * pre-empts them under row locks, so reaching one means a genuine race rather than a duplicate
 * request -- and a race must not be reported as "already linked", because the caller's read was valid
 * when it was taken.
 */
const linkConflict = (err) => err.constraint === "employee_principal_links_one_active_per_principal"
    ? new employeeCommandKernel_1.EmployeeCommandError("PRINCIPAL_LINK_CONCURRENT_CHANGE", "CONFLICT", "that Principal's Employee link changed concurrently; retry")
    : new employeeCommandKernel_1.EmployeeCommandError("EMPLOYEE_PRINCIPAL_LINK_CONCURRENT_CHANGE", "CONFLICT", "the Employee's Principal link changed concurrently; retry");
/** The Employee's ACTIVE link, locked. At most one can exist: the partial unique index says so. */
async function lockActiveLinkForEmployee(db, tenantId, employeeId) {
    const { rows } = await db.query(`SELECT id, principal_id FROM eos_policy.employee_principal_links
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active' FOR UPDATE`, [tenantId, employeeId]);
    return rows[0];
}
/** The Employee's operating company, and the proof the Employee is this tenant's. Locked by lockEmployee first. */
async function employeeOperatingCompany(db, tenantId, employeeId) {
    const { rows } = await db.query(`SELECT operating_company_id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
    return rows[0].operating_company_id;
}
/**
 * The target Principal must be ACTIVE with an ACTIVE membership in the ACTOR's tenant, and must not
 * already be the ACTIVE login of a DIFFERENT Employee.
 *
 * The membership check is not decoration even though the composite foreign key would also refuse: a
 * constraint violation tells the caller a constraint name, and "that Principal is not an active member
 * of this tenant" is the fact they need. A Principal of another tenant is reported as not a member --
 * this never discloses which tenant it belongs to.
 */
async function assertTargetPrincipalAvailable(db, tenantId, employeeId, principalId) {
    const member = await db.query(`SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active' FOR SHARE OF m`, [tenantId, principalId]);
    if (member.rows.length === 0) {
        (0, employeeCommandKernel_1.refuse)("PRINCIPAL_NOT_ACTIVE_MEMBER", "PRECONDITION_FAILED", "the Principal must be an ACTIVE Principal with an ACTIVE membership in this tenant; no Principal or membership is created here");
    }
    const held = await db.query(`SELECT id, employee_id FROM eos_policy.employee_principal_links
      WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active' FOR UPDATE`, [tenantId, principalId]);
    const other = held.rows.find((r) => r.employee_id !== employeeId);
    if (other) {
        (0, employeeCommandKernel_1.refuse)("PRINCIPAL_ALREADY_LINKED", "CONFLICT", "that Principal is already the active login of another Employee; one login is one Employee, and folding two together is refused");
    }
}
async function insertLink(db, actor, employeeId, principalId, reason, at) {
    const operatingCompanyId = await employeeOperatingCompany(db, actor.tenantId, employeeId);
    const id = `epl_${(0, node_crypto_1.randomUUID)()}`;
    await db.query(`INSERT INTO eos_policy.employee_principal_links
       (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $9)`, 
    // operating_company_id is the EMPLOYEE's own governed value, read in this transaction -- not a
    // caller argument and not derived from a warehouse, a truck, a title or a Job Role. The link
    // carries a copy of it because migration 1758412800000 declares the column NOT NULL with no
    // DEFAULT; taking it from the one authority that states it is what keeps the two from disagreeing.
    [id, actor.tenantId, principalId, employeeId, operatingCompanyId, exports.GOVERNED_LINK_SOURCE, actor.principalId, reason, at]);
    return id;
}
async function revokeLink(db, tenantId, linkId, at) {
    // status only, plus updated_at. The row is never deleted and its provenance is never rewritten:
    // asserted_by and assertion_reason still say who established it and why.
    await db.query(`UPDATE eos_policy.employee_principal_links SET status = 'revoked', updated_at = $3
      WHERE tenant_id = $1 AND id = $2 AND status = 'active'`, [tenantId, linkId, at]);
}
/**
 * The audit before/after of a link change.
 *
 * `userAccess` is the part the governed Employee change history projects under `employee.record.read`
 * (reads/employeeChangeHistoryRead.ts); the Principal id stays in the append-only audit row, where
 * it belongs, and is never projected by a read whose capability is not the one that reveals Principal
 * identity (admin.principalAccess.read, EMP-RT-02).
 */
const linkSide = (principalId, linkId) => principalId === null
    ? { userAccess: "UNLINKED", linkedPrincipalId: null, linkId: null }
    : { userAccess: "LINKED", linkedPrincipalId: principalId, linkId };
/**
 * THE TENANT GOVERNANCE LOCK (Pass 9 S4) -- the advisory lock every Administration grant, assignment, workflow
 * publish and Functional Role command takes. A link change moves which Principal an Employee's Functional Roles
 * (and Work Eligibility, and record assignments) speak for, so it serializes with them.
 */
async function takeGovernanceLock(db, tenantId) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtextextended('admin-governance|' || $1, 0))`, [tenantId]);
}
/**
 * NO SELF-LINK ONTO A FUNCTIONAL ROLE (Pass 9 S4). The Functional Role self-assignment ban reads the actor's CURRENT
 * link, so "unlink, assign, relink to myself" would make the actor the holder of a Functional Role they assigned --
 * satisfying a workflow FUNCTIONAL_ROLE requirement for themselves. Linking an Employee that holds a current or
 * scheduled Functional Role to the ACTOR's own Principal is therefore refused; another administrator must do it.
 */
async function refuseSelfLinkOntoFunctionalRole(db, actor, employeeId, targetPrincipalId) {
    if (targetPrincipalId !== actor.principalId)
        return;
    const present = await db.query(`SELECT to_regclass('eos_workforce.employee_functional_role_assignments') IS NOT NULL AS present`);
    if (present.rows[0]?.present !== true)
        return;
    const held = await db.query(`SELECT count(*)::int AS n FROM eos_workforce.employee_functional_role_assignments
      WHERE tenant_id = $1 AND employee_id = $2
        AND (effective_to IS NULL OR (effective_to > now() AND effective_to > effective_from))`, [actor.tenantId, employeeId]);
    if (Number(held.rows[0]?.n ?? 0) > 0) {
        (0, employeeCommandKernel_1.refuse)("FUNCTIONAL_ROLE_SELF_LINK", "FORBIDDEN", "this Employee holds a current or scheduled Functional Role; you may not link it to your own Principal -- another administrator must");
    }
}
/**
 * NO SELF-LINK ONTO AN OPERATIONAL SCOPE OR WORK ELIGIBILITY (Pass 10 P10-1, extending S4 to the facts lane GA made
 * assignable). Both are narrowing conjuncts the actor would satisfy for themselves: "unlink, assign, relink to myself"
 * is refused exactly as for a Functional Role. Current (or future-ended) rows count; another administrator may link.
 */
async function refuseSelfLinkOntoNarrowingFacts(db, actor, employeeId, targetPrincipalId) {
    await refuseSelfLinkOntoFunctionalRole(db, actor, employeeId, targetPrincipalId);
    if (targetPrincipalId !== actor.principalId)
        return;
    const current = `tenant_id = $1 AND employee_id = $2 AND (effective_to IS NULL OR (effective_to > now() AND effective_to > effective_from))`;
    const scopes = await db.query(`SELECT count(*)::int AS n FROM eos_workforce.employee_operational_scopes WHERE ${current}`, [actor.tenantId, employeeId]);
    if (Number(scopes.rows[0]?.n ?? 0) > 0) {
        (0, employeeCommandKernel_1.refuse)("OPERATIONAL_SCOPE_SELF_LINK", "FORBIDDEN", "this Employee holds a current Operational Scope; you may not link it to your own Principal -- another administrator must");
    }
    const eligibility = await db.query(`SELECT count(*)::int AS n FROM eos_workforce.employee_work_eligibility WHERE ${current}`, [actor.tenantId, employeeId]);
    if (Number(eligibility.rows[0]?.n ?? 0) > 0) {
        (0, employeeCommandKernel_1.refuse)("WORK_ELIGIBILITY_SELF_LINK", "FORBIDDEN", "this Employee holds a current Work Eligibility qualification; you may not link it to your own Principal -- another administrator must");
    }
}
/** Establish the Employee's FIRST active Principal link. An Employee that already has one refuses. */
async function linkEmployeePrincipal(deps, actor, input) {
    const effective = await (0, employeeAdministrationAuthority_1.withDirectCapabilityGrants)(deps.pool, actor, employeeCommandKernel_1.EMPLOYEE_PROFILE_WRITE);
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, effective, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "linkedPrincipalId", "reason"]);
        return {
            employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"),
            linkedPrincipalId: (0, employeeCommandKernel_1.requireId)(i.linkedPrincipalId, "linkedPrincipalId"),
            reason: (0, employeeAdministrationInput_1.requireGovernedReason)(i.reason),
        };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, effective.tenantId);
        await (0, employeeCommandKernel_1.lockEmployee)(db, effective.tenantId, p.employeeId);
        const current = await lockActiveLinkForEmployee(db, effective.tenantId, p.employeeId);
        if (current && current.principal_id === p.linkedPrincipalId) {
            // ALREADY THE ANSWER. Idempotent, and deliberately silent: nothing changed, so nothing is
            // written and NO audit event is appended. An audit row per resubmission would make the trail
            // report activity that never happened.
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, linkedPrincipalId: current.principal_id, linkId: current.id, revokedLinkId: null, auditEventId: null };
        }
        if (current) {
            (0, employeeCommandKernel_1.refuse)("EMPLOYEE_ALREADY_LINKED", "CONFLICT", "the Employee already has a different active Principal link; move it with relinkEmployeePrincipal, "
                + "which requires expectedCurrentPrincipalId, rather than establishing a second one");
        }
        await assertTargetPrincipalAvailable(db, effective.tenantId, p.employeeId, p.linkedPrincipalId);
        await refuseSelfLinkOntoNarrowingFacts(db, effective, p.employeeId, p.linkedPrincipalId);
        const linkId = await insertLink(db, effective, p.employeeId, p.linkedPrincipalId, p.reason, at);
        const auditEventId = await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, effective.tenantId, effective.principalId, exports.PRINCIPAL_LINK_ESTABLISH_ACTION, p.employeeId, linkSide(null, null), linkSide(p.linkedPrincipalId, linkId), p.reason, at);
        return { outcome: "LINKED", employeeId: p.employeeId, linkedPrincipalId: p.linkedPrincipalId, linkId, revokedLinkId: null, auditEventId };
    }, linkConflict, employeeCommandKernel_1.EMPLOYEE_PROFILE_WRITE);
}
/**
 * Revoke the Employee's active Principal link, which the caller must NAME.
 *
 * NOT idempotent, and that follows from the guard rather than from a separate decision: once the link
 * is revoked there is no current Principal, so a repeated call states an expected value that is no
 * longer in force and is refused STALE. "Revoke again" is not a thing a caller can mean.
 */
async function unlinkEmployeePrincipal(deps, actor, input) {
    const effective = await (0, employeeAdministrationAuthority_1.withDirectCapabilityGrants)(deps.pool, actor, employeeCommandKernel_1.EMPLOYEE_PROFILE_WRITE);
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, effective, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "expectedCurrentPrincipalId", "reason"]);
        return {
            employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"),
            expected: (0, employeeCommandKernel_1.requireId)(i.expectedCurrentPrincipalId, "expectedCurrentPrincipalId"),
            reason: (0, employeeAdministrationInput_1.requireGovernedReason)(i.reason),
        };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, effective.tenantId);
        await (0, employeeCommandKernel_1.lockEmployee)(db, effective.tenantId, p.employeeId);
        const current = await lockActiveLinkForEmployee(db, effective.tenantId, p.employeeId);
        assertExpectedCurrent(current, p.expected);
        await revokeLink(db, effective.tenantId, current.id, at);
        const auditEventId = await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, effective.tenantId, effective.principalId, exports.PRINCIPAL_LINK_REVOKE_ACTION, p.employeeId, linkSide(current.principal_id, current.id), linkSide(null, null), p.reason, at);
        return { outcome: "REVOKED", employeeId: p.employeeId, linkedPrincipalId: null, linkId: null, revokedLinkId: current.id, auditEventId };
    }, linkConflict, employeeCommandKernel_1.EMPLOYEE_PROFILE_WRITE);
}
/**
 * Move the Employee's link from the Principal the caller NAMES to another, in ONE transaction.
 *
 * Revoke and establish commit together or not at all: an Employee is never left with no login because
 * the second half failed, and the two halves appear as ONE audit event carrying both Principals,
 * because they are one decision.
 */
async function relinkEmployeePrincipal(deps, actor, input) {
    const effective = await (0, employeeAdministrationAuthority_1.withDirectCapabilityGrants)(deps.pool, actor, employeeCommandKernel_1.EMPLOYEE_PROFILE_WRITE);
    return (0, employeeCommandKernel_1.runEmployeeCommand)(deps, effective, () => {
        const i = (0, employeeCommandKernel_1.acceptOnly)(input, ["employeeId", "expectedCurrentPrincipalId", "newPrincipalId", "reason"]);
        return {
            employeeId: (0, employeeCommandKernel_1.requireId)(i.employeeId, "employeeId"),
            expected: (0, employeeCommandKernel_1.requireId)(i.expectedCurrentPrincipalId, "expectedCurrentPrincipalId"),
            next: (0, employeeCommandKernel_1.requireId)(i.newPrincipalId, "newPrincipalId"),
            reason: (0, employeeAdministrationInput_1.requireGovernedReason)(i.reason),
        };
    }, async (db, p, at) => {
        await takeGovernanceLock(db, effective.tenantId);
        await (0, employeeCommandKernel_1.lockEmployee)(db, effective.tenantId, p.employeeId);
        const current = await lockActiveLinkForEmployee(db, effective.tenantId, p.employeeId);
        // THE GUARD FIRST, even when the move is a no-op. A caller whose expected value is stale is
        // refused whatever it asked for: it is acting on a row it has not actually read.
        assertExpectedCurrent(current, p.expected);
        if (p.next === p.expected) {
            return { outcome: "NO_CHANGE", employeeId: p.employeeId, linkedPrincipalId: current.principal_id, linkId: current.id, revokedLinkId: null, auditEventId: null };
        }
        await assertTargetPrincipalAvailable(db, effective.tenantId, p.employeeId, p.next);
        await refuseSelfLinkOntoNarrowingFacts(db, effective, p.employeeId, p.next);
        await revokeLink(db, effective.tenantId, current.id, at);
        const linkId = await insertLink(db, effective, p.employeeId, p.next, p.reason, at);
        const auditEventId = await (0, employeeCommandKernel_1.appendEmployeeAudit)(db, effective.tenantId, effective.principalId, exports.PRINCIPAL_LINK_RELINK_ACTION, p.employeeId, linkSide(current.principal_id, current.id), linkSide(p.next, linkId), p.reason, at);
        return { outcome: "RELINKED", employeeId: p.employeeId, linkedPrincipalId: p.next, linkId, revokedLinkId: current.id, auditEventId };
    }, linkConflict, employeeCommandKernel_1.EMPLOYEE_PROFILE_WRITE);
}
/**
 * OPTIMISTIC CONCURRENCY. The stated value must be the Principal in force RIGHT NOW.
 *
 * Both failures are the same refusal on purpose -- an Employee with no active link and an Employee
 * linked to somebody else are both "the row you read is not the row you are changing", and telling
 * the two apart would let a caller enumerate link state through the refusal.
 */
function assertExpectedCurrent(current, expected) {
    if (!current || current.principal_id !== expected) {
        (0, employeeCommandKernel_1.refuse)("EMPLOYEE_PRINCIPAL_LINK_STALE", "CONFLICT", "expectedCurrentPrincipalId is not the Principal linked to this Employee right now; refusing rather than "
            + "proceeding, because the state you read is not the state you are about to change");
    }
}
//# sourceMappingURL=employeePrincipalLinkCommands.js.map