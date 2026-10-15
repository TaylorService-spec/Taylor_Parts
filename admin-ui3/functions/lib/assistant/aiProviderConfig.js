"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ANTHROPIC_MODEL = exports.DEFAULT_OPENAI_MODEL = exports.DEFAULT_SELF_HOSTED_BASE_URL = void 0;
exports.resolveSelfHostedConfig = resolveSelfHostedConfig;
exports.resolveGatewayTenantId = resolveGatewayTenantId;
exports.resolveOpenAiConfig = resolveOpenAiConfig;
exports.resolveAnthropicConfig = resolveAnthropicConfig;
exports.resolveAvailableProviders = resolveAvailableProviders;
exports.resolveRoutingPolicy = resolveRoutingPolicy;
exports.resolveProviderPolicyConfig = resolveProviderPolicyConfig;
exports.buildAiProvider = buildAiProvider;
exports.redactedAiConfigSummary = redactedAiConfigSummary;
const anthropicProvider_1 = require("./anthropicProvider");
const openAiProvider_1 = require("./openAiProvider");
const selfHostedProvider_1 = require("./selfHostedProvider");
const ROUTING_POLICIES = ["PRIVATE_ONLY", "PRIVATE_PREFERRED", "FRONTIER_ALLOWED"];
const DATA_CLASSES = ["EOS_BUSINESS_DATA", "NON_BUSINESS_DIAGNOSTIC"];
const PROVIDER_IDS = ["selfHosted", "openai", "anthropic"];
/** Opt-in, and only on an exact match. "TRUE", "1" and "yes" are not accepted: a flag that guards a
 *  disclosure boundary should be turned on by someone who knows its exact spelling. */
function enabled(env, key) {
    return env[key] === "true";
}
function trimmedOrNull(value) {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
}
exports.DEFAULT_SELF_HOSTED_BASE_URL = "http://127.0.0.1:8080";
/**
 * Resolve the private gateway's configuration from the trusted environment.
 *
 * Note what is NOT here: a default tenant id. `local-dev` baked into reusable code would make every
 * unconfigured environment quietly share one gateway tenant -- and a tenant boundary that defaults
 * to a shared value is not a boundary. An unset tenant makes the provider unavailable, loudly.
 */
function resolveSelfHostedConfig(env) {
    return {
        enabled: enabled(env, "AI_SELF_HOSTED_ENABLED"),
        baseUrl: trimmedOrNull(env.AI_SELF_HOSTED_BASE_URL) ?? exports.DEFAULT_SELF_HOSTED_BASE_URL,
        apiKey: trimmedOrNull(env.AI_SELF_HOSTED_API_KEY),
        tenantId: trimmedOrNull(env.AI_SELF_HOSTED_TENANT_ID),
    };
}
/**
 * The gateway tenant this request speaks as.
 *
 * Server-side only, and deliberately NOT derived from anything the caller sent. A browser-supplied
 * tenant id would let a user pick which gateway tenant their question is metered and isolated
 * under, which is the tenant boundary being handed to the party it exists to constrain.
 *
 * `companyId` is accepted so a future multi-tenant mapping has an obvious home, and is currently
 * unused: the first sandbox integration speaks as one explicitly configured tenant, which is
 * clearer to reason about than a mapping nobody has been asked to approve yet.
 */
function resolveGatewayTenantId(args) {
    return args.configured;
}
exports.DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
exports.DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
function resolveOpenAiConfig(env) {
    return {
        enabled: enabled(env, "AI_OPENAI_ENABLED"),
        apiKey: trimmedOrNull(env.OPENAI_API_KEY),
        model: trimmedOrNull(env.OPENAI_MODEL) ?? exports.DEFAULT_OPENAI_MODEL,
    };
}
function resolveAnthropicConfig(env) {
    return {
        enabled: enabled(env, "AI_ANTHROPIC_ENABLED"),
        apiKey: trimmedOrNull(env.ANTHROPIC_API_KEY),
        model: trimmedOrNull(env.ANTHROPIC_MODEL) ?? exports.DEFAULT_ANTHROPIC_MODEL,
    };
}
/**
 * Which providers are actually usable here.
 *
 * "Available" means enabled AND credentialed AND, for the gateway, given a tenant. A provider whose
 * code exists but whose key does not is not available: treating it as available would turn a
 * configuration mistake into a runtime AUTH error at the worst possible moment, when the policy has
 * already committed to it and there is no second choice by design.
 */
