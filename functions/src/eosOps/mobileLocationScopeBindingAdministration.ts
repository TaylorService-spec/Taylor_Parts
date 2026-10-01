// TRUCK LOCATION -> WAREHOUSE SCOPE BINDING ADMINISTRATION (Controller ruling DQ-029; the binding is DQ-024).
//
// The PostgreSQL implementation of the four Administration configuration operations declared in
// adminPolicy/configurationOperations.ts. The CAPABILITY GATE is not here: executeAdminOperation has already
// refused anyone who does not hold `inventory.location.scopeBinding.manage` before this module is reached.
// This module owns the governed-data rules:
//
//   * the truck location must be a governed EOS inventory location (eos_ops.mobile_locations, this tenant);
//     creating or changing a binding additionally requires it to be active -- removing one does not, so an
//     inactive truck's stale binding can still be taken away;
//   * the warehouse must be a governed eos_ops warehouse, in this tenant, and ACTIVE;
//   * company compatibility is decided by the ONE governed company authority
//     (operatingCompanyBinding.resolveActiveOperatingCompanyId): both the truck location's authored key and the
//     warehouse's key must resolve to an ACTIVE governed company, and to the SAME one. Nothing is inferred from a
//     technician, driver, current user, UID, tenant default, customer or vehicle -- the only inputs are the two
//     rows' own authored keys. (The table's same-company trigger stays as the structural backstop.)
//   * every mutation states a reason and appends one eos_policy.audit_events row in the same transaction, with
//     the actor, time, location, previous warehouse and new warehouse;
//   * history is never rewritten: a change ENDS the current row and inserts a new one (the table is end-only),
//     so acts already recorded keep the scope they were authorized under. Future acts only.
//   * after a remove there is no current row, and resolveScopeLocation fails closed with
//     MOBILE_SCOPE_BINDING_MISSING until a new valid binding exists.

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  ConfigurationRefusal,
  type AdminConfigurationOperation,
  type ConfigurationActor,
} from "../adminPolicy/configurationOperations";
import { OperatingCompanyBindingError, resolveActiveOperatingCompanyId } from "./operatingCompanyBinding";

export const MOBILE_SCOPE_BINDING_AUDIT_TARGET = "mobileLocationScopeBinding";

export const MOBILE_SCOPE_BINDING_AUDIT_ACTIONS = Object.freeze({
  CREATED: "mobileLocationScopeBinding.created",
  CHANGED: "mobileLocationScopeBinding.changed",
  REMOVED: "mobileLocationScopeBinding.removed",
});

const refuse = (code: string, category: ConfigurationRefusal["category"], message: string): never => {
  throw new ConfigurationRefusal(code, category, message);
};

function requiredText(input: Record<string, unknown>, field: string): string {
  const v = input[field];
  if (typeof v !== "string" || v.trim() === "") refuse(`${field.toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${field} is required`);
  return (v as string).trim();
}

function requiredReason(reason: string | null): string {
  if (typeof reason !== "string" || reason.trim() === "") {
    refuse("REASON_REQUIRED", "INVALID_INPUT", "a reason is required to change a truck location's warehouse scope");
  }
  return (reason as string).trim();
}

interface BindingRow {
  id: string;
  warehouseId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  establishedBy: string;
  reason: string;
  endedBy: string | null;
  endReason: string | null;
}

const toBinding = (r: Record<string, unknown>): BindingRow => ({
  id: r.id as string,
  warehouseId: r.warehouse_id as string,
  effectiveFrom: new Date(r.effective_from as string).toISOString(),
  effectiveTo: r.effective_to ? new Date(r.effective_to as string).toISOString() : null,
  establishedBy: r.established_by as string,
  reason: r.reason as string,
  endedBy: (r.ended_by as string | null) ?? null,
  endReason: (r.end_reason as string | null) ?? null,
});

const BINDING_COLUMNS = "id, warehouse_id, effective_from, effective_to, established_by, reason, ended_by, end_reason";

async function loadLocation(db: Pick<PoolClient, "query">, tenantId: string, locationId: string, lock: boolean) {
  const { rows } = await db.query(
    `SELECT location_id, operating_company_key, display_label, active
       FROM eos_ops.mobile_locations
      WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2${lock ? " FOR UPDATE" : ""}`,
    [tenantId, locationId],
  );
  if (rows.length === 0) refuse("TRUCK_LOCATION_NOT_FOUND", "NOT_FOUND", `"${locationId}" is not a governed truck inventory location in this tenant`);
  return rows[0] as { location_id: string; operating_company_key: string; display_label: string; active: boolean };
}

