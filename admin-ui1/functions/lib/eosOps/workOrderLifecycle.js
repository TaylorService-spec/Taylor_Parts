"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TRANSITION_NOTE = exports.EDGE_CONTEXT_PREDICATES = exports.LIFECYCLE_CONTEXT_PREDICATES = exports.WorkOrderLifecycleError = exports.STATUS_TIMESTAMP_COLUMN = exports.TRANSITION_MATRIX = exports.INVENTORY_BOUNDARY = exports.EFFECT_BEARING_TARGET_STATUSES = exports.WORK_ORDER_LIFECYCLE_CLOSE = exports.WORK_ORDER_LIFECYCLE_SCHEDULE = exports.WORK_ORDER_LIFECYCLE_READY = exports.WORK_ORDER_LIFECYCLE_COMPLETE = exports.WORK_ORDER_LIFECYCLE_CANCEL = exports.WORK_ORDER_LIFECYCLE_DISPATCH = exports.WORK_ORDER_TRANSITION = exports.TERMINAL_STATUSES = exports.WORK_ORDER_STATUSES = void 0;
exports.transitionRuleFor = transitionRuleFor;
exports.edgeContextPredicates = edgeContextPredicates;
exports.lifecycleContextPredicates = lifecycleContextPredicates;
exports.authorizeLifecycleEdge = authorizeLifecycleEdge;
exports.transitionWorkOrder = transitionWorkOrder;
exports.authorizeEdgeOrRefuse = authorizeEdgeOrRefuse;
exports.applyTransitionWithinTransaction = applyTransitionWithinTransaction;
exports.readTransitionHistory = readTransitionHistory;
const node_crypto_1 = require("node:crypto");
const contextualAuthorization_1 = require("./contextualAuthorization");
const workOrderQuarantine_1 = require("./workOrderQuarantine");
const SCHEMA = "eos_ops";
exports.WORK_ORDER_STATUSES = Object.freeze([
    "CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED",
    "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED",
]);
exports.TERMINAL_STATUSES = Object.freeze(["COMPLETED", "CLOSED", "CANCELLED"]);
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
exports.WORK_ORDER_TRANSITION = "workOrder.transition";
exports.WORK_ORDER_LIFECYCLE_DISPATCH = "workOrder.lifecycle.dispatch";
exports.WORK_ORDER_LIFECYCLE_CANCEL = "workOrder.lifecycle.cancel";
exports.WORK_ORDER_LIFECYCLE_COMPLETE = "workOrder.lifecycle.complete";
/**
 * Controller ruling DQ-010 (2026-09-28): the materially distinct DISPATCHER-BUCKET actions each get their
 * OWN BUSINESS_ACTION capability instead of the broad `workOrder.transition` -- which the baseline grants
 * to eleven Roles, technician and partsAssociate included, so a technician could have closed any
 * Work Order in the tenant. Registered by migration 1763856000000 with NO grants: holding them is an
 * Administration decision. `workOrder.transition` now gates ONLY the technician runtime edges.
 */
exports.WORK_ORDER_LIFECYCLE_READY = "workOrder.lifecycle.ready";
exports.WORK_ORDER_LIFECYCLE_SCHEDULE = "workOrder.lifecycle.schedule";
exports.WORK_ORDER_LIFECYCLE_CLOSE = "workOrder.lifecycle.close";
/** Exactly the edges that fire an inventory effect (inventoryService.ts STATE_TRIGGERS). */
exports.EFFECT_BEARING_TARGET_STATUSES = Object.freeze(["DISPATCHED", "COMPLETED", "CANCELLED"]);
const rule = (from, to, action, disposition, capability, dependsOn, command = "transition", inventoryBoundary = null) => Object.freeze({ from, to, action, disposition, capability, dependsOn, command, inventoryBoundary });
/**
 * The boundary each effect-bearing edge states. Stock reservation, consumption and release are NOT_YET_ACTIVATED on
 * EOS, and NO Firebase stock action occurs either: the Work Order authority is PostgreSQL and the Firebase Work Order
 * writers are FROZEN. (Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30: the earlier wording named a Firebase stock
 * action that no longer happens; the codes are unchanged.)
 */
