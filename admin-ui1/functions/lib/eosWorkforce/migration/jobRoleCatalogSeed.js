"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAUNCH_JOB_ROLES = void 0;
exports.seedJobRoleCatalog = seedJobRoleCatalog;
const node_crypto_1 = require("node:crypto");
const jobRoleVocabulary_1 = require("../jobRoleVocabulary");
/**
 * The catalog this seed writes: a PROJECTION of the canonical vocabulary, narrowed to the two columns
 * eos_workforce.job_roles needs. No membership decision is taken here -- changing the launch catalog means changing
 * ../jobRoleVocabulary.ts, which moves every projection at once.
 */
exports.LAUNCH_JOB_ROLES = Object.freeze(jobRoleVocabulary_1.CANONICAL_JOB_ROLES.map((r) => Object.freeze({ jobRoleId: r.jobRoleId, displayName: r.displayName })));
async function seedJobRoleCatalog(pool, input) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`job-role-catalog-seed|${input.tenantId}`]);
        if ((await client.query(`SELECT 1 FROM eos_policy.tenants WHERE id = $1`, [input.tenantId])).rows.length === 0) {
            throw new Error("the tenant does not exist; the seed never creates one");
        }
        const existing = new Map((await client.query(`SELECT id, display_name, status FROM eos_workforce.job_roles WHERE tenant_id = $1 FOR UPDATE`, [input.tenantId])).rows.map((r) => [r.id, r]));
        const ruled = new Set(exports.LAUNCH_JOB_ROLES.map((r) => r.jobRoleId));
        const additions = exports.LAUNCH_JOB_ROLES.filter((r) => !existing.has(r.jobRoleId));
        const report = {
            tenantId: input.tenantId,
            additions: additions.map((r) => r.jobRoleId),
            alreadyPresent: exports.LAUNCH_JOB_ROLES.filter((r) => existing.has(r.jobRoleId)).map((r) => r.jobRoleId),
            differsFromRuling: exports.LAUNCH_JOB_ROLES.filter((r) => existing.has(r.jobRoleId)
                && (existing.get(r.jobRoleId).display_name !== r.displayName || existing.get(r.jobRoleId).status !== "ACTIVE"))
                .map((r) => ({ jobRoleId: r.jobRoleId, displayName: existing.get(r.jobRoleId).display_name, status: existing.get(r.jobRoleId).status })),
            notInRuling: [...existing.keys()].filter((id) => !ruled.has(id)).sort(),
            applied: input.apply === true && additions.length > 0,
        };
        if (report.applied) {
            for (const r of additions) {
                await client.query(`INSERT INTO eos_workforce.job_roles (tenant_id, id, display_name, status, created_by, updated_by) VALUES ($1, $2, $3, 'ACTIVE', $4, $4)`, [input.tenantId, r.jobRoleId, r.displayName, input.actor]);
            }
            await client.query(`INSERT INTO eos_policy.audit_events (id, tenant_id, action, actor_uid, target_kind, target_id, before, after, reason)
         VALUES ($1, $2, 'jobRole.catalog.seed', $3, 'tenant', $2, NULL, $4, 'Owner ruling 2026-09-25 canonical Job Role vocabulary')`, [`audit_${(0, node_crypto_1.randomUUID)()}`, input.tenantId, input.actor, JSON.stringify({ added: report.additions })]);
        }
        await client.query(report.applied ? "COMMIT" : "ROLLBACK");
        return report;
    }
    catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=jobRoleCatalogSeed.js.map