"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailProviderError = exports.ATTACHMENT_POLICIES = exports.MAILBOX_PROCESSING_MODES = exports.MAILBOX_PURPOSES = exports.CONNECTION_HEALTH = exports.OAUTH_STATUSES = exports.EMAIL_PROVIDERS = void 0;
exports.assertNoCredentialMaterial = assertNoCredentialMaterial;
exports.isEmailProviderId = isEmailProviderId;
exports.validateConnectionConfig = validateConnectionConfig;
exports.validateMailboxConfig = validateMailboxConfig;
exports.buildAuthorizationRequest = buildAuthorizationRequest;
exports.normalizeMicrosoftGraphMessage = normalizeMicrosoftGraphMessage;
exports.normalizeGmailMessage = normalizeGmailMessage;
exports.normalizeProviderMessage = normalizeProviderMessage;
// Email Connections -- the PROVIDER ABSTRACTION. Pure: config validation plus a total function from each
// provider's native message shape to the one normalized message EOS stores. No network call, no SDK, no
// firebase import, so every mapping below is testable from a fixture.
//
// NO CREDENTIAL IS STORED, EVER. A connection document carries the provider's identity and status and the
// NAME of the secret a deployment binds -- never a mailbox password, never an access or refresh token, and
// never a client secret. `assertNoCredentialMaterial` refuses a config that tries to smuggle one in, so a
// well-meaning admin form addition cannot quietly turn this collection into a credential store.
//
// OAUTH IS AN EXTERNAL CONFIGURATION DEPENDENCY, NOT A MISSING ABSTRACTION. Non-production Microsoft 365 /
// Google Workspace tenants and their OAuth client registrations are not available to this repository, and
// fabricating them would be worse than not having them. What is implemented here is everything that does
// not require them: the provider model, the configuration contract, validation, the authorization-request
// and callback SEAMS (`buildAuthorizationRequest`), and the message mappings -- exercised end to end
// against deterministic fixtures. Binding a real tenant is a deployment action recorded in the docs.
const inboundWorkModel_1 = require("./inboundWorkModel");
exports.EMAIL_PROVIDERS = ["MICROSOFT_365", "GOOGLE_WORKSPACE"];
exports.OAUTH_STATUSES = ["NOT_CONNECTED", "PENDING_AUTHORIZATION", "CONNECTED", "EXPIRED", "REVOKED"];
exports.CONNECTION_HEALTH = ["UNKNOWN", "HEALTHY", "DEGRADED", "FAILED"];
exports.MAILBOX_PURPOSES = ["SERVICE", "WARRANTY", "PARTS", "OTHER"];
exports.MAILBOX_PROCESSING_MODES = ["REVIEW_REQUIRED", "AUTO_ROUTE"];
exports.ATTACHMENT_POLICIES = ["PRESERVE_METADATA", "IGNORE"];
class EmailProviderError extends Error {
    constructor(message) {
        super(message);
        this.name = "EmailProviderError";
    }
}
exports.EmailProviderError = EmailProviderError;
/**
 * Field names whose presence means somebody is trying to persist credential material in a configuration
 * document. Refused outright rather than stripped: silently dropping a token an operator believed was
 * saved is how a connection ends up half-configured and nobody knows why it never authorized.
 */
