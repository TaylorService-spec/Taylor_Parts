// SERVER-ONLY PROVIDER CONFIGURATION. Where credentials are read, and the only place they exist.
//
// ============================ THE BROWSER IS NOT IN THIS PICTURE ============================
//
//   browser -> trusted EOS server -> provider abstraction -> provider
//
// Every arrow is one-way and the browser touches only the first. There is no configuration here a
// Vite bundle can reach: `process.env` in a Cloud Function is not `import.meta.env` in a client
// build, nothing in this file is exported to a client package, and the private gateway address is a
// loopback address that a browser on a user's laptop could not usefully reach even if it had the
// key. The CI grep that keeps `AI_SELF_HOSTED_*` out of the client tree is what keeps that true as
// the repository grows.
//
// ============================ EVERYTHING IS OFF UNTIL SOMEONE TURNS IT ON ============================
//
// Defaults: self-hosted DISABLED, policy PRIVATE_ONLY, no data class permitted to leave. Merging
// this code activates nothing. An environment that has not been deliberately configured resolves to
// no available providers, which resolves to a governed unavailable outcome -- the safe direction for
// a setting someone will forget.
import type { AiProvider } from "./aiProvider";
import type { AiDataClass, AiProviderId, AiProviderPolicyConfig, AiRoutingPolicy } from "./aiProviderPolicy";
import { AnthropicProvider } from "./anthropicProvider";
import type { AnthropicFetchLike } from "./anthropicProvider";
import { OpenAiProvider } from "./openAiProvider";
import type { FetchLike } from "./openAiProvider";
import { SelfHostedProvider } from "./selfHostedProvider";
import type { GatewayFetchLike } from "./selfHostedProvider";

/** The trusted environment source. Never a request body, never a client-supplied value. */
export type TrustedEnv = Readonly<Record<string, string | undefined>>;

const ROUTING_POLICIES: readonly AiRoutingPolicy[] = ["PRIVATE_ONLY", "PRIVATE_PREFERRED", "FRONTIER_ALLOWED"];
const DATA_CLASSES: readonly AiDataClass[] = ["EOS_BUSINESS_DATA", "NON_BUSINESS_DIAGNOSTIC"];
const PROVIDER_IDS: readonly AiProviderId[] = ["selfHosted", "openai", "anthropic"];

/** Opt-in, and only on an exact match. "TRUE", "1" and "yes" are not accepted: a flag that guards a
 *  disclosure boundary should be turned on by someone who knows its exact spelling. */
