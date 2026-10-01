// THE GOVERNED WORK ORDER EXECUTION FACTS: the technician's actual Parts used, and execution notes.
//
// Firebase: the execution-capture callable wrote `inventorySnapshot[].qtyUsed` as a DELTA per Part, clamped to
// [0, qtyPlanned], and appended `executionNote`, for the technician on their OWN assignment on a non-terminal
// Work Order, keyed by an idempotencyKey. Every one of those rules is kept. Two things are deliberately not:
//
//   * NO STOCK MOVES. Recording an actual is not consuming stock; the ruling makes stock movement an explicit
//     boundary. The actuals recorded here are what an activated Inventory authority would consume from.
//   * NOTHING IS OVERWRITTEN. Each request appends a record (migration 1764300000000); the current actual for a
//     Part is the SUM of its applied deltas, and a correction is a negative delta, never an edit.
//
// AUTHORITY: workOrder.execution.record (registered with no grants) + RECORD_ASSIGNMENT -- the capability first,
// then the relation, through the ONE contextual authorization path the lifecycle uses.
//
// TRUCK CONSUMPTION (Controller OD-T4, 2026-10-01). When the request states `consumeFrom: { type: "MOBILE", locationId }`,
// the usage IS consumption: every positive applied delta posts the existing WORK_ORDER_CONSUMPTION movement (-applied)
// from that truck location IN THE SAME TRANSACTION as the usage record -- both commit or neither does. Additionally required
// then: inventory.workOrderConsumption.record, SERVICE_TECHNICIAN eligibility and a current MOBILE scope over the truck
// (mobileStockAuthority.ts, revalidated here), an ACTIVE truck of the Work Order's operating company, a WORK_IN_PROGRESS
// Work Order, a certified baseline, a quantity-tracked Part, and enough stock at the truck under the shared stock location
// lock (never negative). A replay of the same key returns the original outcome and moves nothing. A correction (negative
// delta) never moves stock and may not take the recorded usage below what has already been consumed.
import type { Pool, PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { authorizeObjectAction, postgresContextualReader, type ContextualReader } from "./contextualAuthorization";
import { isQuarantined, WORK_ORDER_QUARANTINED, WORK_ORDER_QUARANTINED_MESSAGE } from "./workOrderQuarantine";
import { TERMINAL_STATUSES, WorkOrderLifecycleError, lifecycleContextPredicates, WORK_ORDER_LIFECYCLE_COMPLETE, type LifecycleActor } from "./workOrderLifecycle";
import { authorizeMobileAct, MobileStockRefusal } from "./mobileStockAuthority";
import { lockStockLocation } from "./stockLocationLock";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority";
import { INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE, isInventoryBaselineCertified } from "./inventoryBaselineGate";

const SCHEMA = "eos_ops";
export const WORK_ORDER_EXECUTION_RECORD = "workOrder.execution.record";
export const MAX_EXECUTION_NOTE = 2000;
export const MAX_USAGE_LINES = 100;
/** OD-T4: the capability that turns recorded usage into consumption from a truck. */
export const WORK_ORDER_CONSUMPTION_RECORD = "inventory.workOrderConsumption.record";
export const TRUCK_CONSUMPTION_SOURCE_KIND = "WORK_ORDER_TRUCK_CONSUMPTION";
export const CONSUMABLE_WORK_ORDER_STATUSES: readonly string[] = Object.freeze(["WORK_IN_PROGRESS"]);
export const truckConsumptionMovementKey = (workOrderId: string, idempotencyKey: string, partId: string): string =>
  `woConsume:${workOrderId}:${idempotencyKey}#part:${partId}`;

type Category = WorkOrderLifecycleError["category"];
const refuse = (code: string, category: Category, message: string): never => {
  throw new WorkOrderLifecycleError(code, category, message);
};
const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

export interface UsageLine { readonly partId: string; readonly qtyDelta: number }
export interface ExecutionRequest {
  readonly workOrderId: string;
  readonly idempotencyKey: string;
  readonly partUsage: readonly UsageLine[];
  readonly note: string | null;
  /** OD-T4: the truck the used Parts came out of; absent, nothing moves (NO_STOCK_MOVEMENT). */
  readonly consumeFrom: { readonly type: "MOBILE"; readonly locationId: string } | null;
}

export function validateExecutionRequest(input: unknown): ExecutionRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const d = input as Record<string, unknown>;
  const extra = Object.keys(d).filter((k) => !["workOrderId", "idempotencyKey", "partUsage", "note", "consumeFrom"].includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  if (!ID_SHAPE(d.workOrderId)) refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
  if (typeof d.idempotencyKey !== "string" || d.idempotencyKey.trim() === "" || d.idempotencyKey.length > 150) {
    refuse("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "an idempotencyKey of at most 150 characters is required");
  }
  const usage = d.partUsage === undefined ? [] : d.partUsage;
  if (!Array.isArray(usage) || usage.length > MAX_USAGE_LINES) {
    refuse("PART_USAGE_INVALID", "INVALID_INPUT", `partUsage is a list of at most ${MAX_USAGE_LINES} { partId, qtyDelta }`);
  }
  const seen = new Set<string>();
  const lines = (usage as unknown[]).map((raw) => {
    const l = raw as Record<string, unknown>;
    if (!l || typeof l !== "object" || !ID_SHAPE(l.partId) || !Number.isSafeInteger(l.qtyDelta) || l.qtyDelta === 0
      || Object.keys(l).some((k) => k !== "partId" && k !== "qtyDelta")) {
      refuse("PART_USAGE_INVALID", "INVALID_INPUT", "each usage line is { partId, qtyDelta } with a non-zero integer delta");
    }
    if (seen.has(l.partId as string)) refuse("PART_USAGE_DUPLICATED", "INVALID_INPUT", `partId ${String(l.partId)} appears twice`);
    seen.add(l.partId as string);
    return Object.freeze({ partId: l.partId as string, qtyDelta: l.qtyDelta as number });
  });
  let note: string | null = null;
  if (d.note !== undefined && d.note !== null) {
    if (typeof d.note !== "string" || d.note.trim() === "" || d.note.length > MAX_EXECUTION_NOTE) {
      refuse("NOTE_INVALID", "INVALID_INPUT", `a note is a non-empty string of at most ${MAX_EXECUTION_NOTE} characters`);
    }
    note = (d.note as string).trim();
  }
  if (lines.length === 0 && note === null) refuse("EXECUTION_EMPTY", "INVALID_INPUT", "record at least one usage line or a note");
  let consumeFrom: ExecutionRequest["consumeFrom"] = null;
  if (d.consumeFrom !== undefined && d.consumeFrom !== null) {
    const c = d.consumeFrom as Record<string, unknown>;
    if (!c || typeof c !== "object" || Array.isArray(c) || Object.keys(c).some((k) => k !== "type" && k !== "locationId") || !ID_SHAPE(c.locationId)) {
      refuse("CONSUME_FROM_INVALID", "INVALID_INPUT", "consumeFrom is { type: \"MOBILE\", locationId }");
    }
    // OD-T4 / OD-T3: consumption is from the Technician's truck. Warehouse issue is not a Technician act.
    if (c.type !== "MOBILE") refuse("CONSUME_FROM_NOT_MOBILE", "INVALID_INPUT", "Work Order consumption is recorded from a truck (MOBILE) location");
    if (lines.length === 0) refuse("CONSUME_FROM_WITHOUT_USAGE", "INVALID_INPUT", "consumeFrom needs at least one usage line");
    consumeFrom = Object.freeze({ type: "MOBILE" as const, locationId: c.locationId as string });
  }
  return Object.freeze({
    workOrderId: d.workOrderId as string, idempotencyKey: (d.idempotencyKey as string).trim(),
    partUsage: Object.freeze(lines.sort((a, b) => a.partId.localeCompare(b.partId))), note, consumeFrom,
  });
}

// The fingerprint of a request WITHOUT consumeFrom is unchanged, so every record written before OD-T4 still replays.
const fingerprintOf = (r: ExecutionRequest): string =>
  createHash("sha256").update(JSON.stringify(r.consumeFrom === null ? { w: r.workOrderId, u: r.partUsage, n: r.note }
    : { w: r.workOrderId, u: r.partUsage, n: r.note, c: r.consumeFrom })).digest("hex");

export interface AppliedUsage {
  readonly partId: string;
  readonly requestedDelta: number;
  readonly appliedDelta: number;
  readonly qtyUsed: number;
  readonly qtyPlanned: number;
  /** OD-T4: the ledger row this line posted at the truck, when it consumed. */
  readonly movementId?: string;
}
export interface ExecutionResult {
  readonly outcome: "RECORDED" | "REPLAYED";
  readonly workOrderId: string;
  readonly usage: readonly AppliedUsage[];
  readonly noteRecorded: boolean;
  /** Stated on every result: NO_STOCK_MOVEMENT, or TRUCK_CONSUMPTION when consumeFrom moved stock out of a truck. */
  readonly inventoryBoundary: "NO_STOCK_MOVEMENT" | "TRUCK_CONSUMPTION";
  readonly consumedFrom?: { readonly type: "MOBILE"; readonly locationId: string };
}

/** Record actuals and/or a note on the caller's OWN, non-terminal Work Order. Idempotent by key. */
export async function recordWorkOrderExecution(
  deps: { readonly pool: Pool; readonly now?: () => Date; readonly contextualReader?: ContextualReader },
  actor: LifecycleActor,
  input: unknown,
): Promise<ExecutionResult> {
  if (!ID_SHAPE(actor?.tenantId) || !ID_SHAPE(actor?.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_INVALID", "INVALID_INPUT", "an actor is a Principal within a tenant");
  }
  const workOrderId = (input as { workOrderId?: unknown } | null)?.workOrderId;
  if (!ID_SHAPE(workOrderId)) refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
  // CAPABILITY, THEN OWN ASSIGNMENT -- before the request body is interpreted any further.
  const decision = await authorizeObjectAction(deps.contextualReader ?? postgresContextualReader(deps.pool), {
    actor: { tenantId: actor.tenantId, principalId: actor.principalId, capabilities: actor.capabilities },
    capabilityKey: WORK_ORDER_EXECUTION_RECORD,
    // The SAME own-assignment predicate the technician's Complete requires.
    predicates: lifecycleContextPredicates(WORK_ORDER_LIFECYCLE_COMPLETE),
    record: { recordKind: "workOrder", recordId: workOrderId as string },
  });
  if (!decision.allowed) {
    refuse(decision.reason, "FORBIDDEN", decision.reason === "CAPABILITY_MISSING"
      ? `recording execution requires ${WORK_ORDER_EXECUTION_RECORD}`
      : "only the assigned Employee records this Work Order's execution");
  }
  const request = validateExecutionRequest(input);
  if (request.consumeFrom !== null && !actor.capabilities.has(WORK_ORDER_CONSUMPTION_RECORD)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `consuming from a truck requires ${WORK_ORDER_CONSUMPTION_RECORD}`);
  }
  const boundary = request.consumeFrom === null ? ("NO_STOCK_MOVEMENT" as const) : ("TRUCK_CONSUMPTION" as const);
  const consumedFrom = request.consumeFrom === null ? {} : { consumedFrom: request.consumeFrom };
  const fingerprint = fingerprintOf(request);
  const now = (deps.now ?? (() => new Date()))();
  const keys = [
    ...request.partUsage.map((l) => `${request.idempotencyKey}#part:${l.partId}`),
    ...(request.note !== null ? [`${request.idempotencyKey}#note`] : []),
  ];

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    const wo = await client.query(
      `SELECT status::text AS status FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [actor.tenantId, request.workOrderId]);
    if (wo.rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
    if (await isQuarantined(client, actor.tenantId, request.workOrderId)) refuse(WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", WORK_ORDER_QUARANTINED_MESSAGE);

    const prior = await client.query(
      `SELECT idempotency_key, request_fingerprint FROM ${SCHEMA}.work_order_execution_records
        WHERE tenant_id = $1 AND work_order_id = $2 AND (idempotency_key = ANY($3::text[]) OR idempotency_key LIKE $4)`,
      [actor.tenantId, request.workOrderId, keys, `${request.idempotencyKey.replace(/[\\%_]/g, "\\$&")}#%`]);
    if (prior.rows.length > 0) {
      const same = prior.rows.length === keys.length && prior.rows.every((r) => r.request_fingerprint === fingerprint);
      if (!same) refuse("IDEMPOTENCY_KEY_REUSED", "CONFLICT", "this idempotencyKey already recorded a different request");
      await client.query("COMMIT");
      return Object.freeze({
        outcome: "REPLAYED" as const, workOrderId: request.workOrderId,
        usage: await currentUsage(client, actor.tenantId, request.workOrderId, request.partUsage.map((l) => l.partId)),
        noteRecorded: request.note !== null, inventoryBoundary: boundary, ...consumedFrom,
      });
    }
    if ((TERMINAL_STATUSES as readonly string[]).includes(wo.rows[0].status)) {
      refuse("WORK_ORDER_TERMINAL", "PRECONDITION_FAILED", `a ${wo.rows[0].status} Work Order's execution is closed`);
    }
    const consume = request.consumeFrom === null ? null
      : await authorizeTruckConsumption(client, actor, request.workOrderId, wo.rows[0], request.consumeFrom.locationId, request.partUsage);

    const applied: AppliedUsage[] = [];
    for (const line of request.partUsage) {
      // The PLAN row, locked: usage is recorded only against a Part the Work Order planned, and the clamp is
      // computed against the same snapshot the append commits into.
      const plan = await client.query(
        `SELECT qty_planned FROM ${SCHEMA}.work_order_parts_plan
          WHERE tenant_id = $1 AND work_order_id = $2 AND part_id = $3 FOR UPDATE`,
        [actor.tenantId, request.workOrderId, line.partId]);
      if (plan.rows.length === 0) {
        refuse("PART_NOT_PLANNED", "PRECONDITION_FAILED", `Part ${line.partId} is not on this Work Order's parts plan`);
      }
      const planned = Number(plan.rows[0].qty_planned);
      const used = Number((await client.query(
        `SELECT COALESCE(SUM(applied_delta), 0)::int AS used FROM ${SCHEMA}.work_order_execution_records
          WHERE tenant_id = $1 AND work_order_id = $2 AND kind = 'PART_USAGE' AND part_id = $3`,
        [actor.tenantId, request.workOrderId, line.partId])).rows[0].used);
      const next = Math.min(planned, Math.max(0, used + line.qtyDelta));
      const appliedDelta = next - used;
      // Usage may never fall below what has already been physically consumed for this Part on this Work Order.
      if (appliedDelta < 0) {
        const consumed = await consumedQuantity(client, actor.tenantId, request.workOrderId, line.partId);
        if (next < consumed) {
          refuse("USAGE_BELOW_CONSUMED", "PRECONDITION_FAILED",
            `Part ${line.partId}: ${consumed} were already consumed from a truck; recorded usage cannot go below that`);
        }
      }
      let movementId: string | undefined;
      if (consume && appliedDelta > 0) {
        movementId = await postTruckConsumption(client, actor, request, consume, line.partId, appliedDelta);
      }
      await client.query(
        `INSERT INTO ${SCHEMA}.work_order_execution_records
           (id, tenant_id, work_order_id, kind, part_id, requested_delta, applied_delta, note, idempotency_key,
            request_fingerprint, recorded_by_principal_id, recorded_at)
         VALUES ($1,$2,$3,'PART_USAGE',$4,$5,$6,NULL,$7,$8,$9,$10)`,
        [`woe_${randomUUID()}`, actor.tenantId, request.workOrderId, line.partId, line.qtyDelta, appliedDelta,
         `${request.idempotencyKey}#part:${line.partId}`, fingerprint, actor.principalId, now]);
      applied.push(Object.freeze({ partId: line.partId, requestedDelta: line.qtyDelta, appliedDelta, qtyUsed: next, qtyPlanned: planned,
        ...(movementId ? { movementId } : {}) }));
    }
    if (request.note !== null) {
      await client.query(
        `INSERT INTO ${SCHEMA}.work_order_execution_records
           (id, tenant_id, work_order_id, kind, part_id, requested_delta, applied_delta, note, idempotency_key,
            request_fingerprint, recorded_by_principal_id, recorded_at)
         VALUES ($1,$2,$3,'NOTE',NULL,NULL,NULL,$4,$5,$6,$7,$8)`,
        [`woe_${randomUUID()}`, actor.tenantId, request.workOrderId, request.note, `${request.idempotencyKey}#note`,
         fingerprint, actor.principalId, now]);
    }
    await client.query("COMMIT");
    return Object.freeze({
      outcome: "RECORDED" as const, workOrderId: request.workOrderId, usage: Object.freeze(applied),
      noteRecorded: request.note !== null, inventoryBoundary: boundary, ...consumedFrom,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((err as { code?: string })?.code === "23505") {
      refuse("EXECUTION_CONCURRENT_CHANGE", "CONFLICT", "the same request was recorded concurrently; retry to read its outcome");
    }
    throw err;
  } finally {
    client.release();
  }
}

interface TruckConsumption {
  readonly locationId: string;
  readonly operatingCompanyKey: string;
}

/**
 * OD-T4 preconditions, inside the transaction that holds the Work Order row: the truck path (eligibility + current MOBILE
 * scope + usable truck + the Employee's company), the truck is the Work Order's company, the Work Order is in progress,
 * the baseline is certified and every consumed Part is quantity-tracked in the catalog.
 */
async function authorizeTruckConsumption(client: PoolClient, actor: LifecycleActor, workOrderId: string,
  wo: { readonly status: string }, locationId: string, usage: readonly UsageLine[]): Promise<TruckConsumption> {
  if (!CONSUMABLE_WORK_ORDER_STATUSES.includes(wo.status)) {
    refuse("WORK_ORDER_STATE_INVALID", "PRECONDITION_FAILED", `parts are consumed while the job is in progress; this Work Order is ${wo.status}`);
  }
  let mobile;
  try {
    mobile = await authorizeMobileAct(client, actor, WORK_ORDER_CONSUMPTION_RECORD, locationId, { lock: true });
  } catch (err) {
    if (err instanceof MobileStockRefusal) refuse(err.code, err.category === "NOT_FOUND" ? "PRECONDITION_FAILED" : err.category, err.message);
    throw err;
  }
  if (!mobile.allowed) return refuse(mobile.decision.reason, "FORBIDDEN", "that truck is outside your current MOBILE scope");
  const { rows } = await client.query(`SELECT operating_company_key FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, workOrderId]);
  if (String(rows[0]?.operating_company_key) !== mobile.location.operatingCompanyKey) {
    refuse("OPERATING_COMPANY_MISMATCH", "PRECONDITION_FAILED", "the truck belongs to another operating company than the Work Order's");
  }
  if (!(await isInventoryBaselineCertified(client, actor.tenantId))) refuse("NOT_ACTIVATED", "UNAVAILABLE", INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE);
  const consumed = usage.filter((l) => l.qtyDelta > 0).map((l) => l.partId);
  const policies = await createPostgresPartPolicyAuthority().readPartPolicies(client, actor.tenantId, consumed);
  for (const p of policies) {
    if (!p.found) refuse("PART_NOT_FOUND", "PRECONDITION_FAILED", `Part ${p.partId} is not in the catalog`);
    if (p.trackingMode !== "NONE") {
      refuse("SERIALIZED_CONSUMPTION_NOT_SUPPORTED", "PRECONDITION_FAILED",
        `Part ${p.partId} is serialized; a serialized whole unit leaves a truck through Equipment installation`);
    }
  }
  return Object.freeze({ locationId, operatingCompanyKey: mobile.location.operatingCompanyKey });
}

/** One WORK_ORDER_CONSUMPTION row at the truck, under the shared stock location lock, never driving the balance negative. */
async function postTruckConsumption(client: PoolClient, actor: LifecycleActor, request: ExecutionRequest, consume: TruckConsumption,
  partId: string, quantity: number): Promise<string> {
  await lockStockLocation(client, actor.tenantId, partId, "MOBILE", consume.locationId);
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(quantity_delta), 0)::bigint AS total FROM ${SCHEMA}.inventory_movements
      WHERE tenant_id = $1 AND part_id = $2 AND tracking_mode = 'NONE' AND location_type = 'MOBILE' AND location_id = $3`,
    [actor.tenantId, partId, consume.locationId]);
  const onHand = Number(rows[0]?.total ?? 0);
  if (onHand < quantity) {
    refuse("INSUFFICIENT_TRUCK_STOCK", "PRECONDITION_FAILED", `the truck holds ${onHand} of Part ${partId}; ${quantity} cannot be consumed`);
  }
  const movementId = `mov_${randomUUID()}`;
  await client.query(
    `INSERT INTO ${SCHEMA}.inventory_movements
       (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
        movement_type, quantity_delta, source_kind, source_id, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, 'NONE', 'MOBILE', $5, 'WORK_ORDER_CONSUMPTION', $6, $7, $8, $9, $10)`,
    [movementId, actor.tenantId, consume.operatingCompanyKey, partId, consume.locationId, -quantity, TRUCK_CONSUMPTION_SOURCE_KIND,
      request.workOrderId, truckConsumptionMovementKey(request.workOrderId, request.idempotencyKey, partId), actor.principalId]);
  return movementId;
}

/** What has physically left a truck for this Part on this Work Order (positive). */
async function consumedQuantity(db: Pick<PoolClient, "query">, tenantId: string, workOrderId: string, partId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(-SUM(quantity_delta), 0)::int AS consumed FROM ${SCHEMA}.inventory_movements
      WHERE tenant_id = $1 AND source_kind = $2 AND source_id = $3 AND part_id = $4 AND movement_type = 'WORK_ORDER_CONSUMPTION'`,
    [tenantId, TRUCK_CONSUMPTION_SOURCE_KIND, workOrderId, partId]);
  return Number(rows[0]?.consumed ?? 0);
}

async function currentUsage(
  db: Pick<PoolClient, "query">, tenantId: string, workOrderId: string, partIds: readonly string[] | null,
): Promise<readonly AppliedUsage[]> {
  const { rows } = await db.query(
    `SELECT p.part_id, p.qty_planned,
            COALESCE((SELECT SUM(r.applied_delta) FROM ${SCHEMA}.work_order_execution_records r
                       WHERE r.tenant_id = p.tenant_id AND r.work_order_id = p.work_order_id
                         AND r.kind = 'PART_USAGE' AND r.part_id = p.part_id), 0)::int AS used
       FROM ${SCHEMA}.work_order_parts_plan p
      WHERE p.tenant_id = $1 AND p.work_order_id = $2 AND ($3::text[] IS NULL OR p.part_id = ANY($3::text[]))
      ORDER BY p.part_id`,
    [tenantId, workOrderId, partIds]);
  return Object.freeze(rows.map((r) => Object.freeze({
    partId: String(r.part_id), requestedDelta: 0, appliedDelta: 0, qtyUsed: Number(r.used), qtyPlanned: Number(r.qty_planned),
  })));
}

export interface ExecutionView {
  readonly parts: readonly { readonly partId: string; readonly qtyPlanned: number; readonly qtyUsed: number }[];
  readonly notes: readonly { readonly note: string; readonly recordedByPrincipalId: string; readonly recordedAt: string }[];
}

/** Planned vs actual per Part, and the notes oldest first. A read; the caller has already authorized it. */
export async function readWorkOrderExecution(db: Pick<PoolClient, "query">, tenantId: string, workOrderId: string): Promise<ExecutionView> {
  const usage = await currentUsage(db, tenantId, workOrderId, null);
  const notes = await db.query(
    `SELECT note, recorded_by_principal_id, recorded_at FROM ${SCHEMA}.work_order_execution_records
      WHERE tenant_id = $1 AND work_order_id = $2 AND kind = 'NOTE' ORDER BY recorded_at, id`,
    [tenantId, workOrderId]);
  return Object.freeze({
    parts: Object.freeze(usage.map((u) => Object.freeze({ partId: u.partId, qtyPlanned: u.qtyPlanned, qtyUsed: u.qtyUsed }))),
    notes: Object.freeze(notes.rows.map((r) => Object.freeze({
      note: String(r.note), recordedByPrincipalId: String(r.recorded_by_principal_id),
      recordedAt: new Date(r.recorded_at as string).toISOString(),
    }))),
  });
}
