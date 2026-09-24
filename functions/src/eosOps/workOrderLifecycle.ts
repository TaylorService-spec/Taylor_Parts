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
import {
  authorizeObjectAction,
  postgresContextualReader,
  type AuthorizationDecision,
  type ContextPredicate,
  type ContextualReader,
} from "./contextualAuthorization";

const SCHEMA = "eos_ops";

export const WORK_ORDER_STATUSES = Object.freeze([
  "CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED",
  "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED",
] as const);
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const TERMINAL_STATUSES: readonly WorkOrderStatus[] = Object.freeze(["COMPLETED", "CLOSED", "CANCELLED"]);

/**
 * ════════════════════ THE CAPABILITY VOCABULARY IS POSTGRESQL'S, NOT FIRESTORE'S ════════════════════
 *
 * These keys must exist in `eos_policy.capabilities`, because that -- through capabilitiesForRoleKeys --
 * is what actually authorizes a Render request. The Firestore permissionCatalog is a different
 * authority and its ids are NOT interchangeable with these: an earlier version of this file asked for
 * `workOrder.cancel`, which exists only in Firestore, so no principal could ever have held it and every
 * cancel would have been FORBIDDEN by construction.
 *
 * THE THREE EFFECT-BEARING EDGES REUSE THE KEYS THAT ALREADY EXIST. Migration 1757894400000 catalogued
 * dispatch / cancel / complete precisely because each drives triggerInventoryEffects -- the
 * RESERVED / RELEASED / CONSUMED commitment writes. Those are the same three edges this engine defers,
 * and they keep their own capability rather than falling through the general one.
 *
 * THE GENERAL KEY IS NOT A SUPERSET. A caller holding only `workOrder.transition` must not be able to
 * reserve, release or consume stock; if it could, the three specific keys would be decorative. A test
 * asserts `workOrder.transition` appears on none of the three effect edges.
 */
export const WORK_ORDER_TRANSITION = "workOrder.transition";
export const WORK_ORDER_LIFECYCLE_DISPATCH = "workOrder.lifecycle.dispatch";
export const WORK_ORDER_LIFECYCLE_CANCEL = "workOrder.lifecycle.cancel";
export const WORK_ORDER_LIFECYCLE_COMPLETE = "workOrder.lifecycle.complete";

