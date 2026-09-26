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
//
// THE CONTRACT. docs/engineering/work-order-migration-copy-contract-2026-09-26.md says, per source field,
// what this COPY does with it; WORK_ORDER_COPY_CONTRACT below is that table in code. Historical instants
// are carried EXPLICITLY (never the database clock), the current assignee is copied through governed identity only,
// and VERIFY compares every contracted fact and child row rather than a handful of columns.
import { createHash, randomUUID } from "node:crypto";
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
  | "MANIFEST_POPULATION_MISMATCH"
  | "UNRESOLVED_IDENTITY"
  | "DECISION_MISMATCH";

export class WorkOrderCopyRefusedError extends Error {
  constructor(readonly code: CopyRefusalCode, message: string, readonly details: unknown = null) {
    super(message);
    this.name = "WorkOrderCopyRefusedError";
  }
}
const refuse = (code: CopyRefusalCode, message: string, details: unknown = null): never => {
  throw new WorkOrderCopyRefusedError(code, message, details);
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


// ════════════════════ THE COPY CONTRACT ════════════════════
//
// docs/engineering/work-order-migration-copy-contract-2026-09-26.md, as code. EVERY top-level source field
// the COPY may meet is named here. A field that is not named refuses its record (UNMAPPED_SOURCE_FIELD),
// and a field classed UNKNOWN -- no target column exists -- refuses its record when it carries a value
// (SCHEMA_GAP_FIELD_PRESENT). Silently dropping a fact nobody listed is exactly the defect this repairs.

export const COPY_CONTRACT_CLASSES = Object.freeze([
  "REQUIRED_COPY", "DERIVED_SERVER_SIDE", "HISTORICAL_ONLY", "INTENTIONALLY_NOT_COPIED", "UNKNOWN",
] as const);
export type CopyContractClass = (typeof COPY_CONTRACT_CLASSES)[number];

export const WORK_ORDER_COPY_CONTRACT: Readonly<Record<string, CopyContractClass>> = Object.freeze({
  id: "REQUIRED_COPY",
  woNumber: "REQUIRED_COPY",
  status: "REQUIRED_COPY",
  type: "REQUIRED_COPY",
  priority: "REQUIRED_COPY",
  severity: "REQUIRED_COPY",
  customerId: "REQUIRED_COPY",
  locationId: "REQUIRED_COPY",
  equipmentId: "REQUIRED_COPY",
  salesOrderId: "REQUIRED_COPY",
  complaint: "REQUIRED_COPY",
  diagnosis: "REQUIRED_COPY",
  resolution: "REQUIRED_COPY",
  estimatedDurationMinutes: "REQUIRED_COPY",
  scheduledStart: "REQUIRED_COPY",
  scheduledEnd: "REQUIRED_COPY",
  dispatchedAt: "REQUIRED_COPY",
  acceptedAt: "REQUIRED_COPY",
  enRouteAt: "REQUIRED_COPY",
  arrivedAt: "REQUIRED_COPY",
  workStartedAt: "REQUIRED_COPY",
  completedAt: "REQUIRED_COPY",
  closedAt: "REQUIRED_COPY",
  createdAt: "REQUIRED_COPY",
  updatedAt: "REQUIRED_COPY",
  partsPlanUpdatedAt: "REQUIRED_COPY",
  assignedTechId: "REQUIRED_COPY",
  scheduledTechId: "REQUIRED_COPY",
  rescheduledFromStart: "REQUIRED_COPY",
  rescheduledFromEnd: "REQUIRED_COPY",
  rescheduledAt: "REQUIRED_COPY",
  rescheduledReason: "REQUIRED_COPY",
  inventorySnapshot: "REQUIRED_COPY",
  rescheduledByUid: "DERIVED_SERVER_SIDE",
  reassignedFromTechId: "HISTORICAL_ONLY",
  reassignedAt: "HISTORICAL_ONLY",
  reassignedReason: "HISTORICAL_ONLY",
  reassignedByUid: "HISTORICAL_ONLY",
  rescheduledFromTechId: "HISTORICAL_ONLY",
  laborHours: "INTENTIONALLY_NOT_COPIED",
  lastUpdated: "INTENTIONALLY_NOT_COPIED",
  salesOrderLineRefs: "UNKNOWN",
  executionLog: "UNKNOWN",
  inboundWorkRequestId: "UNKNOWN",
  externalReference: "UNKNOWN",
  authorizationNumber: "UNKNOWN",
});

/** The eleven governed statuses (ops_work_order_status, types/workOrder.ts WorkOrderStatus). */
export const GOVERNED_WORK_ORDER_STATUSES: readonly string[] = Object.freeze([
  "CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED",
  "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED",
]);
const GOVERNED_SEVERITIES: readonly string[] =
  Object.freeze(["EQUIPMENT_DOWN", "PARTIAL_OPERATION", "COSMETIC", "PREVENTIVE"]);
const LIFECYCLE_FIELDS = Object.freeze(
  ["dispatchedAt", "acceptedAt", "enRouteAt", "arrivedAt", "workStartedAt", "completedAt"] as const);

// ════════════════════ TIMESTAMPS ════════════════════
//
// ONE converter for every target instant. It never assumes a zone, never reads epoch SECONDS as
// milliseconds, never coerces, and never falls back to the clock. The canonical form is the exact string
// VERIFY reads back: YYYY-MM-DDTHH:MM:SS.ffffffZ (timestamptz precision is the microsecond).

export type TimestampRefusalCode = "TIMESTAMP_INVALID" | "TIMESTAMP_AMBIGUOUS_TIMEZONE" | "TIMESTAMP_OUT_OF_RANGE";
export type TimestampConversion =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false; readonly code: TimestampRefusalCode; readonly detail: string };

const MIN_INSTANT_MS = Date.UTC(2000, 0, 1);
const MAX_INSTANT_MS = Date.UTC(2100, 0, 1);
const tsInvalid = (detail: string): TimestampConversion => ({ ok: false, code: "TIMESTAMP_INVALID", detail });

function canonicalInstant(epochSeconds: number, microsOfSecond: number): TimestampConversion {
  const ms = epochSeconds * 1000 + Math.floor(microsOfSecond / 1000);
  if (!Number.isFinite(ms)) return tsInvalid("not a finite instant");
  if (ms < MIN_INSTANT_MS || ms >= MAX_INSTANT_MS) {
    return { ok: false, code: "TIMESTAMP_OUT_OF_RANGE", detail: `${new Date(ms).toISOString()} is outside [2000-01-01, 2100-01-01)` };
  }
  const base = new Date(epochSeconds * 1000).toISOString().slice(0, 19);
  return { ok: true, value: `${base}.${String(microsOfSecond).padStart(6, "0")}Z` };
}

function fromEpochMillis(ms: number): TimestampConversion {
  const seconds = Math.floor(ms / 1000);
  return canonicalInstant(seconds, (ms - seconds * 1000) * 1000);
}

const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const ISO_WITHOUT_ZONE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

function fromIsoString(text: string): TimestampConversion {
  const m = ISO_WITH_ZONE.exec(text);
  if (!m) {
    return ISO_WITHOUT_ZONE.test(text)
      ? { ok: false, code: "TIMESTAMP_AMBIGUOUS_TIMEZONE", detail: `'${text}' states no zone; none is ever assumed` }
      : tsInvalid(`'${text}' is not an ISO-8601 instant`);
  }
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return tsInvalid(`'${text}' names an impossible time`);
  const base = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(base);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return tsInvalid(`'${text}' names an impossible calendar date`);
  }
  let offsetMinutes = 0;
  if (m[8] !== "Z") {
    const sign = m[8][0] === "-" ? -1 : 1;
    const oh = Number(m[8].slice(1, 3));
    const om = Number(m[8].slice(4, 6));
    if (oh > 23 || om > 59) return tsInvalid(`'${text}' names an impossible offset`);
    offsetMinutes = sign * (oh * 60 + om);
  }
  const micros = Number((m[7] ?? "").padEnd(6, "0").slice(0, 6));
  return canonicalInstant((base - offsetMinutes * 60000) / 1000, micros);
}

