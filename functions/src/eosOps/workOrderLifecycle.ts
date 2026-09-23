// THE GOVERNED WORK ORDER LIFECYCLE AUTHORITY.
//
// ════════════════════ THE MATRIX IS DERIVED, NOT INVENTED ════════════════════
//
// Every edge below comes from transitionEngine.ts's TRANSITIONS map -- the live process today -- and
// every DEPENDENCY comes from inventoryService.ts's STATE_TRIGGERS, which names exactly three statuses
// that carry an effect:
//
//     DISPATCHED  -> reserveParts
//     COMPLETED   -> consumeParts + finalizeInventoryTransaction
//     CANCELLED   -> releaseParts
//
// So a transition INTO one of those three is not a status change; it is a status change plus an
// inventory effect, and performing the first without the second is the exact failure this authority
// exists to prevent. "Do not simulate completion by simply changing status" applies to all three.
//
// NOT_YET_IMPLEMENTED IS A REAL ANSWER AND IT FAILS CLOSED. It is not REFUSED -- the business does
// perform these transitions today, in Firebase -- and it is not ALLOWED, because the authority the
// transition depends on is not composed here yet. Collapsing the two would either delete a real
// business capability from the model or let a Work Order reach COMPLETED with no parts consumed.
//
// NO SECOND VOCABULARY. The statuses are ops_work_order_status, restated here only so this module stays
// free of the Firestore engine, and a test asserts the two sets are identical.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";

const SCHEMA = "eos_ops";

export const WORK_ORDER_STATUSES = Object.freeze([
  "CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED",
  "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED",
] as const);
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const TERMINAL_STATUSES: readonly WorkOrderStatus[] = Object.freeze(["COMPLETED", "CLOSED", "CANCELLED"]);

/** Already in the catalog; this authority invents no capability. */
export const WORK_ORDER_TRANSITION = "workOrder.transition";
export const WORK_ORDER_CANCEL = "workOrder.cancel";

export type TransitionDisposition = "ALLOWED" | "NOT_YET_IMPLEMENTED" | "REFUSED";

export interface TransitionRule {
  readonly from: WorkOrderStatus;
  readonly to: WorkOrderStatus;
  readonly action: string;
  readonly disposition: TransitionDisposition;
  readonly capability: string;
  /** Named when the disposition is NOT_YET_IMPLEMENTED, so the gap is legible rather than mysterious. */
  readonly dependsOn: string | null;
}

const rule = (
  from: WorkOrderStatus, to: WorkOrderStatus, action: string,
  disposition: TransitionDisposition, capability: string, dependsOn: string | null,
): TransitionRule => Object.freeze({ from, to, action, disposition, capability, dependsOn });

/**
 * THE MATRIX. Exactly transitionEngine.ts's edges -- no edge added, none removed.
 */
