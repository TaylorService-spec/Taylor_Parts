// ANTHROPIC ADAPTER. The third provider, and the second proof that the contract is provider-neutral.
//
// ============================ WHY THIS FILE LOOKS LIKE THE OTHER TWO ============================
//
// Same shape as `openAiProvider.ts` and `selfHostedProvider.ts`: injected fetch, no SDK, key read
// from trusted backend config at call time, errors normalised here, model ids confined here. The
// repetition is the property being bought -- three adapters that differ only in the vendor-shaped
// parts is evidence the seam is in the right place. If adding a provider had required changing
// `aiProvider.ts` or the gateway, the abstraction would have been wrong.
//
// ============================ THE ONE REAL SHAPE DIFFERENCE ============================
//
// Anthropic does not accept `system` as a message role: the system prompt is a separate top-level
// field. EOS keeps its provider-neutral `system` role and this adapter hoists those turns into that
// field. That translation belongs here precisely because it is a vendor fact -- a caller that had
// to know which providers take a system role would already be outside the abstraction.
import type {
  AiHealthResult, AiProvider, AiProviderMetadata, AiRespondRequest, AiRespondResult, AssistantMessage,
} from "./aiProvider";
import { AiProviderError } from "./aiProvider";

const PROVIDER = "anthropic";

/** The API version header Anthropic requires. A vendor fact, and therefore confined to this file. */
const ANTHROPIC_VERSION = "2023-06-01";

/** Injected so tests never touch the network and the SDK stays out of the dependency graph. */
export type AnthropicFetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>;

export interface AnthropicProviderConfig {
  /** Supplied by trusted backend secret config. Never read from a client-visible source. */
  readonly apiKey: string | null;
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetchImpl: AnthropicFetchLike;
  readonly defaultTimeoutMs?: number;
}

export function classifyAnthropicStatus(status: number): AiProviderError["code"] {
  if (status === 401 || status === 403) return "AUTH";
  if (status === 400 || status === 422) return "INVALID_REQUEST";
  if (status === 429) return "RATE_LIMITED";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status >= 500) return "UNAVAILABLE";
  return "UNKNOWN";
}

/**
 * Split EOS's provider-neutral message list into Anthropic's shape.
 *
 * System turns are concatenated in order rather than only the first being kept: the gateway sends
 * several (instruction, situation, permitted facts), and silently dropping all but one would strip
 * the retrieved EOS data out of the prompt and leave a model answering from nothing at all.
 */
export function splitSystemPrompt(messages: readonly AssistantMessage[]): {
  system: string;
  turns: { role: "user" | "assistant"; content: string }[];
} {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = messages
    .filter((m): m is AssistantMessage & { role: "user" | "assistant" } => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  return { system, turns };
}

export class AnthropicProvider implements AiProvider {
  readonly metadata: AiProviderMetadata;
  private readonly config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    this.config = config;
    this.metadata = { provider: PROVIDER, model: config.model };
  }

  async respond(request: AiRespondRequest): Promise<AiRespondResult> {
    if (!this.config.apiKey) {
      throw new AiProviderError({
        code: "AUTH",
        provider: PROVIDER,
        message: "Anthropic is not configured in this environment (no API key present in trusted config).",
        retryable: false,
      });
    }

    const url = (this.config.baseUrl ?? "https://api.anthropic.com/v1") + "/messages";
    const { system, turns } = splitSystemPrompt(request.messages);
    const startedAt = Date.now();

    let response;
    try {
      response = await this.config.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature ?? 0.2,
          ...(system ? { system } : {}),
          messages: turns,
        }),
      });
    } catch (cause) {
      // Our message, not the raw one: a transport error can carry the request headers, and the
      // headers carry the key.
      throw new AiProviderError({
        code: "UNAVAILABLE",
        provider: PROVIDER,
        message: "Anthropic request failed before a response was received.",
      });
    }

    if (!response.ok) {
      throw new AiProviderError({
        code: classifyAnthropicStatus(response.status),
        provider: PROVIDER,
        message: `Anthropic returned HTTP ${response.status}.`,
        providerCode: String(response.status),
      });
    }

    const body = (await response.json()) as {
      id?: string;
      content?: { type?: string; text?: string }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    // Anthropic returns content as blocks. Only text blocks are joined; a future block type EOS
    // does not understand is skipped rather than stringified into the answer.
    const text = (body.content ?? [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");

    return {
      text,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      },
      metadata: this.metadata,
      latencyMs: Date.now() - startedAt,
      truncated: body.stop_reason === "max_tokens",
      ...(typeof body.id === "string" ? { providerRequestId: body.id } : {}),
    };
  }

  async health(): Promise<AiHealthResult> {
    // Configuration, not the key.
    return {
      healthy: Boolean(this.config.apiKey),
      provider: PROVIDER,
      checkedAtMs: Date.now(),
      detail: this.config.apiKey ? "configured" : "no API key in trusted config",
    };
  }
}