function enabled(env: TrustedEnv, key: string): boolean {
  return env[key] === "true";
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface SelfHostedEnvConfig {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly tenantId: string | null;
}

export const DEFAULT_SELF_HOSTED_BASE_URL = "http://127.0.0.1:8080";

/**
 * Resolve the private gateway's configuration from the trusted environment.
 *
 * Note what is NOT here: a default tenant id. `local-dev` baked into reusable code would make every
 * unconfigured environment quietly share one gateway tenant -- and a tenant boundary that defaults
 * to a shared value is not a boundary. An unset tenant makes the provider unavailable, loudly.
 */
export function resolveSelfHostedConfig(env: TrustedEnv): SelfHostedEnvConfig {
  return {
    enabled: enabled(env, "AI_SELF_HOSTED_ENABLED"),
    baseUrl: trimmedOrNull(env.AI_SELF_HOSTED_BASE_URL) ?? DEFAULT_SELF_HOSTED_BASE_URL,
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
export function resolveGatewayTenantId(args: {
  readonly configured: string | null;
  readonly companyId?: string;
}): string | null {
  return args.configured;
}

export interface ExternalProviderEnvConfig {
  readonly enabled: boolean;
  readonly apiKey: string | null;
  readonly model: string;
}

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";

export function resolveOpenAiConfig(env: TrustedEnv): ExternalProviderEnvConfig {
  return {
    enabled: enabled(env, "AI_OPENAI_ENABLED"),
    apiKey: trimmedOrNull(env.OPENAI_API_KEY),
    model: trimmedOrNull(env.OPENAI_MODEL) ?? DEFAULT_OPENAI_MODEL,
  };
}

export function resolveAnthropicConfig(env: TrustedEnv): ExternalProviderEnvConfig {
  return {
    enabled: enabled(env, "AI_ANTHROPIC_ENABLED"),
    apiKey: trimmedOrNull(env.ANTHROPIC_API_KEY),
    model: trimmedOrNull(env.ANTHROPIC_MODEL) ?? DEFAULT_ANTHROPIC_MODEL,
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
export function resolveAvailableProviders(env: TrustedEnv): readonly AiProviderId[] {
  const available: AiProviderId[] = [];
  const selfHosted = resolveSelfHostedConfig(env);
  if (selfHosted.enabled && selfHosted.apiKey && selfHosted.tenantId) available.push("selfHosted");
  const openai = resolveOpenAiConfig(env);
  if (openai.enabled && openai.apiKey) available.push("openai");
  const anthropic = resolveAnthropicConfig(env);
  if (anthropic.enabled && anthropic.apiKey) available.push("anthropic");
  return available;
}

function parseDataClasses(raw: string | undefined): readonly AiDataClass[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // An unrecognised entry is DROPPED rather than passed through. A typo that widened a disclosure
  // permission would be the worst possible failure mode for this particular setting.
  return parsed.filter((s): s is AiDataClass => (DATA_CLASSES as readonly string[]).includes(s));
}

/**
 * Resolve the routing policy. An unset or unrecognised value resolves to PRIVATE_ONLY -- the most
 * restrictive option, because a misconfigured policy must fail towards not disclosing.
 */
export function resolveRoutingPolicy(env: TrustedEnv): AiRoutingPolicy {
  const raw = trimmedOrNull(env.AI_ROUTING_POLICY);
  return raw && (ROUTING_POLICIES as readonly string[]).includes(raw) ? (raw as AiRoutingPolicy) : "PRIVATE_ONLY";
}

export function resolveProviderPolicyConfig(env: TrustedEnv): AiProviderPolicyConfig {
  const preferred = trimmedOrNull(env.AI_PREFERRED_EXTERNAL_PROVIDER);
  return {
    policy: resolveRoutingPolicy(env),
    availableProviders: resolveAvailableProviders(env),
    externallyPermittedDataClasses: parseDataClasses(env.AI_EXTERNAL_PERMITTED_DATA_CLASSES),
    ...(preferred && (PROVIDER_IDS as readonly string[]).includes(preferred)
      ? { preferredExternalProvider: preferred as AiProviderId }
      : {}),
  };
}

export interface ProviderFactoryDeps {
  readonly gatewayFetch: GatewayFetchLike;
  readonly openAiFetch: FetchLike;
  readonly anthropicFetch: AnthropicFetchLike;
  readonly companyId?: string;
}

/**
 * Build the adapter the policy chose.
 *
 * Takes an id, not a list. There is no "build them all and try each" entry point, for the same
 * reason `selectAiProvider` cannot see failures.
 */
export function buildAiProvider(
  providerId: AiProviderId,
  env: TrustedEnv,
  deps: ProviderFactoryDeps,
): AiProvider {
  if (providerId === "selfHosted") {
    const config = resolveSelfHostedConfig(env);
    return new SelfHostedProvider({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      tenantId: resolveGatewayTenantId({ configured: config.tenantId, companyId: deps.companyId }) ?? "",
      fetchImpl: deps.gatewayFetch,
    });
  }
  if (providerId === "openai") {
    const config = resolveOpenAiConfig(env);
    return new OpenAiProvider({ apiKey: config.apiKey, model: config.model, fetchImpl: deps.openAiFetch });
  }
  const config = resolveAnthropicConfig(env);
  return new AnthropicProvider({ apiKey: config.apiKey, model: config.model, fetchImpl: deps.anthropicFetch });
}

/**
 * A description of the AI configuration that is safe to return to an operator surface.
 *
 * Booleans and names only. There is no field here a key could be placed in, which is why the shape
 * is fixed rather than a filtered copy of the environment -- a filter is a blocklist, and blocklists
 * are wrong the day someone adds a variable nobody updated the list for.
 */
export interface RedactedAiConfigSummary {
  readonly policy: AiRoutingPolicy;
  readonly availableProviders: readonly AiProviderId[];
  readonly selfHostedEnabled: boolean;
  readonly selfHostedConfigured: boolean;
  readonly selfHostedTenantConfigured: boolean;
  readonly externallyPermittedDataClasses: readonly AiDataClass[];
}

export function redactedAiConfigSummary(env: TrustedEnv): RedactedAiConfigSummary {
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
