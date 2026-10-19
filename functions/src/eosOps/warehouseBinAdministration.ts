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
import { withActorAuthority } from "./administrationReach";
import { resolveInventoryCompanyAuthority } from "./inventoryCompanyAuthority";
import { MAX_BIN_PROPOSALS, classifyBin, planBinCreates, validateProposal, type BinVerdict, type StoredBinRow, type StoredClaimRow } from "./binRackingPlan";

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
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(await withActorAuthority(c, actor.tenantId, actor.principalId, after)), reason]);
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

// ════════════════════ THE WAREHOUSE RACKING PLANNER (Firebase exit B3; Owner rulings 5-7) ════════════════════
//
// Administration > Warehouse Racking, served on EOS in place of the Firebase bin callables (createBin, renameBin, deactivateBin,
// reactivateBin, previewBinCreates, listBins) and the Firestore `warehouses` picker. Gated by the Firebase catalog's OWN ids, mirrored
// (inventory.location.bin.read / .manage -- same holders, no new one), NOT by warehouse.record.manage: this is the bin administrator's
// audience, a different one from warehouse master configuration.
//
//   PARTIAL SUCCESS, PER-ITEM OUTCOMES, SAFE RETRY, NO FALSE WHOLE-BATCH SUCCESS (ruling 5). createBins applies the planner's bins ONE
//   BIN PER TRANSACTION -- a bin and its HELD code claim commit together, each with its own audit row -- and answers per item: CREATED,
//   UNCHANGED (an exact replay: same id, same rack position, code held by it) or REFUSED with its classification and reason. A batch is
//   never one transaction and never reports a single boolean; a retry of the same request is, per bin, UNCHANGED. Bins are never moved,
//   overwritten or revived by a create, and a code claim is never released.
//
//   COMPANY ISOLATION. A bin carries no company; its warehouse does. Every racking operation reaches only the warehouses of operating
//   companies the caller is authorized for (resolveInventoryCompanyAuthority: the caller's own companies, or every governed company for a protected Administrator (OD-ISO-2); #235 / #237): none at all is COMPANY_AUTHORITY_REQUIRED, and a
//   warehouse (or a bin of a warehouse) outside the caller's companies reads exactly as a nonexistent one.
const RACKING_LIST_LIMIT = 2000;

async function rackingReach(c: Pick<PoolClient, "query">, actor: ConfigurationActor): Promise<readonly string[]> {
  const authority = await resolveInventoryCompanyAuthority(c, actor.tenantId, actor.principalId);
  if (authority.companyKeys.length === 0) refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", "racking requires operating-company authority; this principal has none");
  return authority.companyKeys;
}

async function reachableWarehouse(c: PoolClient | Pool, actor: ConfigurationActor, warehouseId: string, keys: readonly string[]) {
  const w = await readWarehouse(c, actor.tenantId, warehouseId);
  if (!w || !keys.includes(w.operatingCompanyKey)) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such warehouse");
  return w!;
}

function proposalsOf(input: Record<string, unknown>): readonly unknown[] {
  const p = input.proposals;
  if (!Array.isArray(p)) refuse("PROPOSALS_REQUIRED", "INVALID_INPUT", "proposals must be a list");
  if ((p as unknown[]).length > MAX_BIN_PROPOSALS) refuse("TOO_MANY_PROPOSALS", "INVALID_INPUT", `at most ${MAX_BIN_PROPOSALS} bins per request; nothing is truncated`);
  return p as unknown[];
}

async function snapshot<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function listRackingWarehouses(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>) {
  only(input, []);
  const keys = await rackingReach(pool, actor);
  const { rows } = await pool.query(
    `SELECT ${WAREHOUSE_SELECT} FROM eos_ops.warehouses w WHERE w.tenant_id = $1 AND w.operating_company_key = ANY($2::text[]) ORDER BY w.name, w.id`,
    [actor.tenantId, [...keys]]);
  return { items: rows.map(warehouseOf) };
}

