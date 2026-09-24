// THE GOVERNED WORK ORDER PARTS PLAN -- "plan these parts for this Work Order", in PostgreSQL.
//
// The Firestore original (workOrderPartsPlan/setWorkOrderPartsPlan.ts) states the invariant this preserves:
// PLAN PARTS != RESERVE PARTS != USE PARTS. This command writes planned requirements and nothing else. It
// never reserves, consumes, moves, procures, or touches actual usage.
//
// ════════════════════ WHAT MOVED, AND WHAT DELIBERATELY DID NOT ════════════════════
//
// PRESERVED, because each is a business rule a user depends on:
//
//   TERMINAL_WORK_ORDER   a COMPLETED / CLOSED / CANCELLED Work Order's plan cannot be rewritten. There is
//                         no effect left to reconcile a changed plan against, so accepting one would
//                         misrepresent a finished job. Same three statuses as transitionEngine's
//                         TERMINAL_STATUSES -- read from the Work Order's own status column, never a
//                         locally re-derived list.
//   PART_NOT_FOUND        a plan line whose Part does not resolve fails the WHOLE plan, closed. The
//                         original refuses to fabricate identity and so does this.
//   USED_PART_REMOVAL     a currently-planned Part with recorded usage cannot be un-planned. Usage is read
//                         from the COMMITMENT LEDGER (`inventory_commitments` CONSUMED rows), never from a
//                         column here -- see the migration on why there is no qty_used to read.
//   SET SEMANTICS         the caller states the whole plan; requirements absent from it are removed. That
//                         is the business action ("plan these parts"), and a partial-merge API would be the
//                         "generic persistence API" the original explicitly refuses to be.
//
// NOT CARRIED, because they are artefacts of the array rather than rules:
//
//   SKU_UNRESOLVED / SKU_CONFLICT / IDENTITY_AMBIGUOUS. All three exist because `inventorySnapshot[]` is a
//   JSON array with no key, so a row could be identified by `partId` OR by a legacy `sku`, two rows could
//   match one plan line, and a row's stored sku could disagree with Part Master. Here the primary key is
//   (tenant_id, work_order_id, part_id): there is one row per Part, identified one way, and no sku is
//   stored to disagree with anything. These are not rules that were dropped -- they are failures that
//   became unrepresentable. The original's own header calls sku "a compatibility/display identifier".
//
// ════════════════════ THE CATALOG DECIDES WHAT A PART IS ════════════════════
//
// Part existence comes from the PostgreSQL Part policy authority, composed as a repository in this same
// Render runtime and run on THIS command's client, so the answer belongs to the same transaction as the
// write. No HTTP call to another Render handler; no Firestore read.
//
// TRACKING MODE IS NOT CHECKED HERE, and that is deliberate rather than an omission. Planning a serialized
// part is a legitimate business act -- you plan to fit a compressor before you know which compressor. The
// tracking-mode refusal belongs where a QUANTITY PROMISE is made, which is reconcileConsumption, and it is
// enforced there. Refusing here would make it impossible to plan the very parts an INSTALL work order
// exists to fit.
import type { Pool, PoolClient } from "pg";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority.js";

const SCHEMA = "eos_ops";

/** Already in the Role catalog; this command does not invent a capability. */
export const WORK_ORDER_PARTS_PLAN = "workOrder.parts.plan";

/**
 * A finished Work Order's plan is closed. The SAME three statuses as transitionEngine.TERMINAL_STATUSES.
 * Restated here because this module may not import the Firestore engine -- and asserted equal to it by
 * workOrderPartsPlanAuthority.test.mjs, so the two cannot drift.
 */
export const TERMINAL_WORK_ORDER_STATUSES = Object.freeze(["COMPLETED", "CLOSED", "CANCELLED"] as const);

export type PartsPlanCategory =
  | "INVALID_INPUT" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "FORBIDDEN";

export class WorkOrderPartsPlanError extends Error {
  constructor(readonly code: string, readonly category: PartsPlanCategory, message: string) {
    super(message);
    this.name = "WorkOrderPartsPlanError";
  }
}
const refuse = (code: string, category: PartsPlanCategory, message: string): never => {
  throw new WorkOrderPartsPlanError(code, category, message);
};

