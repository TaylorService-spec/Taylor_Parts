"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INBOUND_RECOVERY_READ_OPERATIONS = exports.INBOUND_RECOVERY_OPERATIONS = exports.RECOVERABLE_MAILBOX_PURPOSES = exports.RECOVERABLE_DESTINATIONS = void 0;
exports.releaseInboundWork = releaseInboundWork;
exports.listInboundRecoveryTargets = listInboundRecoveryTargets;
exports.reassignInboundWork = reassignInboundWork;
const workOrderCreateCommand_1 = require("./workOrderCreateCommand");
const inboundWorkIntake_1 = require("./inboundWorkIntake");
const inboundWorkDecisions_1 = require("./inboundWorkDecisions");
const capabilityAuthority_1 = require("./capabilityAuthority");
const entitledActionAuthority_1 = require("./entitledActionAuthority");
const workOrderAssignmentAuthority_1 = require("./workOrderAssignmentAuthority");
const inboundWorkModel_1 = require("../inboundWork/inboundWorkModel");
/** The destinations recovery governs. Everything else is a separate, unruled domain boundary. */
exports.RECOVERABLE_DESTINATIONS = new Set(["SERVICE"]);
/** The mailbox purposes that are Service intake. PARTS / OTHER mailboxes are outside Service recovery. */
exports.RECOVERABLE_MAILBOX_PURPOSES = new Set(["SERVICE", "WARRANTY"]);
const TERMINAL_WORK_ORDER = ["CLOSED", "CANCELLED"];
const MAX_TARGETS = 100;
function requireReason(v) {
    const reason = (0, inboundWorkModel_1.boundedString)(v, 500);
    if (!reason)
        (0, inboundWorkIntake_1.refuse)("RECOVERY_REASON_REQUIRED", "INVALID_INPUT", "a recovery states why (reason, at most 500 characters)");
    return reason;
}
/** Lock the intake; prove it is a Service-domain ACCEPTING claim. */
async function lockClaim(c, tenantId, requestId) {
    const { rows } = await c.query(`SELECT r.*, m.purpose AS mailbox_purpose FROM eos_ops.inbound_work_requests r
       LEFT JOIN eos_ops.inbound_mailboxes m ON m.tenant_id = r.tenant_id AND m.id = r.source_mailbox_id
      WHERE r.tenant_id = $1 AND r.id = $2 FOR UPDATE OF r`, [tenantId, requestId]);
    if (rows.length === 0)
        (0, inboundWorkIntake_1.refuse)("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
    const r = rows[0];
    const destination = r.destination ?? "SERVICE";
    // BOTH facts must say Service: the routed destination AND the mailbox it arrived in. An unrouted message defaults to
    // the SERVICE destination (inboundRouting UNROUTED_OUTCOME), so a Parts-mailbox item is identified by its mailbox.
    const purpose = r.mailbox_purpose ?? null;
    if (!exports.RECOVERABLE_DESTINATIONS.has(destination) || !exports.RECOVERABLE_MAILBOX_PURPOSES.has(purpose ?? "")) {
        const domain = !exports.RECOVERABLE_DESTINATIONS.has(destination) ? destination : purpose ?? "UNKNOWN_MAILBOX";
        (0, inboundWorkIntake_1.refuse)("RECOVERY_OUTSIDE_SERVICE_DOMAIN", "FORBIDDEN", `this request belongs to ${domain} intake; Inbound Work recovery governs Service intake only (a ${domain} recovery authority is not ruled)`);
    }
    if (r.status !== "ACCEPTING") {
        (0, inboundWorkIntake_1.refuse)("RECOVERY_NOT_APPLICABLE", "PRECONDITION_FAILED", `this request is ${r.status}; only an accepted-but-unfinished (ACCEPTING) request is released or reassigned`);
    }
    return { id: r.id, status: r.status, destination, claimant: r.accept_claimed_by_principal_id, priorStatus: r.accept_claim_prior_status,
        pendingWorkOrderId: r.accept_pending_work_order_id ?? null };
}
/** The Work Order the claimant's own create already committed under the derived key, if any (and still live). */
async function carriedWorkOrder(c, tenantId, claim) {
    if (claim.pendingWorkOrderId)
        return claim.pendingWorkOrderId;
    const { rows } = await c.query(`SELECT id, status::text AS status FROM eos_ops.work_orders
      WHERE tenant_id = $1 AND created_by_principal_id = $2 AND create_idempotency_key = $3`, [tenantId, claim.claimant, (0, inboundWorkDecisions_1.acceptIdempotencyKey)(claim.id)]);
    return rows.length && !TERMINAL_WORK_ORDER.includes(rows[0].status) ? rows[0].id : null;
}
/** RELEASE: the unfinished claim returns to the review queue. */
async function releaseInboundWork(deps, actor, input) {
    (0, inboundWorkIntake_1.requireCapability)(actor, inboundWorkIntake_1.INBOUND_WORK_RECOVER);
    (0, inboundWorkIntake_1.only)(input, ["requestId", "reason"]);
    if (!(0, inboundWorkIntake_1.isId)(input.requestId))
        (0, inboundWorkIntake_1.refuse)("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
    const reason = requireReason(input.reason);
    const now = (deps.now ?? (() => new Date()))();
    return (0, inboundWorkIntake_1.inTransaction)(deps.pool, async (c) => {
        const claim = await lockClaim(c, actor.tenantId, input.requestId);
        const carried = await carriedWorkOrder(c, actor.tenantId, claim);
        await c.query(`UPDATE eos_ops.inbound_work_requests SET status = $3, accept_claimed_by_principal_id = NULL, accept_claim_prior_status = NULL,
              accept_claimed_at = NULL, accept_pending_work_order_id = $4, updated_at = $5, version = version + 1
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, claim.id, claim.priorStatus, carried, now]);
        const auditId = await (0, inboundWorkIntake_1.writeAudit)(c, actor, "inboundWork.request.release", "inboundWorkRequest", claim.id, { status: "ACCEPTING", claimedBy: claim.claimant }, { status: claim.priorStatus, carriedWorkOrderId: carried }, reason, now);
        await (0, inboundWorkDecisions_1.recordClaimEvent)(c, actor.tenantId, { requestId: claim.id, kind: "RELEASED", from: claim.claimant, to: null, actor: actor.principalId,
            reason, carriedWorkOrderId: carried, at: now, auditEventId: auditId });
        return Object.freeze({ requestId: claim.id, status: claim.priorStatus, releasedFrom: claim.claimant, carriedWorkOrderId: carried });
    });
}
/** Linked, ACTIVE / CONTRACTOR Employees of ACTIVE operating companies -- the candidates, before authority. */
async function candidateReviewers(db, tenantId, employeeId) {
    const { rows } = await db.query(`SELECT e.id, l.principal_id, e.display_name, e.operating_company_id
       FROM eos_workforce.employees e
       JOIN eos_policy.employee_principal_links l ON l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active'
       JOIN eos_policy.tenant_operating_companies oc ON oc.tenant_id = e.tenant_id AND oc.operating_company_id = e.operating_company_id AND oc.status = 'ACTIVE'
       JOIN eos_policy.tenant_memberships m ON m.tenant_id = e.tenant_id AND m.principal_id = l.principal_id AND m.status = 'active'
       JOIN eos_policy.principals p ON p.id = l.principal_id AND p.status = 'active'
      WHERE e.tenant_id = $1 AND e.employment_status::text = ANY($2::text[]) AND ($3::text IS NULL OR e.id = $3)
      ORDER BY e.display_name NULLS LAST, e.id LIMIT ${MAX_TARGETS}`, [tenantId, [...workOrderAssignmentAuthority_1.WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES], employeeId]);
    return rows.map((r) => ({ employeeId: r.id, principalId: r.principal_id, displayName: r.display_name ?? null, operatingCompanyId: r.operating_company_id }));
}
/** Does this Principal hold, right now, the authority to complete an Accept? Decided by the governed resolver. */
async function mayAccept(deps, tenantId, principalId) {
    if (!deps.policyReader)
        return false; // no resolver composed: fail closed
    try {
        const ctx = await (0, capabilityAuthority_1.resolveOperationalContextForPrincipal)(deps.policyReader, deps.pool, principalId, tenantId, (0, entitledActionAuthority_1.postgresGrantConditionProvider)(deps.pool));
        return ctx.principalContext.tenantId === tenantId && ctx.capabilities.has(inboundWorkIntake_1.INBOUND_WORK_ACCEPT) && ctx.capabilities.has(workOrderCreateCommand_1.WORK_ORDER_CREATE);
    }
    catch {
        return false;
    }
}
/** The reviewers a claim may be reassigned to: eligible Employees whose Principal may accept. */
async function listInboundRecoveryTargets(deps, actor, input) {
    (0, inboundWorkIntake_1.requireCapability)(actor, inboundWorkIntake_1.INBOUND_WORK_RECOVER);
    (0, inboundWorkIntake_1.only)(input, ["requestId"]);
    if (!(0, inboundWorkIntake_1.isId)(input.requestId))
        (0, inboundWorkIntake_1.refuse)("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
    const claimant = await deps.pool.query(`SELECT accept_claimed_by_principal_id FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, input.requestId]);
    if (claimant.rows.length === 0)
        (0, inboundWorkIntake_1.refuse)("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
    const current = claimant.rows[0].accept_claimed_by_principal_id ?? null;
    const out = [];
    for (const r of await candidateReviewers(deps.pool, actor.tenantId, null)) {
        if (r.principalId === current)
            continue;
        if (await mayAccept(deps, actor.tenantId, r.principalId))
            out.push({ employeeId: r.employeeId, displayName: r.displayName, operatingCompanyId: r.operatingCompanyId });
    }
    // The Principal ids stay server-side: a reviewer is chosen by Employee.
    return Object.freeze({ requestId: input.requestId, targets: out });
}
/** REASSIGN: the unfinished claim moves to another eligible reviewer, named by Employee. */
async function reassignInboundWork(deps, actor, input) {
    (0, inboundWorkIntake_1.requireCapability)(actor, inboundWorkIntake_1.INBOUND_WORK_RECOVER);
    (0, inboundWorkIntake_1.only)(input, ["requestId", "employeeId", "reason"]);
    if (!(0, inboundWorkIntake_1.isId)(input.requestId))
        (0, inboundWorkIntake_1.refuse)("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
    if (!(0, inboundWorkIntake_1.isId)(input.employeeId))
        (0, inboundWorkIntake_1.refuse)("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", "the new reviewer is named by Employee id");
    const reason = requireReason(input.reason);
    const now = (deps.now ?? (() => new Date()))();
    // ELIGIBILITY IS PROVEN BEFORE THE LOCK (the resolver reads through the pool), and re-proven inside it below.
    const [target] = await candidateReviewers(deps.pool, actor.tenantId, input.employeeId);
    if (!target) {
        (0, inboundWorkIntake_1.refuse)("REVIEWER_NOT_ELIGIBLE", "PRECONDITION_FAILED", "that Employee is not an eligible reviewer (ACTIVE / CONTRACTOR, an ACTIVE operating company, an active principal link and membership)");
    }
    if (!(await mayAccept(deps, actor.tenantId, target.principalId))) {
        (0, inboundWorkIntake_1.refuse)("REVIEWER_NOT_AUTHORIZED", "PRECONDITION_FAILED", "that Employee's Principal does not hold Inbound Work accept and Work Order create");
    }
    return (0, inboundWorkIntake_1.inTransaction)(deps.pool, async (c) => {
        const claim = await lockClaim(c, actor.tenantId, input.requestId);
        if (claim.claimant === target.principalId)
            (0, inboundWorkIntake_1.refuse)("REVIEWER_UNCHANGED", "PRECONDITION_FAILED", "that Employee already holds this claim");
        const still = await candidateReviewers(c, actor.tenantId, target.employeeId);
        if (still.length === 0 || still[0].principalId !== target.principalId) {
            (0, inboundWorkIntake_1.refuse)("REVIEWER_NOT_ELIGIBLE", "PRECONDITION_FAILED", "the reviewer's eligibility changed; nothing was reassigned");
        }
        const carried = await carriedWorkOrder(c, actor.tenantId, claim);
        await c.query(`UPDATE eos_ops.inbound_work_requests SET accept_claimed_by_principal_id = $3, accept_claimed_at = $4, accept_pending_work_order_id = $5,
              updated_at = $4, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND status = 'ACCEPTING'`, [actor.tenantId, claim.id, target.principalId, now, carried]);
        const auditId = await (0, inboundWorkIntake_1.writeAudit)(c, actor, "inboundWork.request.reassign", "inboundWorkRequest", claim.id, { claimedBy: claim.claimant }, { claimedBy: target.principalId, claimedByEmployeeId: target.employeeId, carriedWorkOrderId: carried }, reason, now);
        await (0, inboundWorkDecisions_1.recordClaimEvent)(c, actor.tenantId, { requestId: claim.id, kind: "REASSIGNED", from: claim.claimant, to: target.principalId,
            toEmployeeId: target.employeeId, actor: actor.principalId, reason, carriedWorkOrderId: carried, at: now, auditEventId: auditId });
        return Object.freeze({ requestId: claim.id, status: "ACCEPTING", reassignedFrom: claim.claimant, reassignedToEmployeeId: target.employeeId,
            carriedWorkOrderId: carried });
    });
}
exports.INBOUND_RECOVERY_OPERATIONS = Object.freeze({
    releaseInboundWork: (deps, caller, input) => releaseInboundWork(deps, caller.actor, input),
    reassignInboundWork: (deps, caller, input) => reassignInboundWork(deps, caller.actor, input),
    listInboundRecoveryTargets: (deps, caller, input) => listInboundRecoveryTargets(deps, caller.actor, input),
});
exports.INBOUND_RECOVERY_READ_OPERATIONS = Object.freeze(["listInboundRecoveryTargets"]);
//# sourceMappingURL=inboundWorkRecovery.js.map