"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelfHostedProvider = exports.GATEWAY_ROUTED_MODEL = void 0;
exports.gatewayModeForWorkload = gatewayModeForWorkload;
exports.classifyGatewayStatus = classifyGatewayStatus;
const aiProvider_1 = require("./aiProvider");
const PROVIDER = "selfHosted";
/**
 * The model name reported before a call has happened.
 *
 * Deliberately not a model id. The gateway routes per request, so any id written here would be a
 * guess that goes stale silently; the honest answer is "whatever the gateway routes to", and the
 * real id arrives on the response and is what gets recorded.
 */
exports.GATEWAY_ROUTED_MODEL = "gateway-routed";
function gatewayModeForWorkload(workloadClass) {
    return workloadClass === "REASONING" ? "deep" : "fast";
}
/**
 * Translate a gateway failure into the normalised taxonomy.
 *
 * 401 and 403 both land on AUTH because EOS does the same thing about either -- stop, loudly, and
 * do not retry -- but the HTTP status is kept as `providerCode` so an operator can tell "the key is
 * wrong" from "this tenant may not use that mode" without reading the gateway's own logs.
 *
 * 503 is the gateway shedding load, not dying. It is UNAVAILABLE and retryable, and it must never
 * be reclassified as anything that would tempt a caller across a privacy boundary: a busy private
 * gateway is a queue to wait for, not a reason to send the same data somewhere else.
 */
function classifyGatewayStatus(status) {
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
function asFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
class SelfHostedProvider {
    metadata;
    config;
    constructor(config) {
        this.config = config;
        this.metadata = { provider: PROVIDER, model: exports.GATEWAY_ROUTED_MODEL };
    }
    async respond(request) {
        if (!this.config.apiKey) {
            // Loud, not silent. An unconfigured provider that returned empty text would look like a model
            // with nothing to say, and the outage would be invisible until someone read the telemetry.
            throw new aiProvider_1.AiProviderError({
                code: "AUTH",
                provider: PROVIDER,
                message: "The private AI gateway is not configured in this environment (no API key in trusted config).",
                retryable: false,
            });
        }
        if (!this.config.tenantId) {
            throw new aiProvider_1.AiProviderError({
                code: "AUTH",
                provider: PROVIDER,
                message: "The private AI gateway is not configured in this environment (no tenant id in trusted config).",
                retryable: false,
            });
        }
        const url = this.config.baseUrl.replace(/\/+$/, "") + "/v1/chat";
        const timeoutMs = request.timeoutMs ?? this.config.defaultTimeoutMs ?? 60_000;
        // A self-hosted queue can hold a request far longer than a hosted API would. Without a ceiling
        // the assistant would hang instead of reporting unavailable, and a hanging page is worse than a
        // page that says the assistant is busy.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const startedAt = Date.now();
        let response;
        try {
            response = await this.config.fetchImpl(url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-api-key": this.config.apiKey,
                    "x-tenant-id": this.config.tenantId,
                },
                body: JSON.stringify({
                    mode: gatewayModeForWorkload(request.workloadClass),
                    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
                    max_output_tokens: request.maxOutputTokens,
                    ...(request.contextTokenLimit !== undefined ? { num_ctx: request.contextTokenLimit } : {}),
                }),
                signal: controller.signal,
            });
        }
        catch (cause) {
            // The message is OURS. A raw transport error can carry the request URL and headers, and the
            // headers carry the key.
            const aborted = controller.signal.aborted;
            throw new aiProvider_1.AiProviderError({
                code: aborted ? "TIMEOUT" : "UNAVAILABLE",
                provider: PROVIDER,
                message: aborted
                    ? `The private AI gateway did not respond within ${timeoutMs}ms.`
                    : "The private AI gateway could not be reached.",
            });
        }
        finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            throw new aiProvider_1.AiProviderError({
                code: classifyGatewayStatus(response.status),
                provider: PROVIDER,
                message: `The private AI gateway returned HTTP ${response.status}.`,
                providerCode: String(response.status),
            });
        }
        let body;
        try {
            body = (await response.json());
        }
        catch {
            throw new aiProvider_1.AiProviderError({
                code: "UNKNOWN",
                provider: PROVIDER,
                message: "The private AI gateway returned a body that was not valid JSON.",
                retryable: false,
            });
        }
        // A malformed success is a failure, not an empty answer. Returning "" here would surface to a
        // user as the assistant having nothing to say, and would be recorded as a successful call.
        if (typeof body?.content !== "string") {
            throw new aiProvider_1.AiProviderError({
                code: "UNKNOWN",
                provider: PROVIDER,
                message: "The private AI gateway returned a response without text content.",
                retryable: false,
            });
        }
        const queueWaitMs = asFiniteNumber(body.queue_wait_ms);
        const providerRequestId = typeof body.request_id === "string" ? body.request_id : undefined;
        return {
            text: body.content,
            usage: {
                inputTokens: asFiniteNumber(body.prompt_tokens) ?? 0,
                outputTokens: asFiniteNumber(body.output_tokens) ?? 0,
            },
            metadata: {
                provider: PROVIDER,
                // The model the gateway actually routed to, not one EOS chose.
                model: typeof body.model === "string" && body.model ? body.model : exports.GATEWAY_ROUTED_MODEL,
            },
            // Measured by EOS. `total_duration_ms` is the gateway's view and excludes the network between
            // us; recording the gateway's number as ours would make a slow link look like a fast model.
            latencyMs: Date.now() - startedAt,
            // The gateway has no distinct "stopped at the ceiling" signal today, so this is not inferred
            // from token counts -- a guess recorded as a fact is worse than an absent one.
            truncated: false,
            ...(providerRequestId !== undefined ? { providerRequestId } : {}),
            ...(queueWaitMs !== undefined ? { queueWaitMs } : {}),
        };
    }
    async health() {
        // Reports reachability and CONFIGURATION, never the key. A health endpoint that echoed any part
        // of a credential would be a credential disclosure with a reassuring name.
        const checkedAtMs = Date.now();
        if (!this.config.apiKey) {
            return { healthy: false, provider: PROVIDER, checkedAtMs, detail: "no API key in trusted config" };
        }
        const url = this.config.baseUrl.replace(/\/+$/, "") + "/health";
        try {
            const response = await this.config.fetchImpl(url, {
                method: "GET",
                headers: { "x-api-key": this.config.apiKey, "x-tenant-id": this.config.tenantId },
            });
            return {
                healthy: response.ok,
                provider: PROVIDER,
                checkedAtMs,
                detail: response.ok ? "gateway reachable" : `gateway returned HTTP ${response.status}`,
            };
        }
        catch {
            return { healthy: false, provider: PROVIDER, checkedAtMs, detail: "gateway unreachable" };
        }
    }
}
exports.SelfHostedProvider = SelfHostedProvider;
//# sourceMappingURL=selfHostedProvider.js.map