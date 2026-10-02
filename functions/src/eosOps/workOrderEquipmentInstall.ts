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
// ROUTED (Controller EQUIPMENT ACTIVATION AUTHORIZED, 2026-10-01). On /operations/work-orders as
// listInstallableEquipmentForWorkOrder / recordWorkOrderEquipmentInstall. OD-1: ONE transaction reconciles the source
// custody, the inventory ledger consequence (a WORK_ORDER_CONSUMPTION -1 at the WAREHOUSE / BIN the unit left -- the
// existing governed ledger, no second accounting), the EQUIPMENT custody, the Equipment record, the Work Order's
// equipment_id and the Equipment event; any failure rolls all of it back. OD-5: this is the ONLY installation workflow.
// A MOBILE (truck) source fails closed -- Truck Inventory is the next journey (TRUCK_INVENTORY_FOLLOWUP).
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { createPostgresPartPolicyAuthority } from "../catalogAuthority/postgresPartPolicyAuthority.js";
import {
  authorizeObjectAction,
  postgresContextualReader,
  type AuthorizationDecision,
  type ContextualReader,
} from "./contextualAuthorization.js";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  customerLocation,
  EquipmentCustodyError,
  INSTALLABLE_CUSTODY_STATUSES,
  installSerializedUnitAsEquipmentOn,
  readEquipment,
  readInstalledUnit,
  type InstallResult,
} from "./equipmentCustody.js";
import { INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE, isInventoryBaselineCertified } from "./inventoryBaselineGate.js";
import { authorizeMobileAct, currentMobileLocationIds, MobileStockRefusal } from "./mobileStockAuthority.js";

export const EQUIPMENT_INSTALL = "equipment.install";
export const INSTALL_WORK_ORDER_TYPE = "INSTALL";
/** WORK_IN_PROGRESS only -- the single state Complete may follow (workOrderInstallCommand, unchanged). */
export const INSTALLABLE_WORK_ORDER_STATUSES: readonly string[] = Object.freeze(["WORK_IN_PROGRESS"]);
/**
 * OD-1: the source custody an installation may draw from. MOBILE since Truck Inventory activation (2026-10-01, Package F):
 * only from a truck the installer holds a current MOBILE scope over, revalidated in the install transaction.
 */
export const INSTALL_SOURCE_LOCATION_TYPES: readonly string[] = Object.freeze(["WAREHOUSE", "BIN", "MOBILE"]);
/** The ledger row's source_kind: the existing WORK_ORDER_CONSUMPTION movement, attributed to an installation. */
export const INSTALL_MOVEMENT_SOURCE_KIND = "WORK_ORDER_EQUIPMENT_INSTALL";
export const installMovementKey = (idempotencyKey: string): string => `equipmentInstall:${idempotencyKey}`;
export const installEventKey = (idempotencyKey: string): string => `equipmentInstall:${idempotencyKey}`;
/** A day is not an inventory report: the list is capped, and says so. */
export const INSTALLABLE_LIST_CAP = 50;