export interface PartsPlanActor {
  readonly tenantId: string;
  /** The EOS Principal id. The ACTOR -- never the assigned technician. */
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export interface PartsPlanLine {
  readonly partId: string;
  readonly qtyPlanned: number;
  /**
   * The version the caller read for this requirement, when changing an existing one. Omitted for a new
   * requirement. A stated version that does not match the stored one is a CONFLICT, never an overwrite.
   */
  readonly expectedVersion?: number;
}

export interface PlannedRequirement {
  readonly partId: string;
  readonly qtyPlanned: number;
  readonly version: number;
  readonly plannedAt: string;
  readonly plannedBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface SetPartsPlanResult {
  readonly workOrderId: string;
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: readonly string[];
  readonly plan: readonly PlannedRequirement[];
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");
const POSITIVE_INT = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

/** Validate the stated plan. Never a partial plan: one bad line refuses all of them. */
export function validatePartsPlanLines(lines: unknown): readonly PartsPlanLine[] {
  if (!Array.isArray(lines)) refuse("PLAN_INVALID", "INVALID_INPUT", "plan must be a list");
  const seen = new Set<string>();
  return Object.freeze((lines as unknown[]).map((raw, i) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      refuse("PLAN_LINE_INVALID", "INVALID_INPUT", `plan line ${i} must be an object`);
    }
    const line = raw as Record<string, unknown>;
    const extra = Object.keys(line).filter((k) => !["partId", "qtyPlanned", "expectedVersion"].includes(k));
    if (extra.length > 0) {
      refuse("PLAN_LINE_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `plan line ${i} does not accept: ${extra.sort().join(", ")}`);
    }
    if (!ID_SHAPE(line.partId)) refuse("PART_ID_INVALID", "INVALID_INPUT", `plan line ${i} requires a partId`);
    const partId = line.partId as string;
    // A duplicate would make the plan ambiguous about its own quantity. The table's primary key would
    // refuse it too, but as a constraint violation rather than as a statement about the request.
    if (seen.has(partId)) refuse("PART_DUPLICATED", "INVALID_INPUT", `part ${partId} appears twice in one plan`);
    seen.add(partId);
    if (!POSITIVE_INT(line.qtyPlanned)) {
      refuse("QUANTITY_INVALID", "INVALID_INPUT", `plan line ${i} requires a positive integer qtyPlanned`);
    }
    if (line.expectedVersion !== undefined && !POSITIVE_INT(line.expectedVersion)) {
      refuse("VERSION_INVALID", "INVALID_INPUT", `plan line ${i} has an invalid expectedVersion`);
    }
    return Object.freeze({
      partId,
      qtyPlanned: line.qtyPlanned as number,
      ...(line.expectedVersion === undefined ? {} : { expectedVersion: line.expectedVersion as number }),
    });
  }));
}

const row = (r: Record<string, unknown>): PlannedRequirement => Object.freeze({
  partId: String(r.part_id),
  qtyPlanned: Number(r.qty_planned),
  version: Number(r.version),
  plannedAt: new Date(r.planned_at as string).toISOString(),
  plannedBy: String(r.planned_by),
  updatedAt: new Date(r.updated_at as string).toISOString(),
  updatedBy: String(r.updated_by),
});

/** The Work Order's current plan. A read, in Part order, with no side effect. */
export async function readPartsPlan(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  workOrderId: string,
): Promise<readonly PlannedRequirement[]> {
  if (!ID_SHAPE(tenantId) || !ID_SHAPE(workOrderId)) {
    refuse("INPUT_INVALID", "INVALID_INPUT", "a plan is only readable for a stated Work Order within a tenant");
  }
  const { rows } = await db.query(
    `SELECT part_id, qty_planned, version, planned_at, planned_by, updated_at, updated_by
       FROM ${SCHEMA}.work_order_parts_plan
      WHERE tenant_id = $1 AND work_order_id = $2
      ORDER BY part_id`,
    [tenantId, workOrderId],
  );
  return Object.freeze(rows.map(row));
}

/**
 * Set the whole parts plan for one Work Order.
 *
 * ONE TRANSACTION. A plan that added two requirements and failed to remove a third is not the plan anyone
 * stated, and the removal rule (usage) can only be evaluated against the same snapshot as the write.
 */
export async function setPartsPlan(
  deps: { readonly pool: Pool; readonly now?: () => Date },
  actor: PartsPlanActor,
  input: { readonly workOrderId: string; readonly plan: unknown },
): Promise<SetPartsPlanResult> {
  if (!ID_SHAPE(actor?.tenantId) || !ID_SHAPE(actor?.principalId)) {
    refuse("ACTOR_INVALID", "INVALID_INPUT", "an actor is a Principal within a tenant");
  }
  if (!(actor.capabilities instanceof Set) || !actor.capabilities.has(WORK_ORDER_PARTS_PLAN)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `planning parts requires ${WORK_ORDER_PARTS_PLAN}`);
  }
  if (!ID_SHAPE(input?.workOrderId)) refuse("WORK_ORDER_ID_INVALID", "INVALID_INPUT", "a workOrderId is required");
  const lines = validatePartsPlanLines(input.plan);
  const { tenantId, principalId } = actor;
  const workOrderId = input.workOrderId;
  const now = (deps.now ?? (() => new Date()))();

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");

