"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicProvider = void 0;
exports.classifyAnthropicStatus = classifyAnthropicStatus;
exports.splitSystemPrompt = splitSystemPrompt;
const aiProvider_1 = require("./aiProvider");
const PROVIDER = "anthropic";
/** The API version header Anthropic requires. A vendor fact, and therefore confined to this file. */
const ANTHROPIC_VERSION = "2023-06-01";
function classifyAnthropicStatus(status) {
    if (status === 401 || status === 403)
        return "AUTH";
    if (status === 400 || status === 422)
        return "INVALID_REQUEST";
    if (status === 429)
        return "RATE_LIMITED";
    if (status === 408 || status === 504)
        return "TIMEOUT";
    if (status >= 500)
        return "UNAVAILABLE";
    return "UNKNOWN";
}
/**
 * Split EOS's provider-neutral message list into Anthropic's shape.
 *
 * System turns are concatenated in order rather than only the first being kept: the gateway sends
 * several (instruction, situation, permitted facts), and silently dropping all but one would strip
 * the retrieved EOS data out of the prompt and leave a model answering from nothing at all.
 */
function splitSystemPrompt(messages) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const turns = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
    return { system, turns };
}
class AnthropicProvider {
    metadata;
    config;
    constructor(config) {
        this.config = config;
        this.metadata = { provider: PROVIDER, model: config.model };
    }
    async respond(request) {
        if (!this.config.apiKey) {
            throw new aiProvider_1.AiProviderError({
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
        }
        catch (cause) {
            // Our message, not the raw one: a transport error can carry the request headers, and the
            // headers carry the key.
            throw new aiProvider_1.AiProviderError({
                code: "UNAVAILABLE",
                provider: PROVIDER,
                message: "Anthropic request failed before a response was received.",
            });
        }
        if (!response.ok) {
            throw new aiProvider_1.AiProviderError({
                code: classifyAnthropicStatus(response.status),
                provider: PROVIDER,
                message: `Anthropic returned HTTP ${response.status}.`,
                providerCode: String(response.status),
            });
        }
        const body = (await response.json());
        // Anthropic returns content as blocks. Only text blocks are joined; a future block type EOS
        // does not understand is skipped rather than stringified into the answer.
        const text = (body.content ?? [])
            .filter((block) => block?.type === "text" && typeof block.text === "string")
            .map((block) => block.text)
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
    async health() {
        // Configuration, not the key.
        return {
            healthy: Boolean(this.config.apiKey),
            provider: PROVIDER,
            checkedAtMs: Date.now(),
            detail: this.config.apiKey ? "configured" : "no API key in trusted config",
        };
    }
}
exports.AnthropicProvider = AnthropicProvider;
//# sourceMappingURL=anthropicProvider.js.map