export class WorkOrderEquipmentInstallError extends Error {
  constructor(readonly code: string, readonly category: "INVALID_INPUT" | "FORBIDDEN" | "NOT_FOUND" | "PRECONDITION_FAILED" | "CONFLICT" | "NOT_ACTIVATED", message: string) {
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
  readonly equipmentId: string | null;
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

async function readInstallWorkOrder(db: Pick<PoolClient, "query">, tenantId: string, workOrderId: string, lock = false): Promise<InstallWorkOrder> {
  const { rows } = await db.query(
    `SELECT id, status::text AS status, work_order_type::text AS type, customer_id, location_id, operating_company_key,
            equipment_id
       FROM eos_ops.work_orders WHERE tenant_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [tenantId, workOrderId]);
  if (rows.length === 0) refuse("WORK_ORDER_NOT_FOUND", "NOT_FOUND", "no such Work Order in this tenant");
  const r = rows[0];
  const wo: InstallWorkOrder = {
    id: String(r.id), status: String(r.status), type: String(r.type), customerId: String(r.customer_id),
    locationId: String(r.location_id), operatingCompanyKey: String(r.operating_company_key),
    equipmentId: r.equipment_id == null ? null : String(r.equipment_id),
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
  /** The governed warehouse name (and bin code) -- so a technician never reads an internal location key. */
  readonly locationLabel: string | null;
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
  // fetched because some candidates will not be whole units; then the CATALOG decides which are. A truck's units are
  // candidates only on the trucks the caller holds a current MOBILE scope over -- never another Employee's truck.
  const myTrucks = await currentMobileLocationIds(deps.pool, actor);
  const { rows } = await deps.pool.query(
    `SELECT c.part_id, c.serial_number, c.status::text AS status, c.location_type::text AS location_type, c.location_id,
            CASE WHEN c.location_type = 'BIN' THEN concat_ws(' / ', bw.name, b.code)
                 WHEN c.location_type = 'MOBILE' THEN m.display_label ELSE w.name END AS location_label
       FROM eos_ops.serialized_custody c
       LEFT JOIN eos_ops.warehouses w ON c.location_type = 'WAREHOUSE' AND w.tenant_id = c.tenant_id AND w.id = c.location_id
       LEFT JOIN eos_ops.bins b ON c.location_type = 'BIN' AND b.tenant_id = c.tenant_id AND b.id = c.location_id
       LEFT JOIN eos_ops.warehouses bw ON bw.tenant_id = b.tenant_id AND bw.id = b.warehouse_id
       LEFT JOIN eos_ops.mobile_locations m ON c.location_type = 'MOBILE' AND m.tenant_id = c.tenant_id
                                           AND m.location_type = 'MOBILE' AND m.location_id = c.location_id
      WHERE c.tenant_id = $1 AND c.operating_company_key = $2 AND c.status::text = ANY($3::text[])
        AND c.location_type::text = ANY($6::text[])
        AND (c.location_type <> 'MOBILE' OR c.location_id = ANY($7::text[]))
        AND ($4::text IS NULL OR c.serial_number = $4)
      ORDER BY c.part_id, c.serial_number
      LIMIT $5`,
    [actor.tenantId, wo.operatingCompanyKey, [...INSTALLABLE_CUSTODY_STATUSES], serial, INSTALLABLE_LIST_CAP * 4,
      [...INSTALL_SOURCE_LOCATION_TYPES], myTrucks]);
  const partIds = [...new Set(rows.map((r) => String(r.part_id)))];
  const policies = await createPostgresPartPolicyAuthority().readPartPolicies(deps.pool, actor.tenantId, partIds);
  const wholeUnit = new Set(policies.filter((p) => p.found && p.wholeUnit === true).map((p) => p.partId));
  const units = rows.filter((r) => wholeUnit.has(String(r.part_id))).map((r) => Object.freeze({
    partId: String(r.part_id), serialNumber: String(r.serial_number), status: String(r.status),
    locationType: String(r.location_type), locationId: String(r.location_id),
    locationLabel: r.location_label == null || r.location_label === "" ? null : String(r.location_label),
  }));
  return Object.freeze({
    units: Object.freeze(units.slice(0, INSTALLABLE_LIST_CAP)),
    truncated: units.length > INSTALLABLE_LIST_CAP || rows.length >= INSTALLABLE_LIST_CAP * 4,
  });
}

export interface WorkOrderInstallResult extends InstallResult {
  readonly outcome: "installed" | "replayed";
  readonly workOrderId: string;
  /** The ledger row that took the unit out of company-held stock. */
  readonly movementId: string;
  readonly eventId: string;
}

const INSTALL_INPUT_KEYS: readonly string[] = Object.freeze(["workOrderId", "partId", "serialNumber", "idempotencyKey", "equipmentName", "notes"]);

/**
 * Record the installation of one serialized whole unit on this Work Order (step ONE of closeout; the Work Order is
 * completed separately). The customer, the site and the operating company are the Work Order's, never the caller's.
 *
 * ONE TRANSACTION (OD-1), in the ruled order: authorize -> lock + revalidate the Work Order -> INSTALL / state ->
 * assignment -> source unit -> source custody (WAREHOUSE / BIN, or MOBILE within the installer's scope) -> whole unit / model (the catalog) -> company /
 * customer / site -> the ledger consequence -> EQUIPMENT custody -> the Equipment record -> work_orders.equipment_id ->
 * the Equipment event -> commit. A replay of the same key returns the ORIGINAL result and writes nothing.
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
): Promise<WorkOrderInstallResult> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) refuse("REQUEST_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(input).filter((k) => !INSTALL_INPUT_KEYS.includes(k));
  if (extra.length > 0) refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this operation does not accept: ${extra.sort().join(", ")}`);
  if (actor?.capabilities instanceof Set && !actor.capabilities.has(EQUIPMENT_INSTALL)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `installing equipment requires ${EQUIPMENT_INSTALL}`);
  }
  for (const [k, v] of [["partId", input.partId], ["serialNumber", input.serialNumber], ["idempotencyKey", input.idempotencyKey]] as const) {
    if (typeof v !== "string" || v.trim() === "" || v.trim() !== v || v.length > 300) refuse("REQUEST_INVALID", "INVALID_INPUT", `${k} is required`);
  }
  if (typeof input.equipmentName !== "string" || input.equipmentName.trim() === "") {
    refuse("REQUEST_INVALID", "INVALID_INPUT", "equipmentName is required");
  }
  if (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.trim() === "")) {
    refuse("REQUEST_INVALID", "INVALID_INPUT", "notes, when stated, is non-empty text");
  }

