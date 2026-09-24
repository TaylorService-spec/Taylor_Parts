// WORK ORDER COPY ONCE + VERIFY -- the executor built around the existing DRY RUN.
//
// ════════════════════ THE DRY RUN IS THE AUTHORITY ════════════════════
//
// This module re-derives NOTHING. Which records are business, which are excluded, what each type
// normalizes to, which assignment resolves and which stays historical -- every one of those decisions is
// read from a DryRunReport and an Owner manifest that were produced and reviewed elsewhere. A COPY that
// recomputed them could disagree with the report a human approved, and the disagreement would appear only
// as rows in a database nobody re-reads.
//
// DEFAULT IS DRY RUN. Mutation requires an explicit apply flag, and the planning path and the writing path
// share one plan, so what is printed is what would be written.
//
// ONE TRANSACTION, ALL OR NOTHING. Thirteen records is a bounded population; a partial Work Order
// migration is worse than none, because the half that landed looks migrated.
import type { Pool, PoolClient } from "pg";
import type { DryRunReport, ValidatedManifest, SourceWorkOrder } from "./workOrderMigrationDryRun.js";
// THE SHARED PLATFORM AUTHORITY for company -> eos_ops partition key. Work Order does not own this
// question and must not answer it privately.
import { resolveOperatingCompanyKeyForCompany } from "../operatingCompanyBinding.js";

const SCHEMA = "eos_ops";

export type CopyRefusalCode =
  | "SOURCE_DRIFT"
  | "TARGET_SCHEMA_NOT_READY"
  | "TARGET_MIGRATIONS_NOT_APPLIED"
  | "TENANT_NOT_FOUND"
  | "OPERATING_COMPANY_BINDING_MISSING"
  | "OPERATING_COMPANY_BINDING_INACTIVE"
  | "OPERATING_COMPANY_BINDING_AMBIGUOUS"
  | "OPERATING_COMPANY_KEY_UNRESOLVED"
  | "TARGET_CONFLICT"
  | "RECORD_NOT_COPYABLE"
  | "MANIFEST_POPULATION_MISMATCH";

export class WorkOrderCopyRefusedError extends Error {
  constructor(readonly code: CopyRefusalCode, message: string) {
    super(message);
    this.name = "WorkOrderCopyRefusedError";
  }
}
const refuse = (code: CopyRefusalCode, message: string): never => {
  throw new WorkOrderCopyRefusedError(code, message);
};

/** Exactly the relations migration 1761004800000 / 1761091200000 declare. */
export const REQUIRED_TARGET_RELATIONS: readonly string[] = Object.freeze([
  "work_orders", "work_order_assignments", "work_order_schedule_history",
  "work_order_transitions", "work_order_sales_order_lines", "work_order_parts_plan",
]);

/**
 * THE MIGRATIONS THIS COPY REQUIRES, BY NAME.
 *
 * Deliberately NOT "the last migration is X" or "the count is N". Migration 1760486400000 was applied
 * out of order -- it was authored for Reorder, carries an earlier timestamp, and landed in nonprod AFTER
 * the Work Order migrations -- so "last by insertion" now names it and the count moved. Neither says
 * anything about whether the tables this COPY writes exist. Presence does, and it stays true however
 * history was assembled: what matters is that history contains each immutable migration exactly once.
 */
export const REQUIRED_MIGRATIONS: readonly string[] = Object.freeze([
  "1761004800000_work-order-object-authority",
  "1761091200000_work-order-parts-plan-authority",
  "1760486400000_tenant-operating-company-key-binding",
]);

/**
 * SOURCE DRIFT GUARD. Recompute the snapshot and compare to what the decisions were made about.
 *
 * The Owner manifest, the type normalizations and the probe exclusion are all bound to ONE checksum. If
 * the source moved, every one of those decisions is about records that no longer exist in that form, and
 * the correct action is to refuse and re-run the DRY RUN -- never to reconcile part of a changed snapshot.
 */
