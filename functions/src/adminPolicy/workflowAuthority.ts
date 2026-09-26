// The EFFECTIVE AUTHORITY half of a workflow decision, composed from the runtime evaluator.
//
// workflowEngine.authorizeWorkflowAction decides WORKFLOW_BINDING itself and asks this for the
// other half. There is exactly one evaluator behind it -- the one every PostgreSQL command path
// already uses -- so a workflow action can never be authorized by a rule the runtime would not
// apply to the same capability:
//
//   capability     authorizeOperationalAction(reader, actor, {capabilityKey, recordId})
//                  -- the flat set from capabilitiesForRoleKeys first, then the provenance-
//                  preserving entitlements with conditions from capability_grant_conditions
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
    async authorize({ capabilityKey, recordId, guardKind }) {
      const capability = await authorizeOperationalAction(reader, actor, { capabilityKey, recordId });
      if (!capability.allowed) return { allowed: false, outcome: capability.outcome };
      if (guardKind === null) return { allowed: true, outcome: "ALLOWED" };
      if (guardKind !== "RECORD_ASSIGNMENT" || !isAssignmentRecordKind(objectKey)) {
        return { allowed: false, outcome: "GUARD_NOT_EVALUABLE" };
      }
      const guard = await authorizeObjectAction(reader, {
        actor: { tenantId: actor.tenantId, principalId: actor.principalId, capabilities: actor.capabilities },
        capabilityKey,
        predicates: [{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }],
        record: { recordKind: objectKey, recordId },
      });
      return guard.allowed ? { allowed: true, outcome: "ALLOWED" } : { allowed: false, outcome: guard.reason };
    },
  };
}
