// THE AUDIT OF A READ-ONLY "VIEW AS USER" PREVIEW (Administration control plane, DECISIONS #210).
//
// A preview changes nothing, but WHO looked at WHOSE resolved experience is an administration fact: one row in the governed
// audit log (eos_policy.audit_events), the same table every Administration command writes. It records the subject Principal and
// Employee and what was shown (the persona and the section statuses) -- never a token, credential or record content.
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export async function auditExperiencePreview(pool: Pool, input: {
  readonly tenantId: string; readonly actorPrincipalId: string; readonly subjectPrincipalId: string; readonly subjectEmployeeId: string;
  readonly shown: Readonly<Record<string, unknown>>; readonly reason: string | null;
}): Promise<string> {
  const id = `audit_${randomUUID()}`;
  await pool.query(
    `INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, 'experience.previewAsUser', $3, 'principal', $4, NULL, $5, now(), $6)`,
    [id, input.tenantId, input.actorPrincipalId, input.subjectPrincipalId,
      JSON.stringify({ subjectEmployeeId: input.subjectEmployeeId, ...input.shown }), input.reason],
  );
  return id;
}
