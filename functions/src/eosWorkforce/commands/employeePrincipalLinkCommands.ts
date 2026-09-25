// THE GOVERNED POSTGRESQL EMPLOYEE <-> PRINCIPAL LINK WRITERS -- "which login is this person".
//
// eos_policy.employee_principal_links (migration 1758412800000) is the relation that says an Employee
// and a Principal are the SAME PERSON, and nothing else about either of them. Until this lane the only
// writers of it were fixture seeds; the runtime could READ the link (reads/employeePrincipalLinkRead.ts,
// reads/myEmployeeProfile.ts) and nothing governed could establish, revoke or move one.
//
//   linkEmployeePrincipal    { employeeId, linkedPrincipalId, reason }                               first link
//   unlinkEmployeePrincipal  { employeeId, expectedCurrentPrincipalId, reason }                      revoke
//   relinkEmployeePrincipal  { employeeId, expectedCurrentPrincipalId, newPrincipalId, reason }      move, atomically
//
// ════════════════════ WHY THE TARGET IS NOT SPELLED `principalId` ════════════════════
//
// `principalId` is in workforceHttp.AUTHORITY_BEARING_FIELDS: a body that carries it is refused
// before the token is even verified, because in every other EOS operation a `principalId` in a
// request is a caller trying to say WHO IT IS. Here the Principal is a TARGET, not the actor, so it
// is spelled `linkedPrincipalId` / `newPrincipalId` / `expectedCurrentPrincipalId`. The actor's own
// Principal id never appears in an input to anything in this file; it arrives resolved.
//
// ════════════════════ EXPECTED-CURRENT-VALUE PROTECTION (required, not optional) ════════════════════
//
// A first link is guarded by ABSENCE: there must be no ACTIVE link for this Employee, and none for
// this Principal. Nothing to state, nothing to get wrong.
//
// Revoking or MOVING a link is different. The Employee already has a login, and "revoke it" or "point
// it at that Principal instead" is a statement about a row the caller read a moment ago. So both take
// `expectedCurrentPrincipalId` and it is MANDATORY: the caller states which Principal it believes is
// linked right now, and a value that is not the one in force REFUSES with
// EMPLOYEE_PRINCIPAL_LINK_STALE. It never falls back to "whatever is current", because that is
// exactly the read the caller's value was supposed to confirm -- and the row being confirmed is the
// one that decides whose login answers "who did this" for this Employee from then on.
//
// This is the compare-and-swap the governed Principal identity RE-BIND operator tool applies to a
// Principal's authentication subject ("the row I read is the row I am changing"), applied to the link. The
// difference is that there it is an optional flag on an operator tool; here it is a required argument
// of the command, because there is no version of "move this link" that is safe without it.
//
// ════════════════════ LINKING MOVES NO AUTHORITY ════════════════════
//
// A link says which two records are one person. It does NOT grant, revoke, copy or read a Security
// Role, a Role assignment, a capability grant, a Job Role, a Work Eligibility, an Operational Scope,
// an ownership row or an assignment. The Principal keeps exactly the authority it already had, and the
// Employee gains none: what the link changes is which Employee record an authenticated session
// resolves to, and that is all. Revoking a link likewise takes nothing away from the Principal -- its
// Roles, its grants and its membership are untouched, which is why a revoked link is not a
// deactivation and must never be used as one.
//
// Nor does it touch the Employee's own facts: no employment status, no operating company, no profile
// column and no updated_at on eos_workforce.employees. The Employee row is locked (so the link cannot
// be established against an Employee being concurrently created or changed) and read, never written.
//
// ════════════════════ HISTORY, NOT DELETION ════════════════════
//
// The two UNIQUE indexes are PARTIAL on `status = 'active'`, which migration 1758412800000 chose so
// that "a revoked link stays in the table as history and does not block a later re-link". So nothing
// here DELETEs: a revoke sets status = 'revoked' and a relink appends a new row beside the revoked
// one. The audit trail and the table then agree, and at most one link is ever in force in either
// direction.
//
// ════════════════════ AUTHORITY ════════════════════
//
// `admin.employeeProfile.write` -- the EXISTING capability, held by `admin` and `owner`. NO CAPABILITY
// IS ADDED BY THIS LANE. An ACTIVE Principal with an ACTIVE membership in the actor's tenant, re-read
// inside the transaction by the shared kernel; DIRECT Principal grants count; no Firebase anywhere.
// The TARGET Principal must itself be ACTIVE with an ACTIVE membership in the SAME tenant -- the
// composite foreign key employee_principal_links_member_fk makes a cross-tenant Principal
// unrepresentable, and this command refuses it by name first so the caller gets a reason rather than a
// constraint.
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  EmployeeCommandError, acceptOnly, appendEmployeeAudit, lockEmployee, refuse, requireId, runEmployeeCommand,
  EMPLOYEE_PROFILE_WRITE, type EmployeeCommandActor, type EmployeeCommandDeps,
} from "./employeeCommandKernel";
import { withDirectCapabilityGrants } from "./employeeAdministrationAuthority";
import { requireGovernedReason } from "./employeeAdministrationInput";