/** Convert one source value to the canonical timestamptz string, or refuse with a named reason. */
export function toTimestamptz(value: unknown): TimestampConversion {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? fromEpochMillis(ms) : tsInvalid("an invalid Date");
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return tsInvalid("a fractional number is not an instant");
    if (value < MIN_INSTANT_MS || value >= MAX_INSTANT_MS) {
      return { ok: false, code: "TIMESTAMP_OUT_OF_RANGE",
        detail: `${value} is outside [2000, 2100) read as epoch MILLISECONDS; epoch seconds are never reinterpreted` };
    }
    return fromEpochMillis(value);
  }
  if (typeof value === "string") return fromIsoString(value);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const seconds = typeof o.seconds === "number" ? o.seconds : typeof o._seconds === "number" ? o._seconds : undefined;
    const nanos = typeof o.nanoseconds === "number" ? o.nanoseconds : typeof o._nanoseconds === "number" ? o._nanoseconds : undefined;
    if (seconds !== undefined && nanos !== undefined) {
      if (!Number.isInteger(seconds) || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) {
        return tsInvalid("a Timestamp with non-integer or out-of-range parts");
      }
      // Firestore keeps nanoseconds; timestamptz keeps microseconds. Truncated, never rounded up.
      return canonicalInstant(seconds, Math.floor(nanos / 1000));
    }
    if (typeof o.toDate === "function") {
      const d = (o.toDate as () => unknown).call(o);
      if (d instanceof Date) return toTimestamptz(d);
    }
  }
  return tsInvalid(`a ${Array.isArray(value) ? "array" : typeof value} is not a recognised instant representation`);
}

// ════════════════════ THE PLAN ════════════════════

export type PlanRefusalCategory = "MISSING_REQUIRED_FIELD" | "UNRESOLVED_IDENTITY" | "UNKNOWN";
export type PlanRefusalCode =
  | "MISSING_REQUIRED_FIELD" | "FIELD_VALUE_INVALID"
  | TimestampRefusalCode | "TIMESTAMP_ORDER_VIOLATION" | "TIMESTAMP_STATUS_INCOHERENT"
  | "SCHEMA_GAP_FIELD_PRESENT" | "UNMAPPED_SOURCE_FIELD"
  | "PARTS_PLAN_LINE_UNMAPPABLE" | "PARTS_PLAN_DUPLICATE_PART"
  | "UNRESOLVED_IDENTITY";

export interface PlanRefusalReason {
  readonly code: PlanRefusalCode;
  readonly category: PlanRefusalCategory;
  readonly field: string;
  readonly detail: string;
}
export interface PlanRefusal {
  readonly workOrderId: string;
  readonly reasons: readonly PlanRefusalReason[];
}

export type AssignmentBasis = "REASSIGNED_AT" | "RESCHEDULED_AT" | "MIGRATION_INSTANT";

export interface PlannedAssignment {
  readonly id: string;
  readonly employeeId: string;
  readonly sourceField: "assignedTechId" | "scheduledTechId" | null;
  readonly technicianId: string | null;
  readonly basis: AssignmentBasis;
  /** A source instant, or NULL when the basis is MIGRATION_INSTANT (the run's copiedAt is used). */
  readonly effectiveFrom: string | null;
  readonly reason: string;
}

export interface PlannedScheduleHistory {
  readonly id: string;
  readonly previousStart: string | null;
  readonly previousEnd: string | null;
  readonly newStart: string | null;
  readonly newEnd: string | null;
  readonly changedAt: string;
  readonly reason: string | null;
  /** Resolved to a Principal at COPY time. Never written anywhere. */
  readonly changedByLegacyUid: string | null;
}

export interface PlannedTransition {
  readonly id: string;
  readonly toStatus: "CANCELLED";
  readonly action: "cancel";
  readonly occurredAt: string;
  readonly note: string;
}

export interface LegacyAssignmentEvidence {
  readonly assignedTechId: string | null;
  readonly scheduledTechId: string | null;
  readonly reassignedFromTechId: string | null;
  readonly reassignedAt: string | null;
  readonly reassignedReason: string | null;
  /** Resolved to a Principal at COPY time. Never written anywhere. */
  readonly reassignedByLegacyUid: string | null;
  readonly rescheduledFromTechId: string | null;
}

export interface PlannedWorkOrder {
  readonly workOrderId: string;
  readonly decisionId: string;
  readonly snapshotBodySha256: string;
  /** The per-document digest from the DRY RUN snapshot -- the source fingerprint. */
  readonly sourceSha256: string;
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
  readonly severity: string | null;
  readonly severityRaw: string | null;
  readonly severityDisposition: "ABSENT" | "COPIED" | "OUT_OF_VOCABULARY_HISTORICAL_ONLY";
  readonly complaint: string | null;
  readonly diagnosis: string | null;
  readonly resolution: string | null;
  readonly estimatedDurationMinutes: number | null;
  readonly scheduledStart: string | null;
  readonly scheduledEnd: string | null;
  readonly dispatchedAt: string | null;
  readonly acceptedAt: string | null;
  readonly enRouteAt: string | null;
  readonly arrivedAt: string | null;
  readonly workStartedAt: string | null;
  readonly completedAt: string | null;
  /** closed_at. NULL on a CANCELLED record: its legacy closedAt is the cancellation instant. */
  readonly closedAt: string | null;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly partsPlanUpdatedAt: string | null;
  readonly assignmentDisposition: string;
  readonly assignmentEmployeeId: string | null;
  readonly legacyTechnicianReference: string | null;
  readonly assignment: PlannedAssignment | null;
  readonly legacyAssignment: LegacyAssignmentEvidence;
  readonly scheduleDisposition: string;
  readonly scheduleHistory: PlannedScheduleHistory | null;
  readonly transitions: readonly PlannedTransition[];
  readonly partsPlanDisposition: string;
  readonly partsPlan: readonly { readonly partId: string; readonly qtyPlanned: number }[];
}

