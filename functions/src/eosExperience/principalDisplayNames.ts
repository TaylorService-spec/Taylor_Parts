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
  const scoped = (caller.operational?.scopedHeld ?? []) as readonly { capabilityKey: string }[];
  const reads = ACTOR_DISPLAY_READ_CAPABILITIES.some((c) => actor.capabilities.has(c) || scoped.some((h) => h.capabilityKey === c));
  if (!reads) {
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