async function listRackingBins(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>) {
  only(input, ["warehouseId"]);
  const warehouseId = text(input, "warehouseId", 64);
  const keys = await rackingReach(pool, actor);
  await reachableWarehouse(pool, actor, warehouseId, keys);
  const { rows } = await pool.query(
    `SELECT id, warehouse_id, area, aisle, bay, "position", code, name, status::text AS status FROM eos_ops.bins
      WHERE tenant_id = $1 AND warehouse_id = $2 ORDER BY code, id LIMIT ${RACKING_LIST_LIMIT + 1}`, [actor.tenantId, warehouseId]);
  return {
    warehouseId, truncated: rows.length > RACKING_LIST_LIMIT,
    items: rows.slice(0, RACKING_LIST_LIMIT).map((b) => ({ binId: b.id, warehouseId: b.warehouse_id, area: b.area, aisle: b.aisle, bay: Number(b.bay),
      position: Number(b.position), code: b.code, name: b.name, status: b.status })),
  };
}

const verdictOut = ({ value: _value, ...v }: BinVerdict) => { void _value; return v; };
const summarize = (verdicts: readonly { classification: string }[]) => {
  const out: Record<string, number> = {};
  for (const v of verdicts) out[v.classification] = (out[v.classification] ?? 0) + 1;
  return out;
};

async function previewBinCreates(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>) {
  only(input, ["warehouseId", "proposals"]);
  const warehouseId = text(input, "warehouseId", 64);
  const proposals = proposalsOf(input);
  return snapshot(pool, async (c) => {
    const keys = await rackingReach(c, actor);
    const w = await reachableWarehouse(c, actor, warehouseId, keys);
    const bins = await c.query(`SELECT id, area, aisle, bay, "position", code, status::text AS status FROM eos_ops.bins WHERE tenant_id = $1 AND warehouse_id = $2`, [actor.tenantId, warehouseId]);
    const claims = await c.query(`SELECT code, bin_id, claim_state::text AS claim_state FROM eos_ops.bin_code_claims WHERE tenant_id = $1 AND warehouse_id = $2`, [actor.tenantId, warehouseId]);
    const rows = planBinCreates(
      warehouseId, proposals,
      bins.rows.map((b): StoredBinRow => ({ id: b.id, area: b.area, aisle: b.aisle, bay: Number(b.bay), position: Number(b.position), code: b.code, status: b.status })),
      claims.rows.map((k): StoredClaimRow => ({ code: k.code, binId: k.bin_id, claimState: k.claim_state })));
    return { warehouseId, warehouseStatus: w.status, rows: rows.map(verdictOut), summary: summarize(rows) };
  });
}

export type BinCreateOutcome = "CREATED" | "UNCHANGED" | "REFUSED";
interface BinCreateItem {
  readonly index: number; readonly idempotencyKey: string | null; readonly outcome: BinCreateOutcome;
  readonly classification: string; readonly reason: string | null; readonly binId: string | null; readonly code: string | null;
}