export function assertNoSourceDrift(recomputedBodySha256: string, boundBodySha256: string): void {
  if (recomputedBodySha256 !== boundBodySha256) {
    refuse("SOURCE_DRIFT",
      "the source no longer matches the snapshot these decisions were made about. Re-run the DRY RUN; do "
      + "not reconcile part of a changed population.");
  }
}

export interface TargetSchemaState {
  readonly migrationCount: number;
  readonly appliedMigrations: ReadonlySet<string>;
  readonly relations: ReadonlySet<string>;
  readonly tenantExists: boolean;
}

/** Read the target's readiness. READ ONLY -- this function creates nothing. */
export async function readTargetSchemaState(
  db: Pick<PoolClient, "query">,
  tenantId: string,
): Promise<TargetSchemaState> {
  const { rows: migrations } = await db.query("SELECT name FROM pgmigrations");
  const { rows: rels } = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [SCHEMA]);
  const { rows: tenants } = await db.query(
    "SELECT 1 FROM eos_policy.tenants WHERE id = $1", [tenantId]);
  return Object.freeze({
    migrationCount: migrations.length,
    appliedMigrations: new Set(migrations.map((r) => String(r.name))),
    relations: new Set(rels.map((r) => String(r.table_name))),
    tenantExists: tenants.length > 0,
  });
}

/** NO SCHEMA IS CREATED HERE. A migration tool that fixes its own preconditions cannot be reviewed. */
export function assertTargetSchemaReady(state: TargetSchemaState): void {
  const missing = REQUIRED_TARGET_RELATIONS.filter((r) => !state.relations.has(r));
  if (missing.length > 0) {
    refuse("TARGET_SCHEMA_NOT_READY",
      `the target is missing required relation(s): ${missing.join(", ")}. Apply the Work Order migrations `
      + "first -- this tool creates no schema.");
  }
  const absent = REQUIRED_MIGRATIONS.filter((m) => !state.appliedMigrations.has(m));
  if (absent.length > 0) {
    refuse("TARGET_MIGRATIONS_NOT_APPLIED",
      `the target has not applied: ${absent.join(", ")}. This COPY writes tables and reads a binding those `
      + "migrations establish.");
  }
  if (!state.tenantExists) refuse("TENANT_NOT_FOUND", "the target tenant does not exist");
}

export interface OperatingCompanyBinding {
  readonly operatingCompanyId: string;
  readonly operatingCompanyKey: string;
}

/**
 * Resolve the Owner's operatingCompanyId to the TARGET's operating_company_key.
 *
 * DELEGATES TO THE SHARED AUTHORITY. eosOps/operatingCompanyBinding.ts owns this question for the whole
 * platform -- Reorder will consume the same resolver when #1961 integrates -- and a private Work Order
 * copy of it would be a second answer to "which partition does this company use". This function adds only
 * the COPY-shaped refusal vocabulary on top; it derives nothing of its own.
 *
 * ════════ WHY THIS IS NOT A STRING EQUALITY ════════
 *
 * `operating_company_id` and `operating_company_key` are different vocabularies, and nonprod proves it
 * rather than merely asserting it: the Sample Company fixture carries operatingCompanyId 'taylor' with
 * operatingCompanyKey 'sample-co-synthetic', deliberately, so its eos_ops rows sit in a partition nothing
 * else uses. Writing 'taylor' into eos_ops.work_orders.operating_company_key because the strings happen to
 * match would be asserting an equality this repository explicitly denies -- and in nonprod today it does
 * match, which is exactly why the shortcut would go unnoticed.
 *
 * TWO GATES. The company must be ACTIVE for the tenant AND its key binding must be ACTIVE. Ventana is
 * deliberately authorized-but-unkeyed, so a Ventana row fails closed until someone keys its partition.
 */
