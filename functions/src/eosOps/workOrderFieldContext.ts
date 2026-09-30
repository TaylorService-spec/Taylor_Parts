// THE EOS WORK ORDER FIELD CONTEXT -- "who is the customer, which site am I going to, what am I working on, and what
// parts are planned", for ONE Work Order, from governed sources only.
//
// Owner DECISION 7: "Build the EOS field-context response from governed sources: Work Order, CRM customer/site,
// Equipment where PostgreSQL authority exists, Catalog/parts plan, Technician assignment, available execution
// facts. If a subdomain is not activated: return its explicit availability state. Do not call Firebase to fill the
// gap."
//
// ════════════════════ WHAT IS PRESERVED FROM getWorkOrderFieldContext.ts ════════════════════
//
//   * THE REQUEST CARRIES workOrderId ONLY. Every other id read here is one the governed Work Order already
//     contains, on a Work Order the caller is already authorized to read -- so this is a projection of the
//     caller's work, never a customer-lookup API.
//   * customer { state, displayName } and site { state, displayLabel } keep the F1 vocabulary: RESOLVED (a canonical
//     display value), ABSENT (no reference), UNRESOLVED (a reference whose canonical record gives no usable value).
//     The raw id is never emitted as a display fallback. A DENIAL is never one of these -- it is a refusal.
//   * The site label is the location's own name, qualified by city/state -- the canonical CRM fields.
//
// WHAT CHANGED: the gate. Firebase was technician-only by a role string and a users/{uid}.technicianId. Here it is
// the entitled per-record Work Order read (workOrderRecordRead.ts): workOrder.record.read, decided against the
// governed assignment when Administration conditioned the grant (a technician reads only their own), and held
// unconditionally by the office. The same gate readWorkOrderDetail uses; no second model.
//
// ════════════════════ EVERY SUBDOMAIN SAYS WHETHER IT IS AVAILABLE ════════════════════
//
//   workOrder, customer, site, assignment, execution   PostgreSQL Work Order + CRM authority       AVAILABLE
//   equipment                                           eos_ops.equipment + Catalog models         AVAILABLE | NOT_APPLICABLE
//     .custody                                          serialized custody / install               NOT_YET_ACTIVATED
//   parts                                               the plan, named by the PostgreSQL Catalog  AVAILABLE
//   inventory                                           stock balance / reservation                NOT_YET_ACTIVATED
//
// Nothing here reads Firestore -- not the frozen Catalog, not accounts/locations, not fieldops_wos.
import type { Pool } from "pg";
import type { ContextualReader } from "./contextualAuthorization";
import type { OperationalActor } from "./entitledActionAuthority";
import { WorkOrderLifecycleError } from "./workOrderLifecycle";
import { isQuarantined, WORK_ORDER_QUARANTINED, WORK_ORDER_QUARANTINED_MESSAGE } from "./workOrderQuarantine";
import { authorizeWorkOrderRecordRead, readWorkOrderPartsPlanGoverned } from "./workOrderRecordRead";
import { readWorkOrderExecution } from "./workOrderExecution";
import { readPartsByIds, PART_BY_IDS_MAX } from "../catalogMaster/postgresCatalogReads";
import { EQUIPMENT_MODEL_SELECT, equipmentModelFromRow, type CanonicalPart } from "../catalogMaster/catalogRows";
import type { WorkOrderOp } from "./workOrderOperationTypes";

const SCHEMA = "eos_ops";

export type SubdomainAvailability = "AVAILABLE" | "NOT_YET_ACTIVATED" | "NOT_APPLICABLE";
export type FieldContextState = "RESOLVED" | "ABSENT" | "UNRESOLVED";

/** The inventory boundary, stated identically wherever it appears. Nothing behind it is read or invented. */
export const INVENTORY_NOT_YET_ACTIVATED = Object.freeze({
  state: "NOT_YET_ACTIVATED" as const,
  boundary: "INVENTORY_BALANCE",
  message: "Inventory readiness is not activated yet: no stock balance, reservation or truck quantity is read.",
});