export const PRINCIPAL_LINK_ESTABLISH_ACTION = "employee.principalLink.establish";
export const PRINCIPAL_LINK_REVOKE_ACTION = "employee.principalLink.revoke";
export const PRINCIPAL_LINK_RELINK_ACTION = "employee.principalLink.relink";

/**
 * The only link source a governed command may write. The vocabulary's other term,
 * RECIPROCAL_FIREBASE_UID_LINK, is a DERIVED fact belonging to the one-time migration that derived
 * it; a command driven by a named administrator is an assertion, and an assertion has an author.
 */
export const GOVERNED_LINK_SOURCE = "OPERATOR_ASSERTED";

export interface EmployeePrincipalLinkResult {
  readonly outcome: "LINKED" | "REVOKED" | "RELINKED" | "NO_CHANGE";
  readonly employeeId: string;
  /** The Principal in force AFTER the command, or null when the Employee now has no login. */
  readonly linkedPrincipalId: string | null;
  readonly linkId: string | null;
  readonly revokedLinkId: string | null;
  readonly auditEventId: string | null;
}

/**
 * The partial unique indexes are the last line of defence against two concurrent links. Each command
 * pre-empts them under row locks, so reaching one means a genuine race rather than a duplicate
 * request -- and a race must not be reported as "already linked", because the caller's read was valid
 * when it was taken.
 */
const linkConflict = (err: { constraint?: string }) =>
  err.constraint === "employee_principal_links_one_active_per_principal"
    ? new EmployeeCommandError("PRINCIPAL_LINK_CONCURRENT_CHANGE", "CONFLICT", "that Principal's Employee link changed concurrently; retry")
    : new EmployeeCommandError("EMPLOYEE_PRINCIPAL_LINK_CONCURRENT_CHANGE", "CONFLICT", "the Employee's Principal link changed concurrently; retry");

interface ActiveLink {
  readonly id: string;
  readonly principal_id: string;
}

/** The Employee's ACTIVE link, locked. At most one can exist: the partial unique index says so. */
async function lockActiveLinkForEmployee(db: PoolClient, tenantId: string, employeeId: string): Promise<ActiveLink | undefined> {
  const { rows } = await db.query(
    `SELECT id, principal_id FROM eos_policy.employee_principal_links
      WHERE tenant_id = $1 AND employee_id = $2 AND status = 'active' FOR UPDATE`,
    [tenantId, employeeId],
  );
  return rows[0] as ActiveLink | undefined;
}

/** The Employee's operating company, and the proof the Employee is this tenant's. Locked by lockEmployee first. */
async function employeeOperatingCompany(db: PoolClient, tenantId: string, employeeId: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT operating_company_id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = $2`, [tenantId, employeeId]);
  return rows[0].operating_company_id as string;
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
async function assertTargetPrincipalAvailable(
  db: PoolClient, tenantId: string, employeeId: string, principalId: string,
): Promise<void> {
  const member = await db.query(
    `SELECT 1 FROM eos_policy.tenant_memberships m JOIN eos_policy.principals p ON p.id = m.principal_id
      WHERE m.tenant_id = $1 AND m.principal_id = $2 AND m.status = 'active' AND p.status = 'active' FOR SHARE OF m`,
    [tenantId, principalId],
  );
  if (member.rows.length === 0) {
    refuse("PRINCIPAL_NOT_ACTIVE_MEMBER", "PRECONDITION_FAILED",
      "the Principal must be an ACTIVE Principal with an ACTIVE membership in this tenant; no Principal or membership is created here");
  }
  const held = await db.query(
    `SELECT id, employee_id FROM eos_policy.employee_principal_links
      WHERE tenant_id = $1 AND principal_id = $2 AND status = 'active' FOR UPDATE`,
    [tenantId, principalId],
  );
  const other = held.rows.find((r) => r.employee_id !== employeeId);
  if (other) {
    refuse("PRINCIPAL_ALREADY_LINKED", "CONFLICT",
      "that Principal is already the active login of another Employee; one login is one Employee, and folding two together is refused");
  }
}

async function insertLink(
  db: PoolClient, actor: EmployeeCommandActor, employeeId: string, principalId: string, reason: string, at: Date,
): Promise<string> {
  const operatingCompanyId = await employeeOperatingCompany(db, actor.tenantId, employeeId);
  const id = `epl_${randomUUID()}`;
  await db.query(
    `INSERT INTO eos_policy.employee_principal_links
       (id, tenant_id, principal_id, employee_id, operating_company_id, link_source, status, asserted_by, assertion_reason, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $9)`,
    // operating_company_id is the EMPLOYEE's own governed value, read in this transaction -- not a
    // caller argument and not derived from a warehouse, a truck, a title or a Job Role. The link
    // carries a copy of it because migration 1758412800000 declares the column NOT NULL with no
    // DEFAULT; taking it from the one authority that states it is what keeps the two from disagreeing.
    [id, actor.tenantId, principalId, employeeId, operatingCompanyId, GOVERNED_LINK_SOURCE, actor.principalId, reason, at],
  );
  return id;
}

async function revokeLink(db: PoolClient, tenantId: string, linkId: string, at: Date): Promise<void> {
  // status only, plus updated_at. The row is never deleted and its provenance is never rewritten:
  // asserted_by and assertion_reason still say who established it and why.
  await db.query(
    `UPDATE eos_policy.employee_principal_links SET status = 'revoked', updated_at = $3
      WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
    [tenantId, linkId, at],
  );
}

