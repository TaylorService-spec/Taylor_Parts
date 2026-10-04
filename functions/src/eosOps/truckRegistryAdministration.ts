// TRUCK / MOBILE-LOCATION REGISTRY ADMINISTRATION -- Controller TRUCK INVENTORY ACTIVATION AUTHORIZED (2026-10-01), OD-T7.
//
// The EXISTING PostgreSQL registry (truckFleetRepository.ts) on the Administration control plane, gated in
// executeAdminOperation on inventory.truckRegistry.manage (adminPolicy/configurationOperations.ts) before this is reached.
// It replaces the Firebase truck-registry callables, whose authority was a users.role string.
//
//   listTrucks / readTruck                 the registry: truck, its linked MOBILE location, company, current warehouse
//                                          binding and the Employees currently holding MOBILE scope over it
//   listMobileLocations                    MOBILE inventory locations (with the truck linked to each, if any)
//   createMobileLocation                   a MOBILE location of a governed ACTIVE operating company (the company is stated
//                                          by its id and resolved to its ACTIVE key -- never inferred)
//   createTruck                            a truck, optionally linked to an unlinked MOBILE location
//   linkTruck / relinkTruck / unlinkTruck  the 1:1 truck <-> MOBILE location link (unique index enforced)
//   changeTruckStatus                      ACTIVE <-> IDLE (OUT_OF_SERVICE stays the inventory-guarded deactivation path)
//
// FOUR DISTINCT RECORDS, kept distinct (OD-T1): truck / vehicle (eos_ops.trucks), MOBILE inventory location
// (eos_ops.mobile_locations -- the custody and ledger key), warehouse binding (inventory.location.scopeBinding.manage) and
// Employee MOBILE scope (admin.employeeOperationalScope.write). This module writes only the first two.
//
// Every mutation requires a stated reason and appends an audit event IN THE SAME TRANSACTION.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ConfigurationRefusal, type AdminConfigurationOperation, type ConfigurationActor } from "../adminPolicy/configurationOperations";
import {
  changeTruckStatus, createMobileLocation, createTruck, linkTruck, relinkTruck, unlinkTruck,
  TruckFleetRepositoryError, TRUCK_STATUSES, type OperatingCompanyKey, type TruckStatus,
} from "./truckFleetRepository";

export const TRUCK_REGISTRY_ADMIN_OPERATIONS = Object.freeze([
  "listTrucks", "readTruck", "listMobileLocations", "createMobileLocation", "createTruck",
  "linkTruck", "relinkTruck", "unlinkTruck", "changeTruckStatus",
] as const);
export const isTruckRegistryAdminOperation = (op: string): boolean => (TRUCK_REGISTRY_ADMIN_OPERATIONS as readonly string[]).includes(op);

export const TRUCK_REGISTRY_AUDIT_ACTIONS = Object.freeze({
  MOBILE_LOCATION_CREATED: "mobileLocation.created",
  TRUCK_CREATED: "truck.created",
  TRUCK_LINKED: "truck.linked",
  TRUCK_RELINKED: "truck.relinked",
  TRUCK_UNLINKED: "truck.unlinked",
  TRUCK_STATUS: "truck.statusChanged",
});

const refuse = (code: string, category: ConfigurationRefusal["category"], message: string): never => {
  throw new ConfigurationRefusal(code, category, message);
};
const ID = (v: unknown): v is string => typeof v === "string" && v !== "" && v.trim() === v && v.length <= 128 && !v.includes("/");

function id(input: Record<string, unknown>, field: string): string {
  if (!ID(input[field])) refuse(`${field.toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${field} is a governed id (no slashes, at most 128 characters)`);
  return input[field] as string;
}
function text(input: Record<string, unknown>, field: string, max = 200): string {
  const v = input[field];
  if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse(`${field.toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${field} is required (at most ${max} characters)`);
  return (v as string).trim();
}
function only(input: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
}
function requiredReason(reason: string | null): string {
  if (typeof reason !== "string" || reason.trim() === "") refuse("REASON_REQUIRED", "INVALID_INPUT", "a reason is required to change the truck registry");
  return (reason as string).trim();
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    if (err instanceof TruckFleetRepositoryError) {
      const category = /NOT_FOUND/.test(err.code) ? "NOT_FOUND" as const
        : /ALREADY_LINKED|LIFECYCLE|NOT_LINKED/.test(err.code) ? "CONFLICT" as const : "INVALID_INPUT" as const;
      refuse(err.code, category, err.message);
    }
    if ((err as { code?: string })?.code === "23505") refuse("DUPLICATE", "CONFLICT", "that truck or location identity is already taken");
    throw err;
  } finally {
    c.release();
  }
}

