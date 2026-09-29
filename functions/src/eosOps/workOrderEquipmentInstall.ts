// THE GOVERNED WORK ORDER EQUIPMENT INSTALLATION -- the EOS / PostgreSQL implementation of journey 5's
// `getInstallableEquipmentForWorkOrder` and `recordWorkOrderEquipmentInstall` (Controller ruling DQ-034).
//
// ════════════════════ WHY IT EXISTS ════════════════════
//
// The deployed Firebase callables decide "is this Part a whole unit" by reading Firestore `parts` where
// wholeUnit == true. At Catalog activation PostgreSQL becomes the Catalog READ authority and the Firebase
// Catalog is frozen, so the EOS path must ask the PostgreSQL catalog -- and only through the ONE Part
// policy authority (catalogAuthority/postgresPartPolicyAuthority.ts), never a private SELECT on eos_ops.parts.
//
// ════════════════════ WHAT IT COMPOSES, AND WHAT IT DOES NOT REBUILD ════════════════════
//
// The installation itself is equipmentCustody.installSerializedUnitAsEquipment -- the existing PostgreSQL
// engine: custody refusals, the whole-unit catalog fact, the Equipment mint and the custody move in ONE
// transaction. This module adds only the WORK ORDER boundary the Firebase wrapper (workOrderInstallCommand)
// applies, expressed against governed authority:
//
//   capability     equipment.install (the registered PostgreSQL key)
//   the job        RECORD_ASSIGNMENT -- the caller is the ASSIGNED EMPLOYEE of this Work Order, through the
//                  governed assignment, Employee against Employee (never a technicianId, never a uid)
//   the state      the Work Order is an INSTALL Work Order, WORK_IN_PROGRESS (install first, then complete)
//   the facts      customer, site and operating company come FROM THE WORK ORDER, never from the caller
//
// INERT. No transport routes to it; the PG Work Order activation stays HELD. It is built so that the
// activation, when authorized, has a PG-catalog install path to switch to.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority.js";
import {
  authorizeObjectAction,
  postgresContextualReader,
  type AuthorizationDecision,
  type ContextualReader,
} from "./contextualAuthorization.js";
import {
  customerLocation,
  EquipmentCustodyError,
  INSTALLABLE_CUSTODY_STATUSES,
  installSerializedUnitAsEquipment,
  type InstallResult,
} from "./equipmentCustody.js";

export const EQUIPMENT_INSTALL = "equipment.install";
export const INSTALL_WORK_ORDER_TYPE = "INSTALL";
/** WORK_IN_PROGRESS only -- the single state Complete may follow (workOrderInstallCommand, unchanged). */
export const INSTALLABLE_WORK_ORDER_STATUSES: readonly string[] = Object.freeze(["WORK_IN_PROGRESS"]);
/** A day is not an inventory report: the list is capped, and says so. */
export const INSTALLABLE_LIST_CAP = 50;

export class WorkOrderEquipmentInstallError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "FORBIDDEN" | "NOT_FOUND" | "PRECONDITION_FAILED", message: string) {
    super(message);
    this.name = "WorkOrderEquipmentInstallError";
  }
}
const refuse = (code: string, category: WorkOrderEquipmentInstallError["category"], message: string): never => {
  throw new WorkOrderEquipmentInstallError(code, category, message);
};