async function currentBinding(db: Pick<PoolClient, "query">, tenantId: string, locationId: string): Promise<BindingRow | null> {
  const { rows } = await db.query(
    `SELECT ${BINDING_COLUMNS} FROM eos_ops.mobile_location_scope_bindings
      WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2 AND effective_to IS NULL`,
    [tenantId, locationId],
  );
  return rows.length === 0 ? null : toBinding(rows[0]);
}

async function resolveCompany(db: PoolClient, tenantId: string, key: string, whose: string): Promise<string> {
  try {
    return await resolveActiveOperatingCompanyId(db, tenantId, key);
  } catch (err) {
    if (err instanceof OperatingCompanyBindingError) {
      return refuse(`${whose}_COMPANY_NOT_GOVERNED`, "CONFLICT", `the ${whose.toLowerCase()}'s operating company is not governed: ${err.message}`);
    }
    throw err;
  }
}

async function appendAudit(
  db: PoolClient, actor: ConfigurationActor, action: string, locationId: string,
  before: unknown, after: unknown, reason: string,
): Promise<string> {
  const id = `audit_${randomUUID()}`;
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, actor.tenantId, action, actor.principalId, MOBILE_SCOPE_BINDING_AUDIT_TARGET, locationId,
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), reason],
  );
  return id;
}

/** READ/explain one truck location: its current binding (or the fail-closed state) and its full history. */
async function readOne(db: Pick<PoolClient, "query">, tenantId: string, locationId: string) {
  const loc = await loadLocation(db, tenantId, locationId, false);
  const { rows } = await db.query(
    `SELECT ${BINDING_COLUMNS} FROM eos_ops.mobile_location_scope_bindings
      WHERE tenant_id = $1 AND location_type = 'MOBILE' AND location_id = $2
      ORDER BY effective_from DESC, id`,
    [tenantId, locationId],
  );
  const history = rows.map(toBinding);
  const current = history.find((b) => b.effectiveTo === null) ?? null;
  return {
    locationId: loc.location_id,
    displayLabel: loc.display_label,
    operatingCompanyKey: loc.operating_company_key,
    active: loc.active,
    state: current ? "BOUND" : "NO_BINDING",
    scopeWarehouseId: current?.warehouseId ?? null,
    explanation: current
      ? `Acts at this truck location are authorized under warehouse ${current.warehouseId}'s operational scope.`
      : "No current binding: every inventory act at this truck location fails closed (MOBILE_SCOPE_BINDING_MISSING) until a binding is set.",
    current,
    history,
  };
}

async function listAll(db: Pick<PoolClient, "query">, tenantId: string) {
  const { rows } = await db.query(
    `SELECT m.location_id, m.display_label, m.operating_company_key, m.active,
            b.id, b.warehouse_id, b.effective_from, b.effective_to, b.established_by, b.reason, b.ended_by, b.end_reason
       FROM eos_ops.mobile_locations m
       LEFT JOIN eos_ops.mobile_location_scope_bindings b
         ON b.tenant_id = m.tenant_id AND b.location_type = m.location_type AND b.location_id = m.location_id
        AND b.effective_to IS NULL
      WHERE m.tenant_id = $1 AND m.location_type = 'MOBILE'
      ORDER BY m.location_id`,
    [tenantId],
  );
  return {
    locations: rows.map((r) => ({
      locationId: r.location_id,
      displayLabel: r.display_label,
      operatingCompanyKey: r.operating_company_key,
      active: r.active,
      state: r.id ? "BOUND" : "NO_BINDING",
      scopeWarehouseId: r.id ? r.warehouse_id : null,
      current: r.id ? toBinding(r) : null,
    })),
  };
}

async function inTransaction<T>(pool: Pool, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const out = await work(db);
    await db.query("COMMIT");
    return out;
  } catch (err) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    db.release();
  }
}