  const client = await deps.pool.connect();
  try {
    await client.query("BEGIN");
    // 1 + 4. capability, then the assignment -- read through THIS transaction.
    await authorizeInstall(deps.reader ?? postgresContextualReader(client), actor, input.workOrderId);
    // 2 + 3. lock and revalidate the Work Order: a concurrent install on the same Work Order waits here.
    const wo = await readInstallWorkOrder(client, actor.tenantId, input.workOrderId, true);
    if (!(await isInventoryBaselineCertified(client, actor.tenantId))) {
      refuse("NOT_ACTIVATED", "NOT_ACTIVATED", INVENTORY_BASELINE_NOT_CERTIFIED_MESSAGE);
    }
    const equipmentId = workOrderInstallEquipmentId(input.idempotencyKey);

    // REPLAY BY INTENT: the key's event is the original result; the same request returns it, a different one refuses.
    const prior = await readInstallEvent(client, actor.tenantId, { idempotencyKey: installEventKey(input.idempotencyKey) });
    if (prior) {
      if (prior.work_order_id !== wo.id || prior.part_id !== input.partId || prior.serial_number !== input.serialNumber) {
        refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotencyKey already recorded a different installation");
      }
      const replay = await replayResult(client, actor.tenantId, prior);
      await client.query("COMMIT");
      return replay;
    }

    // 5 + 6. the source unit and its custody, locked. An installed unit is either THIS Work Order's (recovery without
    // browser memory: the original result) or someone else's (refused); nothing is ever installed twice.
    const { rows: units } = await client.query(
      `SELECT status::text AS status, location_type::text AS location_type, location_id, operating_company_key
         FROM eos_ops.serialized_custody WHERE tenant_id = $1 AND part_id = $2 AND serial_number = $3 FOR UPDATE`,
      [actor.tenantId, input.partId, input.serialNumber]);
    if (units.length === 0) refuse("UNIT_NOT_FOUND", "PRECONDITION_FAILED", `no serialized custody row for ${input.partId}/${input.serialNumber}`);
    const unit = units[0];
    if (unit.status === "INSTALLED") {
      const installedHere = await readInstallEvent(client, actor.tenantId, { equipmentId: String(unit.location_id) });
      if (installedHere && installedHere.work_order_id === wo.id) {
        const replay = await replayResult(client, actor.tenantId, installedHere);
        await client.query("COMMIT");
        return replay;
      }
      refuse("ALREADY_INSTALLED_ELSEWHERE", "PRECONDITION_FAILED", "that unit is already installed for another Work Order, customer or site");
    }
    if (wo.equipmentId !== null) {
      refuse("WORK_ORDER_ALREADY_HAS_EQUIPMENT", "PRECONDITION_FAILED", "this Work Order already references Equipment; one installation per INSTALL Work Order");
    }
    if (!INSTALL_SOURCE_LOCATION_TYPES.includes(String(unit.location_type))) {
      refuse("SOURCE_NOT_INSTALLABLE", "PRECONDITION_FAILED", `a unit in ${String(unit.location_type)} custody cannot be installed`);
    }
    if (unit.location_type === "MOBILE") {
      // PACKAGE F (OD-T3): from a truck only when the location is ACTIVE and linked to an active truck, the installer holds a
      // current MOBILE scope over it (with SERVICE_TECHNICIAN eligibility), and the truck is the Work Order's company.
      // The assignment was checked above; custody / ledger agreement is checked below exactly as for a warehouse unit.
      let mobile;
      try {
        mobile = await authorizeMobileAct(client, actor, EQUIPMENT_INSTALL, String(unit.location_id), { lock: true });
      } catch (err) {
        if (err instanceof MobileStockRefusal) refuse(err.code, err.category === "NOT_FOUND" ? "PRECONDITION_FAILED" : err.category, err.message);
        throw err;
      }
      if (!mobile.allowed) {
        return refuse(mobile.decision.reason, "FORBIDDEN", "the unit is on a truck outside your current MOBILE scope");
      }
      if (mobile.location.operatingCompanyKey !== wo.operatingCompanyKey) {
        refuse("OPERATING_COMPANY_MISMATCH", "PRECONDITION_FAILED", "the truck belongs to another operating company than the Work Order's");
      }
    }
    if (unit.operating_company_key !== wo.operatingCompanyKey) {
      refuse("OPERATING_COMPANY_MISMATCH", "PRECONDITION_FAILED", "the unit is held by another operating company than the Work Order's");
    }

    // 8. the customer and site the Work Order names are governed CRM records, and the site is the customer's.
    const { rows: site } = await client.query(
      `SELECT a.status::text AS account_status FROM eos_crm.account_locations l
         JOIN eos_crm.accounts a ON a.tenant_id = l.tenant_id AND a.id = l.account_id
        WHERE l.tenant_id = $1 AND l.id = $2 AND l.account_id = $3 FOR SHARE OF l`,
      [actor.tenantId, wo.locationId, wo.customerId]);
    if (site.length === 0) refuse("CUSTOMER_SITE_MISMATCH", "PRECONDITION_FAILED", "the Work Order's site is not a site of its customer");
    if (site[0].account_status !== "ACTIVE") {
      refuse("CUSTOMER_NOT_ACTIVE", "PRECONDITION_FAILED", `the Work Order's customer is ${String(site[0].account_status)}`);
    }

    // 9. the ledger must agree with custody before it moves (DQ-019), then the consequence: the unit leaves stock.
    const { rows: nets } = await client.query(
      `SELECT COALESCE(SUM(quantity_delta), 0)::bigint AS net FROM eos_ops.inventory_movements
        WHERE tenant_id = $1 AND part_id = $2 AND tracking_mode = 'SERIAL' AND serial_number = $3
          AND location_type = $4 AND location_id = $5`,
      [actor.tenantId, input.partId, input.serialNumber, unit.location_type, unit.location_id]);
    if (Number(nets[0]?.net ?? 0) !== 1) {
      refuse("LEDGER_INTEGRITY", "PRECONDITION_FAILED", "the ledger disagrees with custody at the source; it must be investigated before installing");
    }
    const movementId = `mov_${randomUUID()}`;
    try {
      await client.query(
        `INSERT INTO eos_ops.inventory_movements
           (id, tenant_id, operating_company_key, part_id, tracking_mode, location_type, location_id,
            movement_type, quantity_delta, serial_number, source_kind, source_id, idempotency_key, created_by)
         VALUES ($1, $2, $3, $4, 'SERIAL', $5, $6, 'WORK_ORDER_CONSUMPTION', -1, $7, $8, $9, $10, $11)`,
        [movementId, actor.tenantId, wo.operatingCompanyKey, input.partId, unit.location_type, unit.location_id,
          input.serialNumber, INSTALL_MOVEMENT_SOURCE_KIND, wo.id, installMovementKey(input.idempotencyKey), actor.principalId]);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "this idempotencyKey already moved stock");
      throw err;
    }