export const TRANSITION_MATRIX: readonly TransitionRule[] = Object.freeze([
  // ── implemented: no dependent authority is missing and no inventory effect is owed ──
  rule("CREATED", "READY_TO_DISPATCH", "markReadyToDispatch", "ALLOWED", WORK_ORDER_TRANSITION, null),
  rule("SCHEDULED", "READY_TO_DISPATCH", "unschedule", "ALLOWED", WORK_ORDER_TRANSITION, null),
  rule("COMPLETED", "CLOSED", "close", "ALLOWED", WORK_ORDER_TRANSITION, null),

  // ── scheduling ──
  rule("READY_TO_DISPATCH", "SCHEDULED", "schedule", "NOT_YET_IMPLEMENTED", WORK_ORDER_TRANSITION,
    "the scheduling authority: a SCHEDULED Work Order asserts a time and an assignee, and neither is established here"),

  // ── inventory effects (inventoryService.ts STATE_TRIGGERS) ──
  rule("SCHEDULED", "DISPATCHED", "dispatch", "NOT_YET_IMPLEMENTED", WORK_ORDER_TRANSITION,
    "reserveParts: DISPATCHED reserves the planned parts. The PostgreSQL equivalent exists "
    + "(inventoryCommitmentRepository.reserve) but is not composed into this transition, and dispatching "
    + "without reserving promises stock nobody set aside"),
  rule("WORK_IN_PROGRESS", "COMPLETED", "complete", "NOT_YET_IMPLEMENTED", WORK_ORDER_TRANSITION,
    "consumeParts + finalizeInventoryTransaction: COMPLETED consumes what was used and closes the "
    + "inventory record. Changing the status alone would report work finished with the parts still promised"),

  // ── technician runtime ──
  rule("DISPATCHED", "ACCEPTED", "accept", "NOT_YET_IMPLEMENTED", WORK_ORDER_TRANSITION,
    "the technician runtime: acceptance is performed BY the assigned Employee, and that seam is not composed here"),
  rule("ACCEPTED", "EN_ROUTE", "startTravel", "NOT_YET_IMPLEMENTED", WORK_ORDER_TRANSITION, "the technician runtime"),
  rule("EN_ROUTE", "ARRIVED", "arrive", "NOT_YET_IMPLEMENTED", WORK_ORDER_TRANSITION, "the technician runtime"),
  rule("ARRIVED", "WORK_IN_PROGRESS", "startWork", "NOT_YET_IMPLEMENTED", WORK_ORDER_TRANSITION, "the technician runtime"),

  // ── cancellation, from every non-terminal state ──
  ...(["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"] as WorkOrderStatus[])
    .map((from) => rule(from, "CANCELLED", "cancel", "NOT_YET_IMPLEMENTED", WORK_ORDER_CANCEL,
      "releaseParts: CANCELLED releases everything the Work Order still holds. The PostgreSQL equivalent "
      + "exists (inventoryCommitmentRepository.releaseOutstanding) but is not composed here, and cancelling "
      + "without releasing strands the stock permanently")),
]);

export type LifecycleCategory = "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN" | "UNAVAILABLE";

export class WorkOrderLifecycleError extends Error {
  constructor(readonly code: string, readonly category: LifecycleCategory, message: string) {
    super(message);
    this.name = "WorkOrderLifecycleError";
  }
}
const refuse = (code: string, category: LifecycleCategory, message: string): never => {
  throw new WorkOrderLifecycleError(code, category, message);
};

/** The rule for one edge, or REFUSED when the business has no such transition. */
export function transitionRuleFor(from: WorkOrderStatus, to: WorkOrderStatus): TransitionRule {
  return TRANSITION_MATRIX.find((r) => r.from === from && r.to === to)
    ?? rule(from, to, "(none)", "REFUSED", WORK_ORDER_TRANSITION, null);
}

export interface LifecycleActor {
  readonly tenantId: string;
  /** The EOS Principal id. The ACTOR -- never an Employee, never a Firebase uid. */
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface TransitionResult {
  readonly workOrderId: string;
  readonly fromStatus: WorkOrderStatus;
  readonly toStatus: WorkOrderStatus;
  readonly action: string;
  readonly transitionId: string;
  readonly occurredAt: string;
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

/**
 * Perform one governed lifecycle transition.
 *
 * THE EXPECTED CURRENT STATE IS REQUIRED. A caller states what it believes the Work Order is, and a
 * mismatch is a CONFLICT rather than a silent overwrite -- two dispatchers acting on the same stale
 * screen must not both succeed. The row is taken FOR UPDATE, so the check and the write cannot be
 * separated by another transaction.
 *
 * PROVENANCE DOES NOT GATE AUTHORITY. A migrated Work Order uses this command exactly as a native one
 * does; there is no second runtime for legacy records. The TRANSITION it writes is NATIVE, because this
 * transition really is happening now, whatever the record's own origin was.
 */
export async function transitionWorkOrder(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: LifecycleActor,
  input: {
    readonly workOrderId: string;
    readonly expectedStatus: WorkOrderStatus;
    readonly toStatus: WorkOrderStatus;
    readonly note?: string;
  },
): Promise<TransitionResult> {
  if (!ID_SHAPE(actor?.tenantId) || !ID_SHAPE(actor?.principalId)) {
    refuse("ACTOR_INVALID", "INVALID_INPUT", "an actor is a Principal within a tenant");
  }
  if (!ID_SHAPE(input?.workOrderId)) refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
  for (const status of [input.expectedStatus, input.toStatus]) {
    if (!(WORK_ORDER_STATUSES as readonly string[]).includes(status)) {
      refuse("STATUS_UNKNOWN", "INVALID_INPUT", `${String(status)} is not a governed Work Order status`);
    }
  }
  const ruleForEdge = transitionRuleFor(input.expectedStatus, input.toStatus);
  if (ruleForEdge.disposition === "REFUSED") {
    refuse("TRANSITION_NOT_ALLOWED", "PRECONDITION_FAILED",
      `${input.expectedStatus} -> ${input.toStatus} is not a transition this business performs`);
  }
  if (ruleForEdge.disposition === "NOT_YET_IMPLEMENTED") {
    refuse("TRANSITION_AUTHORITY_UNAVAILABLE", "UNAVAILABLE",
      `${input.expectedStatus} -> ${input.toStatus} depends on ${ruleForEdge.dependsOn}. It is refused rather `
      + "than performed, because the status alone would misreport what happened.");
  }
  if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(ruleForEdge.capability)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `this transition requires ${ruleForEdge.capability}`);
  }