const CREDENTIAL_FIELD_PATTERN = /(password|secret|token|refresh|clientSecret|privateKey|credential(?!SecretName))/i;
function assertNoCredentialMaterial(raw) {
    if (!raw || typeof raw !== "object")
        return;
    for (const key of Object.keys(raw)) {
        if (key === "credentialSecretName")
            continue;
        if (CREDENTIAL_FIELD_PATTERN.test(key)) {
            throw new EmailProviderError(`"${key}" cannot be stored on an email connection. EOS stores no mailbox password and no OAuth token -- bind an externally-managed secret by name instead.`);
        }
    }
}
function isEmailProviderId(v) {
    return typeof v === "string" && exports.EMAIL_PROVIDERS.includes(v);
}
function validateConnectionConfig(raw) {
    if (!raw || typeof raw !== "object")
        throw new EmailProviderError("A connection configuration is required.");
    assertNoCredentialMaterial(raw);
    const c = raw;
    if (!isEmailProviderId(c.provider)) {
        throw new EmailProviderError(`provider must be one of ${exports.EMAIL_PROVIDERS.join(", ")}.`);
    }
    const connectionName = (0, inboundWorkModel_1.boundedString)(c.connectionName, 120);
    if (!connectionName)
        throw new EmailProviderError("connectionName is required.");
    const tenantOrWorkspace = (0, inboundWorkModel_1.boundedString)(c.tenantOrWorkspace, 255);
    if (!tenantOrWorkspace)
        throw new EmailProviderError("tenantOrWorkspace is required.");
    const connectedAccount = (0, inboundWorkModel_1.normalizeEmailAddress)(c.connectedAccount);
    if (!connectedAccount)
        throw new EmailProviderError("connectedAccount must be a valid email address.");
    return {
        connectionName,
        provider: c.provider,
        tenantOrWorkspace,
        connectedAccount,
        inboundEnabled: c.inboundEnabled !== false,
        outboundEnabled: c.outboundEnabled === true,
        credentialSecretName: (0, inboundWorkModel_1.boundedString)(c.credentialSecretName, 255) || null,
    };
}
function validateMailboxConfig(raw) {
    if (!raw || typeof raw !== "object")
        throw new EmailProviderError("A mailbox configuration is required.");
    assertNoCredentialMaterial(raw);
    const m = raw;
    const connectionId = (0, inboundWorkModel_1.boundedString)(m.connectionId, 255);
    if (!connectionId)
        throw new EmailProviderError("connectionId is required.");
    const emailAddress = (0, inboundWorkModel_1.normalizeEmailAddress)(m.emailAddress);
    if (!emailAddress)
        throw new EmailProviderError("emailAddress must be a valid email address.");
    const purpose = exports.MAILBOX_PURPOSES.includes(m.purpose) ? m.purpose : "OTHER";
    return {
        connectionId,
        displayName: (0, inboundWorkModel_1.boundedString)(m.displayName, 120) || emailAddress,
        emailAddress,
        purpose,
        operatingCompanyId: (0, inboundWorkModel_1.boundedString)(m.operatingCompanyId, 120) || null,
        destination: (0, inboundWorkModel_1.boundedString)(m.destination, 60) || "SERVICE",
        defaultQueue: (0, inboundWorkModel_1.boundedString)(m.defaultQueue, 120) || null,
        inboundEnabled: m.inboundEnabled !== false,
        processingMode: exports.MAILBOX_PROCESSING_MODES.includes(m.processingMode)
            ? m.processingMode
            : "REVIEW_REQUIRED",
        routingPolicyId: (0, inboundWorkModel_1.boundedString)(m.routingPolicyId, 255) || null,
        attachmentPolicy: exports.ATTACHMENT_POLICIES.includes(m.attachmentPolicy)
            ? m.attachmentPolicy
            : "PRESERVE_METADATA",
        threadingEnabled: m.threadingEnabled !== false,
    };
}
const MICROSOFT_SCOPES = ["offline_access", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/Mail.ReadBasic.All"];
const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
function buildAuthorizationRequest(connection, deployment) {
    const clientId = (0, inboundWorkModel_1.boundedString)(deployment?.clientId, 255);
    const redirectUri = (0, inboundWorkModel_1.boundedString)(deployment?.redirectUri, 500);
    const state = (0, inboundWorkModel_1.boundedString)(deployment?.state, 255);
    if (!clientId || !redirectUri || !state) {
        throw new EmailProviderError("clientId, redirectUri and state are deployment configuration and are all required.");
    }
    if (!/^https:\/\//.test(redirectUri))
        throw new EmailProviderError("redirectUri must be https.");
    const scopes = connection.provider === "MICROSOFT_365" ? MICROSOFT_SCOPES : GOOGLE_SCOPES;
    const base = connection.provider === "MICROSOFT_365"
        ? `https://login.microsoftonline.com/${encodeURIComponent(connection.tenantOrWorkspace)}/oauth2/v2.0/authorize`
        : "https://accounts.google.com/o/oauth2/v2/auth";
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        response_mode: "query",
        scope: scopes.join(" "),
        state,
        login_hint: connection.connectedAccount,
    });
    return { authorizationUrl: `${base}?${params.toString()}`, scopes, state };
}
const headerValue = (headers, name) => {
    if (!Array.isArray(headers))
        return "";
    const hit = headers.find((h) => h && typeof h === "object" && String(h.name).toLowerCase() === name);
    return hit ? (0, inboundWorkModel_1.boundedString)(hit.value, 2000) : "";
};
const splitAddresses = (value) => value
    .split(",")
    .map((v) => (0, inboundWorkModel_1.normalizeEmailAddress)(v))
    .filter(Boolean);
