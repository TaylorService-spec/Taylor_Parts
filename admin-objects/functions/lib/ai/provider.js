"use strict";
// AI PROVIDER SEAM. Server-side only, capability-checked, and disabled unless deliberately enabled.
//
// ============================ THE BROWSER NEVER CALLS THIS ============================
//
//     EOS surface  →  trusted EOS callable  →  AIProvider  →  Keystone gateway
//
// The browser talks to a callable. The callable talks to a provider. Only the provider knows a URL,
// and it runs in Cloud Functions.
//
// A browser calling a developer workstation on loopback would work perfectly for exactly one person
// -- the developer -- and fail for every other user with a connection error, having first shipped
// the gateway's address to everyone. It would also make a Firebase-hosted product depend on a laptop
// being awake. There is no configuration of that idea which is correct, so the seam is shaped to
// make it impossible rather than discouraged.
//
// ============================ WHY IT REFUSES BY DEFAULT ============================
//
// `KeystoneRepositoryProvider` is DEVELOPMENT TOOLING. It is constructed only when an explicit
// server-side configuration names an endpoint, and it throws when that is absent. There is no
// default, no fallback, and no localhost baked in -- because a default that happens to work on the
// machine where it was written is how a workstation dependency reaches production without anyone
// deciding to put it there.
//
// ============================ NO CAPABILITY IS GAINED BY ASKING AN AI ============================
//
// `assertAiRequestAuthorized` intersects; it never adds. Asking a question through a model returns
// what the caller could already have read, or it returns an error. There is no AI service account
// and no elevated context anywhere in this file.
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeystoneRepositoryProvider = exports.REPOSITORY_INTELLIGENCE_CAPABILITY = void 0;
exports.assertAiRequestAuthorized = assertAiRequestAuthorized;
exports.keystoneConfigFromEnvironment = keystoneConfigFromEnvironment;
exports.repositoryProviderFromEnvironment = repositoryProviderFromEnvironment;
const types_1 = require("./types");
/**
 * The capability a caller must already hold to use repository intelligence.
 *
 * A repository contains unreleased design, security rules and governance. Reading it through a
 * model is still reading it, so it is gated like any other privileged read rather than treated as
 * a developer convenience that happens to be exposed.
 */
exports.REPOSITORY_INTELLIGENCE_CAPABILITY = "ai.repositoryIntelligence.read";
/**
 * The gate every AI request passes, before any provider is constructed.
 *
 * Order matters: purpose, then classification, then capability. A caller who lacks the capability
 * must not be able to probe which classifications are permitted by varying the request, and
 * checking the cheap declared fields first keeps the capability answer last.
 */
function assertAiRequestAuthorized(context) {
    if (context.purpose !== "REPOSITORY_INTELLIGENCE") {
        throw new types_1.AIError("AI_PURPOSE_UNSUPPORTED", `Purpose ${context.purpose} is not implemented. Operational data requires a separate ` +
            "governed authorization and is not enabled.");
    }
    if (!types_1.AI_PERMITTED_CLASSIFICATIONS.includes(context.classification)) {
        throw new types_1.AIError("AI_CLASSIFICATION_DENIED", `Classification ${context.classification} may not be sent to a model.`);
    }
    if (!context.capabilities.includes(exports.REPOSITORY_INTELLIGENCE_CAPABILITY)) {
        throw new types_1.AIError("AI_CAPABILITY_DENIED", `Caller does not hold ${exports.REPOSITORY_INTELLIGENCE_CAPABILITY}.`);
    }
}
/**
 * Reads provider configuration from the server environment.
 *
 * Returns `null` rather than throwing when unconfigured, so that "AI is not set up here" is an
 * ordinary state a caller can report -- which is what production is, and must remain.
 */
function keystoneConfigFromEnvironment(environment = process.env) {
    const endpoint = environment.KEYSTONE_GATEWAY_URL;
    const apiKey = environment.KEYSTONE_GATEWAY_API_KEY;
    const tenantId = environment.KEYSTONE_GATEWAY_TENANT_ID;
    if (!endpoint || !apiKey || !tenantId)
        return null;
    return { endpoint, apiKey, tenantId };
}
class KeystoneRepositoryProvider {
    name = "keystone-repository";
    config;
    fetchImpl;
    /**
     * `fetchImpl` is injected so tests exercise the real request-building code rather than a
     * lookalike. A test that reimplements the call proves the test works.
     */
    constructor(config, fetchImpl = fetch) {
        if (!config?.endpoint) {
            throw new types_1.AIError("AI_NOT_CONFIGURED", "No Keystone gateway endpoint is configured. This provider is development tooling and " +
                "has no default endpoint by design.");
        }
        this.config = config;
        this.fetchImpl = fetchImpl;
    }
    async repositoryAnswer(context, request) {
        assertAiRequestAuthorized(context);
        const url = `${this.config.endpoint.replace(/\/+$/, "")}/v1/repository/answer`;
        let response;
        try {
            response = await this.fetchImpl(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    // The credential is a server-side header and appears nowhere else -- not in a URL, not in
                    // a query string, not in a log line, and never in anything returned to a caller.
                    "X-API-Key": this.config.apiKey,
                    "X-Tenant-ID": this.config.tenantId,
                    "X-Trace-Id": context.traceId,
                },
                body: JSON.stringify({
                    source: request.source,
                    question: request.question,
                    contextBudget: request.contextBudget ?? 2000,
                    pathPrefix: request.pathPrefix,
                    pathContains: request.pathContains,
                    retrieveOnly: request.retrieveOnly ?? false,
                }),
            });
        }
        catch (cause) {
            // The message deliberately carries no configuration: an unreachable endpoint must not
            // publish its address through an error string that ends up in a client or a log.
            throw new types_1.AIError("AI_PROVIDER_UNAVAILABLE", "The Keystone gateway could not be reached.");
        }
        if (!response.ok) {
            throw new types_1.AIError("AI_PROVIDER_ERROR", `The Keystone gateway returned ${response.status}.`);
        }
        return (await response.json());
    }
}
exports.KeystoneRepositoryProvider = KeystoneRepositoryProvider;
/**
 * The only constructor callers should use.
 *
 * Returns `null` when unconfigured. Production is expected to be unconfigured, and a caller that
 * treats `null` as an ordinary absence is a caller that cannot accidentally depend on a
 * workstation.
 */
function repositoryProviderFromEnvironment(environment = process.env, fetchImpl = fetch) {
    const config = keystoneConfigFromEnvironment(environment);
    return config ? new KeystoneRepositoryProvider(config, fetchImpl) : null;
}
//# sourceMappingURL=provider.js.map