/**
 * The audit before/after of a link change.
 *
 * `userAccess` is the part the governed Employee change history projects under `employee.record.read`
 * (reads/employeeChangeHistoryRead.ts); the Principal id stays in the append-only audit row, where
 * it belongs, and is never projected by a read whose capability is not the one that reveals Principal
 * identity (admin.principalAccess.read, EMP-RT-02).
 */
const linkSide = (principalId: string | null, linkId: string | null) =>
  principalId === null
    ? { userAccess: "UNLINKED", linkedPrincipalId: null, linkId: null }
    : { userAccess: "LINKED", linkedPrincipalId: principalId, linkId };

/** Establish the Employee's FIRST active Principal link. An Employee that already has one refuses. */
export async function linkEmployeePrincipal(
  deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>,
): Promise<EmployeePrincipalLinkResult> {
  const effective = await withDirectCapabilityGrants(deps.pool, actor, EMPLOYEE_PROFILE_WRITE);
  return runEmployeeCommand(deps, effective,
    () => {
      const i = acceptOnly(input, ["employeeId", "linkedPrincipalId", "reason"]);
      return {
        employeeId: requireId(i.employeeId, "employeeId"),
        linkedPrincipalId: requireId(i.linkedPrincipalId, "linkedPrincipalId"),
        reason: requireGovernedReason(i.reason),
      };
    },
    async (db, p, at) => {
      await lockEmployee(db, effective.tenantId, p.employeeId);
      const current = await lockActiveLinkForEmployee(db, effective.tenantId, p.employeeId);
      if (current && current.principal_id === p.linkedPrincipalId) {
        // ALREADY THE ANSWER. Idempotent, and deliberately silent: nothing changed, so nothing is
        // written and NO audit event is appended. An audit row per resubmission would make the trail
        // report activity that never happened.
        return { outcome: "NO_CHANGE" as const, employeeId: p.employeeId, linkedPrincipalId: current.principal_id, linkId: current.id, revokedLinkId: null, auditEventId: null };
      }
      if (current) {
        refuse("EMPLOYEE_ALREADY_LINKED", "CONFLICT",
          "the Employee already has a different active Principal link; move it with relinkEmployeePrincipal, "
          + "which requires expectedCurrentPrincipalId, rather than establishing a second one");
      }
      await assertTargetPrincipalAvailable(db, effective.tenantId, p.employeeId, p.linkedPrincipalId);
      const linkId = await insertLink(db, effective, p.employeeId, p.linkedPrincipalId, p.reason, at);
      const auditEventId = await appendEmployeeAudit(db, effective.tenantId, effective.principalId, PRINCIPAL_LINK_ESTABLISH_ACTION,
        p.employeeId, linkSide(null, null), linkSide(p.linkedPrincipalId, linkId), p.reason, at);
      return { outcome: "LINKED" as const, employeeId: p.employeeId, linkedPrincipalId: p.linkedPrincipalId, linkId, revokedLinkId: null, auditEventId };
    },
    linkConflict, EMPLOYEE_PROFILE_WRITE);
}

/**
 * Revoke the Employee's active Principal link, which the caller must NAME.
 *
 * NOT idempotent, and that follows from the guard rather than from a separate decision: once the link
 * is revoked there is no current Principal, so a repeated call states an expected value that is no
 * longer in force and is refused STALE. "Revoke again" is not a thing a caller can mean.
 */
