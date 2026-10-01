// WAREHOUSE AND BIN MASTER ADMINISTRATION -- the governed way a real warehouse and its bins come to exist in PostgreSQL
// (Controller DQ-E, 2026-10-01: "Build governed EOS Administration management for Warehouse and Bin master data ...
// Administration UI/API -> governed server command -> PostgreSQL; not developer, migration, direct SQL, Firebase or
// source-code seed. Reuse the existing warehouse/bin schema and invariants. DO NOT build a second warehouse model.").
//
// Served on /admin/policy as ADMINISTRATION CONFIGURATION operations (adminPolicy/configurationOperations.ts), every one
// gated by `warehouse.record.manage` -- configuration authority, deliberately NOT operational: it confers no receive,
// transfer, relocation, placement or cycle-count right, and no operational Role or WAREHOUSE scope implies it.
//
// THE EXISTING MODEL, REUSED. The writes are warehouseBinRepository's own (its id rules, racking normalization, bin-code
// claims, immutable parent warehouse, no company on a bin), run in THIS module's transaction so the master-data change
// and its audit event commit together. A warehouse is a COMPANY ROOT: its operating company is stated once, as a governed
// operating company id, resolved here to that company's ACTIVE bound key (eos_policy.tenant_operating_company_keys) --
// never a caller-supplied key, never inferred, and an unbound company (e.g. one not yet keyed) is refused. It is immutable
// afterwards. Fixture identities (wh-main, wh-north, the Sample Company and synthetic acceptance warehouses) are refused as
// identities for a new master: they are evidence, not real sites.
//
// Every mutation states a reason and appends one eos_policy.audit_events row in the same transaction.
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ConfigurationRefusal, type AdminConfigurationOperation, type ConfigurationActor } from "../adminPolicy/configurationOperations";
import {
  LocationAuthorityError, createBin, createWarehouse, readWarehouse, renameBin, setBinStatus, setWarehouseStatus,
  type BinRecord,
} from "./warehouseBinRepository";
import { FORBIDDEN_WAREHOUSE_IDS, SYNTHETIC_ACCEPTANCE_WAREHOUSE } from "./syntheticAcceptanceWarehouse";

export const WAREHOUSE_ADMIN_AUDIT_TARGETS = Object.freeze({ WAREHOUSE: "warehouse", BIN: "bin" });
export const WAREHOUSE_ADMIN_AUDIT_ACTIONS = Object.freeze({
  WAREHOUSE_CREATED: "warehouse.created",
  WAREHOUSE_CHANGED: "warehouse.changed",
  WAREHOUSE_STATUS: "warehouse.statusChanged",
  BIN_CREATED: "bin.created",
  BIN_RELABELLED: "bin.relabelled",
  BIN_STATUS: "bin.statusChanged",
});

const refuse = (code: string, category: ConfigurationRefusal["category"], message: string): never => {
  throw new ConfigurationRefusal(code, category, message);
};