export interface InstallActor {
  readonly tenantId: string;
  /** The EOS Principal id -- the actor, never the Employee. */
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

const ID_SHAPE = (v: unknown): v is string =>
  typeof v === "string" && v !== "" && v.trim() === v && v.length <= 200 && !v.includes("/");

/**
 * The Equipment id for one installation request, derived exactly as the deployed command derives it
 * (installSerializedAssetCommand.equipmentDocIdFor) so a replay of the same request is the same id on
 * either runtime. Restated rather than imported: that module is Firestore-bound, and an eosOps module may
 * not import one. A test asserts the two derivations agree.
 */
export function workOrderInstallEquipmentId(idempotencyKey: string): string {
  return "eq_" + createHash("sha256").update(JSON.stringify(["equipmentInstall", idempotencyKey]))
    .digest("hex").slice(0, 40);
}

interface InstallWorkOrder {
  readonly id: string;
  readonly status: string;
  readonly type: string;
  readonly customerId: string;
  readonly locationId: string;
  readonly operatingCompanyKey: string;
}

/** Capability, then the assignment -- in that order, so an unauthorized caller reads nothing. */
async function authorizeInstall(reader: ContextualReader, actor: InstallActor, workOrderId: string): Promise<void> {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
  if (!ID_SHAPE(workOrderId)) refuse("WORK_ORDER_ID_REQUIRED", "INVALID_INPUT", "workOrderId is required");
  const decision: AuthorizationDecision = await authorizeObjectAction(reader, {
    actor: { tenantId: actor.tenantId, principalId: actor.principalId, capabilities: actor.capabilities },
    capabilityKey: EQUIPMENT_INSTALL,
    predicates: [{ kind: "RECORD_ASSIGNMENT", relation: "ASSIGNED_EMPLOYEE" }],
    record: { recordKind: "workOrder", recordId: workOrderId },
  });
  if (!decision.allowed) {
    refuse(decision.reason, "FORBIDDEN",
      decision.reason === "CAPABILITY_MISSING"
        ? `installing equipment requires ${EQUIPMENT_INSTALL}`
        : "equipment may only be installed on a Work Order assigned to you");
  }
}

async function readInstallWorkOrder(pool: Pool, tenantId: string, workOrderId: string): Promise<InstallWorkOrder> {
  const { rows } = await pool.query(
    `SELECT id, status::text AS status, work_order_type::text AS type, customer_id, location_id, operating_company_key
       FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2`,
    [tenantId, workOrderId]);
  if (rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "no such Work Order in this tenant");
  const r = rows[0];
  const wo: InstallWorkOrder = {
    id: String(r.id), status: String(r.status), type: String(r.type), customerId: String(r.customer_id),
    locationId: String(r.location_id), operatingCompanyKey: String(r.operating_company_key),
  };
  if (wo.type !== INSTALL_WORK_ORDER_TYPE) {
    refuse("WORK_ORDER_NOT_INSTALL", "PRECONDITION_FAILED", "only an INSTALL Work Order carries an installation");
  }
  if (!INSTALLABLE_WORK_ORDER_STATUSES.includes(wo.status)) {
    refuse("WORK_ORDER_STATE_INVALID", "PRECONDITION_FAILED",
      `a Work Order in ${wo.status} is not being executed; an installation is recorded while the job is in progress`);
  }
  return wo;
}

export interface InstallableUnit {
  readonly partId: string;
  readonly serialNumber: string;
  readonly status: string;
  readonly locationType: string;
  readonly locationId: string;
}

/**
 * What may be installed on this Work Order: serialized units the Work Order's operating company holds in an
 * installable status, whose Part the PostgreSQL CATALOG says is a whole unit. Read-only; writes nothing.
 */
export async function listInstallableUnitsForWorkOrder(
  deps: { readonly pool: Pool; readonly reader?: ContextualReader },
  actor: InstallActor,
  input: { readonly workOrderId: string; readonly serialNumber?: string },
): Promise<{ readonly units: readonly InstallableUnit[]; readonly truncated: boolean }> {
  await authorizeInstall(deps.reader ?? postgresContextualReader(deps.pool), actor, input?.workOrderId);
  const wo = await readInstallWorkOrder(deps.pool, actor.tenantId, input.workOrderId);
  const serial = input.serialNumber === undefined ? null : input.serialNumber;
  if (serial !== null && (typeof serial !== "string" || serial.trim() === "")) {
    refuse("SERIAL_INVALID", "INVALID_INPUT", "serialNumber, when stated, is a non-empty string");
  }
  // Candidates by CUSTODY first (the operating company and installable statuses are custody facts), over-
  // fetched because some candidates will not be whole units; then the CATALOG decides which are.
  const { rows } = await deps.pool.query(
    `SELECT part_id, serial_number, status::text AS status, location_type::text AS location_type, location_id
       FROM eos_ops.serialized_custody
      WHERE tenant_id = $1 AND operating_company_key = $2 AND status::text = ANY($3::text[])
        AND ($4::text IS NULL OR serial_number = $4)
      ORDER BY part_id, serial_number
      LIMIT $5`,
    [actor.tenantId, wo.operatingCompanyKey, [...INSTALLABLE_CUSTODY_STATUSES], serial, INSTALLABLE_LIST_CAP * 4]);
  const partIds = [...new Set(rows.map((r) => String(r.part_id)))];
  const policies = await createPostgresPartPolicyAuthority().readPartPolicies(deps.pool, actor.tenantId, partIds);
  const wholeUnit = new Set(policies.filter((p) => p.found && p.wholeUnit === true).map((p) => p.partId));
  const units = rows.filter((r) => wholeUnit.has(String(r.part_id))).map((r) => Object.freeze({
    partId: String(r.part_id), serialNumber: String(r.serial_number), status: String(r.status),
    locationType: String(r.location_type), locationId: String(r.location_id),
  }));
  return Object.freeze({
    units: Object.freeze(units.slice(0, INSTALLABLE_LIST_CAP)),
    truncated: units.length > INSTALLABLE_LIST_CAP || rows.length >= INSTALLABLE_LIST_CAP * 4,
  });
}

/**
 * Record the installation of one serialized whole unit on this Work Order (step ONE of closeout; the Work
 * Order is completed separately). The customer, the site and the operating company are the Work Order's.
 */
export async function recordWorkOrderEquipmentInstall(
  deps: { readonly pool: Pool; readonly reader?: ContextualReader },
  actor: InstallActor,
  input: {
    readonly workOrderId: string;
    readonly partId: string;
    readonly serialNumber: string;
    readonly idempotencyKey: string;
    readonly equipmentName: string;
    readonly notes?: string;
  },
): Promise<InstallResult & { readonly outcome: "installed" | "already_installed_for_this_work_order" }> {
  await authorizeInstall(deps.reader ?? postgresContextualReader(deps.pool), actor, input?.workOrderId);
  for (const [k, v] of [["partId", input.partId], ["serialNumber", input.serialNumber], ["idempotencyKey", input.idempotencyKey]] as const) {
    if (typeof v !== "string" || v.trim() === "") refuse("REQUEST_INVALID", "INVALID_INPUT", `${k} is required`);
  }
  if (typeof input.equipmentName !== "string" || input.equipmentName.trim() === "") {
    refuse("REQUEST_INVALID", "INVALID_INPUT", "equipmentName is required");
  }
  const wo = await readInstallWorkOrder(deps.pool, actor.tenantId, input.workOrderId);
  const equipmentId = workOrderInstallEquipmentId(input.idempotencyKey);

  // RECOVERY WITHOUT BROWSER MEMORY: a unit already installed as Equipment for THIS Work Order's customer
  // and site is reported as done, and nothing is installed twice.
  const prior = await deps.pool.query(
    `SELECT e.id, e.account_id, e.customer_location_id
       FROM eos_ops.serialized_custody c JOIN eos_ops.equipment e ON e.tenant_id = c.tenant_id AND e.id = c.location_id
      WHERE c.tenant_id = $1 AND c.part_id = $2 AND c.serial_number = $3 AND c.status::text = 'INSTALLED'`,
    [actor.tenantId, input.partId, input.serialNumber]);
  if (prior.rows.length > 0) {
    const p = prior.rows[0];
    if (p.account_id === wo.customerId && p.customer_location_id === wo.locationId) {
      return Object.freeze({
        outcome: "already_installed_for_this_work_order" as const,
        equipment: { id: String(p.id) } as InstallResult["equipment"],
        unit: { partId: input.partId, serialNumber: input.serialNumber } as unknown as InstallResult["unit"],
      });
    }
    refuse("ALREADY_INSTALLED_ELSEWHERE", "PRECONDITION_FAILED", "that unit is already installed for another customer or site");
  }

  try {
    const result = await installSerializedUnitAsEquipment(deps.pool, {
      tenantId: actor.tenantId,
      actorId: actor.principalId,
      operatingCompanyKey: wo.operatingCompanyKey as never,
      partId: input.partId,
      serialNumber: input.serialNumber,
      equipmentId,
      accountId: wo.customerId,
      customerLocation: customerLocation(wo.locationId),
      equipment: { name: input.equipmentName, notes: input.notes ?? null },
    });
    return Object.freeze({ outcome: "installed" as const, ...result });
  } catch (err) {
    // The engine's refusal codes (PART_NOT_WHOLE_UNIT, PART_NOT_FOUND, UNIT_NOT_FOUND, ...) pass through as
    // PRECONDITION_FAILED with their own code; nothing is re-worded into a generic failure.
    if (err instanceof EquipmentCustodyError) refuse(err.code, "PRECONDITION_FAILED", err.message);
    throw err;
  }
}
