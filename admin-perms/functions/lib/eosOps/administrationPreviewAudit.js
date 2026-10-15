"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditExperiencePreview = auditExperiencePreview;
// THE AUDIT OF A READ-ONLY "VIEW AS USER" PREVIEW (Administration control plane, DECISIONS #210).
//
// A preview changes nothing, but WHO looked at WHOSE resolved experience is an administration fact: one row in the governed
// audit log (eos_policy.audit_events), the same table every Administration command writes. It records the subject Principal and
// Employee and what was shown (the persona and the section statuses) -- never a token, credential or record content.
const node_crypto_1 = require("node:crypto");
async function auditExperiencePreview(pool, input) {
    const id = `audit_${(0, node_crypto_1.randomUUID)()}`;
    await pool.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, occurred_at, reason)
     VALUES ($1, $2, 'experience.previewAsUser', $3, 'principal', $4, NULL, $5, now(), $6)`, [id, input.tenantId, input.actorPrincipalId, input.subjectPrincipalId,
        JSON.stringify({ subjectEmployeeId: input.subjectEmployeeId, ...input.shown }), input.reason]);
    return id;
}
//# sourceMappingURL=administrationPreviewAudit.js.map