exports.INVENTORY_BOUNDARY = Object.freeze({
    DISPATCHED: "RESERVE_NOT_APPLIED: stock reservation is NOT_YET_ACTIVATED; this dispatch reserved no parts, "
        + "and no Firebase stock action occurs",
    COMPLETED: "CONSUME_NOT_APPLIED: stock consumption is NOT_YET_ACTIVATED; the parts actuals are recorded as "
        + "execution facts, no stock was consumed, and no Firebase stock action occurs",
    CANCELLED: "RELEASE_NOT_APPLIED: stock release is NOT_YET_ACTIVATED; this path never reserved, so nothing was "
        + "released, and no Firebase stock action occurs",
});
/**
 * THE MATRIX. Exactly transitionEngine.ts's edges -- no edge added, none removed.
 */
exports.TRANSITION_MATRIX = Object.freeze([
    rule("CREATED", "READY_TO_DISPATCH", "markReadyToDispatch", "ALLOWED", exports.WORK_ORDER_LIFECYCLE_READY, null),
    rule("COMPLETED", "CLOSED", "close", "ALLOWED", exports.WORK_ORDER_LIFECYCLE_CLOSE, null),
    // ── scheduling: a SCHEDULED Work Order asserts a window AND an assignee, so it is a command, never a flip ──
    rule("READY_TO_DISPATCH", "SCHEDULED", "schedule", "ALLOWED", exports.WORK_ORDER_LIFECYCLE_SCHEDULE, null, "schedule"),
    // UNSCHEDULE IS THE INVERSE OF SCHEDULE. Owner ruling ND-18 (2026-08-27) makes it a REASONED act: a stated
    // reason, a record of the technician and window given up (the ENDED assignment interval and the schedule
    // history row), and the placement CLEARED so a job back in the Ready queue is indistinguishable from one
    // never scheduled.
    rule("SCHEDULED", "READY_TO_DISPATCH", "unschedule", "ALLOWED", exports.WORK_ORDER_LIFECYCLE_SCHEDULE, null, "unschedule"),
    // ── the three effect-bearing edges: each states the inventory boundary it does not cross ──
    rule("SCHEDULED", "DISPATCHED", "dispatch", "ALLOWED", exports.WORK_ORDER_LIFECYCLE_DISPATCH, null, "dispatch", exports.INVENTORY_BOUNDARY.DISPATCHED),
    rule("WORK_IN_PROGRESS", "COMPLETED", "complete", "ALLOWED", exports.WORK_ORDER_LIFECYCLE_COMPLETE, null, "complete", exports.INVENTORY_BOUNDARY.COMPLETED),
    // ── technician runtime: performed BY the assigned Employee (RECORD_ASSIGNMENT, below) ──
    rule("DISPATCHED", "ACCEPTED", "accept", "ALLOWED", exports.WORK_ORDER_TRANSITION, null),
    rule("ACCEPTED", "EN_ROUTE", "startTravel", "ALLOWED", exports.WORK_ORDER_TRANSITION, null),
    rule("EN_ROUTE", "ARRIVED", "arrive", "ALLOWED", exports.WORK_ORDER_TRANSITION, null),
    rule("ARRIVED", "WORK_IN_PROGRESS", "startWork", "ALLOWED", exports.WORK_ORDER_TRANSITION, null),
    // ── cancellation, from every non-terminal state ──
    ...["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS"]
        .map((from) => rule(from, "CANCELLED", "cancel", "ALLOWED", exports.WORK_ORDER_LIFECYCLE_CANCEL, null, "transition", exports.INVENTORY_BOUNDARY.CANCELLED)),
]);
/** The timestamp each target status stamps -- once, on first arrival (COALESCE), from the server clock. */
exports.STATUS_TIMESTAMP_COLUMN = Object.freeze({
    DISPATCHED: "dispatched_at",
    ACCEPTED: "accepted_at",
    EN_ROUTE: "en_route_at",
    ARRIVED: "arrived_at",
    WORK_IN_PROGRESS: "work_started_at",
    COMPLETED: "completed_at",
    CLOSED: "closed_at",
});
class WorkOrderLifecycleError extends Error {
    code;
    category;
    constructor(code, category, message) {
        super(message);
        this.code = code;
        this.category = category;
        this.name = "WorkOrderLifecycleError";
    }
}
exports.WorkOrderLifecycleError = WorkOrderLifecycleError;
const refuse = (code, category, message) => {
    throw new WorkOrderLifecycleError(code, category, message);
};
/** The rule for one edge, or REFUSED when the business has no such transition. */
function transitionRuleFor(from, to) {
    return exports.TRANSITION_MATRIX.find((r) => r.from === from && r.to === to)
        ?? rule(from, to, "(none)", "REFUSED", exports.WORK_ORDER_TRANSITION, null);
}
const ID_SHAPE = (v) => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
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
const NO_CONTEXT_PREDICATES = Object.freeze([]);
const OWN_ASSIGNMENT = Object.freeze([
    Object.freeze({ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }),
]);
exports.LIFECYCLE_CONTEXT_PREDICATES = Object.freeze({
    [exports.WORK_ORDER_LIFECYCLE_COMPLETE]: OWN_ASSIGNMENT,
});
/**
 * THE TECHNICIAN RUNTIME EDGES ARE OWN-ASSIGNMENT TOO (the cutover, 2026-09-30) -- declared on the EDGE, not on
 * the capability. Firebase's ACTION_PERMISSIONS marks Accept / Travel / Arrive / WorkStart `requiresOwnAssignment:
 * true`; workOrder.transition is granted to eleven Roles, so without the predicate any of them could accept or
 * start another technician's job. It narrows these four edges and grants nothing.
 *
 * WHY THE EDGE AND NOT THE CAPABILITY: LIFECYCLE_CONTEXT_PREDICATES is also the Workflow control plane's source of
 * REQUIRED guards (workflowValidation.ts), keyed by capability. workOrder.transition still appears in published
 * workflow definitions on actions that are not the technician's, and a capability-wide requirement would change
 * what Administration may publish -- a different decision from narrowing these four runtime edges.
 */