const refuse = (code: string, category: WorkOrderLifecycleError["category"], message: string): never => {
  throw new WorkOrderLifecycleError(code, category, message);
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const dateOnly = (v: unknown): string | null => (v ? new Date(v as string).toISOString().slice(0, 10) : null);
const personName = (r: Record<string, unknown>): string | null => {
  if (text(r.preferred_name)) return text(r.preferred_name);
  if (text(r.display_name)) return text(r.display_name);
  const joined = [r.first_name, r.last_name].filter((v) => typeof v === "string" && v !== "").join(" ");
  return joined === "" ? null : joined;
};

type Deps = { readonly pool: Pool; readonly reader: ContextualReader };

/**
 * The shared front half of both field reads: the input shape, the entitled per-record decision, and the governed
 * Work Order row (with its assignment, customer and site). Refuses before anything is read for a caller the
 * decision does not allow; a real id and a guessed one refuse identically.
 */
export async function readAuthorizedWorkOrderRow(
  deps: Deps, actor: OperationalActor, input: Record<string, unknown>,
): Promise<{ readonly workOrderId: string; readonly row: Record<string, unknown> }> {
  const extra = Object.keys(input ?? {}).filter((k) => k !== "workOrderId");
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this read does not accept: ${extra.sort().join(", ")}`);
  const workOrderId = input?.workOrderId as string;
  const decision = await authorizeWorkOrderRecordRead(deps.reader, actor, workOrderId);
  if (!decision.allowed) refuse(String(decision.outcome), "FORBIDDEN", "this Work Order may not be read by this caller");
  const { rows } = await deps.pool.query(
    `SELECT w.id, w.work_order_number, w.status::text AS status, w.work_order_type::text AS work_order_type, w.priority,
            w.severity::text AS severity, w.complaint, w.diagnosis, w.resolution, w.scheduled_start, w.scheduled_end,
            w.estimated_duration_minutes, w.customer_id, w.location_id, w.equipment_id,
            w.accepted_at, w.en_route_at, w.arrived_at, w.work_started_at, w.completed_at,
            acct.id AS acct_id, acct.name AS acct_name,
            loc.id AS loc_id, loc.name AS loc_name, loc.address_street, loc.address_city, loc.address_state,
            loc.address_postal_code, loc.access_notes,
            a.assignee_employee_id, e.preferred_name, e.display_name, e.first_name, e.last_name
       FROM ${SCHEMA}.work_orders w
       LEFT JOIN ${SCHEMA}.work_order_assignments a ON a.tenant_id = w.tenant_id AND a.work_order_id = w.id AND a.effective_to IS NULL
       LEFT JOIN eos_workforce.employees e ON e.tenant_id = a.tenant_id AND e.id = a.assignee_employee_id
       LEFT JOIN eos_crm.accounts acct ON acct.tenant_id = w.tenant_id AND acct.id = w.customer_id
       LEFT JOIN eos_crm.account_locations loc ON loc.tenant_id = w.tenant_id AND loc.id = w.location_id
      WHERE w.tenant_id = $1 AND w.id = $2`,
    [actor.tenantId, workOrderId]);
  if (rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "the Work Order does not exist in this tenant");
  if (await isQuarantined(deps.pool, actor.tenantId, workOrderId)) refuse(WORK_ORDER_QUARANTINED, "PRECONDITION_FAILED", WORK_ORDER_QUARANTINED_MESSAGE);
  return { workOrderId, row: rows[0] };
}

export interface FieldPartLine {
  readonly partId: string;
  readonly name: string | null;
  readonly internalPartNumber: string | null;
  readonly catalog: "RESOLVED" | "UNRESOLVED";
  readonly qtyPlanned: number;
  readonly qtyUsed: number;
}

/**
 * The planned Parts with their recorded actuals, named by the PostgreSQL Catalog through its governed by-id read.
 * A plan line whose Part the Catalog cannot name is UNRESOLVED, never given a guessed name.
 */
export async function readPlannedPartLines(deps: Deps, actor: OperationalActor, workOrderId: string): Promise<readonly FieldPartLine[]> {
  const plan = await readWorkOrderPartsPlanGoverned({ db: deps.pool, reader: deps.reader }, actor, workOrderId);
  const execution = await readWorkOrderExecution(deps.pool, actor.tenantId, workOrderId);
  const usedByPart = new Map(execution.parts.map((p) => [p.partId, p.qtyUsed]));
  const ids = plan.map((l) => l.partId);
  const parts = new Map<string, CanonicalPart>();
  for (let i = 0; i < ids.length; i += PART_BY_IDS_MAX) {
    for (const p of await readPartsByIds(deps.pool, actor.tenantId, ids.slice(i, i + PART_BY_IDS_MAX))) parts.set(p.id, p);
  }
  return Object.freeze(plan.map((l) => {
    const part = parts.get(l.partId);
    return Object.freeze({
      partId: l.partId, name: part?.name ?? null, internalPartNumber: part?.internalPartNumber ?? null,
      catalog: part ? "RESOLVED" as const : "UNRESOLVED" as const,
      qtyPlanned: l.qtyPlanned, qtyUsed: usedByPart.get(l.partId) ?? 0,
    });
  }));
}

/** The site label: the location's own name, qualified by city/state when present (the F1 rule). */
function siteLabel(r: Record<string, unknown>): string | null {
  const name = text(r.loc_name);
  if (!name) return null;
  const place = [text(r.address_city), text(r.address_state)].filter(Boolean).join(", ");
  return place ? `${name} — ${place}` : name;
}

async function assembleFieldContext(deps: Deps, actor: OperationalActor, input: Record<string, unknown>) {
  const { workOrderId, row: r } = await readAuthorizedWorkOrderRow(deps, actor, input);
  const customerName = text(r.acct_name);
  const label = siteLabel(r);

  let equipment: Record<string, unknown>;
  if (!r.equipment_id) {
    equipment = { state: "NOT_APPLICABLE" as const, equipment: null, model: null };
  } else {
    // The Equipment on the Work Order is part of the Work Order's own record, read through THIS gate -- not a
    // tenant-wide Equipment read. Its model is named by the PostgreSQL Catalog's equipment model row.
    const eq = (await deps.pool.query(
      `SELECT id, name, status::text AS status, serial_number, asset_tag, equipment_model_id, installed_on, warranty_expires_on
         FROM ${SCHEMA}.equipment WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, r.equipment_id])).rows[0];
    const modelRow = eq?.equipment_model_id
      ? (await deps.pool.query(`${EQUIPMENT_MODEL_SELECT} WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, eq.equipment_model_id])).rows[0]
      : undefined;
    const model = modelRow ? equipmentModelFromRow(modelRow) : null;
    equipment = eq ? {
      state: "AVAILABLE" as const,
      equipment: Object.freeze({
        equipmentId: String(eq.id), name: String(eq.name), status: String(eq.status), serialNumber: eq.serial_number ?? null,
        assetTag: eq.asset_tag ?? null, equipmentModelId: eq.equipment_model_id ?? null,
        installedOn: dateOnly(eq.installed_on), warrantyExpiresOn: dateOnly(eq.warranty_expires_on),
      }),
      model: model ? Object.freeze({ equipmentModelId: model.id, displayName: model.displayName, manufacturerName: model.manufacturerName,
        modelNumber: model.modelNumber }) : null,
    } : { state: "AVAILABLE" as const, equipment: null, model: null, reference: "UNRESOLVED" as const };
  }

  const execution = await readWorkOrderExecution(deps.pool, actor.tenantId, workOrderId);
  const callerEmployeeId = await deps.reader.linkedEmployeeId(actor.tenantId, actor.principalId);
  const assigneeEmployeeId = (r.assignee_employee_id as string | null) ?? null;

  return Object.freeze({
    schemaVersion: 1 as const,
    workOrderId,
    workOrder: Object.freeze({
      state: "AVAILABLE" as const,
      workOrderNumber: (r.work_order_number as string | null) ?? null, status: String(r.status),
      workOrderType: String(r.work_order_type), priority: Number(r.priority), severity: (r.severity as string | null) ?? null,
      complaint: (r.complaint as string | null) ?? null, diagnosis: (r.diagnosis as string | null) ?? null,
      resolution: (r.resolution as string | null) ?? null,
      scheduledStart: iso(r.scheduled_start), scheduledEnd: iso(r.scheduled_end),
      estimatedDurationMinutes: r.estimated_duration_minutes === null || r.estimated_duration_minutes === undefined
        ? null : Number(r.estimated_duration_minutes),
      timestamps: Object.freeze({ acceptedAt: iso(r.accepted_at), enRouteAt: iso(r.en_route_at), arrivedAt: iso(r.arrived_at),
        workStartedAt: iso(r.work_started_at), completedAt: iso(r.completed_at) }),
    }),
    // ABSENT (no reference) and UNRESOLVED (reference present, no usable canonical value) stay different facts.
    customer: Object.freeze({
      state: (!r.customer_id ? "ABSENT" : customerName ? "RESOLVED" : "UNRESOLVED") as FieldContextState,
      displayName: customerName,
    }),
    site: Object.freeze({
      state: (!r.location_id ? "ABSENT" : label ? "RESOLVED" : "UNRESOLVED") as FieldContextState,
      displayLabel: label,
      address: r.loc_id ? Object.freeze({ street: r.address_street ?? null, city: r.address_city ?? null,
        state: r.address_state ?? null, postalCode: r.address_postal_code ?? null }) : null,
      accessNotes: (r.access_notes as string | null) ?? null,
    }),
    assignment: Object.freeze({
      state: "AVAILABLE" as const,
      assigneeEmployeeId,
      assigneeDisplayName: assigneeEmployeeId ? personName(r) : null,
      assignedToCaller: assigneeEmployeeId !== null && assigneeEmployeeId === callerEmployeeId,
    }),
    equipment: Object.freeze({
      ...equipment,
      // Serialized custody and installation stay behind the Inventory boundary: the PostgreSQL custody authority
      // is not activated, so nothing about where a serialized unit IS is read or implied.
      custody: Object.freeze({ state: "NOT_YET_ACTIVATED" as const }),
    }),
    parts: Object.freeze({ state: "AVAILABLE" as const, lines: await readPlannedPartLines(deps, actor, workOrderId) }),
    execution: Object.freeze({ state: "AVAILABLE" as const, notes: execution.notes }),
    inventory: INVENTORY_NOT_YET_ACTIVATED,
  });
}

/** readWorkOrderFieldContext: the governed field context for ONE Work Order, behind the entitled record read. */
export const readWorkOrderFieldContext: WorkOrderOp = (deps, caller, input) =>
  assembleFieldContext({ pool: deps.pool, reader: deps.reader }, caller.operational, (input ?? {}) as Record<string, unknown>);