export interface CopyPlanReport {
  readonly planned: readonly PlannedWorkOrder[];
  readonly refused: readonly PlanRefusal[];
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const present = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/**
 * Build the copy plan from the DRY RUN report, and say which records it REFUSES and why. Pure.
 *
 * Population-level defects (a manifest naming a non-COPYABLE record, a COPYABLE record without an Owner
 * decision, an unkeyed company) still throw: they are not facts about one record. Record-level defects
 * are collected, every reason per record, so an operator sees the whole list in one dry run.
 */
export function buildCopyPlanReport(input: {
  readonly report: DryRunReport;
  readonly records: readonly SourceWorkOrder[];
  readonly manifest: ValidatedManifest;
  readonly operatingCompanyKeyByCompanyId: ReadonlyMap<string, string>;
}): CopyPlanReport {
  const byId = new Map(input.records.map((r) => [r.id, r.data]));
  const shaById = new Map(input.report.snapshot.documents.map((d) => [d.id, d.sha256]));
  const copyable = input.report.records.filter((r) => r.result === "COPYABLE");
  const copyableIds = new Set(copyable.map((r) => r.workOrderId));
  for (const id of input.manifest.byWorkOrderId.keys()) {
    if (!copyableIds.has(id)) {
      refuse("MANIFEST_POPULATION_MISMATCH", `the manifest decides ${id}, which is not COPYABLE in this report`);
    }
  }

  const planned: PlannedWorkOrder[] = [];
  const refused: PlanRefusal[] = [];
  for (const r of copyable) {
    const data = byId.get(r.workOrderId) ?? {};
    const decision = input.manifest.byWorkOrderId.get(r.workOrderId);
    if (!decision) refuse("RECORD_NOT_COPYABLE", `${r.workOrderId} is COPYABLE but carries no Owner company decision`);
    const key = input.operatingCompanyKeyByCompanyId.get(decision!.operatingCompanyId);
    if (!key) {
      refuse("OPERATING_COMPANY_KEY_UNRESOLVED", `no operating_company_key is established for '${decision!.operatingCompanyId}'`);
    }
    const sourceSha256 = shaById.get(r.workOrderId);
    if (!sourceSha256) refuse("RECORD_NOT_COPYABLE", `${r.workOrderId} is not in the snapshot the report was built from`);

    const reasons: PlanRefusalReason[] = [];
    const add = (code: PlanRefusalCode, category: PlanRefusalCategory, field: string, detail: string) =>
      reasons.push(Object.freeze({ code, category, field, detail }));

    // ── contract coverage: nothing unlisted, nothing unplaceable ──
    for (const field of Object.keys(data).sort()) {
      if (!hasOwn(WORK_ORDER_COPY_CONTRACT, field)) {
        add("UNMAPPED_SOURCE_FIELD", "UNKNOWN", field, "the COPY contract does not name this field; it is refused, not dropped");
      } else if (WORK_ORDER_COPY_CONTRACT[field] === "UNKNOWN" && present(data[field])) {
        add("SCHEMA_GAP_FIELD_PRESENT", "UNKNOWN", field, "no target column holds this fact (contract schema gap); copying without it would lose it");
      }
    }
    if (data.id !== undefined && data.id !== r.workOrderId) {
      add("FIELD_VALUE_INVALID", "UNKNOWN", "id", `data.id '${String(data.id)}' disagrees with the document id`);
    }

    // ── instants: explicit, validated, never the clock ──
    const instant = (field: string, required: boolean): string | null => {
      const c = toTimestamptz(data[field]);
      if (!c.ok) {
        add(c.code, required ? "MISSING_REQUIRED_FIELD" : "UNKNOWN", field, c.detail);
        return null;
      }
      if (c.value === null && required) {
        add("MISSING_REQUIRED_FIELD", "MISSING_REQUIRED_FIELD", field, "absent; a historical instant is never invented");
      }
      return c.value;
    };

    const statusRaw = data.status;
    let status = "";
    if (statusRaw === undefined || statusRaw === null || statusRaw === "") {
      add("MISSING_REQUIRED_FIELD", "MISSING_REQUIRED_FIELD", "status", "absent");
    } else if (typeof statusRaw !== "string" || !GOVERNED_WORK_ORDER_STATUSES.includes(statusRaw)) {
      add("FIELD_VALUE_INVALID", "UNKNOWN", "status", `'${String(statusRaw)}' is outside the governed vocabulary`);
    } else {
      status = statusRaw;
    }

    const createdAt = instant("createdAt", true);
    const updatedAt = instant("updatedAt", true);
    const lifecycle = Object.fromEntries(LIFECYCLE_FIELDS.map((f) => [f, instant(f, f === "completedAt" && status === "COMPLETED")])) as
      Record<(typeof LIFECYCLE_FIELDS)[number], string | null>;
    const closedRaw = instant("closedAt", status === "CLOSED");
    let closedAt: string | null = null;
    let cancelledAt: string | null = null;
    if (closedRaw !== null) {
      if (status === "CLOSED") closedAt = closedRaw;
      else if (status === "CANCELLED") cancelledAt = closedRaw;
      else add("TIMESTAMP_STATUS_INCOHERENT", "UNKNOWN", "closedAt", `a ${status || "status-less"} record carries closedAt; only Close and Cancel write it`);
    }
    if (createdAt !== null) {
      const ordered: [string, string | null][] = [["updatedAt", updatedAt], ...LIFECYCLE_FIELDS.map((f) => [f, lifecycle[f]] as [string, string | null]), ["closedAt", closedRaw]];
      for (const [field, value] of ordered) {
        if (value !== null && value < createdAt) {
          add("TIMESTAMP_ORDER_VIOLATION", "UNKNOWN", field, `${value} precedes createdAt ${createdAt}`);
        }
      }
    }
    const scheduledStart = instant("scheduledStart", false);
    const scheduledEnd = instant("scheduledEnd", false);
    if ((data.scheduledStart == null) !== (data.scheduledEnd == null)) {
      add("FIELD_VALUE_INVALID", "UNKNOWN", "scheduledStart", "a schedule window is both ends or neither");
    } else if (scheduledStart !== null && scheduledEnd !== null && scheduledEnd < scheduledStart) {
      add("FIELD_VALUE_INVALID", "UNKNOWN", "scheduledEnd", "the window runs backwards");
    }
    const partsPlanUpdatedAt = instant("partsPlanUpdatedAt", false);

    // ── governed facts: no default, no coercion ──
    const priority = data.priority;
    if (priority === undefined || priority === null) {
      add("MISSING_REQUIRED_FIELD", "MISSING_REQUIRED_FIELD", "priority", "absent; no priority is defaulted");
    } else if (!Number.isInteger(priority) || (priority as number) < 1 || (priority as number) > 4) {
      add("FIELD_VALUE_INVALID", "MISSING_REQUIRED_FIELD", "priority", `'${String(priority)}' is not one of the four governed priorities`);
    }
    const customerId = str(data.customerId);
    if (!customerId) add("MISSING_REQUIRED_FIELD", "MISSING_REQUIRED_FIELD", "customerId", "absent or blank");
    const locationId = str(data.locationId);
    if (!locationId) add("MISSING_REQUIRED_FIELD", "MISSING_REQUIRED_FIELD", "locationId", "absent or blank");

    const verbatim = (field: string): string | null => {
      const v = data[field];
      if (v === undefined || v === null) return null;
      if (typeof v !== "string") { add("FIELD_VALUE_INVALID", "UNKNOWN", field, `a ${typeof v} is not text`); return null; }
      return v;
    };
    const complaint = verbatim("complaint");
    const diagnosis = verbatim("diagnosis");
    const resolution = verbatim("resolution");
    const reassignedReason = verbatim("reassignedReason");
    const rescheduledReason = verbatim("rescheduledReason");

    let estimatedDurationMinutes: number | null = null;
    if (data.estimatedDurationMinutes !== undefined && data.estimatedDurationMinutes !== null) {
      const v = data.estimatedDurationMinutes;
      if (Number.isInteger(v) && (v as number) > 0) estimatedDurationMinutes = v as number;
      else add("FIELD_VALUE_INVALID", "UNKNOWN", "estimatedDurationMinutes", `'${String(v)}' is not a positive whole number of minutes`);
    }

    // RULING (DRY RUN): severity never becomes priority. In vocabulary -> the severity column; outside it
    // -> NULL there, and the raw value survives in the run record.
    const severityValue = data.severity;
    let severity: string | null = null;
    let severityRaw: string | null = null;
    let severityDisposition: PlannedWorkOrder["severityDisposition"] = "ABSENT";
    if (present(severityValue)) {
      severityRaw = String(severityValue);
      if (typeof severityValue === "string" && GOVERNED_SEVERITIES.includes(severityValue)) {
        severity = severityValue;
        severityDisposition = "COPIED";
      } else {
        severityDisposition = "OUT_OF_VOCABULARY_HISTORICAL_ONLY";
      }
    }

    // ── parts plan: planned lines only, each with a canonical Part id ──
    const plan: { partId: string; qtyPlanned: number }[] = [];
    const snapshot = data.inventorySnapshot;
    if (snapshot !== undefined && snapshot !== null && !Array.isArray(snapshot)) {
      add("FIELD_VALUE_INVALID", "UNKNOWN", "inventorySnapshot", "not an array");
    } else if (Array.isArray(snapshot)) {
      const seen = new Set<string>();
      snapshot.forEach((raw, index) => {
        const line = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const qty = line.qtyPlanned;
        if (qty === undefined || qty === null || qty === 0) return; // usage-only / unplanned: not a plan line
        const partId = str(line.partId);
        if (!Number.isInteger(qty) || (qty as number) < 0) {
          add("PARTS_PLAN_LINE_UNMAPPABLE", "UNKNOWN", `inventorySnapshot[${index}]`, `qtyPlanned '${String(qty)}' is not a whole number`);
        } else if (!partId) {
          add("PARTS_PLAN_LINE_UNMAPPABLE", "UNKNOWN", `inventorySnapshot[${index}]`, "a planned line with no canonical partId (sku-only legacy line)");
        } else if (seen.has(partId)) {
          add("PARTS_PLAN_DUPLICATE_PART", "UNKNOWN", `inventorySnapshot[${index}]`, `partId ${partId} is planned twice`);
        } else {
          seen.add(partId);
          plan.push({ partId, qtyPlanned: qty as number });
        }
      });
      plan.sort((a, b) => (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));
    }

    // ── assignment: the CURRENT assignee, through governed identity only ──
    const assignedTech = str(data.assignedTechId);
    const scheduledTech = str(data.scheduledTechId);
    const sourceField: PlannedAssignment["sourceField"] = assignedTech ? "assignedTechId" : scheduledTech ? "scheduledTechId" : null;
    const technicianId = assignedTech ?? scheduledTech;
    const ref = sourceField ? r.assignment.references.find((x) => x.field === sourceField) : undefined;
    const decided = decision!.assignmentEmployeeId ?? null;
    const reassignedFrom = str(data.reassignedFromTechId);
    const rescheduledFrom = str(data.rescheduledFromTechId);
    const reassignedAt = instant("reassignedAt", false);
    const rescheduledAt = instant("rescheduledAt", false);

    let employeeId: string | null = null;
    if (decided) {
      employeeId = decided;
    } else if (ref && ref.resolution === "EXACT_EMPLOYEE") {
      employeeId = ref.employeeId;
    } else if (sourceField && !r.assignment.terminal) {
      // The DRY RUN blocks this; reaching here means the report and the records disagree.
      add("UNRESOLVED_IDENTITY", "UNRESOLVED_IDENTITY", sourceField,
        `ACTIVE Work Order whose technician '${technicianId}' does not resolve (${ref?.resolution ?? "UNCLASSIFIED"})`);
    }
    let basis: AssignmentBasis = "MIGRATION_INSTANT";
    let effectiveFrom: string | null = null;
    if (employeeId && !decided) {
      if (sourceField === "assignedTechId" && reassignedFrom && reassignedFrom !== assignedTech) {
        if (reassignedAt) { basis = "REASSIGNED_AT"; effectiveFrom = reassignedAt; }
        else add("MISSING_REQUIRED_FIELD", "MISSING_REQUIRED_FIELD", "reassignedAt", "reassignedFromTechId is present without the instant it happened");
      } else if (sourceField === "scheduledTechId" && rescheduledFrom && rescheduledFrom !== scheduledTech) {
        if (rescheduledAt) { basis = "RESCHEDULED_AT"; effectiveFrom = rescheduledAt; }
        else add("MISSING_REQUIRED_FIELD", "MISSING_REQUIRED_FIELD", "rescheduledAt", "rescheduledFromTechId is present without the instant it happened");
      }
    }
    const assignment: PlannedAssignment | null = employeeId
      ? Object.freeze({
          id: `woa_mig_${r.workOrderId}`, employeeId, sourceField, technicianId, basis, effectiveFrom,
          reason: `MIGRATED_CURRENT_ASSIGNMENT legacy:${sourceField ?? "none"}=${technicianId ?? "none"} basis:${basis}`
            + (decided ? ` decision:${input.manifest.decisionId}` : ""),
        })
      : null;

    // ── schedule history: the surviving latest reschedule, whole or not at all ──
    const previousStart = instant("rescheduledFromStart", false);
    const previousEnd = instant("rescheduledFromEnd", false);
    let scheduleHistory: PlannedScheduleHistory | null = null;
    if (rescheduledAt !== null) {
      if (previousStart === null && scheduledStart === null) {
        add("FIELD_VALUE_INVALID", "UNKNOWN", "rescheduledAt", "a reschedule with neither a previous nor a current start says nothing");
      } else {
        scheduleHistory = Object.freeze({
          id: `wosh_mig_${r.workOrderId}`, previousStart, previousEnd, newStart: scheduledStart, newEnd: scheduledEnd,
          changedAt: rescheduledAt, reason: rescheduledReason, changedByLegacyUid: str(data.rescheduledByUid),
        });
      }
    } else if (present(data.rescheduledFromStart) || present(data.rescheduledFromEnd) || rescheduledFrom) {
      add("MISSING_REQUIRED_FIELD", "MISSING_REQUIRED_FIELD", "rescheduledAt", "a reschedule snapshot without the instant it happened");
    }

    const transitions: PlannedTransition[] = cancelledAt ? [Object.freeze({
      id: `wot_mig_${r.workOrderId}_cancel`, toStatus: "CANCELLED" as const, action: "cancel" as const,
      occurredAt: cancelledAt,
      note: "MIGRATED: cancellation instant carried from legacy closedAt (transitionEngine.ts ACTION_TIMESTAMP_FIELD.Cancel); "
        + "the source recorded neither the prior status nor the actor",
    })] : [];

    if (reasons.length > 0) {
      refused.push(Object.freeze({ workOrderId: r.workOrderId, reasons: Object.freeze(reasons) }));
      continue;
    }

    planned.push(Object.freeze({
      workOrderId: r.workOrderId,
      decisionId: input.manifest.decisionId,
      snapshotBodySha256: input.report.snapshot.bodySha256,
      sourceSha256: sourceSha256!,
      // PRESERVED EXACTLY. No number is allocated for a migrated Work Order.
      woNumber: str(data.woNumber),
      status,
      sourceType: r.type.sourceValue,
      targetType: r.type.targetValue as string,
      typeResolution: r.type.resolution,
      operatingCompanyId: decision!.operatingCompanyId,
      operatingCompanyKey: key!,
      customerId: customerId!,
      locationId: locationId!,
      equipmentId: str(data.equipmentId),
      salesOrderId: str(data.salesOrderId),
      priority: priority as number,
      severity, severityRaw, severityDisposition,
      complaint, diagnosis, resolution, estimatedDurationMinutes,
      scheduledStart, scheduledEnd,
      ...lifecycle,
      closedAt, cancelledAt,
      createdAt: createdAt!, updatedAt: updatedAt!, partsPlanUpdatedAt,
      assignmentDisposition: r.assignment.outcome,
      assignmentEmployeeId: employeeId,
      // The legacy reference survives as EVIDENCE when it resolved to nobody. No Employee is invented.
      legacyTechnicianReference: ref && ref.resolution !== "EXACT_EMPLOYEE" ? ref.technicianId : null,
      assignment,
      legacyAssignment: Object.freeze({
        assignedTechId: assignedTech, scheduledTechId: scheduledTech,
        reassignedFromTechId: reassignedFrom, reassignedAt, reassignedReason,
        reassignedByLegacyUid: str(data.reassignedByUid), rescheduledFromTechId: rescheduledFrom,
      }),
      scheduleDisposition: scheduleHistory ? "LATEST_RESCHEDULE_MIGRATED" : scheduledStart ? "CURRENT_SCHEDULE_ONLY" : "NO_SCHEDULE_IN_SOURCE",
      scheduleHistory,
      transitions: Object.freeze(transitions),
      // REFERENCE PRESERVATION, NOT CATALOG VALIDATION. work_order_parts_plan.part_id carries no FK into
      // the (empty) Part catalog, so historical Part ids are preserved exactly -- and this says so.
      partsPlanDisposition: plan.length === 0 ? "NO_PARTS_PLAN_IN_SOURCE" : "REFERENCE_PRESERVATION_CATALOG_NOT_VALIDATED",
      partsPlan: Object.freeze(plan.map((l) => Object.freeze(l))),
    }));
  }
  return Object.freeze({ planned: Object.freeze(planned), refused: Object.freeze(refused) });
}

/**
 * Build the copy plan. Pure: no database, no writes. Refuses -- never skips -- when ANY record is not
 * copyable under the contract, listing every record and reason, because silently skipping is how a
 * population shrinks unnoticed.
 */
export function buildCopyPlan(input: Parameters<typeof buildCopyPlanReport>[0]): readonly PlannedWorkOrder[] {
  const report = buildCopyPlanReport(input);
  if (report.refused.length > 0) {
    refuse("RECORD_NOT_COPYABLE",
      `${report.refused.length} record(s) are refused by the COPY contract: `
      + report.refused.map((r) => `${r.workOrderId} [${r.reasons.map((x) => `${x.code}:${x.field}`).join(", ")}]`).join("; "),
      report.refused);
  }
  return report.planned;
}

const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable)
  : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
    : v === undefined ? null : v;