exports.EDGE_CONTEXT_PREDICATES = Object.freeze({
    accept: OWN_ASSIGNMENT,
    startTravel: OWN_ASSIGNMENT,
    arrive: OWN_ASSIGNMENT,
    startWork: OWN_ASSIGNMENT,
});
/** Every predicate one edge requires: its capability's, plus the edge's own. */
function edgeContextPredicates(edge) {
    const own = Object.prototype.hasOwnProperty.call(exports.EDGE_CONTEXT_PREDICATES, edge.action) ? exports.EDGE_CONTEXT_PREDICATES[edge.action] : [];
    const byCapability = lifecycleContextPredicates(edge.capability);
    const kinds = new Set(byCapability.map((p) => JSON.stringify(p)));
    return Object.freeze([...byCapability, ...own.filter((p) => !kinds.has(JSON.stringify(p)))]);
}
/** The context predicates one lifecycle capability declares. Unlisted means NONE, never "unknown". */
function lifecycleContextPredicates(capability) {
    return Object.prototype.hasOwnProperty.call(exports.LIFECYCLE_CONTEXT_PREDICATES, capability)
        ? exports.LIFECYCLE_CONTEXT_PREDICATES[capability]
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
async function authorizeLifecycleEdge(reader, actor, input) {
    const edge = transitionRuleFor(input.expectedStatus, input.toStatus);
    return (0, contextualAuthorization_1.authorizeObjectAction)(reader, {
        actor: {
            tenantId: actor.tenantId,
            principalId: actor.principalId,
            capabilities: actor.capabilities,
        },
        capabilityKey: edge.capability,
        predicates: edgeContextPredicates(edge),
        // The record is supplied for EVERY edge, so a predicate added later cannot silently degrade to
        // the evaluator's "no record supplied" refusal. Supplying it costs nothing when nothing reads it.
        record: { recordKind: "workOrder", recordId: input.workOrderId },
    });
}
/**
 * Perform one governed lifecycle transition that is ONLY a status change: markReady, the technician runtime
 * edges (accept / startTravel / arrive / startWork), close and cancel. Command edges are refused here and
 * performed by workOrderScheduling.ts.
 */
async function transitionWorkOrder(deps, actor, input) {
    const ruleForEdge = await authorizeEdgeOrRefuse(deps, actor, input);
    // A COMMAND EDGE IS NOT A STATUS FLIP. Schedule needs a window and an assignee, Unschedule a reason, Dispatch
    // an eligible and un-double-booked assignee, Complete the DQ-015 Sales Order prerequisite. Performing any of
    // them here would skip exactly the fact that makes the status true, so the bare transition refuses them --
    // AFTER authorization, so an unauthorized caller learns nothing about which commands exist.
    if (ruleForEdge.command !== "transition") {
        refuse("TRANSITION_REQUIRES_COMMAND", "PRECONDITION_FAILED", `${input.expectedStatus} -> ${input.toStatus} is performed by the governed ${ruleForEdge.command} command, `
            + "which records the facts this status asserts; it is not a bare status change");
    }
    const now = (deps.now ?? (() => new Date()))();
    const client = await deps.pool.connect();
    try {
        await client.query("BEGIN");
        const result = await applyTransitionWithinTransaction(client, actor, input, now);
        await client.query("COMMIT");
        return result;
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        throw err;
    }
    finally {
        client.release();
    }
}
/**
 * Validate the request shape and authorize the edge -- capability first, then only the predicates that edge
 * declares -- or throw the governed refusal. Shared by the generic transition and every command edge, so there
 * is ONE authorization path for the lifecycle.
 */
async function authorizeEdgeOrRefuse(deps, actor, input) {
    if (!ID_SHAPE(actor?.tenantId) || !ID_SHAPE(actor?.principalId)) {
        refuse("ACTOR_INVALID", "INVALID_INPUT", "an actor is a Principal within a tenant");
    }
    if (!ID_SHAPE(input?.workOrderId))
        refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
    for (const status of [input.expectedStatus, input.toStatus]) {
        if (!exports.WORK_ORDER_STATUSES.includes(status)) {
            refuse("STATUS_UNKNOWN", "INVALID_INPUT", `${String(status)} is not a governed Work Order status`);
        }
    }
    if (input.note !== undefined && input.note !== null
        && (typeof input.note !== "string" || input.note.trim() === "" || input.note.length > exports.MAX_TRANSITION_NOTE)) {
        refuse("NOTE_INVALID", "INVALID_INPUT", `a note is a non-empty string of at most ${exports.MAX_TRANSITION_NOTE} characters`);
    }
    const ruleForEdge = transitionRuleFor(input.expectedStatus, input.toStatus);
    if (ruleForEdge.disposition === "REFUSED") {
        refuse("TRANSITION_NOT_ALLOWED", "PRECONDITION_FAILED", `${input.expectedStatus} -> ${input.toStatus} is not a transition this business performs`);
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
    const decision = await authorizeLifecycleEdge(deps.contextualReader ?? (0, contextualAuthorization_1.postgresContextualReader)(deps.pool), actor, { workOrderId: input.workOrderId, expectedStatus: input.expectedStatus, toStatus: input.toStatus });
    if (!decision.allowed) {
        refuse(decision.reason, "FORBIDDEN", decision.reason === "CAPABILITY_MISSING"
            ? `this transition requires ${ruleForEdge.capability}`
            : `${ruleForEdge.action} requires ${decision.predicate ?? "a governed record relation"}`
                + " on this Work Order, and this caller does not hold it");
    }
    if (ruleForEdge.disposition === "NOT_YET_IMPLEMENTED") {
        refuse("TRANSITION_AUTHORITY_UNAVAILABLE", "UNAVAILABLE", `${input.expectedStatus} -> ${input.toStatus} depends on ${ruleForEdge.dependsOn}. It is refused rather `
            + "than performed, because the status alone would misreport what happened.");
    }
    return ruleForEdge;
}
exports.MAX_TRANSITION_NOTE = 2000;
/**
 * THE ONE STATUS WRITER. Lock the row, prove the expected state, write the status (with its timestamp and,
 * for a scheduling command, the placement) and append the transition -- inside a transaction the CALLER owns,
 * so a command edge commits its own facts (assignment, schedule history) in the same unit.
 *
 * THE EXPECTED CURRENT STATE IS REQUIRED. A caller states what it believes the Work Order is, and a
 * mismatch is a CONFLICT rather than a silent overwrite -- two dispatchers acting on the same stale
 * screen must not both succeed. The row is taken FOR UPDATE, so the check and the write cannot be
 * separated by another transaction.
 *
 * PROVENANCE DOES NOT GATE AUTHORITY. A migrated Work Order uses this command exactly as a native one
 * does; there is no second runtime for legacy records. The TRANSITION it writes is NATIVE, because this
 * transition really is happening now, whatever the record's own origin was.
 *
 * It does NOT authorize: every caller has already passed `authorizeEdgeOrRefuse` for this exact edge.
 */
async function applyTransitionWithinTransaction(client, actor, input, now) {
    const ruleForEdge = transitionRuleFor(input.expectedStatus, input.toStatus);
    if (ruleForEdge.disposition !== "ALLOWED") {
        refuse("TRANSITION_NOT_ALLOWED", "PRECONDITION_FAILED", `${input.expectedStatus} -> ${input.toStatus} is not a transition this business performs`);
    }
    const current = await client.query(`SELECT status::text AS status FROM ${SCHEMA}.work_orders
      WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, input.workOrderId]);
    if (current.rows.length === 0) {
        refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", `no work order ${input.workOrderId} in this tenant`);
    }
    if (await (0, workOrderQuarantine_1.isQuarantined)(client, actor.tenantId, input.workOrderId)) {
        refuse(workOrderQuarantine_1.WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", workOrderQuarantine_1.WORK_ORDER_QUARANTINED_MESSAGE);
    }
    const observed = String(current.rows[0].status);
    if (observed !== input.expectedStatus) {
        refuse("STALE_WORK_ORDER_STATE", "CONFLICT", `the work order is ${observed}, not ${input.expectedStatus}. Another transition won this race.`);
    }
    const stamp = exports.STATUS_TIMESTAMP_COLUMN[input.toStatus] ?? null;
    const values = [actor.tenantId, input.workOrderId, input.toStatus, now, actor.principalId];
    let placementSql = "";
    if (input.placement) {
        values.push(input.placement.start, input.placement.end);
        placementSql = ", scheduled_start = $6, scheduled_end = $7";
    }
    await client.query(`UPDATE ${SCHEMA}.work_orders
        SET status = $3::${SCHEMA}.ops_work_order_status, updated_at = $4, updated_by_principal_id = $5
            ${stamp ? `, ${stamp} = COALESCE(${stamp}, $4)` : ""}${placementSql}
      WHERE tenant_id = $1 AND id = $2`, values);
    const transitionId = `wot_${(0, node_crypto_1.randomUUID)()}`;
    await client.query(`INSERT INTO ${SCHEMA}.work_order_transitions
       (id, tenant_id, work_order_id, from_status, to_status, action, occurred_at, actor_principal_id, note, provenance)
     VALUES ($1,$2,$3,$4::${SCHEMA}.ops_work_order_status,$5::${SCHEMA}.ops_work_order_status,$6,$7,$8,$9,'NATIVE')`, [transitionId, actor.tenantId, input.workOrderId, observed, input.toStatus, ruleForEdge.action,
        // THE SERVER'S CLOCK. A client-authored transition time would let a caller state when something
        // happened, and "when" is half of what history is for.
        now, actor.principalId, input.note ?? null]);
    return Object.freeze({
        workOrderId: input.workOrderId, fromStatus: observed, toStatus: input.toStatus,
        action: ruleForEdge.action, transitionId, occurredAt: now.toISOString(),
        inventoryBoundary: ruleForEdge.inventoryBoundary,
    });
}
/** Read a Work Order's transition history, oldest first. Read-only. */
async function readTransitionHistory(db, tenantId, workOrderId) {
    const { rows } = await db.query(`SELECT from_status::text AS from_status, to_status::text AS to_status, action,
            actor_principal_id, occurred_at, provenance::text AS provenance
       FROM ${SCHEMA}.work_order_transitions
      WHERE tenant_id = $1 AND work_order_id = $2
      ORDER BY occurred_at, id`, [tenantId, workOrderId]);
    return Object.freeze(rows.map((r) => Object.freeze({
        fromStatus: r.from_status === null ? null : String(r.from_status),
        toStatus: String(r.to_status), action: String(r.action),
        actorPrincipalId: r.actor_principal_id === null ? null : String(r.actor_principal_id),
        occurredAt: new Date(r.occurred_at).toISOString(),
        provenance: String(r.provenance),
    })));
}
//# sourceMappingURL=workOrderLifecycle.js.map