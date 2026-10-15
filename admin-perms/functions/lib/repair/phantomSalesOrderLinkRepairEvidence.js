"use strict";
// X-PHANTOM-SALES-ORDER-LINK-REPAIR -- INERT, PURE sanitized-evidence builders for the phantom Sales Order
// link repair (see phantomSalesOrderLinkRepair.ts). Produce deterministic report objects/strings and a
// secret-scan guard; they perform NO I/O. Mirrors salesOrderNumberBackfillEvidence.ts's shape exactly. The
// operator CLI (functions/scripts/phantomSalesOrderLinkRepairCli.js) writes them atomically and, per
// docs/governance/audit-artifact-standard.md, publishes the execute artifact only after a passing post-write
// verification.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlanEvidence = buildPlanEvidence;
exports.buildExecutionEvidence = buildExecutionEvidence;
exports.buildRollbackEvidence = buildRollbackEvidence;
exports.serializeEvidence = serializeEvidence;
exports.scanForSecrets = scanForSecrets;
const node_crypto_1 = require("node:crypto");
// Mirrors salesOrderNumberBackfillEvidence.ts: refuse to publish anything that looks like a Google API key, a
// JWT, or a labelled secret/PII field. workOrderId/salesOrderId (Firestore document ids) and status/
// inventorySnapshot (governed operational data, not secrets or PII) are all safe to emit.
const SECRET_PATTERN = /(AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|password|refreshToken|idToken|secret|client_secret)/i;
function canonicalJson(value) {
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        const rec = value;
        return `{${Object.keys(rec)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function buildPlanEvidence(plan, ctx) {
    const operative = {
        projectId: ctx.projectId,
        governedCommit: ctx.governedCommit,
        phantomSalesOrderId: plan.phantomSalesOrderId,
        repairPackageId: plan.repairPackageId,
        reason: plan.reason,
        assignments: plan.assignments,
        alreadyRepaired: plan.alreadyRepaired,
    };
    return {
        kind: "phantom-sales-order-link-repair-plan",
        schemaVersion: 1,
        projectId: ctx.projectId,
        governedCommit: ctx.governedCommit,
        generatedAt: ctx.now().toISOString(),
        phantomSalesOrderId: plan.phantomSalesOrderId,
        repairPackageId: plan.repairPackageId,
        reason: plan.reason,
        counts: plan.counts,
        assignments: plan.assignments,
        alreadyRepaired: plan.alreadyRepaired,
        planHash: sha256(canonicalJson(operative)),
    };
}
function buildExecutionEvidence(result, postRepairUpdateTimes, ctx) {
    return {
        kind: "phantom-sales-order-link-repair-execution",
        schemaVersion: 1,
        projectId: ctx.projectId,
        governedCommit: ctx.governedCommit,
        generatedAt: ctx.now().toISOString(),
        boundPlanHash: ctx.boundPlanHash,
        counts: result.counts,
        repaired: result.repaired.map((r) => ({
            workOrderId: r.workOrderId,
            // The updateTime read IMMEDIATELY after this repair's write commits -- the exact optimistic-
            // concurrency precondition token rollback binds to (see phantomSalesOrderLinkRepairCli.js's
            // runRollback). A document changed since this repair is refused at rollback, never clobbered.
            postRepairUpdateTimeMillis: postRepairUpdateTimes.get(r.workOrderId) ?? 0,
        })),
    };
}
function buildRollbackEvidence(args, ctx) {
    return {
        kind: "phantom-sales-order-link-repair-rollback",
        schemaVersion: 1,
        projectId: ctx.projectId,
        governedCommit: ctx.governedCommit,
        generatedAt: ctx.now().toISOString(),
        boundExecutionEvidenceSha256: ctx.boundExecutionEvidenceSha256,
        rolledBack: args.rolledBack.map((workOrderId) => ({ workOrderId })),
        skipped: args.skipped,
    };
}
// Deterministic canonical serialization -- stable bytes for checksums + reproducibility.
function serializeEvidence(evidence) {
    return JSON.stringify(evidence, null, 2) + "\n";
}
// Guard: return every secret-like match found in the text. A non-empty result MUST block publication.
function scanForSecrets(text) {
    const matches = [];
    const re = new RegExp(SECRET_PATTERN, "gi");
    let m;
    while ((m = re.exec(text)) !== null)
        matches.push(m[0]);
    return matches;
}
//# sourceMappingURL=phantomSalesOrderLinkRepairEvidence.js.map