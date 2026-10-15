"use strict";
// AI PROVIDER CONTRACT. The seam that keeps a model vendor replaceable.
//
// ============================ WHY THIS BOUNDARY EXISTS ============================
//
// OpenAI is the initial provider and is INFRASTRUCTURE, not architecture. EOS owns the UX, the
// authorization, the governed tools, the context, the audit trail, the evaluation and the cost
// controls; the provider owns turning permitted text into more text.
//
// The rule that makes that real is narrow and absolute: EOS domain code must never import a
// provider SDK. Everything vendor-shaped -- SDK types, request shapes, model ids, retry policy,
// error taxonomies, token accounting -- lives behind this interface in the infrastructure layer.
// A `catch (e) { if (e instanceof OpenAI.APIError) }` anywhere in domain code is the boundary
// already broken, which is why errors are normalised here rather than passed through.
//
// THIS FILE DELIBERATELY CONTAINS NO SECRETS AND NO NETWORK CODE. It is a contract.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiProviderError = void 0;
class AiProviderError extends Error {
    code;
    provider;
    retryable;
    /** The provider's own code, kept for diagnostics ONLY. Never branched on outside the adapter. */
    providerCode;
    constructor(args) {
        super(args.message);
        this.name = "AiProviderError";
        this.code = args.code;
        this.provider = args.provider;
        this.retryable = args.retryable ?? (args.code === "UNAVAILABLE" || args.code === "TIMEOUT" || args.code === "RATE_LIMITED");
        this.providerCode = args.providerCode;
    }
}
exports.AiProviderError = AiProviderError;
//# sourceMappingURL=aiProvider.js.map