async function audit(c: PoolClient, actor: ConfigurationActor, action: string, kind: string, targetId: string, before: unknown, after: unknown, reason: string) {
  await c.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, kind, targetId,
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), reason]);
}

/** The ACTIVE key of a governed, ACTIVE operating company -- the only way a MOBILE location acquires a company. */
async function boundKeyOf(c: PoolClient, tenantId: string, operatingCompanyId: string): Promise<string> {
  const { rows } = await c.query(
    `SELECT b.operating_company_key FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies co ON co.tenant_id = b.tenant_id AND co.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.operating_company_id = $2 AND b.status = 'ACTIVE' AND co.status = 'ACTIVE'`,
    [tenantId, operatingCompanyId]);
  if (rows.length !== 1) {
    refuse("OPERATING_COMPANY_NOT_GOVERNED", "CONFLICT", `operating company "${operatingCompanyId}" is not an ACTIVE company of this tenant with an ACTIVE key`);
  }
  return rows[0].operating_company_key as string;
}

const TRUCK_VIEW = `SELECT t.truck_id, t.vehicle_number, t.display_label, t.status::text AS status, t.active, t.home_warehouse_id,
    t.mobile_location_id, m.display_label AS location_label, m.active AS location_active, m.operating_company_key,
    (SELECT b.operating_company_id FROM eos_policy.tenant_operating_company_keys b WHERE b.tenant_id = t.tenant_id AND b.operating_company_key = m.operating_company_key AND b.status = 'ACTIVE' LIMIT 1) AS operating_company_id,
    (SELECT sb.warehouse_id FROM eos_ops.mobile_location_scope_bindings sb WHERE sb.tenant_id = t.tenant_id AND sb.location_type = 'MOBILE' AND sb.location_id = t.mobile_location_id AND sb.effective_to IS NULL LIMIT 1) AS bound_warehouse_id,
    coalesce((SELECT array_agg(s.employee_id ORDER BY s.employee_id) FROM eos_workforce.employee_operational_scopes s
               WHERE s.tenant_id = t.tenant_id AND s.scope_type = 'MOBILE' AND s.scope_id = t.mobile_location_id AND s.effective_to IS NULL), '{}') AS scoped_employee_ids,
    coalesce((SELECT array_agg(coalesce(e.display_name, s.employee_id) ORDER BY s.employee_id) FROM eos_workforce.employee_operational_scopes s
               LEFT JOIN eos_workforce.employees e ON e.tenant_id = s.tenant_id AND e.id = s.employee_id
               WHERE s.tenant_id = t.tenant_id AND s.scope_type = 'MOBILE' AND s.scope_id = t.mobile_location_id AND s.effective_to IS NULL), '{}') AS scoped_employee_names
  FROM eos_ops.trucks t
  LEFT JOIN eos_ops.mobile_locations m ON m.tenant_id = t.tenant_id AND m.location_type = t.mobile_location_type AND m.location_id = t.mobile_location_id`;

export const truckView = (r: Record<string, unknown>) => Object.freeze({
  truckId: r.truck_id as string, vehicleNumber: r.vehicle_number as string, displayLabel: r.display_label as string,
  status: r.status as string, active: r.active === true, homeWarehouseId: r.home_warehouse_id as string,
  mobileLocation: r.mobile_location_id == null ? null : Object.freeze({
    type: "MOBILE", locationId: r.mobile_location_id as string, displayLabel: (r.location_label as string) ?? null, active: r.location_active === true,
  }),
  operatingCompanyKey: (r.operating_company_key as string) ?? null, operatingCompanyId: (r.operating_company_id as string) ?? null,
  boundWarehouseId: (r.bound_warehouse_id as string) ?? null,
  scopedEmployeeIds: Object.freeze([...((r.scoped_employee_ids as string[]) ?? [])]),
  // #210: the CURRENT technician relationship in words -- the names of the Employees whose MOBILE scope is this truck (same order).
  scopedEmployeeNames: Object.freeze([...((r.scoped_employee_names as string[]) ?? [])]),
});