    // 7 + 10 + 11. the engine: whole unit and model from the catalog, custody -> EQUIPMENT, the Equipment record.
    let installed: Awaited<ReturnType<typeof installSerializedUnitAsEquipmentOn>>;
    try {
      installed = await installSerializedUnitAsEquipmentOn(client, {
        tenantId: actor.tenantId,
        actorId: actor.principalId,
        operatingCompanyKey: wo.operatingCompanyKey as never,
        partId: input.partId,
        serialNumber: input.serialNumber,
        equipmentId,
        accountId: wo.customerId,
        customerLocation: customerLocation(wo.locationId),
        equipment: { name: input.equipmentName.trim(), notes: input.notes ?? null },
      });
    } catch (err) {
      // The engine's refusal codes (PART_NOT_WHOLE_UNIT, PART_NOT_FOUND, EQUIPMENT_EXISTS, ...) pass through as
      // PRECONDITION_FAILED with their own code; nothing is re-worded into a generic failure.
      if (err instanceof EquipmentCustodyError) refuse(err.code, "PRECONDITION_FAILED", err.message);
      throw err;
    }

    // 12. the Work Order references its Equipment -- only if it still references none.
    const linked = await client.query(
      `UPDATE eos_ops.work_orders SET equipment_id = $3, updated_by_principal_id = $4, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND equipment_id IS NULL`,
      [actor.tenantId, wo.id, equipmentId, actor.principalId]);
    if (linked.rowCount !== 1) refuse("WORK_ORDER_ALREADY_HAS_EQUIPMENT", "PRECONDITION_FAILED", "this Work Order already references Equipment");

