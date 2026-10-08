// resolvePrincipalDisplayNames -- WHO DID IT, IN WORDS (UI corrections integration gate, 2026-10-08).
//
// EOS records store the ACTING Principal (created_by / updated_by / accepted_by are EOS Principal ids). The pages that show
// them (an Account's activity and notes, a Sales Agreement's acceptance) used to name them through the Firestore employee
// directory. Its governed replacement must not hand those readers the Principal administration read (listTenantPrincipals,
// admin.principalAccess.read) -- that read discloses the whole tenant population and serves Administration.
//
// MINIMALLY SCOPED:
//   * input   the actor keys the caller ALREADY holds -- they come only from records it was allowed to read -- at most 100 in
//             all: `principalIds` (EOS records) and/or `actorSubjects` (records written OUTSIDE EOS -- e.g. the legacy CRM
//             activity writer -- store the acting identity's external subject instead of a Principal id);
//   * gate    the caller holds a read of the record kinds that display an actor (customer / opportunity / sales agreement /
//             sales order / work order), flat or within an assignment scope; anyone else is refused, never answered empty;
//   * answer  { key, displayName } -- keyed by EXACTLY the identifier asked for, so one identifier is never translated into
//             another -- for Principals with an ACTIVE membership in the CALLER'S tenant, and nothing else: no Principal id for
//             a subject, no Employee id (the Principal-Employee link stays admin.principalAccess.read, Owner ruling B), no
//             Role, no status. A key outside the tenant, or unknown, is simply absent.
// Read-only; grants nothing.
import type { WorkOrderCaller, WorkOrderOperationDeps } from "../eosOps/workOrderOperationTypes";
import { MyWorkError } from "./myWork";

export const ACTOR_DISPLAY_READ_CAPABILITIES = Object.freeze([
  "customer.record.read", "opportunity.read", "salesAgreement.read", "salesOrder.read", "workOrder.record.read",
]);
export const MAX_PRINCIPAL_IDS = 100;

export async function resolvePrincipalDisplayNames(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  const extra = Object.keys(input ?? {}).filter((k) => k !== "principalIds" && k !== "actorSubjects");
  if (extra.length) throw new MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const list = (v: unknown) => (v === undefined ? [] : v);
  const principalIds = list(input?.principalIds);
  const subjects = list(input?.actorSubjects);
  const valid = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200);
  if (!valid(principalIds) || !valid(subjects) || principalIds.length + subjects.length === 0 || principalIds.length + subjects.length > MAX_PRINCIPAL_IDS) {
    throw new MyWorkError("PRINCIPAL_IDS_INVALID", "INVALID_INPUT", `principalIds and actorSubjects are 1 to ${MAX_PRINCIPAL_IDS} non-empty ids in all`);
  }
  const actor = caller.actor;
  if (!holdsAny(caller, ACTOR_DISPLAY_READ_CAPABILITIES)) {
    throw new MyWorkError("CAPABILITY_REQUIRED", "FORBIDDEN", `naming record actors requires one of ${ACTOR_DISPLAY_READ_CAPABILITIES.join(", ")}`);
  }
  const { rows } = await deps.pool.query<{ key: string; display_name: string | null }>(
    `SELECT p.id AS key, p.display_name
       FROM eos_policy.principals p
       JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1 AND m.status = 'active'
      WHERE p.id = ANY($2::text[])
     UNION
     SELECT p.external_subject AS key, p.display_name
       FROM eos_policy.principals p
       JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1 AND m.status = 'active'
      WHERE p.external_subject = ANY($3::text[])
      ORDER BY 1`,
    [actor.tenantId, [...new Set(principalIds)], [...new Set(subjects)]],
  );
  return Object.freeze({ names: Object.freeze(rows.map((r) => Object.freeze({ key: r.key, displayName: r.display_name ?? null }))) });
}