async function setBinding(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, rawReason: string | null) {
  const locationId = requiredText(input, "locationId");
  const warehouseId = requiredText(input, "warehouseId");
  const reason = requiredReason(rawReason);
  return inTransaction(pool, async (db) => {
    const loc = await loadLocation(db, actor.tenantId, locationId, true);
    if (!loc.active) refuse("TRUCK_LOCATION_INACTIVE", "CONFLICT", `truck location "${locationId}" is inactive; a new scope cannot be bound to it`);
    const { rows: wh } = await db.query(
      `SELECT id, operating_company_key, status FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2 FOR SHARE`,
      [actor.tenantId, warehouseId],
    );
    if (wh.length === 0) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", `"${warehouseId}" is not a governed warehouse in this tenant`);
    if (wh[0].status !== "ACTIVE") refuse("WAREHOUSE_INACTIVE", "CONFLICT", `warehouse "${warehouseId}" is not ACTIVE`);
    const truckCompany = await resolveCompany(db, actor.tenantId, loc.operating_company_key, "TRUCK_LOCATION");
    const warehouseCompany = await resolveCompany(db, actor.tenantId, wh[0].operating_company_key, "WAREHOUSE");
    if (truckCompany !== warehouseCompany) {
      refuse("COMPANY_MISMATCH", "CONFLICT",
        `truck location "${locationId}" operates as company ${truckCompany}; warehouse "${warehouseId}" as ${warehouseCompany}. A truck may only be scoped to a warehouse of its own company.`);
    }
    const previous = await currentBinding(db, actor.tenantId, locationId);
    if (previous?.warehouseId === warehouseId) {
      return { outcome: "NO_CHANGE", locationId, previousWarehouseId: warehouseId, warehouseId, bindingId: previous.id, auditEventId: null };
    }
    if (previous) {
      await db.query(
        `UPDATE eos_ops.mobile_location_scope_bindings SET effective_to = now(), ended_by = $2, end_reason = $3 WHERE id = $1`,
        [previous.id, actor.principalId, reason],
      );
    }
    const bindingId = `msb_${randomUUID()}`;
    await db.query(
      `INSERT INTO eos_ops.mobile_location_scope_bindings (id, tenant_id, location_type, location_id, warehouse_id, established_by, reason)
       VALUES ($1, $2, 'MOBILE', $3, $4, $5, $6)`,
      [bindingId, actor.tenantId, locationId, warehouseId, actor.principalId, reason],
    );
    const outcome = previous ? "CHANGED" : "CREATED";
    const auditEventId = await appendAudit(db, actor,
      previous ? MOBILE_SCOPE_BINDING_AUDIT_ACTIONS.CHANGED : MOBILE_SCOPE_BINDING_AUDIT_ACTIONS.CREATED, locationId,
      previous ? { locationId, warehouseId: previous.warehouseId, bindingId: previous.id } : null,
      { locationId, warehouseId, bindingId }, reason);
    return { outcome, locationId, previousWarehouseId: previous?.warehouseId ?? null, warehouseId, bindingId, auditEventId };
  });
}

async function removeBinding(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, rawReason: string | null) {
  const locationId = requiredText(input, "locationId");
  const reason = requiredReason(rawReason);
  return inTransaction(pool, async (db) => {
    await loadLocation(db, actor.tenantId, locationId, true);
    const previous = await currentBinding(db, actor.tenantId, locationId);
    if (!previous) refuse("BINDING_NOT_FOUND", "NOT_FOUND", `truck location "${locationId}" has no current warehouse scope binding`);
    await db.query(
      `UPDATE eos_ops.mobile_location_scope_bindings SET effective_to = now(), ended_by = $2, end_reason = $3 WHERE id = $1`,
      [previous!.id, actor.principalId, reason],
    );
    const auditEventId = await appendAudit(db, actor, MOBILE_SCOPE_BINDING_AUDIT_ACTIONS.REMOVED, locationId,
      { locationId, warehouseId: previous!.warehouseId, bindingId: previous!.id }, null, reason);
    return { outcome: "REMOVED", locationId, previousWarehouseId: previous!.warehouseId, warehouseId: null, bindingId: previous!.id, auditEventId };
  });
}

/** The server composes this over its pool as AdminApiDeps.configuration. */
export function createMobileLocationScopeBindingAdministration(pool: Pool) {
  return async (
    operation: AdminConfigurationOperation, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null,
  ): Promise<unknown> => {
    switch (operation) {
      case "listMobileLocationScopeBindings": return listAll(pool, actor.tenantId);
      case "readMobileLocationScopeBinding": return readOne(pool, actor.tenantId, requiredText(input, "locationId"));
      case "setMobileLocationScopeBinding": return setBinding(pool, actor, input, reason);
      case "removeMobileLocationScopeBinding": return removeBinding(pool, actor, input, reason);
      default:
        throw new Error(`not a truck-location scope binding operation: ${String(operation)}`);
    }
  };
}
