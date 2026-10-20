// ONE audit row for ONE applied command (Q-1). The EOS convention of cycleCountOperations.ts / performanceGoalAuthoring.ts:
//   action      the operation (e.g. "opportunity.create"),
//   actor_uid   the acting Principal id,
//   target_*    the record the command acted on,
//   before/after structured fields (before null for a create),
//   reason      where the command takes one.
// Written by the command's own transaction, so a refusal (rollback) and a replay (the command body never runs) write nothing.
// `after` carries the protected-Administrator provenance stamp like every other direct audit writer (withActorAuthority).
//
// WHAT AN AUDIT ROW MAY HOLD. audit_events is append-only by trigger: whatever lands there can never be erased. A row therefore
// carries IDENTITY (ids, numbers, the names that identify an account or contact), STATE (statuses, stages), AMOUNTS and QUANTITIES,
// and the governed REASON -- never free text and never contact details. Free text is recorded as its LENGTH (`<field>Length`) or as a
// changed flag; an email, phone number, street address or access note as a PRESENCE flag. Same precedent as crmActivityAuthority
// (`bodyLength`, never the body). Callers build the before/after with the helpers below.
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withActorAuthority } from "../eosOps/administrationReach";

export interface CommandAuditSpec {
  readonly action: string;
  readonly targetKind: string;
  readonly targetId: string;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  readonly reason?: string | null;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Every string made well-formed (a lone surrogate becomes U+FFFD) before it reaches jsonb: PostgreSQL REJECTS a lone surrogate escape,
 * which would turn an otherwise applied command into a failure. Deep over plain objects and arrays; other values pass unchanged.
 */
export function wellFormed<T>(value: T): T {
  if (typeof value === "string") return value.replace(LONE_SURROGATE, "�") as unknown as T;
  if (Array.isArray(value)) return value.map(wellFormed) as unknown as T;
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [wellFormed(k), wellFormed(v)])) as T;
  }
  return value;
}

export async function recordCommandAudit(
  db: Pick<PoolClient, "query">, tenantId: string, principalId: string, spec: CommandAuditSpec,
): Promise<void> {
  const before = spec.before === null ? null : wellFormed(spec.before);
  const after = spec.after === null ? null : await withActorAuthority(db, tenantId, principalId, wellFormed(spec.after));
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [`audit_${randomUUID()}`, tenantId, spec.action, principalId, spec.targetKind, wellFormed(spec.targetId),
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
      spec.reason == null ? null : wellFormed(spec.reason)],
  );
}

/** The length of a free-text value, or null when absent. The value itself is never recorded. */
export const textLength = (v: unknown): number | null => (v === null || v === undefined ? null : String(v).length);

/**
 * The listed fields of `from`, for a before/after pair that states only what a command changed. A key named in `freeText` is recorded
 * as `<key>Length`, never as its value.
 */
export function pickFields(from: Readonly<Record<string, unknown>>, keys: readonly string[], freeText: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (freeText.includes(k)) out[`${k}Length`] = textLength(from[k]);
    else out[k] = from[k] === undefined ? null : from[k];
  }
  return out;
}

const LINE_IDENTITY_KEYS = ["kind", "ref", "businessUnitId", "quantity", "qty", "orderedQty", "unitPrice", "condition"] as const;

/** Commercial lines as identity, quantity and price only: a line's warranty text is recorded as `warrantyLength`. */
export function lineFacts(lines: unknown): Record<string, unknown>[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((l: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const k of LINE_IDENTITY_KEYS) if (l[k] !== undefined) out[k] = l[k];
    if ("warranty" in l) out.warrantyLength = textLength(l.warranty);
    return out;
  });
}
