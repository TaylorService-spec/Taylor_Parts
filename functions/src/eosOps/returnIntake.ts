// RETURNS INTAKE ON EOS CORE -- recording that something came back, and nothing more (Firebase exit F7a; DECISIONS #242).
//
// The Firestore command (inventoryReturns/returnIntakeCommand.ts) re-homed onto eos_ops.inventory_returns, its behaviour kept by
// Owner ruling: intake only (DECISIONS #118 -- NO ledger movement, never restores sellable stock), the same closed source and
// condition vocabularies, quantity XOR serials, one idempotency key = one return (a replay answers from the STORED record; a
// different return under a used key is refused, never "replayed").
//
// NEW, by Owner ruling (2026-10-17):
//   * the OPERATING COMPANY is REQUIRED and must be one of the caller's companies (eosOps/inventoryCompanyAuthority.ts, the #237 check; a
//     protected Administrator holds every governed company, OD-ISO-2):
//     a company outside them answers exactly like an unknown one (OPERATING_COMPANY_NOT_GOVERNED). No authority at all is
//     COMPANY_AUTHORITY_REQUIRED. Every refusal precedes any write.
//   * the receiving WAREHOUSE is optional; when stated it must belong to that company AND be in the caller's warehouse reach
//     (partsReads.scopedWarehouseIds, narrowed to the caller's companies). Outside either it answers exactly like an unknown warehouse (WAREHOUSE_NOT_FOUND).
//   * every recorded return writes ONE eos_policy.audit_events row in the same transaction; a replay writes nothing.
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { ReorderLifecycleError, type ReorderActor } from "./reorderLifecycleCommands.js";
import { resolveInventoryCompanyAuthority } from "./inventoryCompanyAuthority.js";
import { scopedWarehouseIds } from "./partsReads.js";
import { withActorAuthority } from "./administrationReach.js";

export const RETURN_INTAKE_CAPABILITY = "inventory.returns.intake";
export const RETURN_SOURCES = Object.freeze(["WORK_ORDER", "CUSTOMER", "TRUCK", "SUPPLIER", "UNKNOWN"] as const);
export const RETURN_CONDITIONS = Object.freeze(["UNOPENED", "OPENED", "DAMAGED", "UNKNOWN"] as const);
export const RETURN_STATE = "AWAITING_DISPOSITION";

const MAX_REASON = 500;
const MAX_KEY = 200;
const MAX_PART = 256;
const ACCEPTED = new Set(["operatingCompanyId", "warehouseId", "partId", "source", "sourceReference", "condition", "reason",
  "quantity", "serialNumbers", "idempotencyKey"]);

const refuse = (code: string, category: "INVALID_INPUT" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT", message: string): never => {
  throw new ReorderLifecycleError(code, category, message);
};
const nonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export interface ReturnIntakeRequest {
  readonly operatingCompanyId: string;
  readonly warehouseId: string | null;
  readonly partId: string;
  readonly source: string;
  readonly sourceReference: string | null;
  readonly condition: string;
  readonly reason: string | null;
  readonly quantity: number | null;
  readonly serialNumbers: readonly string[];
  readonly idempotencyKey: string;
}