/** Exactly the edges that fire an inventory effect (inventoryService.ts STATE_TRIGGERS). */
export const EFFECT_BEARING_TARGET_STATUSES: readonly WorkOrderStatus[] =
  Object.freeze(["DISPATCHED", "COMPLETED", "CANCELLED"]);

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
  rule("SCHEDULED", "DISPATCHED", "dispatch", "NOT_YET_IMPLEMENTED", WORK_ORDER_LIFECYCLE_DISPATCH,
    "reserveParts: DISPATCHED reserves the planned parts. The PostgreSQL equivalent exists "
    + "(inventoryCommitmentRepository.reserve) but is not composed into this transition, and dispatching "
    + "without reserving promises stock nobody set aside"),
  rule("WORK_IN_PROGRESS", "COMPLETED", "complete", "NOT_YET_IMPLEMENTED", WORK_ORDER_LIFECYCLE_COMPLETE,
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
    .map((from) => rule(from, "CANCELLED", "cancel", "NOT_YET_IMPLEMENTED", WORK_ORDER_LIFECYCLE_CANCEL,
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
 * ════════════════════ THE RECORD CONTEXT EACH LIFECYCLE CAPABILITY REQUIRES ════════════════════
 *
 * Owner ruling B (NONPROD activation, 2026-09-23): "Completion requires RECORD_ASSIGNMENT / OWN
 * ASSIGNMENT." A Technician holding `workOrder.lifecycle.complete` may complete THE WORK ORDER THEY
 * ARE ASSIGNED TO, and no other. The relation is proved server-side, EMPLOYEE AGAINST EMPLOYEE,
 * through the ACTIVE `employee_principal_links` row and the OPEN `work_order_assignments` interval --
 * contextualAuthorization.ts's RECORD_ASSIGNMENT predicate, which is this platform's one authority
 * for "is this mine". Nothing here is caller-supplied but the record id.
 *
 * THE OTHER RELATIONS ARE NOT SUBSTITUTES, and none of them appears here. Record owner, requester,
 * Security Role and Operational Scope each answer a different question: "may work in this warehouse"
 * is not "is assigned this job", and a model that accepted either would hand every technician in the
 * territory everyone else's work to close.
 *
 * DISPATCH AND CANCEL DECLARE NO CONTEXT PREDICATE, deliberately -- they are ABSENT from this map
 * rather than present with an empty list, so adding one is a visible edit against the ruling. A
 * dispatcher dispatches work they are not assigned to; that IS dispatching. Their existing domain
 * preconditions (the transition matrix edge, the expected-status CONFLICT check, the named lifecycle
 * dependency) are untouched: a context predicate narrows WHICH records an already-held capability
 * reaches, and it neither adds nor removes a lifecycle rule.
 *
 * SCOPE STILL DOES NOT LIVE ON THE GRANT. The activated `role_capabilities` rows carry no ownOnly and
 * no assignmentRequired column; this map is policy about the ACTION, kept in code beside the
 * transition it guards, exactly as contextualAuthorization.ts's header requires.
 */
const NO_CONTEXT_PREDICATES: readonly ContextPredicate[] = Object.freeze([]);

export const LIFECYCLE_CONTEXT_PREDICATES: Readonly<Record<string, readonly ContextPredicate[]>> = Object.freeze({
  [WORK_ORDER_LIFECYCLE_COMPLETE]: Object.freeze([
    Object.freeze({ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" } as const),
  ]) as readonly ContextPredicate[],
});

/** The context predicates one lifecycle capability declares. Unlisted means NONE, never "unknown". */
export function lifecycleContextPredicates(capability: string): readonly ContextPredicate[] {
  return Object.prototype.hasOwnProperty.call(LIFECYCLE_CONTEXT_PREDICATES, capability)
    ? LIFECYCLE_CONTEXT_PREDICATES[capability]
    : NO_CONTEXT_PREDICATES;
}

/**
 * Authorize one lifecycle edge: the CAPABILITY first, then only the predicates that edge declares.
 *
 * ORDER IS THE POINT, and it is not this function's own convention -- `authorizeObjectAction`
 * returns CAPABILITY_MISSING before it asks the reader anything at all, so an unauthorized caller
 * causes ZERO record reads and learns nothing about whether the Work Order exists, who it belongs to,
 * or whether they guessed a real id. A counting reader proves it rather than a comment asserting it.
 *
 * Exported separately from `transitionWorkOrder` so the DECISION is provable on its own, without
 * needing an edge that is deliberately NOT_YET_IMPLEMENTED to succeed first. The command below calls
 * exactly this function: there is no second authorization path to drift from this one.
 */
export async function authorizeLifecycleEdge(
  reader: ContextualReader,
  actor: LifecycleActor,
  input: {
    readonly workOrderId: string;
    readonly expectedStatus: WorkOrderStatus;
    readonly toStatus: WorkOrderStatus;
  },
): Promise<AuthorizationDecision> {
  const edge = transitionRuleFor(input.expectedStatus, input.toStatus);
  return authorizeObjectAction(reader, {
    actor: {
      tenantId: actor.tenantId,
      principalId: actor.principalId,
      capabilities: actor.capabilities,
    },
    capabilityKey: edge.capability,
    predicates: lifecycleContextPredicates(edge.capability),
    // The record is supplied for EVERY edge, so a predicate added later cannot silently degrade to
    // the evaluator's "no record supplied" refusal. Supplying it costs nothing when nothing reads it.
    record: { recordKind: "workOrder", recordId: input.workOrderId },
  });
}

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
  deps: {
    readonly pool: Pool;
    readonly now?: () => Date;
    /**
     * The contextual reader. Defaults to the governed PostgreSQL one over this same pool; injectable
     * ONLY so a test can count its reads. It is never a way for a caller to supply the relation.
     */
    readonly contextualReader?: ContextualReader;
  },
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
  // CAPABILITY BEFORE AVAILABILITY, deliberately. An unauthorized caller learns it is unauthorized and
  // nothing else: telling them a feature is "not yet implemented" discloses the platform's roadmap to
  // someone with no authority over it. It also keeps the specific effect-boundary capabilities testable
  // at runtime rather than only as table data.
  //
  // AND CAPABILITY BEFORE RECORD CONTEXT, which `authorizeLifecycleEdge` owns: the capability refusal
  // happens before any relation table is read, so "that Work Order is not yours" is never the answer
  // given to somebody who had no authority over Work Orders in the first place. The REASON is the
  // refusal CODE -- CAPABILITY_MISSING, NOT_ASSIGNED, EMPLOYEE_LINK_REQUIRED -- because collapsing
  // them into one generic FORBIDDEN would hide which authority actually refused, from the caller and
  // from the audit alike.
  const decision = await authorizeLifecycleEdge(
    deps.contextualReader ?? postgresContextualReader(deps.pool),
    actor,
    { workOrderId: input.workOrderId, expectedStatus: input.expectedStatus, toStatus: input.toStatus },
  );
  if (!decision.allowed) {
    refuse(decision.reason, "FORBIDDEN",
      decision.reason === "CAPABILITY_MISSING"
        ? `this transition requires ${ruleForEdge.capability}`
        : `${ruleForEdge.action} requires ${decision.predicate ?? "a governed record relation"}`
          + " on this Work Order, and this caller does not hold it");
  }
  if (ruleForEdge.disposition === "NOT_YET_IMPLEMENTED") {
    refuse("TRANSITION_AUTHORITY_UNAVAILABLE", "UNAVAILABLE",
      `${input.expectedStatus} -> ${input.toStatus} depends on ${ruleForEdge.dependsOn}. It is refused rather `
      + "than performed, because the status alone would misreport what happened.");
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