export async function unlinkEmployeePrincipal(
  deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>,
): Promise<EmployeePrincipalLinkResult> {
  const effective = await withDirectCapabilityGrants(deps.pool, actor, EMPLOYEE_PROFILE_WRITE);
  return runEmployeeCommand(deps, effective,
    () => {
      const i = acceptOnly(input, ["employeeId", "expectedCurrentPrincipalId", "reason"]);
      return {
        employeeId: requireId(i.employeeId, "employeeId"),
        expected: requireId(i.expectedCurrentPrincipalId, "expectedCurrentPrincipalId"),
        reason: requireGovernedReason(i.reason),
      };
    },
    async (db, p, at) => {
      await lockEmployee(db, effective.tenantId, p.employeeId);
      const current = await lockActiveLinkForEmployee(db, effective.tenantId, p.employeeId);
      assertExpectedCurrent(current, p.expected);
      await revokeLink(db, effective.tenantId, current!.id, at);
      const auditEventId = await appendEmployeeAudit(db, effective.tenantId, effective.principalId, PRINCIPAL_LINK_REVOKE_ACTION,
        p.employeeId, linkSide(current!.principal_id, current!.id), linkSide(null, null), p.reason, at);
      return { outcome: "REVOKED" as const, employeeId: p.employeeId, linkedPrincipalId: null, linkId: null, revokedLinkId: current!.id, auditEventId };
    },
    linkConflict, EMPLOYEE_PROFILE_WRITE);
}

/**
 * Move the Employee's link from the Principal the caller NAMES to another, in ONE transaction.
 *
 * Revoke and establish commit together or not at all: an Employee is never left with no login because
 * the second half failed, and the two halves appear as ONE audit event carrying both Principals,
 * because they are one decision.
 */
export async function relinkEmployeePrincipal(
  deps: EmployeeCommandDeps, actor: EmployeeCommandActor, input: Record<string, unknown>,
): Promise<EmployeePrincipalLinkResult> {
  const effective = await withDirectCapabilityGrants(deps.pool, actor, EMPLOYEE_PROFILE_WRITE);
  return runEmployeeCommand(deps, effective,
    () => {
      const i = acceptOnly(input, ["employeeId", "expectedCurrentPrincipalId", "newPrincipalId", "reason"]);
      return {
        employeeId: requireId(i.employeeId, "employeeId"),
        expected: requireId(i.expectedCurrentPrincipalId, "expectedCurrentPrincipalId"),
        next: requireId(i.newPrincipalId, "newPrincipalId"),
        reason: requireGovernedReason(i.reason),
      };
    },
    async (db, p, at) => {
      await lockEmployee(db, effective.tenantId, p.employeeId);
      const current = await lockActiveLinkForEmployee(db, effective.tenantId, p.employeeId);
      // THE GUARD FIRST, even when the move is a no-op. A caller whose expected value is stale is
      // refused whatever it asked for: it is acting on a row it has not actually read.
      assertExpectedCurrent(current, p.expected);
      if (p.next === p.expected) {
        return { outcome: "NO_CHANGE" as const, employeeId: p.employeeId, linkedPrincipalId: current!.principal_id, linkId: current!.id, revokedLinkId: null, auditEventId: null };
      }
      await assertTargetPrincipalAvailable(db, effective.tenantId, p.employeeId, p.next);
      await revokeLink(db, effective.tenantId, current!.id, at);
      const linkId = await insertLink(db, effective, p.employeeId, p.next, p.reason, at);
      const auditEventId = await appendEmployeeAudit(db, effective.tenantId, effective.principalId, PRINCIPAL_LINK_RELINK_ACTION,
        p.employeeId, linkSide(current!.principal_id, current!.id), linkSide(p.next, linkId), p.reason, at);
      return { outcome: "RELINKED" as const, employeeId: p.employeeId, linkedPrincipalId: p.next, linkId, revokedLinkId: current!.id, auditEventId };
    },
    linkConflict, EMPLOYEE_PROFILE_WRITE);
}

/**
 * OPTIMISTIC CONCURRENCY. The stated value must be the Principal in force RIGHT NOW.
 *
 * Both failures are the same refusal on purpose -- an Employee with no active link and an Employee
 * linked to somebody else are both "the row you read is not the row you are changing", and telling
 * the two apart would let a caller enumerate link state through the refusal.
 */
function assertExpectedCurrent(current: ActiveLink | undefined, expected: string): void {
  if (!current || current.principal_id !== expected) {
    refuse("EMPLOYEE_PRINCIPAL_LINK_STALE", "CONFLICT",
      "expectedCurrentPrincipalId is not the Principal linked to this Employee right now; refusing rather than "
      + "proceeding, because the state you read is not the state you are about to change");
  }
}