/** The Firestore command's validation, rule for rule, plus the company/warehouse fields. Pure; exported for tests. */
export function validateReturnIntake(input: unknown): ReturnIntakeRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) refuse("INPUT_REQUIRED", "INVALID_INPUT", "a return is required");
  const d = input as Record<string, unknown>;
  const extra = Object.keys(d).filter((k) => !ACCEPTED.has(k));
  if (extra.length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
  if (!nonBlank(d.operatingCompanyId)) refuse("OPERATING_COMPANY_REQUIRED", "INVALID_INPUT", "operatingCompanyId is required");
  const warehouseId = d.warehouseId === undefined || d.warehouseId === null ? null : d.warehouseId;
  if (warehouseId !== null && !nonBlank(warehouseId)) refuse("WAREHOUSE_ID_INVALID", "INVALID_INPUT", "warehouseId, when stated, is a warehouse id");
  if (!nonBlank(d.partId) || d.partId.trim().length > MAX_PART) refuse("PART_REQUIRED", "INVALID_INPUT", "partId is required");
  if (!nonBlank(d.idempotencyKey) || d.idempotencyKey.length > MAX_KEY) refuse("IDEMPOTENCY_KEY_REQUIRED", "INVALID_INPUT", "idempotencyKey is required");
  // An UNRECOGNIZED source or condition is REFUSED, never coerced to UNKNOWN: UNKNOWN means "nobody could tell".
  if (!(RETURN_SOURCES as readonly unknown[]).includes(d.source)) refuse("SOURCE_INVALID", "INVALID_INPUT", `source must be ${RETURN_SOURCES.join("/")}`);
  if (!(RETURN_CONDITIONS as readonly unknown[]).includes(d.condition)) refuse("CONDITION_INVALID", "INVALID_INPUT", `condition must be ${RETURN_CONDITIONS.join("/")}`);
  let reason: string | null = null;
  if (d.reason !== undefined && d.reason !== null) {
    if (typeof d.reason !== "string") refuse("REASON_INVALID", "INVALID_INPUT", "reason must be text");
    const trimmed = (d.reason as string).trim();
    if (trimmed.length > MAX_REASON) refuse("REASON_TOO_LONG", "INVALID_INPUT", `reason is at most ${MAX_REASON} characters`);
    reason = trimmed === "" ? null : trimmed;
  }
  const sourceReference = nonBlank(d.sourceReference) ? d.sourceReference.trim() : null;
  const hasSerials = d.serialNumbers !== undefined;
  if (hasSerials === (d.quantity !== undefined)) refuse("QUANTITY_OR_SERIALS_REQUIRED", "INVALID_INPUT", "state a quantity or serial numbers, not both");
  let quantity: number | null = null;
  let serialNumbers: string[] = [];
  if (hasSerials) {
    if (!Array.isArray(d.serialNumbers) || d.serialNumbers.length === 0 || !d.serialNumbers.every(nonBlank)) {
      refuse("SERIALS_INVALID", "INVALID_INPUT", "serialNumbers must be a non-empty list of serial numbers");
    }
    serialNumbers = (d.serialNumbers as string[]).map((s) => s.trim());
    if (new Set(serialNumbers.map((s) => s.toLowerCase())).size !== serialNumbers.length) {
      refuse("SERIALS_DUPLICATED", "INVALID_INPUT", "a serial number appears twice");
    }
  } else {
    if (typeof d.quantity !== "number" || !Number.isInteger(d.quantity) || d.quantity <= 0) {
      refuse("QUANTITY_INVALID", "INVALID_INPUT", "quantity must be a positive whole number");
    }
    quantity = d.quantity as number;
  }
  return Object.freeze({
    operatingCompanyId: (d.operatingCompanyId as string).trim(), warehouseId: warehouseId === null ? null : (warehouseId as string).trim(),
    partId: (d.partId as string).trim(), source: d.source as string, sourceReference, condition: d.condition as string, reason,
    quantity, serialNumbers: Object.freeze(serialNumbers), idempotencyKey: d.idempotencyKey as string,
  });
}

/** Derived, so a retry on a bad connection replays rather than recording the same return twice (the Firestore rule). */
export const deriveReturnId = (idempotencyKey: string): string => `ret_${idempotencyKey}`;

function requireIntake(actor: ReorderActor): void {
  if (!actor || !(actor.capabilities instanceof Set) || !actor.capabilities.has(RETURN_INTAKE_CAPABILITY)) {
    refuse("CAPABILITY_MISSING", "FORBIDDEN", `taking a return in requires ${RETURN_INTAKE_CAPABILITY}`);
  }
}

/**
 * The caller's companies (ids and keys) as resolveInventoryCompanyAuthority decides them: their own, or every governed company for a
 * protected Administrator (OD-ISO-2). COMPANY_AUTHORITY_REQUIRED when there are none (fail closed, #237).
 */
async function callerCompanies(c: Pick<PoolClient, "query">, actor: ReorderActor): Promise<{ readonly ids: readonly string[]; readonly keys: readonly string[] }> {
  const authority = await resolveInventoryCompanyAuthority(c, actor.tenantId, actor.principalId);
  if (authority.companyKeys.length === 0) refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", "taking a return in requires company authority");
  const { rows } = await c.query<{ id: string }>(
    `SELECT DISTINCT operating_company_id AS id FROM eos_policy.tenant_operating_company_keys
      WHERE tenant_id = $1 AND status = 'ACTIVE' AND operating_company_key = ANY($2::text[]) ORDER BY 1`, [actor.tenantId, [...authority.companyKeys]]);
  return { ids: rows.map((r) => String(r.id)), keys: authority.companyKeys };
}

/** The warehouses the caller may name for a return: in their reach AND belonging to one of their companies, ACTIVE. */
async function eligibleWarehouses(c: Pick<PoolClient, "query">, actor: ReorderActor, companies: readonly string[], companyKeys: readonly string[]) {
  const reach = await scopedWarehouseIds(c, actor, { companyKeys });
  if (reach.length === 0) return [];
  const { rows } = await c.query<{ id: string; name: string; company: string }>(
    `SELECT w.id, w.name, k.operating_company_id AS company
       FROM eos_ops.warehouses w
       JOIN eos_policy.tenant_operating_company_keys k
         ON k.tenant_id = w.tenant_id AND k.operating_company_key = w.operating_company_key AND k.status = 'ACTIVE'
      WHERE w.tenant_id = $1 AND w.id = ANY($2::text[]) AND w.status::text = 'ACTIVE' AND k.operating_company_id = ANY($3::text[])
      ORDER BY w.name, w.id`, [actor.tenantId, reach, [...companies]]);
  return rows.map((r) => ({ warehouseId: String(r.id), name: String(r.name), operatingCompanyId: String(r.company) }));
}

const outcomeOf = (outcome: "recorded" | "replayed", r: Record<string, unknown>) => Object.freeze({
  outcome, returnId: String(r.id), operatingCompanyId: String(r.operating_company_id),
  warehouseId: r.warehouse_id === null ? null : String(r.warehouse_id), partId: String(r.part_id), state: RETURN_STATE,
  quantity: r.quantity === null ? null : Number(r.quantity), serialNumbers: Object.freeze([...(r.serial_numbers as string[])]),
});