/** A deterministic digest of a plan. Same source + same decisions = same digest, run after run. */
export function planDigest(plan: readonly PlannedWorkOrder[]): string {
  return createHash("sha256").update(JSON.stringify(stable(plan)), "utf8").digest("hex");
}

// ════════════════════ IDENTITY ════════════════════

export interface IdentityResolution {
  readonly employeesPresent: ReadonlySet<string>;
  readonly principalByUid: ReadonlyMap<string, string>;
  /** A planned assignee the target cannot hold. REFUSES the COPY. */
  readonly unresolvedAssignees: readonly { readonly workOrderId: string; readonly employeeId: string }[];
  /** A legacy actor uid with no Principal in this tenant. Recorded as NULL, truthfully, and reported. */
  readonly unresolvedActors: readonly { readonly workOrderId: string; readonly field: string }[];
}

/**
 * Resolve the plan's people against the TARGET's governed identity. READ ONLY.
 *
 * Assignees must be Employees of this tenant in eos_workforce. Actor uids resolve through
 * eos_policy.principals (identity_provider 'firebase') WITH a membership in this tenant -- a uid is never
 * written, and never treated as an Employee.
 */
export async function resolvePlanIdentities(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  plan: readonly PlannedWorkOrder[],
): Promise<IdentityResolution> {
  const employeeIds = [...new Set(plan.map((p) => p.assignment?.employeeId).filter((v): v is string => !!v))].sort();
  const uids = [...new Set(plan.flatMap((p) => [p.scheduleHistory?.changedByLegacyUid, p.legacyAssignment.reassignedByLegacyUid])
    .filter((v): v is string => !!v))].sort();
  const employeesPresent = new Set<string>();
  if (employeeIds.length > 0) {
    const { rows } = await db.query(
      "SELECT id FROM eos_workforce.employees WHERE tenant_id = $1 AND id = ANY($2::text[])", [tenantId, employeeIds]);
    for (const row of rows) employeesPresent.add(String(row.id));
  }
  const principalByUid = new Map<string, string>();
  if (uids.length > 0) {
    const { rows } = await db.query(
      `SELECT p.external_subject, p.id FROM eos_policy.principals p
         JOIN eos_policy.tenant_memberships m ON m.principal_id = p.id AND m.tenant_id = $1
        WHERE p.identity_provider = 'firebase' AND p.external_subject = ANY($2::text[])`,
      [tenantId, uids]);
    for (const row of rows) principalByUid.set(String(row.external_subject), String(row.id));
  }
  const unresolvedAssignees = plan
    .filter((p) => p.assignment && !employeesPresent.has(p.assignment.employeeId))
    .map((p) => Object.freeze({ workOrderId: p.workOrderId, employeeId: p.assignment!.employeeId }));
  const unresolvedActors: { workOrderId: string; field: string }[] = [];
  for (const p of plan) {
    const uid = p.scheduleHistory?.changedByLegacyUid;
    if (uid && !principalByUid.has(uid)) unresolvedActors.push({ workOrderId: p.workOrderId, field: "rescheduledByUid" });
    const by = p.legacyAssignment.reassignedByLegacyUid;
    if (by && !principalByUid.has(by)) unresolvedActors.push({ workOrderId: p.workOrderId, field: "reassignedByUid" });
  }
  return Object.freeze({
    employeesPresent, principalByUid,
    unresolvedAssignees: Object.freeze(unresolvedAssignees),
    unresolvedActors: Object.freeze(unresolvedActors.map((a) => Object.freeze(a))),
  });
}

