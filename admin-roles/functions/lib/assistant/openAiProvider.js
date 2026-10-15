"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAiProvider = void 0;
exports.classifyOpenAiStatus = classifyOpenAiStatus;
const aiProvider_1 = require("./aiProvider");
const PROVIDER = "openai";
/**
 * Translate a provider failure into the normalised taxonomy.
 *
 * Every branch is chosen by what EOS does differently, and the default is UNKNOWN rather than a
 * convenient bucket -- classifying an unrecognised failure as "unavailable" would make a real
 * misconfiguration look transient and retryable forever.
 */
function classifyOpenAiStatus(status) {
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
class OpenAiProvider {
    metadata;
    config;
    constructor(config) {
        this.config = config;
        this.metadata = { provider: PROVIDER, model: config.model };
    }
    async respond(request) {
        if (!this.config.apiKey) {
            // Loud, not silent. An unconfigured provider that returned empty text would look like a model
            // with nothing to say, and the outage would be invisible until someone read the telemetry.
            throw new aiProvider_1.AiProviderError({
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
        }
        catch (cause) {
            // Transport failure. The message is OURS -- a raw network error can carry the request URL and
            // headers, and headers carry the key.
            throw new aiProvider_1.AiProviderError({
                code: "UNAVAILABLE",
                provider: PROVIDER,
                message: "OpenAI request failed before a response was received.",
            });
        }
        if (!response.ok) {
            const code = classifyOpenAiStatus(response.status);
            throw new aiProvider_1.AiProviderError({
                code,
                provider: PROVIDER,
                message: `OpenAI returned HTTP ${response.status}.`,
                providerCode: String(response.status),
            });
        }
        const body = (await response.json());
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
    async health() {
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
exports.OpenAiProvider = OpenAiProvider;
//# sourceMappingURL=openAiProvider.js.map