/**
 * Record that something came back. One transaction: capability -> company -> warehouse -> idempotency -> ONE row + ONE audit
 * row. It touches nothing else -- no ledger, no balance, no serialized-asset state.
 */
export async function recordReturnIntake(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireIntake(actor);
  const req = validateReturnIntake(input);
  const id = deriveReturnId(req.idempotencyKey);
  const c = await deps.pool.connect();
  try {
    await c.query("BEGIN");
    const { ids: companies, keys: companyKeys } = await callerCompanies(c, actor);
    if (!companies.includes(req.operatingCompanyId)) {
      refuse("OPERATING_COMPANY_NOT_GOVERNED", "INVALID_INPUT", "operatingCompanyId is not an active operating company you may act for");
    }
    if (req.warehouseId !== null) {
      const ok = (await eligibleWarehouses(c, actor, [req.operatingCompanyId], companyKeys)).some((w) => w.warehouseId === req.warehouseId);
      if (!ok) refuse("WAREHOUSE_NOT_FOUND", "NOT_FOUND", "no such receiving warehouse for that operating company");
    }
    // One key, one return. Serialized on the key so two concurrent first attempts cannot both insert.
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1 || '/' || $2))", [actor.tenantId, id]);
    const existing = (await c.query(`SELECT * FROM eos_ops.inventory_returns WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, id])).rows[0];
    if (existing) {
      const stored = existing.serial_numbers as string[];
      const same = existing.operating_company_id === req.operatingCompanyId && (existing.warehouse_id ?? null) === req.warehouseId
        && existing.part_id === req.partId && existing.source === req.source && (existing.source_reference ?? null) === req.sourceReference
        && existing.condition === req.condition && (existing.reason ?? null) === req.reason
        && (existing.quantity === null ? null : Number(existing.quantity)) === req.quantity
        && stored.length === req.serialNumbers.length && stored.every((s, i) => s === req.serialNumbers[i]);
      if (!same) refuse("IDEMPOTENCY_CONFLICT", "CONFLICT", "that request id was already used for a different return");
      await c.query("COMMIT");
      return outcomeOf("replayed", existing);
    }
    const { rows } = await c.query(
      `INSERT INTO eos_ops.inventory_returns
         (tenant_id, id, idempotency_key, operating_company_id, warehouse_id, part_id, source, source_reference, condition, reason,
          quantity, serial_numbers, state, provenance, received_at, received_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'NATIVE',now(),$14,$14) RETURNING *`,
      [actor.tenantId, id, req.idempotencyKey, req.operatingCompanyId, req.warehouseId, req.partId, req.source, req.sourceReference,
        req.condition, req.reason, req.quantity, [...req.serialNumbers], RETURN_STATE, actor.principalId]);
    const after = { ...outcomeOf("recorded", rows[0]), source: req.source, condition: req.condition };
    await c.query(
      `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
       VALUES ($1,$2,'inventory.return.intake',$3,'inventory_return',$4,NULL,$5::jsonb,now(),$6)`,
      [`audit_${randomUUID()}`, actor.tenantId, actor.principalId, id,
        JSON.stringify(await withActorAuthority(c, actor.tenantId, actor.principalId, after)), "return intake (AWAITING_DISPOSITION; no ledger movement)"]);
    await c.query("COMMIT");
    return outcomeOf("recorded", rows[0]);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

/** What the intake screen may offer: the caller's companies and the receiving warehouses each allows. Grants nothing. */
export async function listReturnIntakeOptions(deps: { readonly pool: Pool }, actor: ReorderActor, input: Record<string, unknown>) {
  requireIntake(actor);
  if (Object.keys(input ?? {}).length > 0) refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", "this read accepts no input");
  const c = await deps.pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { ids: companies, keys: companyKeys } = await callerCompanies(c, actor);
    const keys = (await c.query<{ id: string; key: string }>(
      `SELECT operating_company_id AS id, min(operating_company_key) AS key FROM eos_policy.tenant_operating_company_keys
        WHERE tenant_id = $1 AND status = 'ACTIVE' AND operating_company_id = ANY($2::text[]) GROUP BY 1 ORDER BY 1`,
      [actor.tenantId, [...companies]])).rows;
    const warehouses = await eligibleWarehouses(c, actor, companies, companyKeys);
    await c.query("COMMIT");
    const keyOf = new Map(keys.map((k) => [String(k.id), String(k.key)]));
    return Object.freeze({
      // Whose answer this is, as the SERVER resolved it -- the client binds any offline copy to exactly this tenant and
      // Principal (it has no tenant of its own to check). Grants nothing: every replay is re-authorized in full.
      tenantId: actor.tenantId,
      principalId: actor.principalId,
      companies: companies.map((id) => Object.freeze({ operatingCompanyId: id, operatingCompanyKey: keyOf.get(id) ?? null })),
      warehouses,
    });
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