/** ONE bin, ONE transaction: decide against the rows as they are NOW, then insert the bin and HOLD its code, or answer without writing. */
async function applyOneBin(pool: Pool, actor: ConfigurationActor, verdict: BinVerdict, why: string): Promise<BinCreateItem> {
  const value = verdict.value!;
  const item = (outcome: BinCreateOutcome, classification: string, reason: string | null, binId: string | null): BinCreateItem =>
    ({ index: verdict.index, idempotencyKey: verdict.idempotencyKey, outcome, classification, reason, binId, code: value.code });
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const active = await c.query(`SELECT 1 FROM eos_ops.warehouses WHERE tenant_id = $1 AND id = $2 AND status::text = 'ACTIVE' FOR SHARE`, [actor.tenantId, value.warehouseId]);
      if (active.rows.length === 0) { await c.query("ROLLBACK"); return item("REFUSED", "INVALID", "warehouse_not_active", verdict.binId); }
      const binId = verdict.binId as string;
      const [byId, byPos, claim] = await Promise.all([
        c.query(`SELECT id, area, aisle, bay, "position", code, status::text AS status FROM eos_ops.bins WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, binId]),
        c.query(`SELECT id, area, aisle, bay, "position", code, status::text AS status FROM eos_ops.bins WHERE tenant_id = $1 AND warehouse_id = $2 AND area = $3 AND aisle = $4 AND bay = $5 AND "position" = $6`,
          [actor.tenantId, value.warehouseId, value.area, value.aisle, value.bay, value.position]),
        c.query(`SELECT code, bin_id, claim_state::text AS claim_state FROM eos_ops.bin_code_claims WHERE tenant_id = $1 AND warehouse_id = $2 AND code = $3`, [actor.tenantId, value.warehouseId, value.code]),
      ]);
      const row = (r: Record<string, unknown> | undefined): StoredBinRow | null => r === undefined ? null
        : { id: String(r.id), area: String(r.area), aisle: String(r.aisle), bay: Number(r.bay), position: Number(r.position), code: String(r.code), status: String(r.status) };
      const decided = classifyBin(verdict.index, value, {
        binById: row(byId.rows[0]), binByPosition: row(byPos.rows[0]),
        claimByCode: claim.rows[0] === undefined ? null : { code: String(claim.rows[0].code), binId: String(claim.rows[0].bin_id), claimState: String(claim.rows[0].claim_state) },
      });
      if (decided.classification === "ALREADY_EXISTS") { await c.query("ROLLBACK"); return item("UNCHANGED", "ALREADY_EXISTS", null, binId); }
      if (decided.classification !== "NEW") { await c.query("ROLLBACK"); return item("REFUSED", decided.classification, decided.reason, decided.binId); }
      const b = await createBin(c, actor.tenantId, actor.principalId, { warehouseId: value.warehouseId, area: value.area, aisle: value.aisle,
        bay: value.bay, position: value.position, name: value.name ?? null, idempotencyKey: value.idempotencyKey });
      await audit(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS.BIN_CREATED, WAREHOUSE_ADMIN_AUDIT_TARGETS.BIN, b.id, null, binOf(b), why);
      await c.query("COMMIT");
      return item("CREATED", "NEW", null, b.id);
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      // A concurrent writer took the same id, position or code between the read and the insert: re-decide ONCE against the new truth.
      if ((err as { code?: string })?.code === "23505" && attempt === 0) continue;
      if ((err as { code?: string })?.code === "23505") return item("REFUSED", "INTEGRITY_ERROR", "concurrent_conflict", verdict.binId);
      if (err instanceof LocationAuthorityError) return item("REFUSED", "INVALID", err.code, verdict.binId);
      throw err;
    } finally {
      c.release();
    }
  }
  return item("REFUSED", "INTEGRITY_ERROR", "concurrent_conflict", verdict.binId);
}

async function createBins(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null) {
  only(input, ["warehouseId", "proposals"]);
  const why = requiredReason(reason);
  const warehouseId = text(input, "warehouseId", 64);
  const proposals = proposalsOf(input);
  // The warehouse gate, once: reach and ACTIVE. Everything after it is per bin.
  const gate = await snapshot(pool, async (c) => {
    const keys = await rackingReach(c, actor);
    return reachableWarehouse(c, actor, warehouseId, keys);
  });
  if (gate.status !== "ACTIVE") refuse("WAREHOUSE_NOT_ACTIVE", "CONFLICT", "bins are added only to an ACTIVE warehouse");
  const seenIds = new Set<string>(); const seenPositions = new Set<string>(); const seenCodes = new Set<string>();
  const items: BinCreateItem[] = [];
  for (let index = 0; index < proposals.length; index++) {
    const checked = validateProposal(index, warehouseId, proposals[index]);
    if (!checked.valid) { const v = checked.verdict; items.push({ index, idempotencyKey: v.idempotencyKey, outcome: "REFUSED", classification: v.classification, reason: v.reason, binId: null, code: null }); continue; }
    const v = checked.value;
    const verdict = classifyBin(index, v, { binById: null, binByPosition: null, claimByCode: null });
    const pos = `${v.area}\u0000${v.aisle}\u0000${v.bay}\u0000${v.position}`;
    if (seenIds.has(verdict.binId as string) || seenPositions.has(pos) || seenCodes.has(v.code)) {
      items.push({ index, idempotencyKey: v.idempotencyKey, outcome: "REFUSED", classification: "INVALID", reason: "duplicate_in_request", binId: verdict.binId, code: v.code });
      continue;
    }
    seenIds.add(verdict.binId as string); seenPositions.add(pos); seenCodes.add(v.code);
    items.push(await applyOneBin(pool, actor, verdict, why));
  }
  const count = (o: BinCreateOutcome) => items.filter((i) => i.outcome === o).length;
  // NEVER a single success flag: `complete` is true only when no item was refused, and the items are the answer.
  return { warehouseId, requested: proposals.length, created: count("CREATED"), unchanged: count("UNCHANGED"), refused: count("REFUSED"),
    complete: count("REFUSED") === 0, items };
}

/** The bin (with its warehouse's company) the caller reaches, locked; absent or outside the caller's companies is BIN_NOT_FOUND. */
async function reachableBinForUpdate(c: PoolClient, actor: ConfigurationActor, binId: string) {
  const keys = await rackingReach(c, actor);
  const { rows } = await c.query(
    `SELECT b.id, b.warehouse_id, b.area, b.aisle, b.bay, b."position", b.code, b.name, b.status::text AS status, w.operating_company_key
       FROM eos_ops.bins b JOIN eos_ops.warehouses w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
      WHERE b.tenant_id = $1 AND b.id = $2 AND w.operating_company_key = ANY($3::text[]) FOR UPDATE OF b`, [actor.tenantId, binId, [...keys]]);
  // The company filter is IN the WHERE: a foreign-company bin is never locked, and reads exactly as a missing one.
  if (rows.length === 0) refuse("BIN_NOT_FOUND", "NOT_FOUND", "no such bin");
  return rows[0];
}

async function renameRackingBin(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null) {
  only(input, ["binId", "name"]);
  const why = requiredReason(reason);
  const binId = text(input, "binId");
  const name = optionalText(input, "name");
  if (name === undefined) refuse("NAME_REQUIRED", "INVALID_INPUT", "state the new name (or null to clear it)");
  return tx(pool, async (c) => {
    const before = await reachableBinForUpdate(c, actor, binId);
    if ((name ?? null) === (before.name ?? null)) return { ...binOfRow(before), changed: false };
    // A NAME edit keeps the rack position: the bin's own attributes are sent back unchanged, so its code and claim do not move.
    const b = await renameBin(c, actor.tenantId, actor.principalId, binId,
      { area: before.area, aisle: before.aisle, bay: Number(before.bay), position: Number(before.position), name: name ?? null });
    await audit(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS.BIN_RELABELLED, WAREHOUSE_ADMIN_AUDIT_TARGETS.BIN, binId,
      { code: before.code, name: before.name }, { code: b.code, name: b.name }, why);
    return { ...binOf(b), changed: true };
  });
}

async function setRackingBinStatus(pool: Pool, actor: ConfigurationActor, input: Record<string, unknown>, reason: string | null) {
  only(input, ["binId", "status"]);
  const why = requiredReason(reason);
  const binId = text(input, "binId");
  const next = status(input);
  return tx(pool, async (c) => {
    const before = await reachableBinForUpdate(c, actor, binId);
    if (before.status === next) return { ...binOfRow(before), changed: false };
    const b = await setBinStatus(c, actor.tenantId, actor.principalId, binId, next);
    await audit(c, actor, WAREHOUSE_ADMIN_AUDIT_ACTIONS.BIN_STATUS, WAREHOUSE_ADMIN_AUDIT_TARGETS.BIN, binId, { status: before.status }, { status: next }, why);
    return { ...binOf(b), changed: true };
  });
}

const binOfRow = (r: Record<string, unknown>) => ({ binId: r.id, warehouseId: r.warehouse_id, area: r.area, aisle: r.aisle, bay: Number(r.bay),
  position: Number(r.position), code: r.code, name: r.name, status: r.status });

export const WAREHOUSE_ADMIN_OPERATIONS = Object.freeze([
  "listWarehouses", "listWarehouseBins", "createWarehouse", "updateWarehouse", "setWarehouseStatus", "createBin", "relabelBin", "setBinStatus",
  // The Warehouse Racking planner (Firebase exit B3), gated by inventory.location.bin.read / .manage.
  "listRackingWarehouses", "listRackingBins", "previewBinCreates", "createBins", "renameRackingBin", "setRackingBinStatus",
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
      case "listRackingWarehouses": return listRackingWarehouses(pool, actor, i);
      case "listRackingBins": return listRackingBins(pool, actor, i);
      case "previewBinCreates": return previewBinCreates(pool, actor, i);
      case "createBins": return createBins(pool, actor, i, reason);
      case "renameRackingBin": return renameRackingBin(pool, actor, i, reason);
      case "setRackingBinStatus": return setRackingBinStatus(pool, actor, i, reason);
      default: throw new Error(`not a warehouse administration operation: ${String(operation)}`);
    }
  };
}