    // FOR UPDATE on the Work Order: a concurrent transition to COMPLETED waits here rather than racing the
    // terminal check, which is the only thing that makes that refusal mean anything.
    const wo = await client.query(
      `SELECT status::text AS status FROM ${SCHEMA}.work_orders
        WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, workOrderId],
    );
    if (wo.rows.length === 0) {
      refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", `no work order ${workOrderId} in this tenant`);
    }
    const status = String(wo.rows[0].status);
    if ((TERMINAL_WORK_ORDER_STATUSES as readonly string[]).includes(status)) {
      refuse("TERMINAL_WORK_ORDER", "PRECONDITION_FAILED",
        `cannot change the parts plan on a terminal Work Order (status ${status})`);
    }

    // EXISTENCE FIRST, AND FOR EVERY LINE AT ONCE -- a plan whose fourth line names an unknown Part must
    // not have written the first three.
    if (lines.length > 0) {
      const policies = await createPostgresPartPolicyAuthority()
        .readPartPolicies(client, tenantId, lines.map((l) => l.partId));
      for (const policy of policies) {
        if (!policy.found) {
          refuse("PART_NOT_FOUND", "NOT_FOUND",
            `part ${policy.partId} is not a Part of this tenant's catalog; a plan cannot require what does not exist`);
        }
      }
    }

    const existing = new Map(
      (await readPartsPlan(client, tenantId, workOrderId)).map((r) => [r.partId, r]),
    );
    const stated = new Map(lines.map((l) => [l.partId, l]));
    const removals = [...existing.keys()].filter((partId) => !stated.has(partId)).sort();

    // USAGE IS READ FROM THE COMMITMENT LEDGER, not from this table. A requirement someone has already
    // used parts against is evidence of what happened on site; un-planning it would leave consumption
    // pointing at a requirement that no longer exists.
    if (removals.length > 0) {
      const used = await client.query(
        `SELECT part_id, SUM(quantity)::bigint AS consumed
           FROM ${SCHEMA}.inventory_commitments
          WHERE tenant_id = $1 AND work_order_id = $2 AND event_type = 'CONSUMED' AND part_id = ANY($3::text[])
          GROUP BY part_id
         HAVING SUM(quantity) > 0`,
        [tenantId, workOrderId, removals],
      );
      if (used.rows.length > 0) {
        const names = used.rows.map((r) => String(r.part_id)).sort().join(", ");
        refuse("USED_PART_REMOVAL", "PRECONDITION_FAILED",
          `cannot un-plan a part with recorded usage: ${names}`);
      }
      await client.query(
        `DELETE FROM ${SCHEMA}.work_order_parts_plan
          WHERE tenant_id = $1 AND work_order_id = $2 AND part_id = ANY($3::text[])`,
        [tenantId, workOrderId, removals],
      );
    }

    const added: string[] = [], changed: string[] = [], unchanged: string[] = [];
    for (const line of [...stated.values()].sort((a, b) => a.partId.localeCompare(b.partId))) {
      const current = existing.get(line.partId);
      if (current && line.expectedVersion !== undefined && line.expectedVersion !== current.version) {
        refuse("VERSION_CONFLICT", "CONFLICT",
          `part ${line.partId} was planned at version ${current.version}, not ${line.expectedVersion}`);
      }
      if (!current) {
        await client.query(
          `INSERT INTO ${SCHEMA}.work_order_parts_plan
             (tenant_id, work_order_id, part_id, qty_planned, planned_at, planned_by, updated_at, updated_by, version)
           VALUES ($1, $2, $3, $4, $5, $6, $5, $6, 1)`,
          [tenantId, workOrderId, line.partId, line.qtyPlanned, now, principalId],
        );
        added.push(line.partId);
        continue;
      }
      // A RESTATED, IDENTICAL REQUIREMENT WRITES NOTHING. Bumping the version and the timestamp for a
      // quantity that did not change would manufacture an edit history of edits nobody made -- the same
      // reason assignWorkOrderToEmployee answers NO_CHANGE for a reassignment to the same Employee.
      if (current.qtyPlanned === line.qtyPlanned) {
        unchanged.push(line.partId);
        continue;
      }
      await client.query(
        `UPDATE ${SCHEMA}.work_order_parts_plan
            SET qty_planned = $4, updated_at = $5, updated_by = $6, version = version + 1
          WHERE tenant_id = $1 AND work_order_id = $2 AND part_id = $3`,
        [tenantId, workOrderId, line.partId, line.qtyPlanned, now, principalId],
      );
      changed.push(line.partId);
    }

    const plan = await readPartsPlan(client, tenantId, workOrderId);
    await client.query("COMMIT");
    return Object.freeze({
      workOrderId,
      added: Object.freeze(added), changed: Object.freeze(changed),
      removed: Object.freeze(removals), unchanged: Object.freeze(unchanged),
      plan,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { /* the original error is the one that matters */ });
    throw err;
  } finally {
    client.release();
  }
}