export async function resolveOperatingCompanyKey(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  operatingCompanyId: string,
): Promise<OperatingCompanyBinding> {
  const { rows } = await db.query(
    `SELECT status FROM eos_policy.tenant_operating_companies
      WHERE tenant_id = $1 AND operating_company_id = $2`,
    [tenantId, operatingCompanyId]);
  if (rows.length === 0) {
    refuse("OPERATING_COMPANY_BINDING_MISSING",
      `no eos_policy.tenant_operating_companies row authorizes '${operatingCompanyId}' for this tenant. The `
      + "governed binding decides which companies a TENANT may use; a code-recognised id is not that fact.");
  }
  if (rows.length > 1) {
    refuse("OPERATING_COMPANY_BINDING_AMBIGUOUS", `'${operatingCompanyId}' resolves to more than one binding row`);
  }
  if (String(rows[0].status) !== "ACTIVE") {
    refuse("OPERATING_COMPANY_BINDING_INACTIVE",
      `'${operatingCompanyId}' is bound to this tenant with status ${String(rows[0].status)}, not ACTIVE`);
  }
  try {
    const key = await resolveOperatingCompanyKeyForCompany(db, tenantId, operatingCompanyId);
    return Object.freeze({ operatingCompanyId, operatingCompanyKey: key });
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "OPERATING_COMPANY_KEY_NOT_BOUND" || code === "OPERATING_COMPANY_KEY_AMBIGUOUS") {
      refuse("OPERATING_COMPANY_KEY_UNRESOLVED",
        `'${operatingCompanyId}' is an ACTIVE governed company for this tenant, but no ACTIVE key binding `
        + "establishes its eos_ops partition. String equality is refused; a key is authored as evidence.");
    }
    throw err;
  }
}

export type TargetCollisionResult = "TARGET_ABSENT" | "ALREADY_PRESENT_EQUIVALENT" | "TARGET_CONFLICT";

export interface PlannedWorkOrder {
  readonly workOrderId: string;
  readonly woNumber: string | null;
  readonly status: string;
  readonly sourceType: string | null;
  readonly targetType: string;
  readonly typeResolution: string;
  readonly operatingCompanyId: string;
  readonly operatingCompanyKey: string;
  readonly customerId: string;
  readonly locationId: string;
  readonly equipmentId: string | null;
  readonly salesOrderId: string | null;
  readonly priority: number;
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  readonly completedAt: string | null;
  readonly assignmentDisposition: string;
  readonly assignmentEmployeeId: string | null;
  readonly legacyTechnicianReference: string | null;
  readonly scheduleDisposition: string;
  readonly partsPlanDisposition: string;
  readonly partsPlan: readonly { readonly partId: string; readonly qtyPlanned: number }[];
}

/**
 * Build the copy plan from the DRY RUN report. Pure: no database, no writes.
 *
 * Only COPYABLE records enter. An excluded or blocked record reaching this point is a caller defect and
 * is refused rather than skipped, because silently skipping is how a population shrinks unnoticed.
 */