// resolveEmployeeDisplayNames -- WHO OWNS IT, IN WORDS. Commercial records carry their owner / accountable person as an
// EOS Employee id. The Employee directory read (listEmployees) is employee.record.read -- Administration and management --
// so a seller or dispatcher who may read the RECORD could not name its owner. Same minimal shape as the actor read above:
// the Employee ids the caller already holds (from records it was allowed to read), at most 100; the same record-read gate;
// the answer is { key, displayName } for Employees of the CALLER'S tenant, every employment status (a former owner keeps
// their name), and nothing else -- no status, no operating company, no Principal link. Unknown or foreign ids are absent.
export async function resolveEmployeeDisplayNames(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  const extra = Object.keys(input ?? {}).filter((k) => k !== "employeeIds");
  if (extra.length) throw new MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const ids = input?.employeeIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PRINCIPAL_IDS
    || !ids.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200)) {
    throw new MyWorkError("EMPLOYEE_IDS_INVALID", "INVALID_INPUT", `employeeIds is 1 to ${MAX_PRINCIPAL_IDS} non-empty ids`);
  }
  requireRecordRead(caller);
  const { rows } = await deps.pool.query<{ key: string; display_name: string | null }>(
    `SELECT id AS key, display_name FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[]) ORDER BY id`,
    [caller.actor.tenantId, [...new Set(ids as string[])]],
  );
  return Object.freeze({ names: Object.freeze(rows.map((r) => Object.freeze({ key: r.key, displayName: r.display_name ?? null }))) });
}

// searchAccountOwnerCandidates -- WHOM MAY I MAKE THE OWNER. The Account owner picker's OFFER, for a caller who may create
// or update an Account (customer.record.create / customer.record.update -- the capabilities under which the CRM write accepts
// an owner; no capability is added). It offers exactly what that write accepts (accountAuthority requireOwnerEmployee): an
// Employee of the caller's tenant whose status is ACTIVE or CONTRACTOR. A typed query of 2 to 100 characters, matched on the
// name; at most 25 answers of { employeeId, displayName }, by last name then first name then id. The write re-validates.
export const ACCOUNT_OWNER_OFFER_CAPABILITIES = Object.freeze(["customer.record.create", "customer.record.update"]);
export const ACCOUNT_OWNER_CANDIDATE_LIMIT = 25;
export async function searchAccountOwnerCandidates(deps: WorkOrderOperationDeps, caller: WorkOrderCaller, input: Record<string, unknown>) {
  const extra = Object.keys(input ?? {}).filter((k) => k !== "query");
  if (extra.length) throw new MyWorkError("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (query.length < 2 || query.length > 100) throw new MyWorkError("QUERY_INVALID", "INVALID_INPUT", "query is 2 to 100 characters");
  if (!holdsAny(caller, ACCOUNT_OWNER_OFFER_CAPABILITIES)) {
    throw new MyWorkError("CAPABILITY_REQUIRED", "FORBIDDEN", `offering Account owners requires one of ${ACCOUNT_OWNER_OFFER_CAPABILITIES.join(", ")}`);
  }
  const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { rows } = await deps.pool.query<{ id: string; display_name: string | null }>(
    `SELECT id, display_name FROM eos_workforce.employees
      WHERE tenant_id = $1 AND employment_status::text = ANY($2::text[])
        AND (display_name ILIKE $3 OR first_name ILIKE $3 OR last_name ILIKE $3 OR preferred_name ILIKE $3)
      ORDER BY lower(last_name) NULLS LAST, lower(first_name) NULLS LAST, id
      LIMIT ${ACCOUNT_OWNER_CANDIDATE_LIMIT}`,
    [caller.actor.tenantId, ["ACTIVE", "CONTRACTOR"], like],
  );
  return Object.freeze({ candidates: Object.freeze(rows.map((r) => Object.freeze({ employeeId: r.id, displayName: r.display_name ?? r.id }))) });
}

function holdsAny(caller: WorkOrderCaller, keys: readonly string[]): boolean {
  const scoped = (caller.operational?.scopedHeld ?? []) as readonly { capabilityKey: string }[];
  return keys.some((c) => caller.actor.capabilities.has(c) || scoped.some((h) => h.capabilityKey === c));
}

function requireRecordRead(caller: WorkOrderCaller): void {
  if (!holdsAny(caller, ACTOR_DISPLAY_READ_CAPABILITIES)) {
    throw new MyWorkError("CAPABILITY_REQUIRED", "FORBIDDEN", `naming record owners requires one of ${ACTOR_DISPLAY_READ_CAPABILITIES.join(", ")}`);
  }
}
