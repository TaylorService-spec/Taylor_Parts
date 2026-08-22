// OPENAI ADAPTER. Every vendor-shaped concern in the system lives in this file.
//
// ============================ WHAT IS CONTAINED HERE ============================
//
// SDK usage, request shape, model ids, retry policy, error translation, token accounting. Nothing
// above this layer knows OpenAI exists. Replacing the provider is replacing this file plus a
// factory line -- not a search for `openai` across the domain.
//
// NO SDK IMPORT YET, AND THAT IS DELIBERATE. The dependency is injected as a `fetch`-shaped
// function, so the architecture, the contract and the security tests are complete and testable
// before a key exists and before a package is added. Adding the SDK later changes this file only.
//
// ============================ THE KEY NEVER LEAVES THE BACKEND ============================
//
// The API key is read from trusted backend configuration at call time and is never logged, never
// returned, never placed in an error message, and never exposed to any client surface. There is no
// code path that puts it in a response, and `health()` reports configured/not-configured rather
// than echoing anything.
import type {
  AiHealthResult, AiProvider, AiProviderMetadata, AiRespondRequest, AiRespondResult,
} from "./aiProvider";
import { AiProviderError } from "./aiProvider";

const PROVIDER = "openai";

/** Injected so tests never touch the network and the SDK stays out of the dependency graph. */
export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface OpenAiProviderConfig {
  /** Supplied by trusted backend secret config. Never read from a client-visible source. */
  readonly apiKey: string | null;
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetchImpl: FetchLike;
  readonly defaultTimeoutMs?: number;
}

/**
 * Translate a provider failure into the normalised taxonomy.
 *
 * Every branch is chosen by what EOS does differently, and the default is UNKNOWN rather than a
 * convenient bucket -- classifying an unrecognised failure as "unavailable" would make a real
 * misconfiguration look transient and retryable forever.
 */
export function classifyOpenAiStatus(status: number): AiProviderError["code"] {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 400 || status === 422) return "INVALID_REQUEST";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 500) return "UNAVAILABLE";
  return "UNKNOWN";
}

export class OpenAiProvider implements AiProvider {
  readonly metadata: AiProviderMetadata;
  private readonly config: OpenAiProviderConfig;

  constructor(config: OpenAiProviderConfig) {
    this.config = config;
    this.metadata = { provider: PROVIDER, model: config.model };
  }

  async respond(request: AiRespondRequest): Promise<AiRespondResult> {
    if (!this.config.apiKey) {
      // Loud, not silent. An unconfigured provider that returned empty text would look like a model
      // with nothing to say, and the outage would be invisible until someone read the telemetry.
      throw new AiProviderError({
        code: "AUTH",
        provider: PROVIDER,
        message: "OpenAI is not configured in this environment (no API key present in trusted config).",
        retryable: false,
      });
    }

    const url = (this.config.baseUrl ?? "https://api.openai.com/v1") + "/chat/completions";
    const startedAt = Date.now();
    let response;
    try {
      response = await this.config.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature ?? 0.2,
        }),
      });
    } catch (cause) {
      // Transport failure. The message is OURS -- a raw network error can carry the request URL and
      // headers, and headers carry the key.
      throw new AiProviderError({
        code: "UNAVAILABLE",
        provider: PROVIDER,
        message: "OpenAI request failed before a response was received.",
      });
    }

    if (!response.ok) {
      const code = classifyOpenAiStatus(response.status);
      throw new AiProviderError({
        code,
        provider: PROVIDER,
        message: `OpenAI returned HTTP ${response.status}.`,
        providerCode: String(response.status),
      });
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? "";
    return {
      text,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
      metadata: this.metadata,
      latencyMs: Date.now() - startedAt,
      truncated: choice?.finish_reason === "length",
    };
  }

  async health(): Promise<AiHealthResult> {
    // Reports CONFIGURATION, not the key. A health endpoint that echoed any part of a credential
    // would be a credential disclosure with a reassuring name.
    return {
      healthy: Boolean(this.config.apiKey),
      provider: PROVIDER,
      checkedAtMs: Date.now(),
      detail: this.config.apiKey ? "configured" : "no API key in trusted config",
    };
  }
}
