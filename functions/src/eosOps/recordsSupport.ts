// SHARED SUPPORT FOR THE RECORDS AND REPORTING OPERATIONS (Firebase exit B4, DECISIONS #B4): imported service history, Data Import, Report Builder /
// Saved Reports and performance goals. Each is its own module with its own authority; this file holds only what they genuinely share and decides
// nothing about any of them:
//
//   * the closed refusal class (ReceiveStockError -- the same { code, category } class the supplier receiving reads use, mapped by eosOpsHttp),
//   * the ONE capability-then-company order: the capability is checked first, then the caller's operating companies (companyAuthority.ts), and a
//     caller with no company authority is REFUSED (COMPANY_AUTHORITY_REQUIRED) rather than answered with an empty list,
//   * one transaction wrapper (a write, or a REPEATABLE READ READ ONLY snapshot) and one audit writer.
//
// Authority is the resolved actor's: no tenant, principal, capability or company is accepted from the caller (acceptOnly refuses unknown input).
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ReceiveStockError, ID_SHAPE, type ReceiveFailureCategory } from "./receiveReorderStockCommand.js";
import { resolveCompanyAuthority } from "./companyAuthority.js";
import { withActorAuthority } from "./administrationReach.js";
import { operatingCompanyDisplayName } from "../ownership/operatingCompanyAuthority.js";

export { ID_SHAPE };

/** The resolved caller: tenant, EOS Principal id and the capability KEYS held (conditioned grants already withheld). */
export interface RecordsActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly capabilities: ReadonlySet<string>;
}

export const refuse: (code: string, category: ReceiveFailureCategory, message: string) => never = (code, category, message) => {
  throw new ReceiveStockError(code, category, message);
};

export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Input that names only the allowed keys. An unknown key is refused (never ignored), so a caller cannot believe it chose an authority. */
export function acceptOnly(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  const i = input === undefined || input === null ? {} : input;
  if (!isPlainObject(i)) return refuse("INPUT_INVALID", "INVALID_INPUT", "input must be an object");
  const extra = Object.keys(i).filter((k) => !allowed.includes(k));
  if (extra.length > 0) return refuse("INPUT_FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${extra.sort().join(", ")}`);
  return i;
}

/** Capability first. Anything but a resolved tenant, principal and a held key is a refusal. */
export function requireCapability(actor: RecordsActor, capability: string): void {
  if (!actor || !ID_SHAPE(actor.tenantId) || !ID_SHAPE(actor.principalId) || !(actor.capabilities instanceof Set)) {
    refuse("ACTOR_CONTEXT_REQUIRED", "FORBIDDEN", "a resolved tenant, principal and capability set are required");
  }
  if (!actor.capabilities.has(capability)) refuse("CAPABILITY_REQUIRED", "FORBIDDEN", `this requires ${capability}`);
}

type Db = Pick<PoolClient, "query">;

export interface ReachableCompanies {
  readonly companies: readonly string[];
  readonly keys: readonly string[];
}

/** The operating companies (ids and keys) the caller is authorized for. None at all is a refusal, not an empty answer. */
export async function reachableCompanies(db: Db, actor: RecordsActor): Promise<ReachableCompanies> {
  const authority = await resolveCompanyAuthority(db, actor.tenantId, actor.principalId);
  if (authority.companyKeys.length === 0) {
    refuse("COMPANY_AUTHORITY_REQUIRED", "FORBIDDEN", "this requires operating-company authority; this principal has none");
  }
  return { companies: authority.companies, keys: authority.companyKeys };
}

/** The caller's reachable companies as { key, name } (the key is what records carry; the name is presentation only). */
export async function companyOptions(db: Db, tenantId: string, keys: readonly string[]): Promise<Array<{ key: string; name: string }>> {
  const { rows } = await db.query(
    `SELECT operating_company_id, operating_company_key FROM eos_policy.tenant_operating_company_keys
      WHERE tenant_id = $1 AND status = 'ACTIVE' AND operating_company_key = ANY($2::text[]) ORDER BY operating_company_key`,
    [tenantId, [...keys]]);
  return rows.map((r) => ({
    key: String(r.operating_company_key),
    name: operatingCompanyDisplayName(r.operating_company_id) ?? String(r.operating_company_key),
  }));
}

export async function inTransaction<T>(pool: Pool, mode: "write" | "snapshot", fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(mode === "snapshot" ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
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

/** One governed audit event (eos_policy.audit_events), stamped with the actor's Administrator provenance where it applies. */
export async function recordsAudit(
  db: Db, actor: RecordsActor, action: string, targetKind: string, targetId: string, after: unknown, reason: string,
): Promise<void> {
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7::jsonb, now(), $8)`,
    [`audit_${randomUUID()}`, actor.tenantId, action, actor.principalId, targetKind, targetId,
      JSON.stringify(await withActorAuthority(db, actor.tenantId, actor.principalId, after)), reason]);
}

/** ISO calendar date (YYYY-MM-DD) of a pg DATE read as text -- never a JS Date, so no timezone can move it. */
export const DATE_AS_TEXT = (column: string): string => `to_char(${column}, 'YYYY-MM-DD')`;
