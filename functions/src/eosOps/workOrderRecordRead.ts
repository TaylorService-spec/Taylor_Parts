// THE GOVERNED WORK ORDER RECORD READ (Controller ruling DQ-016, CLOSED 2026-09-28).
//
//   "Technician Work Order read = workOrder.record.read + RECORD_ASSIGNMENT, no tenant-wide fallback."
//
// Every PostgreSQL Work Order read this domain exposes goes through `authorizeWorkOrderRecordRead`, which
// is the ENTITLED decision (entitledActionAuthority.authorizeOperationalAction) for ONE named record:
//
//   * the capability is checked first -- no capability, no record read, nothing learned;
//   * a grant carrying a condition (technician | workOrder.record.read | RECORD_ASSIGNMENT, set through
//     Administration -> setGrantCondition) is decided against the OPEN governed assignment, Employee
//     against Employee -- own Work Order allowed, anybody else's NOT_ASSIGNED;
//   * an unconditioned holder (dispatcher, service manager) reads the tenant's Work Orders, as ruled.
//
// NO TENANT-WIDE FALLBACK, made structural rather than promised:
//   * a record id is REQUIRED. "No record supplied" is refused here before the evaluator is asked, so a
//     conditioned holder can never be answered for "all Work Orders".
//   * the actor's entitlements are REQUIRED. A caller that could not resolve them (the condition store
//     unreadable) gets the evaluator's failure, never a flat `capabilities.has()` substitute: this module
//     holds no flat check of workOrder.record.read anywhere.
//   * the raw readers (`readTransitionHistory`, `readPartsPlan`) are the trusted internals of the
//     commands; a transport must use the governed readers below, and a source guard test says so.
//
// WHAT THIS DOES NOT DO: it does not SET the technician condition. That is an Administration act on
// governed PostgreSQL authority (ADMIN_READY, administrationControlPlanePostgres CASE D) and, in any real
// environment, an authorized execution step -- recorded in the lane ledger, never a migration.
import type { Pool, PoolClient } from "pg";
import { authorizeOperationalAction, type OperationalActor } from "./entitledActionAuthority";
import type { ContextualReader } from "./contextualAuthorization";
import type { EntitledActionDecision } from "./conditionalEntitlement";
import { readTransitionHistory } from "./workOrderLifecycle";
import { readPartsPlan, type PlannedRequirement } from "./workOrderPartsPlanAuthority";

export const WORK_ORDER_RECORD_READ = "workOrder.record.read";

export class WorkOrderReadError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "FORBIDDEN" | "NOT_FOUND", message: string) {
    super(message);
    this.name = "WorkOrderReadError";
  }
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

/**
 * Decide whether this actor may read THIS Work Order. Returns the evaluator's decision unchanged; never
 * widens it. A missing record id refuses before the evaluator is consulted.
 */
export async function authorizeWorkOrderRecordRead(
  reader: ContextualReader,
  actor: OperationalActor,
  workOrderId: string,
): Promise<EntitledActionDecision> {
  if (!ID_SHAPE(workOrderId)) {
    throw new WorkOrderReadError("WORK_ORDER_ID_REQUIRED", "INVALID_INPUT",
      "a Work Order read names ONE Work Order; there is no tenant-wide read through this gate");
  }
  if (!actor || typeof actor.entitlements !== "function") {
    throw new WorkOrderReadError("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN",
      "a resolved actor with its entitlements is required; a flat capability set is not a substitute");
  }
  return authorizeOperationalAction(reader, actor, { capabilityKey: WORK_ORDER_RECORD_READ, recordId: workOrderId });
}

async function requireRead(reader: ContextualReader, actor: OperationalActor, workOrderId: string): Promise<void> {
  const decision = await authorizeWorkOrderRecordRead(reader, actor, workOrderId);
  if (!decision.allowed) {
    // The OUTCOME is the refusal code (CAPABILITY_MISSING, NOT_ASSIGNED, EMPLOYEE_LINK_REQUIRED, ...): one
    // generic FORBIDDEN would hide which authority refused. A real id and a guessed one refuse identically.
    throw new WorkOrderReadError(String(decision.outcome), "FORBIDDEN", "this Work Order may not be read by this caller");
  }
}

/** A Work Order's transition history, oldest first -- only after the governed read decision allows it. */
export async function readWorkOrderTransitionHistoryGoverned(
  deps: { readonly db: Pick<Pool, "query"> | Pick<PoolClient, "query">; readonly reader: ContextualReader },
  actor: OperationalActor,
  workOrderId: string,
): ReturnType<typeof readTransitionHistory> {
  await requireRead(deps.reader, actor, workOrderId);
  return readTransitionHistory(deps.db as Pick<PoolClient, "query">, actor.tenantId, workOrderId);
}

/** A Work Order's current parts plan -- only after the governed read decision allows it. */
export async function readWorkOrderPartsPlanGoverned(
  deps: { readonly db: Pick<Pool, "query"> | Pick<PoolClient, "query">; readonly reader: ContextualReader },
  actor: OperationalActor,
  workOrderId: string,
): Promise<readonly PlannedRequirement[]> {
  await requireRead(deps.reader, actor, workOrderId);
  return readPartsPlan(deps.db as Pick<PoolClient, "query">, actor.tenantId, workOrderId);
}