// ════════════════════ READING THE TARGET, AND COMPARING ONE ROW ════════════════════

export const COPY_AUDIT_ACTION = "work_order.migration.copy";
const TS = (col: string): string => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

interface TargetWorkOrderState {
  readonly row: Record<string, unknown> | null;
  readonly assignments: string[];
  readonly scheduleHistory: string[];
  readonly transitions: string[];
  readonly partsPlan: string[];
  readonly salesOrderLines: number;
}

async function readTargetState(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  ids: readonly string[],
): Promise<Map<string, TargetWorkOrderState>> {
  const out = new Map<string, TargetWorkOrderState>(ids.map((id) => [id, {
    row: null, assignments: [], scheduleHistory: [], transitions: [], partsPlan: [], salesOrderLines: 0,
  }]));
  if (ids.length === 0) return out;
  const args = [tenantId, [...ids]];
  const { rows } = await db.query(
    `SELECT id, work_order_number, status::text AS status, work_order_type::text AS work_order_type, priority,
            severity::text AS severity, operating_company_key, customer_id, location_id, equipment_id, sales_order_id,
            ${TS("scheduled_start")} AS scheduled_start, ${TS("scheduled_end")} AS scheduled_end, estimated_duration_minutes,
            ${TS("dispatched_at")} AS dispatched_at, ${TS("accepted_at")} AS accepted_at, ${TS("en_route_at")} AS en_route_at,
            ${TS("arrived_at")} AS arrived_at, ${TS("work_started_at")} AS work_started_at,
            ${TS("completed_at")} AS completed_at, ${TS("closed_at")} AS closed_at,
            complaint, diagnosis, resolution, ${TS("parts_plan_updated_at")} AS parts_plan_updated_at,
            provenance::text AS provenance, created_by_principal_id, updated_by_principal_id,
            ${TS("created_at")} AS created_at, ${TS("updated_at")} AS updated_at
       FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND id = ANY($2::text[])`, args);
  for (const row of rows) (out.get(String(row.id)) as { row: unknown }).row = row;
  const push = (id: unknown, key: "assignments" | "scheduleHistory" | "transitions" | "partsPlan", tuple: unknown[]) =>
    out.get(String(id))?.[key].push(JSON.stringify(tuple));
  const a = await db.query(
    `SELECT work_order_id, id, assignee_employee_id, source, reason, ${TS("effective_from")} AS effective_from,
            assigned_by_principal_id, ${TS("effective_to")} AS effective_to, end_source, end_reason, ended_by_principal_id,
            provenance::text AS provenance, ${TS("recorded_at")} AS recorded_at
       FROM ${SCHEMA}.work_order_assignments WHERE tenant_id = $1 AND work_order_id = ANY($2::text[])`, args);
  for (const x of a.rows) {
    push(x.work_order_id, "assignments", [x.id, x.assignee_employee_id, x.source, x.reason, x.effective_from,
      x.assigned_by_principal_id, x.effective_to, x.end_source, x.end_reason, x.ended_by_principal_id, x.provenance, x.recorded_at]);
  }
  const s = await db.query(
    `SELECT work_order_id, id, ${TS("previous_start")} AS previous_start, ${TS("previous_end")} AS previous_end,
            ${TS("new_start")} AS new_start, ${TS("new_end")} AS new_end, reason, changed_by_principal_id,
            ${TS("changed_at")} AS changed_at, provenance::text AS provenance
       FROM ${SCHEMA}.work_order_schedule_history WHERE tenant_id = $1 AND work_order_id = ANY($2::text[])`, args);
  for (const x of s.rows) {
    push(x.work_order_id, "scheduleHistory", [x.id, x.previous_start, x.previous_end, x.new_start, x.new_end, x.reason,
      x.changed_by_principal_id, x.changed_at, x.provenance]);
  }
  const t = await db.query(
    `SELECT work_order_id, id, from_status::text AS from_status, to_status::text AS to_status, action,
            ${TS("occurred_at")} AS occurred_at, actor_principal_id, note, provenance::text AS provenance
       FROM ${SCHEMA}.work_order_transitions WHERE tenant_id = $1 AND work_order_id = ANY($2::text[])`, args);
  for (const x of t.rows) {
    push(x.work_order_id, "transitions", [x.id, x.from_status, x.to_status, x.action, x.occurred_at, x.actor_principal_id, x.note, x.provenance]);
  }
  const pp = await db.query(
    `SELECT work_order_id, part_id, qty_planned, planned_by, ${TS("planned_at")} AS planned_at, updated_by, ${TS("updated_at")} AS updated_at
       FROM ${SCHEMA}.work_order_parts_plan WHERE tenant_id = $1 AND work_order_id = ANY($2::text[])`, args);
  for (const x of pp.rows) {
    push(x.work_order_id, "partsPlan", [x.part_id, Number(x.qty_planned), x.planned_by, x.planned_at, x.updated_by, x.updated_at]);
  }
  const so = await db.query(
    `SELECT work_order_id, count(*)::int AS n FROM ${SCHEMA}.work_order_sales_order_lines
      WHERE tenant_id = $1 AND work_order_id = ANY($2::text[]) GROUP BY work_order_id`, args);
  for (const x of so.rows) (out.get(String(x.work_order_id)) as { salesOrderLines: number }).salesOrderLines = Number(x.n);
  return out;
}

interface RunRecordEntry {
  readonly auditEventId: string;
  readonly runId: string;
  readonly copiedAt: string;
  readonly sourceSha256: string;
}

/** The provenance records this COPY wrote, per Work Order. READ ONLY. */
async function readRunRecords(
  db: Pick<PoolClient, "query">,
  tenantId: string,
): Promise<Map<string, RunRecordEntry[]>> {
  const { rows } = await db.query(
    `SELECT id, after FROM eos_policy.audit_events WHERE tenant_id = $1 AND action = $2 ORDER BY occurred_at, id`,
    [tenantId, COPY_AUDIT_ACTION]);
  const out = new Map<string, RunRecordEntry[]>();
  for (const row of rows) {
    const after = (row.after ?? {}) as { runId?: string; copiedAt?: string; records?: { workOrderId?: string; sourceSha256?: string }[] };
    for (const rec of after.records ?? []) {
      if (!rec.workOrderId) continue;
      const list = out.get(rec.workOrderId) ?? [];
      list.push(Object.freeze({
        auditEventId: String(row.id), runId: String(after.runId ?? ""), copiedAt: String(after.copiedAt ?? ""),
        sourceSha256: String(rec.sourceSha256 ?? ""),
      }));
      out.set(rec.workOrderId, list);
    }
  }
  return out;
}

export type VerifyFindingKind = "SOURCE_CHANGED" | "TARGET_DIVERGED" | "UNRESOLVED_IDENTITY" | "MISSING_REQUIRED_FIELD" | "CHILD_ROW_MISMATCH" | "UNKNOWN";

export interface VerifyMismatch {
  readonly workOrderId: string;
  readonly field: string;
  readonly expected: string;
  readonly found: string;
  readonly kind: VerifyFindingKind;
}

const shown = (v: unknown): string => (v === null || v === undefined ? "(null)" : String(v));
const same = (a: unknown, b: unknown): boolean =>
  (a === null || a === undefined) ? (b === null || b === undefined) : (b !== null && b !== undefined && String(a) === String(b));

