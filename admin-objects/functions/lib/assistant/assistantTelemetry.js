"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORBIDDEN_TELEMETRY_FIELDS = void 0;
exports.buildAuditRecord = buildAuditRecord;
exports.buildUsageRecord = buildUsageRecord;
function buildAuditRecord(args) {
    return {
        correlationId: args.correlationId,
        actorUid: args.actorUid,
        companyId: args.companyId,
        timestampMs: args.timestampMs,
        surface: args.surface,
        route: args.route,
        recordRef: args.recordRef,
        toolsRequested: args.decisions.map((d) => d.toolId),
        toolsAllowed: args.decisions.filter((d) => d.decision === "ALLOW").map((d) => d.toolId),
        toolsDenied: args.decisions.filter((d) => d.decision === "DENY").map((d) => d.toolId),
        recordsAccessed: args.recordsAccessed,
        provider: args.provider,
        model: args.model,
        usage: args.usage,
        latencyMs: args.latencyMs,
        outcome: args.outcome,
        errorClass: args.errorClass,
    };
}
function buildUsageRecord(audit) {
    if (!audit.provider || !audit.model)
        return null; // nothing was called; nothing to bill
    return {
        provider: audit.provider,
        model: audit.model,
        tenantId: audit.companyId,
        actorUid: audit.actorUid,
        surface: audit.surface,
        inputTokens: audit.usage?.inputTokens ?? 0,
        outputTokens: audit.usage?.outputTokens ?? 0,
        requestCount: 1,
        latencyMs: audit.latencyMs,
        errorClass: audit.errorClass,
        ...(audit.usage?.estimatedCostUsd !== undefined ? { estimatedCostUsd: audit.usage.estimatedCostUsd } : {}),
    };
}
/**
 * Fields that must never appear in an audit or usage record.
 *
 * Asserted by test rather than trusted to review: this is the list that quietly grows when someone
 * adds "just the question" to help with debugging, and each addition is individually defensible.
 */
exports.FORBIDDEN_TELEMETRY_FIELDS = Object.freeze([
    "question", "prompt", "messages", "answer", "response", "text",
    "toolResults", "data", "apiKey", "authorization",
]);
//# sourceMappingURL=assistantTelemetry.js.map