function text(input: Record<string, unknown>, field: string, max = 200): string {
  const v = input[field];
  if (typeof v !== "string" || v.trim() === "" || v.length > max) refuse(`${field.toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${field} is required (at most ${max} characters)`);
  return (v as string).trim();
}
function optionalText(input: Record<string, unknown>, field: string, max = 200): string | null | undefined {
  const v = input[field];
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" || v.length > max) refuse(`${field.toUpperCase()}_INVALID`, "INVALID_INPUT", `${field} must be text of at most ${max} characters`);
  return (v as string).trim();
}
function integer(input: Record<string, unknown>, field: string): number {
  const v = input[field];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100000) refuse(`${field.toUpperCase()}_INVALID`, "INVALID_INPUT", `${field} must be a non-negative integer`);
  return v as number;
}
function only(input: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(input ?? {}).filter((k) => !allowed.includes(k));
  if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
}
function requiredReason(reason: string | null): string {
  if (typeof reason !== "string" || reason.trim() === "") refuse("REASON_REQUIRED", "INVALID_INPUT", "a reason is required to change warehouse or bin master data");
  return (reason as string).trim();
}
function status(input: Record<string, unknown>): "ACTIVE" | "INACTIVE" {
  const v = input.status;
  if (v !== "ACTIVE" && v !== "INACTIVE") refuse("STATUS_INVALID", "INVALID_INPUT", "status must be ACTIVE or INACTIVE");
  return v as "ACTIVE" | "INACTIVE";
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
    if (err instanceof LocationAuthorityError) {
      const conflict = /NOT_FOUND|UNKNOWN/.test(err.code) ? "NOT_FOUND" as const : "INVALID_INPUT" as const;
      refuse(err.code, conflict, err.message);
    }
    if ((err as { code?: string })?.code === "23514") refuse("FIELD_NOT_CANONICAL", "INVALID_INPUT", "a racking value is not in the governed canonical form (area A-Z0-9_, aisle one or two letters)");
    if ((err as { code?: string })?.code === "23505") refuse("DUPLICATE", "CONFLICT", "that identity or bin position is already taken");
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

/** The ACTIVE bound key of a governed, ACTIVE operating company -- the only way a warehouse acquires a company. */
async function boundKeyOf(c: PoolClient, tenantId: string, operatingCompanyId: string): Promise<string> {
  const { rows } = await c.query(
    `SELECT b.operating_company_key FROM eos_policy.tenant_operating_company_keys b
       JOIN eos_policy.tenant_operating_companies co ON co.tenant_id = b.tenant_id AND co.operating_company_id = b.operating_company_id
      WHERE b.tenant_id = $1 AND b.operating_company_id = $2 AND b.status = 'ACTIVE' AND co.status = 'ACTIVE'`,
    [tenantId, operatingCompanyId]);
  if (rows.length !== 1) {
    refuse("OPERATING_COMPANY_NOT_GOVERNED", "CONFLICT",
      `operating company "${operatingCompanyId}" is not an ACTIVE company of this tenant with an ACTIVE operating company key`);
  }
  return rows[0].operating_company_key as string;
}

const WAREHOUSE_SELECT = `w.id, w.name, w.site_label, w.status::text AS status, w.provenance::text AS provenance, w.operating_company_key,
  (SELECT b.operating_company_id FROM eos_policy.tenant_operating_company_keys b WHERE b.tenant_id = w.tenant_id AND b.operating_company_key = w.operating_company_key AND b.status = 'ACTIVE' LIMIT 1) AS operating_company_id,
  (SELECT count(*)::int FROM eos_ops.bins x WHERE x.tenant_id = w.tenant_id AND x.warehouse_id = w.id) AS bin_count`;
const warehouseOf = (r: Record<string, unknown>) => ({ warehouseId: r.id, name: r.name, siteLabel: r.site_label, status: r.status,
  provenance: r.provenance, operatingCompanyId: r.operating_company_id ?? null, binCount: Number(r.bin_count ?? 0) });
const binOf = (b: BinRecord) => ({ binId: b.id, warehouseId: b.warehouseId, area: b.area, aisle: b.aisle, bay: b.bay, position: b.position,
  code: b.code, name: b.name, status: b.status });

async function listWarehouses(pool: Pool, tenantId: string) {
  const { rows } = await pool.query(`SELECT ${WAREHOUSE_SELECT} FROM eos_ops.warehouses w WHERE w.tenant_id = $1 ORDER BY w.name, w.id`, [tenantId]);
  return { items: rows.map(warehouseOf) };
}

async function listWarehouseBins(pool: Pool, tenantId: string, input: Record<string, unknown>) {
  only(input, ["warehouseId"]);
  const warehouseId = text(input, "warehouseId");
  const w = await readWarehouse(pool, tenantId, warehouseId);
  if (!w) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such warehouse");
  const { rows } = await pool.query(
    `SELECT id, warehouse_id, area, aisle, bay, "position", code, name, status::text AS status FROM eos_ops.bins
      WHERE tenant_id = $1 AND warehouse_id = $2 ORDER BY code, id`, [tenantId, warehouseId]);
  return { warehouseId, items: rows.map((b) => ({ binId: b.id, warehouseId: b.warehouse_id, area: b.area, aisle: b.aisle, bay: Number(b.bay),
    position: Number(b.position), code: b.code, name: b.name, status: b.status })) };
}

async function createWarehouseMaster(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null) {
  only(input, ["warehouseId", "name", "siteLabel", "operatingCompanyId"]);
  const why = requiredReason(reason);
  const warehouseId = text(input, "warehouseId", 64);
  if (FORBIDDEN_WAREHOUSE_IDS.includes(warehouseId) || warehouseId === SYNTHETIC_ACCEPTANCE_WAREHOUSE.warehouseId) {
    refuse("WAREHOUSE_IDENTITY_RESERVED", "CONFLICT", `"${warehouseId}" is a fixture identity, not a real warehouse master`);
  }
  const name = text(input, "name");
  const siteLabel = text(input, "siteLabel");
  const operatingCompanyId = text(input, "operatingCompanyId", 64);
  return tx(pool, async (c) => {
    const key = await boundKeyOf(c, actor.tenantId, operatingCompanyId);
    if (await readWarehouse(c, actor.tenantId, warehouseId)) refuse("WAREHOUSE_EXISTS", "CONFLICT", "a warehouse with that id already exists");
    const w = await createWarehouse(c, actor.tenantId, actor.principalId, { warehouseId, operatingCompanyKey: key, name, siteLabel, status: "ACTIVE", provenance: "NATIVE" });
    const after = { warehouseId: w.id, name, siteLabel, status: "ACTIVE", operatingCompanyId };
    await audit(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS.WAREHOUSE_CREATED, WAREHOUSE_ADMIN_AUDIT_TARGETS.WAREHOUSE, w.id, null, after, why);
    return { ...after, provenance: "NATIVE", binCount: 0 };
  });
}

async function updateWarehouseMaster(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null) {
  if ("operatingCompanyId" in (input ?? {}) || "operatingCompanyKey" in (input ?? {})) {
    refuse("WAREHOUSE_COMPANY_IMMUTABLE", "INVALID_INPUT", "a warehouse is its company's root; its operating company never changes");
  }
  only(input, ["warehouseId", "name", "siteLabel"]);
  const why = requiredReason(reason);
  const warehouseId = text(input, "warehouseId", 64);
  const name = optionalText(input, "name");
  const siteLabel = optionalText(input, "siteLabel");
  if (name === null || siteLabel === null) refuse("FIELD_INVALID", "INVALID_INPUT", "name and siteLabel cannot be cleared");
  if (name === undefined && siteLabel === undefined) refuse("NO_CHANGE", "INVALID_INPUT", "state a new name or siteLabel");
  return tx(pool, async (c) => {
    const before = await c.query(`SELECT ${WAREHOUSE_SELECT} FROM eos_ops.warehouses w WHERE w.tenant_id = $1 AND w.id = $2 FOR UPDATE`, [actor.tenantId, warehouseId]);
    if (before.rows.length === 0) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such warehouse");
    await c.query(`UPDATE eos_ops.warehouses SET name = coalesce($3, name), site_label = coalesce($4, site_label), updated_by = $5, updated_at = now()
                    WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, warehouseId, name ?? null, siteLabel ?? null, actor.principalId]);
    const after = await c.query(`SELECT ${WAREHOUSE_SELECT} FROM eos_ops.warehouses w WHERE w.tenant_id = $1 AND w.id = $2`, [actor.tenantId, warehouseId]);
    await audit(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS.WAREHOUSE_CHANGED, WAREHOUSE_ADMIN_AUDIT_TARGETS.WAREHOUSE, warehouseId,
      warehouseOf(before.rows[0]), warehouseOf(after.rows[0]), why);
    return warehouseOf(after.rows[0]);
  });
}

async function setWarehouseMasterStatus(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null) {
  only(input, ["warehouseId", "status"]);
  const why = requiredReason(reason);
  const warehouseId = text(input, "warehouseId", 64);
  const next = status(input);
  return tx(pool, async (c) => {
    const before = await readWarehouse(c, actor.tenantId, warehouseId);
    if (!before) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such warehouse");
    if (before!.status === next) return { warehouseId, status: next, changed: false };
    await setWarehouseStatus(c, actor.tenantId, actor.principalId, warehouseId, next);
    await audit(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS.WAREHOUSE_STATUS, WAREHOUSE_ADMIN_AUDIT_TARGETS.WAREHOUSE, warehouseId,
      { status: before!.status }, { status: next }, why);
    return { warehouseId, status: next, changed: true };
  });
}

async function createBinMaster(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null) {
  only(input, ["warehouseId", "area", "aisle", "bay", "position", "name", "idempotencyKey"]);
  const why = requiredReason(reason);
  const draft = { warehouseId: text(input, "warehouseId", 64), area: text(input, "area", 40), aisle: text(input, "aisle", 40),
    bay: integer(input, "bay"), position: integer(input, "position"), name: optionalText(input, "name") ?? null, idempotencyKey: text(input, "idempotencyKey") };
  return tx(pool, async (c) => {
    const w = await readWarehouse(c, actor.tenantId, draft.warehouseId);
    if (!w) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such warehouse");
    if (w!.status !== "ACTIVE") refuse("WAREHOUSE_NOT_ACTIVE", "CONFLICT", "bins are added only to an ACTIVE warehouse");
    const b = await createBin(c, actor.tenantId, actor.principalId, draft);
    await audit(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS.BIN_CREATED, WAREHOUSE_ADMIN_AUDIT_TARGETS.BIN, b.id, null, binOf(b), why);
    return binOf(b);
  });
}

async function relabelBinMaster(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null) {
  if ("warehouseId" in (input ?? {})) refuse("WAREHOUSE_NOT_MOVABLE", "INVALID_INPUT", "a bin's parent warehouse is immutable");
  only(input, ["binId", "area", "aisle", "bay", "position", "name"]);
  const why = requiredReason(reason);
  const binId = text(input, "binId");
  const attrs = { area: text(input, "area", 40), aisle: text(input, "aisle", 40), bay: integer(input, "bay"), position: integer(input, "position"),
    ...(input.name === undefined ? {} : { name: optionalText(input, "name") ?? null }) };
  return tx(pool, async (c) => {
    const before = await c.query(`SELECT id, warehouse_id, area, aisle, bay, "position", code, name, status::text AS status FROM eos_ops.bins WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, binId]);
    if (before.rows.length === 0) refuse("BIN_NOT_FOUND", "NOT_FOUND", "no such bin");
    const b = await renameBin(c, actor.tenantId, actor.principalId, binId, attrs);
    await audit(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS.BIN_RELABELLED, WAREHOUSE_ADMIN_AUDIT_TARGETS.BIN, binId,
      { code: before.rows[0].code, name: before.rows[0].name }, { code: b.code, name: b.name }, why);
    return binOf(b);
  });
}

