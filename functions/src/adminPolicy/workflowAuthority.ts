// The EFFECTIVE AUTHORITY half of a workflow decision, composed from the runtime evaluator.
//
// workflowEngine.authorizeWorkflowAction decides WORKFLOW_BINDING itself and asks this for the
// other half. There is exactly one evaluator behind it -- the one every PostgreSQL command path
// already uses -- so a workflow action can never be authorized by a rule the runtime would not
// apply to the same capability:
//
//   capability     authorizeOperationalAction(reader, actor, {capabilityKey, recordId})
//                  -- authorizeEntitledAction: the unconditional flat set OR the actor's
//                  `conditionallyHeld` keys (Pass 8), evaluated per record through the
//                  provenance-preserving entitlements with conditions from capability_grant_conditions.
//                  A conditioned-only key is never decided from the flat set.
//   guard          RECORD_ASSIGNMENT -> authorizeObjectAction with the ASSIGNED_EMPLOYEE relation
//                  over the SAME contextual reader: Employee against Employee, through the ACTIVE
//                  principal link and the open assignment interval. Never a uid comparison.
//
// FAILS CLOSED. A guard on a record kind the evaluator has no relation for is refused
// (GUARD_NOT_EVALUABLE), and publish validation refuses such a definition before it is live.
import {
  authorizeObjectAction,
  type ContextualReader,
  type RecordContext,
} from "../eosOps/contextualAuthorization";
import { authorizeOperationalAction, type OperationalActor } from "../eosOps/entitledActionAuthority";
import type { WorkflowEffectiveAuthority } from "./workflowEngine";

/**
 * The record kinds the RECORD_ASSIGNMENT relation can answer for. Mirrors RecordContext's closed
 * union, pinned by the type below so a new relation table is a compile-visible edit here too.
 */
export const ASSIGNMENT_RECORD_KINDS: readonly RecordContext["recordKind"][] =
  Object.freeze(["workOrder", "reorderRequest"] satisfies RecordContext["recordKind"][]);

export const isAssignmentRecordKind = (value: unknown): value is RecordContext["recordKind"] =>
  typeof value === "string" && (ASSIGNMENT_RECORD_KINDS as readonly string[]).includes(value);

/**
 * The runtime evaluator for one actor and one workflow's Object.
 *
 * `actor` is the transport's already-resolved OperationalActor (capabilities + the REQUIRED
 * entitlement resolver). `objectKey` is the WORKFLOW's Object, read from the store -- never from a
 * request -- and names the relation a RECORD_ASSIGNMENT guard is decided against.
 */
export function operationalWorkflowAuthority(
  reader: ContextualReader,
  actor: OperationalActor,
  objectKey: string | null,
): WorkflowEffectiveAuthority {
  return {
    async authorize({ capabilityKey, recordId, guardKind, businessContext }) {
      // ORDER: the capability -- global, or a scoped holding decided against the record's business context (lane
      // SC) -- then its condition, inside the ONE entitled decision; the guard next; the FUNCTIONAL_ROLE narrowing
      // last, in the engine, only after this has allowed.
      const capability = await authorizeOperationalAction(reader, actor, { capabilityKey, recordId, businessContext });
      if (!capability.allowed) return { allowed: false, outcome: capability.outcome };
      if (guardKind === null) return { allowed: true, outcome: "ALLOWED" };
      if (guardKind !== "RECORD_ASSIGNMENT" || !isAssignmentRecordKind(objectKey)) {
        return { allowed: false, outcome: "GUARD_NOT_EVALUABLE" };
      }
      // The capability was just ADMITTED by the entitled decision -- possibly through a conditioned
      // grant, which the flat set withholds by design (Pass 8: conditionallyHeld). The guard asks only
      // the record relation, so it is evaluated over the admitted key, never a flat-set re-check.
      const guard = await authorizeObjectAction(reader, {
        actor: { tenantId: actor.tenantId, principalId: actor.principalId, capabilities: new Set([capabilityKey]) },
        capabilityKey,
        predicates: [{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }],
        record: { recordKind: objectKey, recordId },
      });
      return guard.allowed ? { allowed: true, outcome: "ALLOWED" } : { allowed: false, outcome: guard.reason };
    },
  };
}
