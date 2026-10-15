"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIAGNOSTIC_USER_MESSAGE = exports.DIAGNOSTIC_SYSTEM_INSTRUCTION = void 0;
exports.runAiProviderDiagnostic = runAiProviderDiagnostic;
const aiProvider_1 = require("./aiProvider");
const aiProviderPolicy_1 = require("./aiProviderPolicy");
/**
 * The prompt. Fixed, operator-authored, and containing no EOS record of any kind.
 *
 * It asks for a short deterministic-ish reply so a human can tell "the model answered" from "the
 * gateway returned an empty string" at a glance.
 */
exports.DIAGNOSTIC_SYSTEM_INSTRUCTION = "You are responding to an infrastructure connectivity check. Reply with one short sentence "
    + "confirming you received this message. Do not ask questions.";
exports.DIAGNOSTIC_USER_MESSAGE = "Connectivity check from the EOS AI provider abstraction. Please confirm receipt.";
async function runAiProviderDiagnostic(deps) {
    const workloadClass = deps.workloadClass ?? "ROUTINE";
    const tenantId = deps.tenantId ?? null;
    // The decision, made once, from configuration only.
    const selection = (0, aiProviderPolicy_1.selectAiProvider)(deps.policyConfig, { dataClass: "NON_BUSINESS_DIAGNOSTIC" });
    if (selection.outcome === "UNAVAILABLE") {
        return {
            status: selection.reason === "EXTERNAL_USE_NOT_PERMITTED_FOR_DATA_CLASS"
                || selection.reason === "EXTERNAL_USE_PROHIBITED_BY_POLICY"
                ? "NOT_PERMITTED"
                : "PROVIDER_UNAVAILABLE",
            selectionReason: selection.reason,
            providerId: null, model: null, workloadClass, tenantId,
            inputTokens: null, outputTokens: null, queueWaitMs: null, latencyMs: null,
            providerRequestId: null, errorClass: null, receivedText: false,
        };
    }
    const provider = deps.buildProvider(selection.providerId);
    try {
        const result = await provider.respond({
            messages: [
                { role: "system", content: exports.DIAGNOSTIC_SYSTEM_INSTRUCTION },
                { role: "user", content: exports.DIAGNOSTIC_USER_MESSAGE },
            ],
            maxOutputTokens: deps.maxOutputTokens ?? 64,
            correlationId: deps.correlationId,
            workloadClass,
            ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
        });
        return {
            status: "OK",
            selectionReason: selection.reason,
            providerId: selection.providerId,
            model: result.metadata.model,
            workloadClass,
            tenantId,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            queueWaitMs: result.queueWaitMs ?? null,
            latencyMs: result.latencyMs,
            providerRequestId: result.providerRequestId ?? null,
            errorClass: null,
            receivedText: result.text.trim().length > 0,
        };
    }
    catch (err) {
        // The provider failed. The policy decision does not get revisited: there is no second attempt
        // and no second provider, which is the invariant this whole package exists to hold.
        return {
            status: "PROVIDER_UNAVAILABLE",
            selectionReason: selection.reason,
            providerId: selection.providerId,
            model: null,
            workloadClass,
            tenantId,
            inputTokens: null, outputTokens: null, queueWaitMs: null, latencyMs: null,
            providerRequestId: null,
            errorClass: err instanceof aiProvider_1.AiProviderError ? err.code : "UNKNOWN",
            receivedText: false,
        };
    }
}
//# sourceMappingURL=aiProviderDiagnostic.js.map