export function buildCopyPlan(input: {
  readonly report: DryRunReport;
  readonly records: readonly SourceWorkOrder[];
  readonly manifest: ValidatedManifest;
  readonly operatingCompanyKeyByCompanyId: ReadonlyMap<string, string>;
}): readonly PlannedWorkOrder[] {
  const byId = new Map(input.records.map((r) => [r.id, r.data]));
  const copyable = input.report.records.filter((r) => r.result === "COPYABLE");
  const manifestIds = new Set(input.manifest.byWorkOrderId.keys());
  const copyableIds = new Set(copyable.map((r) => r.workOrderId));
  for (const id of manifestIds) {
    if (!copyableIds.has(id)) {
      refuse("MANIFEST_POPULATION_MISMATCH",
        `the manifest decides ${id}, which is not COPYABLE in this report`);
    }
  }

  return Object.freeze(copyable.map((r) => {
    const data = byId.get(r.workOrderId) ?? {};
    const decision = input.manifest.byWorkOrderId.get(r.workOrderId);
    if (!decision) {
      refuse("RECORD_NOT_COPYABLE", `${r.workOrderId} is COPYABLE but carries no Owner company decision`);
    }
    const key = input.operatingCompanyKeyByCompanyId.get(decision!.operatingCompanyId);
    if (!key) {
      refuse("OPERATING_COMPANY_KEY_UNRESOLVED",
        `no operating_company_key is established for '${decision!.operatingCompanyId}'`);
    }
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
    const iso = (v: unknown): string | null => {
      if (v && typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function") {
        return (v as { toDate(): Date }).toDate().toISOString();
      }
      return typeof v === "string" && v ? v : null;
    };
    const snapshot = Array.isArray(data.inventorySnapshot) ? (data.inventorySnapshot as Record<string, unknown>[]) : [];
    const plan = snapshot
      .map((line) => ({ partId: str(line.partId), qtyPlanned: Number(line.qtyPlanned ?? 0) }))
      .filter((line): line is { partId: string; qtyPlanned: number } =>
        line.partId !== null && Number.isInteger(line.qtyPlanned) && line.qtyPlanned > 0);

    const ref = r.assignment.references.find((x) => x.field === "assignedTechId");
    return Object.freeze({
      workOrderId: r.workOrderId,
      // PRESERVED EXACTLY. No number is allocated for a migrated Work Order: the number is what a person
      // says on the phone and what an invoice references.
      woNumber: str(data.woNumber),
      status: String(data.status),
      sourceType: r.type.sourceValue,
      targetType: r.type.targetValue as string,
      typeResolution: r.type.resolution,
      operatingCompanyId: decision!.operatingCompanyId,
      operatingCompanyKey: key!,
      customerId: String(data.customerId),
      locationId: String(data.locationId),
      equipmentId: str(data.equipmentId),
      salesOrderId: str(data.salesOrderId),
      priority: Number(data.priority ?? 3),
      scheduledStart: iso(data.scheduledStart),
      scheduledEnd: iso(data.scheduledEnd),
      completedAt: iso(data.completedAt),
      assignmentDisposition: r.assignment.outcome,
      assignmentEmployeeId: decision!.assignmentEmployeeId
        ?? (ref?.resolution === "EXACT_EMPLOYEE" ? ref.employeeId : null),
      // The legacy reference survives as EVIDENCE when it resolved to nobody. No Employee is invented.
      legacyTechnicianReference: ref && ref.resolution !== "EXACT_EMPLOYEE" ? ref.technicianId : null,
      scheduleDisposition: data.scheduledStart ? "MIGRATED_BASELINE" : "NO_SCHEDULE_IN_SOURCE",
      // REFERENCE PRESERVATION, NOT CATALOG VALIDATION. eos_ops.parts is empty and
      // work_order_parts_plan.part_id deliberately carries no FK into it, so historical Part ids are
      // preserved exactly -- and this disposition says so, rather than implying the reference was checked.
      partsPlanDisposition: plan.length === 0 ? "NO_PARTS_PLAN_IN_SOURCE" : "REFERENCE_PRESERVATION_CATALOG_NOT_VALIDATED",
      partsPlan: Object.freeze(plan),
    });
  }));
}

/** Re-check collisions immediately before applying. Governed facts, never id alone. */
export async function recheckTargetCollisions(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  plan: readonly PlannedWorkOrder[],
): Promise<ReadonlyMap<string, TargetCollisionResult>> {
  if (plan.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT id, work_order_number, status::text AS status, work_order_type::text AS work_order_type,
            operating_company_key, customer_id, location_id
       FROM ${SCHEMA}.work_orders
      WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, plan.map((p) => p.workOrderId)]);
  const existing = new Map(rows.map((r) => [String(r.id), r as Record<string, unknown>]));
  return new Map(plan.map((p) => {
    const row = existing.get(p.workOrderId);
    if (!row) return [p.workOrderId, "TARGET_ABSENT" as TargetCollisionResult];
    // SAME ID IS NOT EQUIVALENCE. Compare the governed facts, or a rerun against a tampered row would
    // report success.
    const same =
      String(row.work_order_number ?? "") === String(p.woNumber ?? "") &&
      String(row.status) === p.status &&
      String(row.work_order_type) === p.targetType &&
      String(row.operating_company_key) === p.operatingCompanyKey &&
      String(row.customer_id) === p.customerId &&
      String(row.location_id) === p.locationId;
    return [p.workOrderId, (same ? "ALREADY_PRESENT_EQUIVALENT" : "TARGET_CONFLICT") as TargetCollisionResult];
  }));
}