export async function listTruckViews(db: Pick<PoolClient, "query">, tenantId: string, filter: { readonly mobileLocationIds?: readonly string[] } = {}) {
  const { rows } = await db.query(`${TRUCK_VIEW} WHERE t.tenant_id = $1 AND ($2::text[] IS NULL OR t.mobile_location_id = ANY($2::text[]))
    ORDER BY lower(t.display_label), t.truck_id`, [tenantId, filter.mobileLocationIds ? [...filter.mobileLocationIds] : null]);
  return rows.map(truckView);
}

async function readTruckView(db: Pick<PoolClient, "query">, tenantId: string, truckId: string) {
  const { rows } = await db.query(`${TRUCK_VIEW} WHERE t.tenant_id = $1 AND t.truck_id = $2`, [tenantId, truckId]);
  if (rows.length === 0) refuse("TRUCK_NOT_FOUND", "NOT_FOUND", "no such truck in this tenant");
  return truckView(rows[0]);
}

async function listMobileLocationViews(db: Pick<PoolClient, "query">, tenantId: string) {
  const { rows } = await db.query(
    `SELECT m.location_id, m.display_label, m.active, m.operating_company_key, t.truck_id,
            (SELECT sb.warehouse_id FROM eos_ops.mobile_location_scope_bindings sb WHERE sb.tenant_id = m.tenant_id AND sb.location_type = 'MOBILE' AND sb.location_id = m.location_id AND sb.effective_to IS NULL LIMIT 1) AS bound_warehouse_id
       FROM eos_ops.mobile_locations m
       LEFT JOIN eos_ops.trucks t ON t.tenant_id = m.tenant_id AND t.mobile_location_type = m.location_type AND t.mobile_location_id = m.location_id
      WHERE m.tenant_id = $1 ORDER BY lower(m.display_label), m.location_id`, [tenantId]);
  return rows.map((r) => Object.freeze({ type: "MOBILE", locationId: r.location_id, displayLabel: r.display_label, active: r.active === true,
    operatingCompanyKey: r.operating_company_key, truckId: r.truck_id ?? null, boundWarehouseId: r.bound_warehouse_id ?? null }));
}

/** A truck's home warehouse is descriptive, but it is still a governed ACTIVE warehouse of this tenant -- never free text. */
async function requireHomeWarehouse(c: PoolClient, tenantId: string, warehouseId: string): Promise<void> {
  const { rows } = await c.query(`SELECT status::text AS status FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2`, [tenantId, warehouseId]);
  if (rows.length === 0) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "the home warehouse does not exist in this tenant");
  if (rows[0].status !== "ACTIVE") refuse("WAREHOUSE_INACTIVE", "CONFLICT", "the home warehouse is not ACTIVE");
}

/** A truck is linked only to an ACTIVE MOBILE location. */
async function requireActiveLocation(c: PoolClient, tenantId: string, locationId: string): Promise<void> {
  const { rows } = await c.query(`SELECT active FROM eos_ops.mobile_locations WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2 FOR SHARE`, [tenantId, locationId]);
  if (rows.length === 0) refuse("LOCATION_NOT_FOUND", "NOT_FOUND", "no such MOBILE location in this tenant");
  if (rows[0].active !== true) refuse("LOCATION_INACTIVE", "CONFLICT", "the MOBILE location is inactive");
}