function resolveAvailableProviders(env) {
    const available = [];
    const selfHosted = resolveSelfHostedConfig(env);
    if (selfHosted.enabled && selfHosted.apiKey && selfHosted.tenantId)
        available.push("selfHosted");
    const openai = resolveOpenAiConfig(env);
    if (openai.enabled && openai.apiKey)
        available.push("openai");
    const anthropic = resolveAnthropicConfig(env);
    if (anthropic.enabled && anthropic.apiKey)
        available.push("anthropic");
    return available;
}
function parseDataClasses(raw) {
    const parsed = (raw ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    // An unrecognised entry is DROPPED rather than passed through. A typo that widened a disclosure
    // permission would be the worst possible failure mode for this particular setting.
    return parsed.filter((s) => DATA_CLASSES.includes(s));
}
/**
 * Resolve the routing policy. An unset or unrecognised value resolves to PRIVATE_ONLY -- the most
 * restrictive option, because a misconfigured policy must fail towards not disclosing.
 */
function resolveRoutingPolicy(env) {
    const raw = trimmedOrNull(env.AI_ROUTING_POLICY);
    return raw && ROUTING_POLICIES.includes(raw) ? raw : "PRIVATE_ONLY";
}
function resolveProviderPolicyConfig(env) {
    const preferred = trimmedOrNull(env.AI_PREFERRED_EXTERNAL_PROVIDER);
    return {
        policy: resolveRoutingPolicy(env),
        availableProviders: resolveAvailableProviders(env),
        externallyPermittedDataClasses: parseDataClasses(env.AI_EXTERNAL_PERMITTED_DATA_CLASSES),
        ...(preferred && PROVIDER_IDS.includes(preferred)
            ? { preferredExternalProvider: preferred }
            : {}),
    };
}
/**
 * Build the adapter the policy chose.
 *
 * Takes an id, not a list. There is no "build them all and try each" entry point, for the same
 * reason `selectAiProvider` cannot see failures.
 */
function buildAiProvider(providerId, env, deps) {
    if (providerId === "selfHosted") {
        const config = resolveSelfHostedConfig(env);
        return new selfHostedProvider_1.SelfHostedProvider({
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            tenantId: resolveGatewayTenantId({ configured: config.tenantId, companyId: deps.companyId }) ?? "",
            fetchImpl: deps.gatewayFetch,
        });
    }
    if (providerId === "openai") {
        const config = resolveOpenAiConfig(env);
        return new openAiProvider_1.OpenAiProvider({ apiKey: config.apiKey, model: config.model, fetchImpl: deps.openAiFetch });
    }
    const config = resolveAnthropicConfig(env);
    return new anthropicProvider_1.AnthropicProvider({ apiKey: config.apiKey, model: config.model, fetchImpl: deps.anthropicFetch });
}
function redactedAiConfigSummary(env) {
    const selfHosted = resolveSelfHostedConfig(env);
    const policyConfig = resolveProviderPolicyConfig(env);
    return {
        policy: policyConfig.policy,
        availableProviders: policyConfig.availableProviders,
        selfHostedEnabled: selfHosted.enabled,
        // Whether a key exists -- never the key, never its length, never a prefix.
        selfHostedConfigured: Boolean(selfHosted.apiKey),
        selfHostedTenantConfigured: Boolean(selfHosted.tenantId),
        externallyPermittedDataClasses: policyConfig.externallyPermittedDataClasses ?? [],
    };
}
//# sourceMappingURL=aiProviderConfig.js.map