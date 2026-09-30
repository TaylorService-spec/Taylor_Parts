// INBOUND WORK RECOVERY -- RELEASE / REASSIGN (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30, increment B).
//
// WHAT IS RECOVERED: the ACCEPTING claim -- an Inbound Work item a reviewer ACCEPTED whose Accept never finished (a
// lost response, a closed browser, a crash between the Work Order create and the record). Until now only that same
// reviewer could ever complete it; everyone else is refused ACCEPT_IN_PROGRESS. A decided intake (ACCEPTED, ATTACHED,
// DECLINED) is a DECISION with its own Work Order link and audit, not a claim, and is refused RECOVERY_NOT_APPLICABLE.
//
//     RELEASE   the claim returns to the review queue (the status it was claimed from); anyone who may accept can
//               take it.
//     REASSIGN  the claim moves to ANOTHER eligible reviewer, named by EMPLOYEE (never a raw Principal id): an ACTIVE /
//               CONTRACTOR Employee of an ACTIVE operating company, with an ACTIVE principal link, whose Principal
//               holds BOTH inboundWork.request.accept and workOrder.create right now. Anything else fails closed.
//
// ONE INTAKE, ONE WORK ORDER. The governed Work Order create is idempotent per CREATOR, so the claimant's create may
// already have committed. Recovery finds it (the claimant's derived key) and CARRIES it -- accept_pending_work_order_id
// -- so whoever completes the Accept links that Work Order instead of creating another.
//
// HISTORY IS NEVER REWRITTEN: every recovery is an append-only inbound_work_claim_events row (who held the claim, who
// acted, the new reviewer, when, why, the carried Work Order) plus an audit event. The original reviewer and the
// original accepted timestamp remain the CLAIMED row.
//
// AUTHORITY: inboundWork.request.recover (registered ungranted; the ruled holder is the canonical Service Manager,
// fieldManager, through the Administration API). Dispatcher processing is unchanged and gains no recovery.
//
// DOMAIN BOUNDARY (classified, not decided here): recovery is SERVICE-domain only. An intake routed to PARTS, SALES or
// OTHER is refused RECOVERY_OUTSIDE_SERVICE_DOMAIN -- a Parts-specific recovery authority is an unruled boundary, and
// the Service Manager is never given cross-domain Parts authority by default.
import type { Pool, PoolClient } from "pg";
import type { LifecycleActor } from "./workOrderLifecycle";
import type { WorkOrderOp, WorkOrderOperationDeps } from "./workOrderOperationTypes";
import { WORK_ORDER_CREATE } from "./workOrderCreateCommand";
import {
  INBOUND_WORK_ACCEPT, INBOUND_WORK_RECOVER, inTransaction, isId, only, refuse, requireCapability, writeAudit,
} from "./inboundWorkIntake";
import { acceptIdempotencyKey, recordClaimEvent } from "./inboundWorkDecisions";
import { resolveOperationalContextForPrincipal } from "./capabilityAuthority";
import { postgresGrantConditionProvider } from "./entitledActionAuthority";
import { WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES } from "./workOrderAssignmentAuthority";
import { boundedString } from "../inboundWork/inboundWorkModel";

/** The destinations recovery governs. Everything else is a separate, unruled domain boundary. */
export const RECOVERABLE_DESTINATIONS: ReadonlySet<string> = new Set(["SERVICE"]);
/** The mailbox purposes that are Service intake. PARTS / OTHER mailboxes are outside Service recovery. */
export const RECOVERABLE_MAILBOX_PURPOSES: ReadonlySet<string> = new Set(["SERVICE", "WARRANTY"]);
const TERMINAL_WORK_ORDER = ["CLOSED", "CANCELLED"];
const MAX_TARGETS = 100;

function requireReason(v: unknown): string {
  const reason = boundedString(v, 500);
  if (!reason) refuse("RECOVERY_REASON_REQUIRED", "INVALID_INPUT", "a recovery states why (reason, at most 500 characters)");
  return reason;
}