export function createTruckRegistryAdministration(pool: Pool) {
  return async (operation: AdminConfigurationOperation, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null): Promise<unknown> => {
    const { reason: _stated, ...i } = input && typeof input === "object" && !Array.isArray(input) ? input : ({} as Record<string, unknown>);
    void _stated;
    switch (operation) {
      case "listTrucks": only(i, []); return { trucks: await listTruckViews(pool, actor.tenantId) };
      case "readTruck": only(i, ["truckId"]); return readTruckView(pool, actor.tenantId, id(i, "truckId"));
      case "listMobileLocations": only(i, []); return { mobileLocations: await listMobileLocationViews(pool, actor.tenantId) };
      case "createMobileLocation": {
        only(i, ["locationId", "displayLabel", "operatingCompanyId"]);
        const why = requiredReason(reason);
        const locationId = id(i, "locationId"), displayLabel = text(i, "displayLabel"), operatingCompanyId = id(i, "operatingCompanyId");
        return tx(pool, async (c) => {
          const key = await boundKeyOf(c, actor.tenantId, operatingCompanyId);
          const created = await createMobileLocation(c as unknown as Pool, actor.tenantId, actor.principalId, { locationId, displayLabel, operatingCompanyKey: key as OperatingCompanyKey });
          await audit(c, actor, TRUCK_REGISTRY_AUDIT_ACTIONS.MOBILE_LOCATION_CREATED, "mobileLocation", locationId, null, { locationId, displayLabel, operatingCompanyKey: key }, why);
          return { outcome: "CREATED", mobileLocation: { type: "MOBILE", locationId: created.location.id, displayLabel: created.displayLabel, active: created.active, operatingCompanyKey: key } };
        });
      }
      case "createTruck": {
        only(i, ["truckId", "vehicleNumber", "displayLabel", "homeWarehouseId", "mobileLocationId"]);
        const why = requiredReason(reason);
        const truckId = id(i, "truckId"), vehicleNumber = text(i, "vehicleNumber", 60), displayLabel = text(i, "displayLabel");
        const homeWarehouseId = id(i, "homeWarehouseId");
        const mobileLocationId = i.mobileLocationId === undefined || i.mobileLocationId === null ? null : id(i, "mobileLocationId");
        return tx(pool, async (c) => {
          await requireHomeWarehouse(c, actor.tenantId, homeWarehouseId);
          if (mobileLocationId) await requireActiveLocation(c, actor.tenantId, mobileLocationId);
          await createTruck(c as unknown as Pool, actor.tenantId, actor.principalId, { truckId, vehicleNumber, displayLabel, homeWarehouseId, mobileLocationId });
          const after = await readTruckView(c, actor.tenantId, truckId);
          await audit(c, actor, TRUCK_REGISTRY_AUDIT_ACTIONS.TRUCK_CREATED, "truck", truckId, null, after, why);
          return { outcome: "CREATED", truck: after };
        });
      }
      case "linkTruck":
      case "relinkTruck": {
        only(i, ["truckId", "mobileLocationId"]);
        const why = requiredReason(reason);
        const truckId = id(i, "truckId"), mobileLocationId = id(i, "mobileLocationId");
        return tx(pool, async (c) => {
          const before = await readTruckView(c, actor.tenantId, truckId);
          await requireActiveLocation(c, actor.tenantId, mobileLocationId);
          await (operation === "linkTruck" ? linkTruck : relinkTruck)(c as unknown as Pool, actor.tenantId, actor.principalId, truckId, mobileLocationId);
          const after = await readTruckView(c, actor.tenantId, truckId);
          await audit(c, actor, operation === "linkTruck" ? TRUCK_REGISTRY_AUDIT_ACTIONS.TRUCK_LINKED : TRUCK_REGISTRY_AUDIT_ACTIONS.TRUCK_RELINKED, "truck", truckId, before, after, why);
          return { outcome: operation === "linkTruck" ? "LINKED" : "RELINKED", truck: after };
        });
      }
      case "unlinkTruck": {
        only(i, ["truckId"]);
        const why = requiredReason(reason);
        const truckId = id(i, "truckId");
        return tx(pool, async (c) => {
          const before = await readTruckView(c, actor.tenantId, truckId);
          await unlinkTruck(c as unknown as Pool, actor.tenantId, actor.principalId, truckId);
          const after = await readTruckView(c, actor.tenantId, truckId);
          await audit(c, actor, TRUCK_REGISTRY_AUDIT_ACTIONS.TRUCK_UNLINKED, "truck", truckId, before, after, why);
          return { outcome: "UNLINKED", truck: after };
        });
      }
      case "changeTruckStatus": {
        only(i, ["truckId", "status"]);
        const why = requiredReason(reason);
        const truckId = id(i, "truckId");
        const status = i.status;
        if (status !== "ACTIVE" && status !== "IDLE") {
          refuse("STATUS_INVALID", "INVALID_INPUT", `status is ACTIVE or IDLE here (${TRUCK_STATUSES.join("|")} exist; OUT_OF_SERVICE is the guarded deactivation path)`);
        }
        return tx(pool, async (c) => {
          const before = await readTruckView(c, actor.tenantId, truckId);
          if (before.status === status) return { outcome: "NO_CHANGE", truck: before };
          await changeTruckStatus(c as unknown as Pool, actor.tenantId, actor.principalId, truckId, status as TruckStatus);
          const after = await readTruckView(c, actor.tenantId, truckId);
          await audit(c, actor, TRUCK_REGISTRY_AUDIT_ACTIONS.TRUCK_STATUS, "truck", truckId, { status: before.status }, { status: after.status }, why);
          return { outcome: "CHANGED", truck: after };
        });
      }
      default:
        return refuse("UNKNOWN_OPERATION", "INVALID_INPUT", `${operation} is not a truck registry operation`);
    }
  };
}
