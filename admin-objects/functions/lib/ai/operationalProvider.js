"use strict";
// EOS NORTH STAR OPERATIONAL PROVIDER — SERVER ONLY.
//
// This transport has no EOS read authority and no write authority. A trusted domain assembler must
// establish the governed fact/evidence/action envelope before this code is called. Keystone returns
// an UNTRUSTED model candidate; the domain-specific EOS verifier remains the final authority on what
// may speak or be recommended.
//
// Current rollout is SYNTHETIC-only because Keystone's central operational data policy is still
// SYNTHETIC-only. There is no external-model fallback here. Remote Keystone ingress is permitted
// only over HTTPS and only with Cloudflare Access machine credentials in addition to Keystone's own
// API-key + tenant authentication. Numeric loopback development remains local and needs no Access token.
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeystoneOperationalProvider = exports.OperationalAIError = void 0;
exports.assertOperationalEnvelope = assertOperationalEnvelope;
exports.operationalProviderFromEnvironment = operationalProviderFromEnvironment;
const provider_1 = require("./provider");
class OperationalAIError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "OperationalAIError";
        this.code = code;
    }
}
exports.OperationalAIError = OperationalAIError;
const DOMAINS = new Set([
    "WORK_ORDER", "SALES_ORDER", "ACCOUNT", "PARTS", "DISPATCH", "OPPORTUNITY", "SALES_AGREEMENT",
]);
// The envelope is the ONLY data entrance to the model, so its vocabulary is closed. A field this
// list does not name never crosses the transport, whatever a caller attached: there is no key that
// could carry a Firestore path, a collection name, a credential, or a query instruction, because
// there is no key at all beyond these. TypeScript enforces this at compile time for repository
// callers; the runtime check is for the field that arrives anyway.
const ENVELOPE_KEYS = new Set([
    "schemaVersion", "classification", "synthetic", "source", "domain", "subjectReference",
    "observedFact", "deterministicInterpretation", "deterministicBusinessConsequence",
    "evidence", "allowedRecommendation", "mode", "maxOutputTokens",
]);
const EVIDENCE_KEYS = new Set(["key", "kind", "summary"]);
const RECOMMENDATION_KEYS = new Set(["actionId", "label", "authority"]);
function assertClosedVocabulary(value, allowed, what) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw new OperationalAIError("AI_OPERATIONAL_ENVELOPE_INVALID", `Operational AI ${what} carries an unknown field.`);
        }
    }
}
function assertOperationalEnvelope(request) {
    if (!request || request.schemaVersion !== 1) {
        throw new OperationalAIError("AI_OPERATIONAL_ENVELOPE_INVALID", "Operational AI envelope is invalid.");
    }
    assertClosedVocabulary(request, ENVELOPE_KEYS, "envelope");
    if (request.classification !== "SYNTHETIC" || request.synthetic !== true) {
        throw new OperationalAIError("AI_CLASSIFICATION_DENIED", "Operational model interpretation is currently limited to synthetic context.");
    }
    if (!DOMAINS.has(request.domain)) {
        throw new OperationalAIError("AI_OPERATIONAL_DOMAIN_UNSUPPORTED", "Operational AI domain is unsupported.");
    }
    if (typeof request.source !== "string" || request.source.trim().length === 0 ||
        typeof request.observedFact !== "string" || request.observedFact.trim().length === 0 ||
        !Array.isArray(request.evidence) || request.evidence.length === 0) {
        throw new OperationalAIError("AI_OPERATIONAL_ENVELOPE_INVALID", "Operational AI envelope is incomplete.");
    }
    for (const item of request.evidence) {
        if (!item || typeof item.key !== "string" || !item.key.trim() ||
            typeof item.kind !== "string" || !item.kind.trim() ||
            typeof item.summary !== "string" || !item.summary.trim()) {
            throw new OperationalAIError("AI_OPERATIONAL_ENVELOPE_INVALID", "Operational AI evidence is invalid.");
        }
        assertClosedVocabulary(item, EVIDENCE_KEYS, "evidence");
    }
    const recommendation = request.allowedRecommendation;
    if (recommendation && recommendation.authority !== "ALLOWED") {
        throw new OperationalAIError("AI_OPERATIONAL_ACTION_DENIED", "A non-authorized action may not cross the model boundary.");
    }
    if (recommendation)
        assertClosedVocabulary(recommendation, RECOMMENDATION_KEYS, "recommendation");
}
function isNumericLoopbackEndpoint(endpoint) {
    try {
        const url = new URL(endpoint);
        // An address CLASS, not a baked-in provider endpoint: the whole 127.0.0.0/8 block is loopback,
        // so this recognizes local development rather than naming somewhere to send traffic. The seam
        // still hard-codes no endpoint -- the address it will actually call is configured, or absent.
        //
        // A hostname is treated as remote even when it resolves locally: "localhost" is a name whose
        // meaning is decided by resolver configuration, and a name that can be repointed is not evidence
        // that the request stays on this machine. Remote means HTTPS plus Access credentials.
        const ipv4Loopback = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
        const ipv6Loopback = url.hostname === "[::1]" || url.hostname === "::1";
        return (url.protocol === "http:" || url.protocol === "https:") && (ipv4Loopback || ipv6Loopback);
    }
    catch {
        return false;
    }
}
function assertIngressConfig(config) {
    if (isNumericLoopbackEndpoint(config.endpoint))
        return;
    let url;
    try {
        url = new URL(config.endpoint);
    }
    catch {
        throw new OperationalAIError("AI_REMOTE_INGRESS_DENIED", "Remote Keystone ingress configuration is invalid.");
    }
    if (url.protocol !== "https:") {
        throw new OperationalAIError("AI_REMOTE_INGRESS_DENIED", "Remote Keystone ingress requires HTTPS.");
    }
    if (!config.accessClientId || !config.accessClientSecret) {
        throw new OperationalAIError("AI_REMOTE_INGRESS_DENIED", "Remote Keystone ingress requires machine-to-machine Access credentials.");
    }
}
class KeystoneOperationalProvider {
    name = "keystone-operational-private-first";
    config;
    fetchImpl;
    constructor(config, fetchImpl = fetch) {
        if (!config?.endpoint) {
            throw new OperationalAIError("AI_NOT_CONFIGURED", "No Keystone gateway endpoint is configured.");
        }
        assertIngressConfig(config);
        this.config = config;
        this.fetchImpl = fetchImpl;
    }
    async interpret(request) {
        assertOperationalEnvelope(request);
        const url = `${this.config.endpoint.replace(/\/+$/, "")}/v1/operational/interpret`;
        const headers = {
            "Content-Type": "application/json",
            "X-API-Key": this.config.apiKey,
            "X-Tenant-ID": this.config.tenantId,
        };
        if (this.config.accessClientId && this.config.accessClientSecret) {
            headers["CF-Access-Client-Id"] = this.config.accessClientId;
            headers["CF-Access-Client-Secret"] = this.config.accessClientSecret;
        }
        let response;
        try {
            response = await this.fetchImpl(url, { method: "POST", headers, body: JSON.stringify(request) });
        }
        catch {
            throw new OperationalAIError("AI_PROVIDER_UNAVAILABLE", "The Keystone operational service could not be reached.");
        }
        if (!response.ok) {
            throw new OperationalAIError("AI_PROVIDER_ERROR", `The Keystone operational service returned ${response.status}.`);
        }
        return (await response.json());
    }
}
exports.KeystoneOperationalProvider = KeystoneOperationalProvider;
function operationalProviderFromEnvironment(environment = process.env, fetchImpl = fetch) {
    const base = (0, provider_1.keystoneConfigFromEnvironment)(environment);
    if (!base)
        return null;
    const config = {
        ...base,
        accessClientId: environment.KEYSTONE_ACCESS_CLIENT_ID,
        accessClientSecret: environment.KEYSTONE_ACCESS_CLIENT_SECRET,
    };
    return new KeystoneOperationalProvider(config, fetchImpl);
}
//# sourceMappingURL=operationalProvider.js.map