async function setBinMasterStatus(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null) {
  only(input, ["binId", "status"]);
  const why = requiredReason(reason);
  const binId = text(input, "binId");
  const next = status(input);
  return tx(pool, async (c) => {
    const before = await c.query(`SELECT status::text AS status FROM eos_ops.bins WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, binId]);
    if (before.rows.length === 0) refuse("BIN_NOT_FOUND", "NOT_FOUND", "no such bin");
    if (before.rows[0].status === next) return { binId, status: next, changed: false };
    const b = await setBinStatus(c, actor.tenantId, actor.principalId, binId, next);
    await audit(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS.BIN_STATUS, WAREHOUSE_ADMIN_AUDIT_TARGETS.BIN, binId, { status: before.rows[0].status }, { status: next }, why);
    return { ...binOf(b), changed: true };
  });
}

export const WAREHOUSE_ADMIN_OPERATIONS = Object.freeze([
  "listWarehouses", "listWarehouseBins", "createWarehouse", "updateWarehouse", "setWarehouseStatus", "createBin", "relabelBin", "setBinStatus",
] as const);
export const isWarehouseAdminOperation = (op: string): boolean => (WAREHOUSE_ADMIN_OPERATIONS as readonly string[]).includes(op);

export function createWarehouseBinAdministration(pool: Pool) {
  return async (operation: AdminConfigurationOperation, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null): Promise<unknown> => {
    // The stated reason travels in the Administration input; it is the `reason` argument here, not a master-data field.
    const { reason: _stated, ...i } = input && typeof input === "object" && !Array.isArray(input) ? input : ({} as Record<string, unknown>);
    void _stated;
    switch (operation) {
      case "listWarehouses": only(i, []); return listWarehouses(pool, actor.tenantId);
      case "listWarehouseBins": return listWarehouseBins(pool, actor.tenantId, i);
      case "createWarehouse": return createWarehouseMaster(pool, actor, i, reason);
      case "updateWarehouse": return updateWarehouseMaster(pool, actor, i, reason);
      case "setWarehouseStatus": return setWarehouseMasterStatus(pool, actor, i, reason);
      case "createBin": return createBinMaster(pool, actor, i, reason);
      case "relabelBin": return relabelBinMaster(pool, actor, i, reason);
      case "setBinStatus": return setBinMasterStatus(pool, actor, i, reason);
      default: throw new Error(`not a warehouse administration operation: ${String(operation)}`);
    }
  };
}