// ════════════════════ COPY ONCE ════════════════════

export interface CopyOutcome {
  readonly runId: string;
  readonly applied: boolean;
  readonly inserted: number;
  readonly alreadyPresentEquivalent: number;
  readonly conflicts: number;
  readonly partsPlanRowsInserted: number;
  readonly collisions: ReadonlyMap<string, TargetCollisionResult>;
}

/**
 * COPY ONCE.
 *
 * `apply` defaults FALSE. Both paths share one plan and one collision recheck, so the dry outcome is the
 * same computation the applying outcome performs -- a preview that ran different code would preview
 * nothing.
 *
 * ONE TRANSACTION, ALL OR NOTHING. There is no UPSERT, no UPDATE, no DELETE and no conflict repair: a
 * plain INSERT into an id the target already holds raises, and the whole transaction rolls back. A COPY
 * that repaired conflicts would be reconciling, which is a different act with different authority.
 *
 * AN EXACT REPLAY WRITES NOTHING. Every record already present AND equivalent means zero inserts, which
 * is what makes the tool safe to re-run for VERIFY.
 */
export async function copyOnce(
  pool: Pool,
  input: {
    readonly tenantId: string;
    readonly runId: string;
    readonly plan: readonly PlannedWorkOrder[];
    readonly decisionId: string;
    readonly apply?: boolean;
  },
): Promise<CopyOutcome> {
  const apply = input.apply === true;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // PREFLIGHT ALL RECORDS BEFORE THE FIRST INSERT.
    const collisions = await recheckTargetCollisions(client, input.tenantId, input.plan);
    const conflicts = [...collisions].filter(([, v]) => v === "TARGET_CONFLICT").map(([k]) => k);
    if (conflicts.length > 0) {
      refuse("TARGET_CONFLICT",
        `${conflicts.length} record(s) already exist in the target with different governed facts: `
        + `${conflicts.sort().join(", ")}. The whole COPY is refused; this tool never overwrites.`);
    }
    const toInsert = input.plan.filter((p) => collisions.get(p.workOrderId) === "TARGET_ABSENT");
    const alreadyPresent = input.plan.length - toInsert.length;

    let partsPlanRows = 0;
    if (apply) {
      for (const p of toInsert) {
        await client.query(
          `INSERT INTO ${SCHEMA}.work_orders
             (id, tenant_id, operating_company_key, work_order_number, status, work_order_type, priority,
              customer_id, location_id, equipment_id, sales_order_id,
              scheduled_start, scheduled_end, completed_at, provenance, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5::${SCHEMA}.ops_work_order_status,$6::${SCHEMA}.ops_work_order_type,$7,
                   $8,$9,$10,$11,$12,$13,$14,'MIGRATED',now(),now())`,
          [p.workOrderId, input.tenantId, p.operatingCompanyKey, p.woNumber, p.status, p.targetType,
           p.priority, p.customerId, p.locationId, p.equipmentId, p.salesOrderId,
           p.scheduledStart, p.scheduledEnd, p.completedAt]);
        for (const line of p.partsPlan) {
          await client.query(
            `INSERT INTO ${SCHEMA}.work_order_parts_plan
               (tenant_id, work_order_id, part_id, qty_planned, planned_by, updated_by)
             VALUES ($1,$2,$3,$4,$5,$5)`,
            [input.tenantId, p.workOrderId, line.partId, line.qtyPlanned, `migration:${input.decisionId}`]);
          partsPlanRows += 1;
        }
      }
      await client.query("COMMIT");
    } else {
      // The preview reaches exactly the same decisions and then leaves the database as it found it.
      await client.query("ROLLBACK");
    }
    return Object.freeze({
      runId: input.runId, applied: apply,
      inserted: apply ? toInsert.length : 0,
      alreadyPresentEquivalent: alreadyPresent,
      conflicts: 0,
      partsPlanRowsInserted: partsPlanRows,
      collisions,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => { /* the original error is the one that matters */ });
    throw err;
  } finally {
    client.release();
  }
}