  const now = (deps.now ?? (() => new Date()))();
  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT status::text AS status FROM ${SCHEMA}.work_orders
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, input.workOrderId]);
    if (current.rows.length === 0) {
      refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", `no work order ${input.workOrderId} in this tenant`);
    }
    const observed = String(current.rows[0].status) as WorkOrderStatus;
    if (observed !== input.expectedStatus) {
      refuse("STALE_WORK_ORDER_STATE", "CONFLICT",
        `the work order is ${observed}, not ${input.expectedStatus}. Another transition won this race.`);
    }

    const stamp = input.toStatus === "COMPLETED" ? "completed_at" : input.toStatus === "CLOSED" ? "closed_at" : null;
    await client.query(
      `UPDATE ${SCHEMA}.work_orders
          SET status = $3::${SCHEMA}.ops_work_order_status, updated_at = $4
              ${stamp ? `, ${stamp} = COALESCE(${stamp}, $4)` : ""}
        WHERE tenant_id = $1 AND id = $2`,
      [actor.tenantId, input.workOrderId, input.toStatus, now]);

    const transitionId = `wot_${randomUUID()}`;
    await client.query(
      `INSERT INTO ${SCHEMA}.work_order_transitions
         (id, tenant_id, work_order_id, from_status, to_status, action, occurred_at, actor_principal_id, note, provenance)
       VALUES ($1,$2,$3,$4::${SCHEMA}.ops_work_order_status,$5::${SCHEMA}.ops_work_order_status,$6,$7,$8,$9,'NATIVE')`,
      [transitionId, actor.tenantId, input.workOrderId, observed, input.toStatus, ruleForEdge.action,
       // THE SERVER'S CLOCK. A client-authored transition time would let a caller state when something
       // happened, and "when" is half of what history is for.
       now, actor.principalId, input.note ?? null]);

    await client.query("COMMIT");
    return Object.freeze({
      workOrderId: input.workOrderId, fromStatus: observed, toStatus: input.toStatus,
      action: ruleForEdge.action, transitionId, occurredAt: now.toISOString(),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { /* the original error is the one that matters */ });
    throw err;
  } finally {
    client.release();
  }
}

/** Read a Work Order's transition history, oldest first. Read-only. */
export async function readTransitionHistory(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  workOrderId: string,
): Promise<readonly { readonly fromStatus: string | null; readonly toStatus: string; readonly action: string; readonly actorPrincipalId: string | null; readonly occurredAt: string; readonly provenance: string }[]> {
  const { rows } = await db.query(
    `SELECT from_status::text AS from_status, to_status::text AS to_status, action,
            actor_principal_id, occurred_at, provenance::text AS provenance
       FROM ${SCHEMA}.work_order_transitions
      WHERE tenant_id = $1 AND work_order_id = $2
      ORDER BY occurred_at, id`,
    [tenantId, workOrderId]);
  return Object.freeze(rows.map((r) => Object.freeze({
    fromStatus: r.from_status === null ? null : String(r.from_status),
    toStatus: String(r.to_status), action: String(r.action),
    actorPrincipalId: r.actor_principal_id === null ? null : String(r.actor_principal_id),
    occurredAt: new Date(r.occurred_at as string).toISOString(),
    provenance: String(r.provenance),
  })));
}
