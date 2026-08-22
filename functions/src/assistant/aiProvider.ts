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

/** Provider-neutral role labels. Deliberately not a provider's own enum. */
export type AssistantMessageRole = "system" | "user" | "assistant";

export interface AssistantMessage {
  readonly role: AssistantMessageRole;
  readonly content: string;
}

/**
 * Normalised failure classes.
 *
 * Callers branch on THESE, never on a provider's error type. The set is chosen by what EOS must do
 * differently, not by what a vendor happens to distinguish:
 *
 *   UNAVAILABLE / TIMEOUT  -- transient. The assistant reports unavailable; EOS keeps working.
 *   RATE_LIMITED           -- transient, but backing off is the caller's decision, not a hidden retry.
 *   AUTH                   -- misconfiguration. Loud, because a silent auth failure looks like a
 *                             quiet model that never answers.
 *   INVALID_REQUEST        -- our bug, not the user's.
 *   CONTENT_FILTERED       -- the provider refused. NOT an EOS authorization decision, and must
 *                             never be reported to a user as one.
 *   UNKNOWN                -- everything else, never swallowed.
 */
export type AiProviderErrorCode =
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "AUTH"
  | "INVALID_REQUEST"
  | "CONTENT_FILTERED"
  | "UNKNOWN";

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly provider: string;
  readonly retryable: boolean;
  /** The provider's own code, kept for diagnostics ONLY. Never branched on outside the adapter. */
  readonly providerCode?: string;

  constructor(args: {
    code: AiProviderErrorCode;
    provider: string;
    message: string;
    retryable?: boolean;
    providerCode?: string;
  }) {
    super(args.message);
    this.name = "AiProviderError";
    this.code = args.code;
    this.provider = args.provider;
    this.retryable = args.retryable ?? (args.code === "UNAVAILABLE" || args.code === "TIMEOUT" || args.code === "RATE_LIMITED");
    this.providerCode = args.providerCode;
  }
}

/**
 * Usage, in provider-neutral units.
 *
 * `estimatedCostUsd` is OPTIONAL and is never computed in domain code. Prices change, differ per
 * model and per contract, and hard-coding them into EOS logic would make a pricing change a code
 * change in the wrong layer. The adapter may supply it; the domain records whatever it gets.
 */
export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd?: number;
}

export interface AiProviderMetadata {
  readonly provider: string;
  readonly model: string;
}

export interface AiRespondRequest {
  readonly messages: readonly AssistantMessage[];
  /** Hard ceiling the caller sets. The adapter must not silently exceed it. */
  readonly maxOutputTokens: number;
  readonly temperature?: number;
  /** Correlates this call with the EOS audit record. Never contains protected business data. */
  readonly correlationId: string;
  readonly timeoutMs?: number;
}

export interface AiRespondResult {
  readonly text: string;
  readonly usage: AiUsage;
  readonly metadata: AiProviderMetadata;
  readonly latencyMs: number;
  /** True when the provider stopped at the token ceiling rather than finishing. */
  readonly truncated: boolean;
}

export interface AiHealthResult {
  readonly healthy: boolean;
  readonly provider: string;
  readonly checkedAtMs: number;
  readonly detail?: string;
}

/**
 * The contract every provider implements.
 *
 * `stream` is optional on purpose: streaming is a UX affordance, not a capability EOS depends on,
 * and a provider without it must remain usable rather than unsupported.
 */
export interface AiProvider {
  readonly metadata: AiProviderMetadata;
  respond(request: AiRespondRequest): Promise<AiRespondResult>;
  stream?(request: AiRespondRequest): AsyncIterable<string>;
  health(): Promise<AiHealthResult>;
}