// ════════════════════ VERIFY ════════════════════

export interface VerifyMismatch {
  readonly workOrderId: string;
  readonly field: string;
  readonly expected: string;
  readonly found: string;
}

export interface VerifyReport {
  readonly checked: number;
  readonly missing: readonly string[];
  readonly mismatches: readonly VerifyMismatch[];
  readonly ok: boolean;
}

/**
 * VERIFY -- an INDEPENDENT read-only phase.
 *
 * It compares the target against the SAME bound plan, and it REPAIRS NOTHING. A verifier that fixed what
 * it found would be a second writer with no review, and its silence would then mean either "correct" or
 * "corrected" with no way to tell which.
 */
export async function verifyCopy(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  plan: readonly PlannedWorkOrder[],
): Promise<VerifyReport> {
  if (plan.length === 0) return Object.freeze({ checked: 0, missing: [], mismatches: [], ok: true });
  const { rows } = await db.query(
    `SELECT id, work_order_number, status::text AS status, work_order_type::text AS work_order_type,
            priority, operating_company_key, customer_id, location_id, equipment_id, sales_order_id,
            completed_at, provenance::text AS provenance
       FROM ${SCHEMA}.work_orders
      WHERE tenant_id = $1 AND id = ANY($2::text[])`,
    [tenantId, plan.map((p) => p.workOrderId)]);
  const found = new Map(rows.map((r) => [String(r.id), r as Record<string, unknown>]));

  const { rows: planRows } = await db.query(
    `SELECT work_order_id, part_id, qty_planned FROM ${SCHEMA}.work_order_parts_plan
      WHERE tenant_id = $1 AND work_order_id = ANY($2::text[]) ORDER BY work_order_id, part_id`,
    [tenantId, plan.map((p) => p.workOrderId)]);
  const planByWo = new Map<string, string[]>();
  for (const r of planRows) {
    const key = String(r.work_order_id);
    if (!planByWo.has(key)) planByWo.set(key, []);
    planByWo.get(key)!.push(`${String(r.part_id)}:${Number(r.qty_planned)}`);
  }

  const missing: string[] = [];
  const mismatches: VerifyMismatch[] = [];
  const norm = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
  for (const p of plan) {
    const row = found.get(p.workOrderId);
    if (!row) { missing.push(p.workOrderId); continue; }
    const check = (field: string, expected: string, actual: string) => {
      if (expected !== actual) mismatches.push({ workOrderId: p.workOrderId, field, expected, found: actual });
    };
    check("woNumber", norm(p.woNumber), norm(row.work_order_number));
    check("status", p.status, norm(row.status));
    check("type", p.targetType, norm(row.work_order_type));
    check("priority", String(p.priority), norm(row.priority));
    check("operating_company_key", p.operatingCompanyKey, norm(row.operating_company_key));
    check("customerId", p.customerId, norm(row.customer_id));
    check("locationId", p.locationId, norm(row.location_id));
    check("equipmentId", norm(p.equipmentId), norm(row.equipment_id));
    check("salesOrderId", norm(p.salesOrderId), norm(row.sales_order_id));
    // PROVENANCE IS VERIFIED, not assumed: a migrated record that claimed NATIVE would be a Work Order
    // asserting a creation event that never happened.
    check("provenance", "MIGRATED", norm(row.provenance));
    if (p.completedAt !== null) {
      check("completedAt", new Date(p.completedAt).toISOString(),
        row.completed_at ? new Date(row.completed_at as string).toISOString() : "");
    }
    const expectedPlan = [...p.partsPlan].map((l) => `${l.partId}:${l.qtyPlanned}`).sort().join(",");
    check("partsPlan", expectedPlan, (planByWo.get(p.workOrderId) ?? []).sort().join(","));
  }
  return Object.freeze({
    checked: plan.length,
    missing: Object.freeze(missing.sort()),
    mismatches: Object.freeze(mismatches),
    ok: missing.length === 0 && mismatches.length === 0,
  });
}