    // 13. the Equipment event: what, who, when, company, customer, site, Work Order, serial, ledger row, source, key.
    const eventId = `eqe_${randomUUID()}`;
    await client.query(
      `INSERT INTO eos_ops.equipment_events
         (id, tenant_id, equipment_id, event_type, operating_company_key, account_id, customer_location_id, work_order_id,
          part_id, serial_number, ledger_movement_id, source, reason, changes, idempotency_key, actor_principal_id)
       VALUES ($1, $2, $3, 'INSTALLED', $4, $5, $6, $7, $8, $9, $10, 'WORK_ORDER_INSTALL', $11, $12, $13, $14)`,
      [eventId, actor.tenantId, equipmentId, wo.operatingCompanyKey, wo.customerId, wo.locationId, wo.id,
        input.partId, input.serialNumber, movementId, "installed on an INSTALL Work Order",
        JSON.stringify({ name: installed.equipment.name, equipmentModelId: installed.equipment.equipmentModelId,
          installedFrom: installed.origin, notes: input.notes ?? null }),
        installEventKey(input.idempotencyKey), actor.principalId]);

    await client.query("COMMIT");
    return Object.freeze({ outcome: "installed" as const, workOrderId: wo.id, movementId, eventId,
      equipment: installed.equipment, unit: installed.unit });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

interface InstallEventRow {
  readonly id: string; readonly equipment_id: string; readonly work_order_id: string; readonly part_id: string;
  readonly serial_number: string; readonly ledger_movement_id: string;
}

async function readInstallEvent(
  db: Pick<PoolClient, "query">, tenantId: string, by: { readonly idempotencyKey?: string; readonly equipmentId?: string },
): Promise<InstallEventRow | null> {
  const { rows } = await db.query(
    `SELECT id, equipment_id, work_order_id, part_id, serial_number, ledger_movement_id FROM eos_ops.equipment_events
      WHERE tenant_id = $1 AND event_type = 'INSTALLED'
        AND ($2::text IS NULL OR idempotency_key = $2) AND ($3::text IS NULL OR equipment_id = $3)
      ORDER BY occurred_at LIMIT 1`,
    [tenantId, by.idempotencyKey ?? null, by.equipmentId ?? null]);
  return rows.length === 0 ? null : (rows[0] as InstallEventRow);
}

/** The ORIGINAL result, read back -- a replay writes nothing. */
async function replayResult(db: Pick<PoolClient, "query">, tenantId: string, event: InstallEventRow): Promise<WorkOrderInstallResult> {
  const equipment = await readEquipment(db as unknown as Pool, tenantId, event.equipment_id);
  const unit = await readInstalledUnit(db as unknown as Pool, tenantId, event.equipment_id);
  if (!equipment || !unit) refuse("INTEGRITY", "CONFLICT", "the recorded installation no longer reads back whole");
  return Object.freeze({ outcome: "replayed" as const, workOrderId: event.work_order_id, movementId: event.ledger_movement_id,
    eventId: event.id, equipment: equipment as NonNullable<typeof equipment>, unit: unit as NonNullable<typeof unit> });
}