/** Compare ONE planned Work Order with what the target holds. Pure over the state already read. */
function compareWorkOrder(
  p: PlannedWorkOrder,
  target: TargetWorkOrderState,
  runs: readonly RunRecordEntry[] | undefined,
  identities: IdentityResolution,
): VerifyMismatch[] {
  const out: VerifyMismatch[] = [];
  const note = (kind: VerifyFindingKind, field: string, expected: unknown, found: unknown) =>
    out.push(Object.freeze({ workOrderId: p.workOrderId, field, expected: shown(expected), found: shown(found), kind }));
  const row = target.row;
  if (!row) {
    note("TARGET_DIVERGED", "row", "present", "absent");
    return out;
  }

  // ── provenance: the run record and the source fingerprint ──
  let copiedAt: string | null = null;
  if (!runs || runs.length === 0) {
    note("TARGET_DIVERGED", "provenance.runRecord", `one ${COPY_AUDIT_ACTION} record naming this Work Order`, "none");
  } else if (runs.length > 1) {
    note("UNKNOWN", "provenance.runRecord", "exactly one run record", `${runs.length} records (${runs.map((r) => r.runId).join(", ")})`);
  } else {
    copiedAt = runs[0].copiedAt;
    if (runs[0].sourceSha256 !== p.sourceSha256) note("SOURCE_CHANGED", "source.sha256", runs[0].sourceSha256, p.sourceSha256);
  }

  // ── the Work Order's own facts ──
  const facts: [string, unknown, unknown][] = [
    ["woNumber", p.woNumber, row.work_order_number],
    ["status", p.status, row.status],
    ["type", p.targetType, row.work_order_type],
    ["priority", p.priority, row.priority],
    ["severity", p.severity, row.severity],
    ["operating_company_key", p.operatingCompanyKey, row.operating_company_key],
    ["customerId", p.customerId, row.customer_id],
    ["locationId", p.locationId, row.location_id],
    ["equipmentId", p.equipmentId, row.equipment_id],
    ["salesOrderId", p.salesOrderId, row.sales_order_id],
    ["complaint", p.complaint, row.complaint],
    ["diagnosis", p.diagnosis, row.diagnosis],
    ["resolution", p.resolution, row.resolution],
    ["estimatedDurationMinutes", p.estimatedDurationMinutes, row.estimated_duration_minutes],
    ["scheduledStart", p.scheduledStart, row.scheduled_start],
    ["scheduledEnd", p.scheduledEnd, row.scheduled_end],
    ["dispatchedAt", p.dispatchedAt, row.dispatched_at],
    ["acceptedAt", p.acceptedAt, row.accepted_at],
    ["enRouteAt", p.enRouteAt, row.en_route_at],
    ["arrivedAt", p.arrivedAt, row.arrived_at],
    ["workStartedAt", p.workStartedAt, row.work_started_at],
    ["completedAt", p.completedAt, row.completed_at],
    ["closedAt", p.closedAt, row.closed_at],
    ["partsPlanUpdatedAt", p.partsPlanUpdatedAt, row.parts_plan_updated_at],
    // PROVENANCE IS VERIFIED, not assumed: a migrated record that claimed NATIVE would be a Work Order
    // asserting a creation event that never happened.
    ["provenance", "MIGRATED", row.provenance],
    ["createdByPrincipalId", null, row.created_by_principal_id],
    ["updatedByPrincipalId", null, row.updated_by_principal_id],
    ["createdAt", p.createdAt, row.created_at],
    ["updatedAt", p.updatedAt, row.updated_at],
  ];
  for (const [field, expected, found] of facts) {
    if (!same(expected, found)) note("TARGET_DIVERGED", field, expected, found);
  }

  // ── child rows ──
  const migrationActor = `migration:${p.decisionId}`;
  const run = copiedAt ?? "(run record missing)";
  const children: [string, string[], string[]][] = [
    ["assignments", p.assignment ? [JSON.stringify([p.assignment.id, p.assignment.employeeId, "MIGRATION", p.assignment.reason,
      p.assignment.effectiveFrom ?? run, null, null, null, null, null, "MIGRATED", run])] : [], target.assignments],
    ["scheduleHistory", p.scheduleHistory ? [JSON.stringify([p.scheduleHistory.id, p.scheduleHistory.previousStart,
      p.scheduleHistory.previousEnd, p.scheduleHistory.newStart, p.scheduleHistory.newEnd, p.scheduleHistory.reason,
      p.scheduleHistory.changedByLegacyUid ? identities.principalByUid.get(p.scheduleHistory.changedByLegacyUid) ?? null : null,
      p.scheduleHistory.changedAt, "MIGRATED"])] : [], target.scheduleHistory],
    ["transitions", p.transitions.map((x) => JSON.stringify([x.id, null, x.toStatus, x.action, x.occurredAt, null, x.note, "MIGRATED"])),
      target.transitions],
    ["partsPlan", p.partsPlan.map((l) => JSON.stringify([l.partId, l.qtyPlanned, migrationActor, run, migrationActor, run])),
      target.partsPlan],
  ];
  for (const [field, expected, found] of children) {
    const e = [...expected].sort();
    const f = [...found].sort();
    if (e.join("\n") !== f.join("\n")) {
      note("CHILD_ROW_MISMATCH", field, `${e.length} row(s): ${e.join(" | ") || "none"}`, `${f.length} row(s): ${f.join(" | ") || "none"}`);
    }
  }
  if (target.salesOrderLines !== 0) note("CHILD_ROW_MISMATCH", "salesOrderLines", "0 row(s)", `${target.salesOrderLines} row(s)`);
  if (p.assignment && !identities.employeesPresent.has(p.assignment.employeeId)) {
    note("UNRESOLVED_IDENTITY", "assignment.employee", `${p.assignment.employeeId} in eos_workforce.employees`, "absent");
  }
  return out;
}

export type TargetCollisionResult = "TARGET_ABSENT" | "ALREADY_PRESENT_EQUIVALENT" | "TARGET_CONFLICT";

export interface TargetCollisionDetail {
  readonly result: TargetCollisionResult;
  readonly findings: readonly VerifyMismatch[];
}

/**
 * Classify every planned record against the target. INSERT-ONLY evidence: SAME ID IS NOT EQUIVALENCE --
 * a present row is ALREADY_PRESENT_EQUIVALENT only when EVERY contracted fact and child row matches.
 */
export async function recheckTargetCollisionDetails(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  plan: readonly PlannedWorkOrder[],
  identities?: IdentityResolution,
): Promise<ReadonlyMap<string, TargetCollisionDetail>> {
  if (plan.length === 0) return new Map();
  const ids = plan.map((p) => p.workOrderId);
  const resolved = identities ?? await resolvePlanIdentities(db, tenantId, plan);
  const state = await readTargetState(db, tenantId, ids);
  const runs = await readRunRecords(db, tenantId);
  return new Map(plan.map((p) => {
    const target = state.get(p.workOrderId)!;
    if (!target.row) {
      // A child row with no parent cannot exist (FKs), so absence of the Work Order is absence.
      return [p.workOrderId, Object.freeze({ result: "TARGET_ABSENT" as TargetCollisionResult, findings: Object.freeze([]) })];
    }
    const findings = compareWorkOrder(p, target, runs.get(p.workOrderId), resolved);
    return [p.workOrderId, Object.freeze({
      result: (findings.length === 0 ? "ALREADY_PRESENT_EQUIVALENT" : "TARGET_CONFLICT") as TargetCollisionResult,
      findings: Object.freeze(findings),
    })];
  }));
}

/** Re-check collisions immediately before applying. Governed facts, never id alone. */
export async function recheckTargetCollisions(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  plan: readonly PlannedWorkOrder[],
): Promise<ReadonlyMap<string, TargetCollisionResult>> {
  const details = await recheckTargetCollisionDetails(db, tenantId, plan);
  return new Map([...details].map(([id, d]) => [id, d.result]));
}

// ════════════════════ COPY ONCE ════════════════════

export interface CopyOutcome {
  readonly runId: string;
  readonly applied: boolean;
  readonly planDigest: string;
  /** The ONE migration instant of this run. NULL on a dry run, so a dry run is deterministic. */
  readonly copiedAt: string | null;
  readonly inserted: number;
  readonly alreadyPresentEquivalent: number;
  readonly conflicts: number;
  readonly assignmentsInserted: number;
  readonly scheduleHistoryInserted: number;
  readonly transitionsInserted: number;
  readonly partsPlanRowsInserted: number;
  readonly provenanceAuditEventId: string | null;
  readonly unresolvedActors: IdentityResolution["unresolvedActors"];
  readonly collisions: ReadonlyMap<string, TargetCollisionResult>;
}

/**
 * COPY ONCE.
 *
 * `apply` defaults FALSE. Both paths share one plan, one identity check and one collision recheck, so the
 * dry outcome is the same computation the applying outcome performs.
 *
 * ONE TRANSACTION, ALL OR NOTHING. INSERT ONLY: there is no UPSERT, no UPDATE, no DELETE and no conflict
 * repair. A present-and-different record refuses the whole COPY with its findings; a present-and-equal one
 * is left alone. AN EXACT REPLAY WRITES NOTHING -- not even a provenance record.
 *
 * HISTORICAL INSTANTS ARE PASSED EXPLICITLY. The only instant this function supplies is `copiedAt`, once
 * per run, for fields that describe the migration itself (the run record, a MIGRATION_INSTANT assignment
 * start, the Parts Plan's planned_at) -- and it is recorded, so VERIFY can check it.
 */