const splitReferences = (value) => value.split(/\s+/).map((v) => (0, inboundWorkModel_1.boundedString)(v, 255)).filter(Boolean);
/** Microsoft Graph `message` resource -> normalized. */
function normalizeMicrosoftGraphMessage(raw, ctx) {
    const m = (raw ?? {});
    const body = (m.body ?? {});
    const headers = m.internetMessageHeaders;
    const address = (entry) => (0, inboundWorkModel_1.normalizeEmailAddress)(entry?.emailAddress?.address);
    const list = (entries) => (Array.isArray(entries) ? entries.map(address).filter(Boolean) : []);
    return (0, inboundWorkModel_1.normalizeInboundMessage)({
        provider: "MICROSOFT_365",
        connectionId: ctx.connectionId,
        mailboxId: ctx.mailboxId,
        // The GRAPH item id is the stable per-mailbox handle used to re-fetch the message and its attachments.
        messageId: (0, inboundWorkModel_1.boundedString)(m.id, 255),
        threadId: (0, inboundWorkModel_1.boundedString)(m.conversationId, 255),
        // RFC 5322 ids come from the internet headers; internetMessageId is this message's own.
        inReplyTo: headerValue(headers, "in-reply-to"),
        references: splitReferences(headerValue(headers, "references")),
        receivedAt: Date.parse((0, inboundWorkModel_1.boundedString)(m.receivedDateTime, 64)) || 0,
        sender: address(m.from ?? m.sender),
        recipients: list(m.toRecipients),
        cc: list(m.ccRecipients),
        subject: m.subject,
        originalBody: body.content,
        originalBodyContentType: String(body.contentType).toLowerCase() === "text" ? "text/plain" : "text/html",
        attachments: (Array.isArray(m.attachments) ? m.attachments : []).map((a) => {
            const att = (a ?? {});
            return { providerAttachmentId: att.id, filename: att.name, mimeType: att.contentType, size: att.size, contentHash: att.contentHash };
        }),
    });
}
/** Gmail API `users.messages` resource (format=full) -> normalized. */
function normalizeGmailMessage(raw, ctx) {
    const m = (raw ?? {});
    const payload = (m.payload ?? {});
    const headers = payload.headers;
    const { body, contentType } = readGmailBody(payload);
    return (0, inboundWorkModel_1.normalizeInboundMessage)({
        provider: "GOOGLE_WORKSPACE",
        connectionId: ctx.connectionId,
        mailboxId: ctx.mailboxId,
        messageId: (0, inboundWorkModel_1.boundedString)(m.id, 255),
        threadId: (0, inboundWorkModel_1.boundedString)(m.threadId, 255),
        inReplyTo: headerValue(headers, "in-reply-to"),
        references: splitReferences(headerValue(headers, "references")),
        receivedAt: Number(m.internalDate) || Date.parse(headerValue(headers, "date")) || 0,
        sender: headerValue(headers, "from"),
        recipients: splitAddresses(headerValue(headers, "to")),
        cc: splitAddresses(headerValue(headers, "cc")),
        subject: headerValue(headers, "subject"),
        originalBody: body,
        originalBodyContentType: contentType,
        attachments: collectGmailAttachments(payload),
    });
}
/** base64url -> utf8, tolerant of the padding Gmail omits. Returns "" on anything unreadable. */
function decodeBase64Url(value) {
    const raw = typeof value === "string" ? value.replace(/-/g, "+").replace(/_/g, "/") : "";
    if (!raw)
        return "";
    try {
        return Buffer.from(raw, "base64").toString("utf8");
    }
    catch {
        return "";
    }
}
/** Prefer text/plain; fall back to text/html. Walks nested multiparts (Gmail nests alternative in mixed). */
function readGmailBody(payload) {
    const found = {};
    const walk = (part, depth) => {
        if (!part || depth > 10)
            return;
        const mime = String(part.mimeType ?? "").toLowerCase();
        const data = (part.body ?? {}).data;
        if (mime === "text/plain" && found.plain === undefined)
            found.plain = decodeBase64Url(data);
        if (mime === "text/html" && found.html === undefined)
            found.html = decodeBase64Url(data);
        for (const child of Array.isArray(part.parts) ? part.parts : [])
            walk(child, depth + 1);
    };
    walk(payload, 0);
    if (found.plain)
        return { body: found.plain, contentType: "text/plain" };
    return { body: found.html ?? "", contentType: "text/html" };
}
function collectGmailAttachments(payload) {
    const out = [];
    const walk = (part, depth) => {
        if (!part || depth > 10)
            return;
        const body = (part.body ?? {});
        const filename = (0, inboundWorkModel_1.boundedString)(part.filename, 255);
        if (filename && body.attachmentId) {
            out.push({ providerAttachmentId: body.attachmentId, filename, mimeType: part.mimeType, size: body.size });
        }
        for (const child of Array.isArray(part.parts) ? part.parts : [])
            walk(child, depth + 1);
    };
    walk(payload, 0);
    return out;
}
/** The one dispatch point. A third provider is a case here plus a mapping function -- nothing above changes. */
function normalizeProviderMessage(provider, raw, ctx) {
    switch (provider) {
        case "MICROSOFT_365":
            return normalizeMicrosoftGraphMessage(raw, ctx);
        case "GOOGLE_WORKSPACE":
            return normalizeGmailMessage(raw, ctx);
        default:
            throw new EmailProviderError(`Unsupported provider "${String(provider)}".`);
    }
}
//# sourceMappingURL=emailProvider.js.map