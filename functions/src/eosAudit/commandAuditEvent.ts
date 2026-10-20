// ONE audit row for ONE applied command (Q-1). The EOS convention of cycleCountOperations.ts / performanceGoalAuthoring.ts:
//   action      the operation (e.g. "opportunity.create"),
//   actor_uid   the acting Principal id,
//   target_*    the record the command acted on,
//   before/after structured fields (before null for a create),
//   reason      where the command takes one.
// Written by the command's own transaction, so a refusal (rollback) and a replay (the command body never runs) write nothing.
// `after` carries the protected-Administrator provenance stamp like every other direct audit writer (withActorAuthority).
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

export async function recordCommandAudit(
  db: Pick<PoolClient, "query">, tenantId: string, principalId: string, spec: CommandAuditSpec,
): Promise<void> {
  await db.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [`audit_${randomUUID()}`, tenantId, spec.action, principalId, spec.targetKind, spec.targetId,
      spec.before === null ? null : JSON.stringify(spec.before),
      spec.after === null ? null : JSON.stringify(await withActorAuthority(db, tenantId, principalId, spec.after)),
      spec.reason ?? null],
  );
}

/** The listed fields of `from`, for a before/after pair that states only what a command changed. */
export function pickFields(from: Readonly<Record<string, unknown>>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = from[k] === undefined ? null : from[k];
  return out;
}