export async function copyOnce(
  pool: Pool,
  input: {
    readonly tenantId: string;
    readonly runId: string;
    readonly plan: readonly PlannedWorkOrder[];
    readonly decisionId: string;
    readonly apply?: boolean;
    /** Who ran it -- the audit actor. Defaults to `migration:<decisionId>`. */
    readonly performedBy?: string;
    /** Injected clock for the run instant (tests). Never used for a historical field. */
    readonly now?: Date;
  },
): Promise<CopyOutcome> {
  const apply = input.apply === true;
  const drifted = input.plan.filter((p) => p.decisionId !== input.decisionId).map((p) => p.workOrderId);
  if (drifted.length > 0) {
    refuse("DECISION_MISMATCH", `the plan was built under a different decision than '${input.decisionId}': ${drifted.sort().join(", ")}`);
  }
  const digest = planDigest(input.plan);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // PREFLIGHT ALL RECORDS BEFORE THE FIRST INSERT: identity, then collisions.
    const identities = await resolvePlanIdentities(client, input.tenantId, input.plan);
    if (identities.unresolvedAssignees.length > 0) {
      refuse("UNRESOLVED_IDENTITY",
        `${identities.unresolvedAssignees.length} planned assignee(s) are not Employees of this tenant: `
        + identities.unresolvedAssignees.map((u) => `${u.workOrderId} -> ${u.employeeId}`).join(", ")
        + ". The whole COPY is refused; no Employee is invented and no Work Order arrives with a dangling assignee.",
        identities.unresolvedAssignees);
    }
    const details = await recheckTargetCollisionDetails(client, input.tenantId, input.plan, identities);
    const collisions = new Map([...details].map(([id, d]) => [id, d.result]));
    const conflicts = [...details].filter(([, d]) => d.result === "TARGET_CONFLICT");
    if (conflicts.length > 0) {
      refuse("TARGET_CONFLICT",
        `${conflicts.length} record(s) already exist in the target with different governed facts: `
        + conflicts.map(([id, d]) => `${id} [${d.findings.map((f) => f.field).join(", ")}]`).sort().join("; ")
        + ". The whole COPY is refused; this tool never overwrites.",
        Object.fromEntries(conflicts.map(([id, d]) => [id, d.findings])));
    }
    const toInsert = input.plan.filter((p) => collisions.get(p.workOrderId) === "TARGET_ABSENT");
    const alreadyPresent = input.plan.length - toInsert.length;

    let copiedAt: string | null = null;
    let assignments = 0;
    let schedules = 0;
    let transitions = 0;
    let partsPlanRows = 0;
    let auditId: string | null = null;
    if (apply) {
      const clock = toTimestamptz(input.now ?? new Date());
      if (!clock.ok || clock.value === null) throw new Error("the run clock is not a usable instant");
      copiedAt = clock.value;
      const actor = `migration:${input.decisionId}`;
      for (const p of toInsert) {
        const cols: [string, unknown, string][] = [
          ["id", p.workOrderId, ""], ["tenant_id", input.tenantId, ""], ["operating_company_key", p.operatingCompanyKey, ""],
          ["work_order_number", p.woNumber, ""],
          ["status", p.status, `::${SCHEMA}.ops_work_order_status`],
          ["work_order_type", p.targetType, `::${SCHEMA}.ops_work_order_type`],
          ["priority", p.priority, ""],
          ["severity", p.severity, `::${SCHEMA}.ops_work_order_severity`],
          ["customer_id", p.customerId, ""], ["location_id", p.locationId, ""],
          ["equipment_id", p.equipmentId, ""], ["sales_order_id", p.salesOrderId, ""],
          ["scheduled_start", p.scheduledStart, "::timestamptz"], ["scheduled_end", p.scheduledEnd, "::timestamptz"],
          ["estimated_duration_minutes", p.estimatedDurationMinutes, ""],
          ["dispatched_at", p.dispatchedAt, "::timestamptz"], ["accepted_at", p.acceptedAt, "::timestamptz"],
          ["en_route_at", p.enRouteAt, "::timestamptz"], ["arrived_at", p.arrivedAt, "::timestamptz"],
          ["work_started_at", p.workStartedAt, "::timestamptz"], ["completed_at", p.completedAt, "::timestamptz"],
          ["closed_at", p.closedAt, "::timestamptz"],
          ["complaint", p.complaint, ""], ["diagnosis", p.diagnosis, ""], ["resolution", p.resolution, ""],
          ["parts_plan_updated_at", p.partsPlanUpdatedAt, "::timestamptz"],
          ["provenance", "MIGRATED", `::${SCHEMA}.ops_work_order_provenance`],
          ["created_by_principal_id", null, ""], ["updated_by_principal_id", null, ""],
          // THE LEGACY INSTANTS, EXPLICITLY. Never the clock.
          ["created_at", p.createdAt, "::timestamptz"], ["updated_at", p.updatedAt, "::timestamptz"],
        ];
        await client.query(
          `INSERT INTO ${SCHEMA}.work_orders (${cols.map((c) => c[0]).join(", ")})
           VALUES (${cols.map((c, i) => `$${i + 1}${c[2]}`).join(", ")})`,
          cols.map((c) => c[1]));
        if (p.assignment) {
          await client.query(
            `INSERT INTO ${SCHEMA}.work_order_assignments
               (id, tenant_id, work_order_id, assignee_employee_id, source, reason, effective_from,
                assigned_by_principal_id, provenance, recorded_at)
             VALUES ($1,$2,$3,$4,'MIGRATION',$5,$6::timestamptz,NULL,'MIGRATED',$7::timestamptz)`,
            [p.assignment.id, input.tenantId, p.workOrderId, p.assignment.employeeId, p.assignment.reason,
             p.assignment.effectiveFrom ?? copiedAt, copiedAt]);
          assignments += 1;
        }
        if (p.scheduleHistory) {
          const h = p.scheduleHistory;
          await client.query(
            `INSERT INTO ${SCHEMA}.work_order_schedule_history
               (id, tenant_id, work_order_id, previous_start, previous_end, new_start, new_end, reason,
                changed_by_principal_id, changed_at, provenance)
             VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::timestamptz,$7::timestamptz,$8,$9,$10::timestamptz,'MIGRATED')`,
            [h.id, input.tenantId, p.workOrderId, h.previousStart, h.previousEnd, h.newStart, h.newEnd, h.reason,
             h.changedByLegacyUid ? identities.principalByUid.get(h.changedByLegacyUid) ?? null : null, h.changedAt]);
          schedules += 1;
        }
        for (const x of p.transitions) {
          await client.query(
            `INSERT INTO ${SCHEMA}.work_order_transitions
               (id, tenant_id, work_order_id, from_status, to_status, action, occurred_at, actor_principal_id, note, provenance)
             VALUES ($1,$2,$3,NULL,$4::${SCHEMA}.ops_work_order_status,$5,$6::timestamptz,NULL,$7,'MIGRATED')`,
            [x.id, input.tenantId, p.workOrderId, x.toStatus, x.action, x.occurredAt, x.note]);
          transitions += 1;
        }
        for (const line of p.partsPlan) {
          await client.query(
            `INSERT INTO ${SCHEMA}.work_order_parts_plan
               (tenant_id, work_order_id, part_id, qty_planned, planned_at, planned_by, updated_at, updated_by)
             VALUES ($1,$2,$3,$4,$5::timestamptz,$6,$5::timestamptz,$6)`,
            [input.tenantId, p.workOrderId, line.partId, line.qtyPlanned, copiedAt, actor]);
          partsPlanRows += 1;
        }
      }
      if (toInsert.length > 0) {
        // THE RUN RECORD (the C5 convention): source id, source fingerprint, run id, copy instant -- the
        // copy instant kept apart from every historical created_at. Uids are never written; only what
        // they resolved to.
        const principalOrUnresolved = (uid: string | null) => (uid ? identities.principalByUid.get(uid) ?? "UNRESOLVED" : null);
        auditId = `audit_${randomUUID()}`;
        await client.query(
          `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
           VALUES ($1,$2,$3,$4,'work_order_snapshot',$5,NULL,$6::jsonb,$7::timestamptz,$8)`,
          [auditId, input.tenantId, COPY_AUDIT_ACTION, input.performedBy ?? actor, toInsert[0].snapshotBodySha256,
           JSON.stringify({
             runId: input.runId, decisionId: input.decisionId, snapshotBodySha256: toInsert[0].snapshotBodySha256,
             copiedAt, planDigest: digest, contract: "docs/engineering/work-order-migration-copy-contract-2026-09-26.md",
             inserted: { workOrders: toInsert.length, assignments, scheduleHistory: schedules, transitions, partsPlanRows },
             records: toInsert.map((p) => ({
               workOrderId: p.workOrderId, sourceSha256: p.sourceSha256,
               sourceType: p.sourceType, typeResolution: p.typeResolution,
               severityRaw: p.severityRaw, severityDisposition: p.severityDisposition, cancelledAt: p.cancelledAt,
               assignmentDisposition: p.assignmentDisposition, legacyTechnicianReference: p.legacyTechnicianReference,
               assignment: p.assignment ? { employeeId: p.assignment.employeeId, basis: p.assignment.basis,
                 sourceField: p.assignment.sourceField, technicianId: p.assignment.technicianId } : null,
               legacyAssignment: {
                 assignedTechId: p.legacyAssignment.assignedTechId, scheduledTechId: p.legacyAssignment.scheduledTechId,
                 reassignedFromTechId: p.legacyAssignment.reassignedFromTechId, reassignedAt: p.legacyAssignment.reassignedAt,
                 reassignedReason: p.legacyAssignment.reassignedReason,
                 reassignedBy: principalOrUnresolved(p.legacyAssignment.reassignedByLegacyUid),
                 rescheduledFromTechId: p.legacyAssignment.rescheduledFromTechId,
                 rescheduledBy: principalOrUnresolved(p.scheduleHistory?.changedByLegacyUid ?? null),
               },
             })),
           }), copiedAt,
           "Work Order one-time migration COPY (docs/engineering/work-order-migration-copy-contract-2026-09-26.md)"]);
      }
      await client.query("COMMIT");
    } else {
      // The preview reaches exactly the same decisions and then leaves the database as it found it.
      await client.query("ROLLBACK");
    }
    return Object.freeze({
      runId: input.runId, applied: apply, planDigest: digest, copiedAt,
      inserted: apply ? toInsert.length : 0,
      alreadyPresentEquivalent: alreadyPresent,
      conflicts: 0,
      assignmentsInserted: assignments,
      scheduleHistoryInserted: schedules,
      transitionsInserted: transitions,
      partsPlanRowsInserted: partsPlanRows,
      provenanceAuditEventId: auditId,
      unresolvedActors: identities.unresolvedActors,
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

export const VERIFY_CLASSIFICATIONS = Object.freeze([
  "MATCH", "SOURCE_CHANGED", "TARGET_DIVERGED", "UNRESOLVED_IDENTITY", "MISSING_REQUIRED_FIELD", "CHILD_ROW_MISMATCH", "UNKNOWN",
] as const);
export type VerifyClassification = (typeof VERIFY_CLASSIFICATIONS)[number];
/** When one row carries several findings, the most consequential names it. All are reported. */
const CLASSIFICATION_PRECEDENCE: readonly VerifyFindingKind[] = Object.freeze([
  "UNRESOLVED_IDENTITY", "MISSING_REQUIRED_FIELD", "SOURCE_CHANGED", "TARGET_DIVERGED", "CHILD_ROW_MISMATCH", "UNKNOWN",
]);

export interface VerifyRow {
  readonly workOrderId: string;
  readonly classification: VerifyClassification;
  readonly findings: readonly VerifyMismatch[];
}

export interface VerifyReport {
  readonly checked: number;
  readonly missing: readonly string[];
  readonly mismatches: readonly VerifyMismatch[];
  readonly rows: readonly VerifyRow[];
  readonly byClassification: Readonly<Record<VerifyClassification, number>>;
  readonly counts: {
    readonly planned: number;
    readonly refused: number;
    readonly targetPresent: number;
    readonly assignments: { readonly expected: number; readonly found: number };
    readonly scheduleHistory: { readonly expected: number; readonly found: number };
    readonly transitions: { readonly expected: number; readonly found: number };
    readonly partsPlan: { readonly expected: number; readonly found: number };
    readonly salesOrderLines: { readonly expected: number; readonly found: number };
  };
  /** MIGRATED target rows outside this population. Any one fails VERIFY. */
  readonly unexpectedTargetIds: readonly string[];
  readonly ok: boolean;
}

const classify = (findings: readonly VerifyMismatch[]): VerifyClassification =>
  findings.length === 0 ? "MATCH" : CLASSIFICATION_PRECEDENCE.find((k) => findings.some((f) => f.kind === k)) ?? "UNKNOWN";

/**
 * VERIFY -- an INDEPENDENT read-only phase.
 *
 * It compares the target against the SAME bound plan -- which is the source, contracted -- field by field
 * and child row by child row, and it REPAIRS NOTHING. `refused` (from buildCopyPlanReport) folds the
 * records the contract refused into the same per-row report, so VERIFY can never say "all good" about a
 * population it silently shrank. `ok` only when every row is MATCH and no unexpected row exists.
 */
export async function verifyCopy(
  db: Pick<PoolClient, "query">,
  tenantId: string,
  plan: readonly PlannedWorkOrder[],
  options: { readonly refused?: readonly PlanRefusal[] } = {},
): Promise<VerifyReport> {
  const refused = options.refused ?? [];
  const empty = Object.fromEntries(VERIFY_CLASSIFICATIONS.map((c) => [c, 0])) as Record<VerifyClassification, number>;
  const zero = { expected: 0, found: 0 };
  if (plan.length === 0 && refused.length === 0) {
    return Object.freeze({
      checked: 0, missing: [], mismatches: [], rows: [], byClassification: Object.freeze(empty),
      counts: { planned: 0, refused: 0, targetPresent: 0, assignments: zero, scheduleHistory: zero, transitions: zero, partsPlan: zero, salesOrderLines: zero },
      unexpectedTargetIds: [], ok: true,
    });
  }
  const identities = await resolvePlanIdentities(db, tenantId, plan);
  const state = await readTargetState(db, tenantId, plan.map((p) => p.workOrderId));
  const runs = await readRunRecords(db, tenantId);

  const rows: VerifyRow[] = [];
  const missing: string[] = [];
  const mismatches: VerifyMismatch[] = [];
  for (const p of plan) {
    const target = state.get(p.workOrderId)!;
    if (!target.row) missing.push(p.workOrderId);
    const findings = compareWorkOrder(p, target, runs.get(p.workOrderId), identities);
    mismatches.push(...findings);
    rows.push(Object.freeze({ workOrderId: p.workOrderId, classification: classify(findings), findings: Object.freeze(findings) }));
  }
  for (const r of refused) {
    const findings = r.reasons.map((x) => Object.freeze({
      workOrderId: r.workOrderId, field: x.field, expected: "a value the COPY contract can carry",
      found: `${x.code}: ${x.detail}`, kind: x.category as VerifyFindingKind,
    }));
    rows.push(Object.freeze({ workOrderId: r.workOrderId, classification: classify(findings), findings: Object.freeze(findings) }));
  }
  rows.sort((a, b) => (a.workOrderId < b.workOrderId ? -1 : a.workOrderId > b.workOrderId ? 1 : 0));
  const byClassification = { ...empty };
  for (const row of rows) byClassification[row.classification] += 1;

  const expectedIds = [...plan.map((p) => p.workOrderId), ...refused.map((r) => r.workOrderId)];
  const { rows: extra } = await db.query(
    `SELECT id FROM ${SCHEMA}.work_orders WHERE tenant_id = $1 AND provenance = 'MIGRATED' AND NOT (id = ANY($2::text[])) ORDER BY id`,
    [tenantId, expectedIds]);
  const unexpectedTargetIds = extra.map((r) => String(r.id));

  const targets = [...state.values()];
  const sum = (f: (s: TargetWorkOrderState) => number) => targets.reduce((n, s) => n + f(s), 0);
  const counts = {
    planned: plan.length,
    refused: refused.length,
    targetPresent: targets.filter((s) => s.row).length,
    assignments: { expected: plan.filter((p) => p.assignment).length, found: sum((s) => s.assignments.length) },
    scheduleHistory: { expected: plan.filter((p) => p.scheduleHistory).length, found: sum((s) => s.scheduleHistory.length) },
    transitions: { expected: plan.reduce((n, p) => n + p.transitions.length, 0), found: sum((s) => s.transitions.length) },
    partsPlan: { expected: plan.reduce((n, p) => n + p.partsPlan.length, 0), found: sum((s) => s.partsPlan.length) },
    salesOrderLines: { expected: 0, found: sum((s) => s.salesOrderLines) },
  };
  return Object.freeze({
    checked: plan.length,
    missing: Object.freeze(missing.sort()),
    mismatches: Object.freeze(mismatches),
    rows: Object.freeze(rows),
    byClassification: Object.freeze(byClassification),
    counts,
    unexpectedTargetIds: Object.freeze(unexpectedTargetIds),
    ok: rows.every((r) => r.classification === "MATCH") && unexpectedTargetIds.length === 0,
  });
}