interface LockedClaim {
  readonly id: string;
  readonly status: string;
  readonly destination: string | null;
  readonly claimant: string;
  readonly priorStatus: string;
  readonly pendingWorkOrderId: string | null;
}

/** Lock the intake; prove it is a Service-domain ACCEPTING claim. */
async function lockClaim(c: PoolClient, tenantId: string, requestId: string): Promise<LockedClaim> {
  const { rows } = await c.query(
    `SELECT r.*, m.purpose AS mailbox_purpose FROM eos_ops.inbound_work_requests r
       LEFT JOIN eos_ops.inbound_mailboxes m ON m.tenant_id = r.tenant_id AND m.id = r.source_mailbox_id
      WHERE r.tenant_id = $1 AND r.id = $2 FOR UPDATE OF r`, [tenantId, requestId]);
  if (rows.length === 0) refuse("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
  const r = rows[0];
  const destination = (r.destination as string | null) ?? "SERVICE";
  // BOTH facts must say Service: the routed destination AND the mailbox it arrived in. An unrouted message defaults to
  // the SERVICE destination (inboundRouting UNROUTED_OUTCOME), so a Parts-mailbox item is identified by its mailbox.
  const purpose = (r.mailbox_purpose as string | null) ?? null;
  if (!RECOVERABLE_DESTINATIONS.has(destination) || !RECOVERABLE_MAILBOX_PURPOSES.has(purpose ?? "")) {
    const domain = !RECOVERABLE_DESTINATIONS.has(destination) ? destination : purpose ?? "UNKNOWN_MAILBOX";
    refuse("RECOVERY_OUTSIDE_SERVICE_DOMAIN", "FORBIDDEN",
      `this request belongs to ${domain} intake; Inbound Work recovery governs Service intake only (a ${domain} recovery authority is not ruled)`);
  }
  if (r.status !== "ACCEPTING") {
    refuse("RECOVERY_NOT_APPLICABLE", "PRECONDITION_FAILED",
      `this request is ${r.status}; only an accepted-but-unfinished (ACCEPTING) request is released or reassigned`);
  }
  return { id: r.id, status: r.status, destination, claimant: r.accept_claimed_by_principal_id, priorStatus: r.accept_claim_prior_status,
    pendingWorkOrderId: r.accept_pending_work_order_id ?? null };
}

/** The Work Order the claimant's own create already committed under the derived key, if any (and still live). */
async function carriedWorkOrder(c: PoolClient, tenantId: string, claim: LockedClaim): Promise<string | null> {
  if (claim.pendingWorkOrderId) return claim.pendingWorkOrderId;
  const { rows } = await c.query(
    `SELECT id, status::text AS status FROM eos_ops.work_orders
      WHERE tenant_id = $1 AND created_by_principal_id = $2 AND create_idempotency_key = $3`,
    [tenantId, claim.claimant, acceptIdempotencyKey(claim.id)]);
  return rows.length && !TERMINAL_WORK_ORDER.includes(rows[0].status) ? rows[0].id : null;
}

/** RELEASE: the unfinished claim returns to the review queue. */
export async function releaseInboundWork(deps: { readonly pool: Pool; readonly now?: () => Date }, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_WORK_RECOVER);
  only(input, ["requestId", "reason"]);
  if (!isId(input.requestId)) refuse("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
  const reason = requireReason(input.reason);
  const now = (deps.now ?? (() => new Date()))();
  return inTransaction(deps.pool, async (c) => {
    const claim = await lockClaim(c, actor.tenantId, input.requestId as string);
    const carried = await carriedWorkOrder(c, actor.tenantId, claim);
    await c.query(
      `UPDATE eos_ops.inbound_work_requests SET status = $3, accept_claimed_by_principal_id = NULL, accept_claim_prior_status = NULL,
              accept_claimed_at = NULL, accept_pending_work_order_id = $4, updated_at = $5, version = version + 1
        WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, claim.id, claim.priorStatus, carried, now]);
    const auditId = await writeAudit(c, actor, "inboundWork.request.release", "inboundWorkRequest", claim.id,
      { status: "ACCEPTING", claimedBy: claim.claimant }, { status: claim.priorStatus, carriedWorkOrderId: carried }, reason, now);
    await recordClaimEvent(c, actor.tenantId, { requestId: claim.id, kind: "RELEASED", from: claim.claimant, to: null, actor: actor.principalId,
      reason, carriedWorkOrderId: carried, at: now, auditEventId: auditId });
    return Object.freeze({ requestId: claim.id, status: claim.priorStatus, releasedFrom: claim.claimant, carriedWorkOrderId: carried });
  });
}

interface EligibleReviewer { readonly employeeId: string; readonly principalId: string; readonly displayName: string | null; readonly operatingCompanyId: string }

/** Linked, ACTIVE / CONTRACTOR Employees of ACTIVE operating companies -- the candidates, before authority. */
async function candidateReviewers(db: Pool | PoolClient, tenantId: string, employeeId: string | null): Promise<EligibleReviewer[]> {
  const { rows } = await db.query(
    `SELECT e.id, l.principal_id, e.display_name, e.operating_company_id
       FROM eos_workforce.employees e
       JOIN eos_policy.employee_principal_links l ON l.tenant_id = e.tenant_id AND l.employee_id = e.id AND l.status = 'active'
       JOIN eos_policy.tenant_operating_companies oc ON oc.tenant_id = e.tenant_id AND oc.operating_company_id = e.operating_company_id AND oc.status = 'ACTIVE'
       JOIN eos_policy.tenant_memberships m ON m.tenant_id = e.tenant_id AND m.principal_id = l.principal_id AND m.status = 'active'
       JOIN eos_policy.principals p ON p.id = l.principal_id AND p.status = 'active'
      WHERE e.tenant_id = $1 AND e.employment_status::text = ANY($2::text[]) AND ($3::text IS NULL OR e.id = $3)
      ORDER BY e.display_name NULLS LAST, e.id LIMIT ${MAX_TARGETS}`,
    [tenantId, [...WORK_ORDER_ASSIGNABLE_EMPLOYMENT_STATUSES], employeeId]);
  return rows.map((r) => ({ employeeId: r.id, principalId: r.principal_id, displayName: r.display_name ?? null, operatingCompanyId: r.operating_company_id }));
}

/** Does this Principal hold, right now, the authority to complete an Accept? Decided by the governed resolver. */
async function mayAccept(deps: WorkOrderOperationDeps, tenantId: string, principalId: string): Promise<boolean> {
  if (!deps.policyReader) return false; // no resolver composed: fail closed
  try {
    const ctx = await resolveOperationalContextForPrincipal(deps.policyReader, deps.pool, principalId, tenantId, postgresGrantConditionProvider(deps.pool));
    return ctx.principalContext.tenantId === tenantId && ctx.capabilities.has(INBOUND_WORK_ACCEPT) && ctx.capabilities.has(WORK_ORDER_CREATE);
  } catch {
    return false;
  }
}

/** The reviewers a claim may be reassigned to: eligible Employees whose Principal may accept. */
export async function listInboundRecoveryTargets(deps: WorkOrderOperationDeps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_WORK_RECOVER);
  only(input, ["requestId"]);
  if (!isId(input.requestId)) refuse("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
  const claimant = await deps.pool.query(`SELECT accept_claimed_by_principal_id FROM eos_ops.inbound_work_requests WHERE tenant_id = $1 AND id = $2`,
    [actor.tenantId, input.requestId]);
  if (claimant.rows.length === 0) refuse("INBOUND_REQUEST_NOT_FOUND", "NOT_FOUND", "that inbound request does not exist");
  const current = claimant.rows[0].accept_claimed_by_principal_id ?? null;
  const out: { employeeId: string; displayName: string | null; operatingCompanyId: string }[] = [];
  for (const r of await candidateReviewers(deps.pool, actor.tenantId, null)) {
    if (r.principalId === current) continue;
    if (await mayAccept(deps, actor.tenantId, r.principalId)) out.push({ employeeId: r.employeeId, displayName: r.displayName, operatingCompanyId: r.operatingCompanyId });
  }
  // The Principal ids stay server-side: a reviewer is chosen by Employee.
  return Object.freeze({ requestId: input.requestId, targets: out });
}

/** REASSIGN: the unfinished claim moves to another eligible reviewer, named by Employee. */
export async function reassignInboundWork(deps: WorkOrderOperationDeps, actor: LifecycleActor, input: Record<string, unknown>) {
  requireCapability(actor, INBOUND_WORK_RECOVER);
  only(input, ["requestId", "employeeId", "reason"]);
  if (!isId(input.requestId)) refuse("REQUEST_ID_REQUIRED", "INVALID_INPUT", "requestId is required");
  if (!isId(input.employeeId)) refuse("EMPLOYEE_ID_REQUIRED", "INVALID_INPUT", "the new reviewer is named by Employee id");
  const reason = requireReason(input.reason);
  const now = (deps.now ?? (() => new Date()))();
  // ELIGIBILITY IS PROVEN BEFORE THE LOCK (the resolver reads through the pool), and re-proven inside it below.
  const [target] = await candidateReviewers(deps.pool, actor.tenantId, input.employeeId as string);
  if (!target) {
    refuse("REVIEWER_NOT_ELIGIBLE", "PRECONDITION_FAILED",
      "that Employee is not an eligible reviewer (ACTIVE / CONTRACTOR, an ACTIVE operating company, an active principal link and membership)");
  }
  if (!(await mayAccept(deps, actor.tenantId, target.principalId))) {
    refuse("REVIEWER_NOT_AUTHORIZED", "PRECONDITION_FAILED", "that Employee's Principal does not hold Inbound Work accept and Work Order create");
  }
  return inTransaction(deps.pool, async (c) => {
    const claim = await lockClaim(c, actor.tenantId, input.requestId as string);
    if (claim.claimant === target.principalId) refuse("REVIEWER_UNCHANGED", "PRECONDITION_FAILED", "that Employee already holds this claim");
    const still = await candidateReviewers(c, actor.tenantId, target.employeeId);
    if (still.length === 0 || still[0].principalId !== target.principalId) {
      refuse("REVIEWER_NOT_ELIGIBLE", "PRECONDITION_FAILED", "the reviewer's eligibility changed; nothing was reassigned");
    }
    const carried = await carriedWorkOrder(c, actor.tenantId, claim);
    await c.query(
      `UPDATE eos_ops.inbound_work_requests SET accept_claimed_by_principal_id = $3, accept_claimed_at = $4, accept_pending_work_order_id = $5,
              updated_at = $4, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND status = 'ACCEPTING'`, [actor.tenantId, claim.id, target.principalId, now, carried]);
    const auditId = await writeAudit(c, actor, "inboundWork.request.reassign", "inboundWorkRequest", claim.id,
      { claimedBy: claim.claimant }, { claimedBy: target.principalId, claimedByEmployeeId: target.employeeId, carriedWorkOrderId: carried }, reason, now);
    await recordClaimEvent(c, actor.tenantId, { requestId: claim.id, kind: "REASSIGNED", from: claim.claimant, to: target.principalId,
      toEmployeeId: target.employeeId, actor: actor.principalId, reason, carriedWorkOrderId: carried, at: now, auditEventId: auditId });
    return Object.freeze({ requestId: claim.id, status: "ACCEPTING", reassignedFrom: claim.claimant, reassignedToEmployeeId: target.employeeId,
      carriedWorkOrderId: carried });
  });
}

export const INBOUND_RECOVERY_OPERATIONS: Readonly<Record<string, WorkOrderOp>> = Object.freeze({
  releaseInboundWork: (deps, caller, input) => releaseInboundWork(deps, caller.actor, input),
  reassignInboundWork: (deps, caller, input) => reassignInboundWork(deps, caller.actor, input),
  listInboundRecoveryTargets: (deps, caller, input) => listInboundRecoveryTargets(deps, caller.actor, input),
});
export const INBOUND_RECOVERY_READ_OPERATIONS: readonly string[] = Object.freeze(["listInboundRecoveryTargets"]);
