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
import {
  boundedString,
  normalizeEmailAddress,
  normalizeInboundMessage,
  type NormalizedInboundMessage,
} from "./inboundWorkModel";

export const EMAIL_PROVIDERS = ["MICROSOFT_365", "GOOGLE_WORKSPACE"] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDERS)[number];

export const OAUTH_STATUSES = ["NOT_CONNECTED", "PENDING_AUTHORIZATION", "CONNECTED", "EXPIRED", "REVOKED"] as const;
export type OAuthStatus = (typeof OAUTH_STATUSES)[number];

export const CONNECTION_HEALTH = ["UNKNOWN", "HEALTHY", "DEGRADED", "FAILED"] as const;
export type ConnectionHealth = (typeof CONNECTION_HEALTH)[number];

export const MAILBOX_PURPOSES = ["SERVICE", "WARRANTY", "PARTS", "OTHER"] as const;
export const MAILBOX_PROCESSING_MODES = ["REVIEW_REQUIRED", "AUTO_ROUTE"] as const;
export const ATTACHMENT_POLICIES = ["PRESERVE_METADATA", "IGNORE"] as const;

export class EmailProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailProviderError";
  }
}

export interface EmailConnectionConfig {
  connectionName: string;
  provider: EmailProviderId;
  /** Microsoft tenant id / Google Workspace customer or primary domain. Identity, not a credential. */
  tenantOrWorkspace: string;
  /** The account the authorization is held against, e.g. a service mailbox. Identity, not a credential. */
  connectedAccount: string;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  /** The NAME of the externally-managed secret holding the OAuth client credential. Never its value. */
  credentialSecretName: string | null;
}

/**
 * Field names whose presence means somebody is trying to persist credential material in a configuration
 * document. Refused outright rather than stripped: silently dropping a token an operator believed was
 * saved is how a connection ends up half-configured and nobody knows why it never authorized.
 */
const CREDENTIAL_FIELD_PATTERN = /(password|secret|token|refresh|clientSecret|privateKey|credential(?!SecretName))/i;

export function assertNoCredentialMaterial(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (key === "credentialSecretName") continue;
    if (CREDENTIAL_FIELD_PATTERN.test(key)) {
      throw new EmailProviderError(
        `"${key}" cannot be stored on an email connection. EOS stores no mailbox password and no OAuth token -- bind an externally-managed secret by name instead.`,
      );
    }
  }
}

export function isEmailProviderId(v: unknown): v is EmailProviderId {
  return typeof v === "string" && (EMAIL_PROVIDERS as readonly string[]).includes(v);
}

export function validateConnectionConfig(raw: unknown): EmailConnectionConfig {
  if (!raw || typeof raw !== "object") throw new EmailProviderError("A connection configuration is required.");
  assertNoCredentialMaterial(raw);
  const c = raw as Record<string, unknown>;
  if (!isEmailProviderId(c.provider)) {
    throw new EmailProviderError(`provider must be one of ${EMAIL_PROVIDERS.join(", ")}.`);
  }
  const connectionName = boundedString(c.connectionName, 120);
  if (!connectionName) throw new EmailProviderError("connectionName is required.");
  const tenantOrWorkspace = boundedString(c.tenantOrWorkspace, 255);
  if (!tenantOrWorkspace) throw new EmailProviderError("tenantOrWorkspace is required.");
  const connectedAccount = normalizeEmailAddress(c.connectedAccount);
  if (!connectedAccount) throw new EmailProviderError("connectedAccount must be a valid email address.");
  return {
    connectionName,
    provider: c.provider,
    tenantOrWorkspace,
    connectedAccount,
    inboundEnabled: c.inboundEnabled !== false,
    outboundEnabled: c.outboundEnabled === true,
    credentialSecretName: boundedString(c.credentialSecretName, 255) || null,
  };
}

export interface EmailMailboxConfig {
  connectionId: string;
  displayName: string;
  emailAddress: string;
  purpose: (typeof MAILBOX_PURPOSES)[number];
  operatingCompanyId: string | null;
  destination: string;
  defaultQueue: string | null;
  inboundEnabled: boolean;
  processingMode: (typeof MAILBOX_PROCESSING_MODES)[number];
  routingPolicyId: string | null;
  attachmentPolicy: (typeof ATTACHMENT_POLICIES)[number];
  threadingEnabled: boolean;
}

export function validateMailboxConfig(raw: unknown): EmailMailboxConfig {
  if (!raw || typeof raw !== "object") throw new EmailProviderError("A mailbox configuration is required.");
  assertNoCredentialMaterial(raw);
  const m = raw as Record<string, unknown>;
  const connectionId = boundedString(m.connectionId, 255);
  if (!connectionId) throw new EmailProviderError("connectionId is required.");
  const emailAddress = normalizeEmailAddress(m.emailAddress);
  if (!emailAddress) throw new EmailProviderError("emailAddress must be a valid email address.");
  const purpose = MAILBOX_PURPOSES.includes(m.purpose as never) ? (m.purpose as (typeof MAILBOX_PURPOSES)[number]) : "OTHER";
  return {
    connectionId,
    displayName: boundedString(m.displayName, 120) || emailAddress,
    emailAddress,
    purpose,
    operatingCompanyId: boundedString(m.operatingCompanyId, 120) || null,
    destination: boundedString(m.destination, 60) || "SERVICE",
    defaultQueue: boundedString(m.defaultQueue, 120) || null,
    inboundEnabled: m.inboundEnabled !== false,
    processingMode: MAILBOX_PROCESSING_MODES.includes(m.processingMode as never)
      ? (m.processingMode as (typeof MAILBOX_PROCESSING_MODES)[number])
      : "REVIEW_REQUIRED",
    routingPolicyId: boundedString(m.routingPolicyId, 255) || null,
    attachmentPolicy: ATTACHMENT_POLICIES.includes(m.attachmentPolicy as never)
      ? (m.attachmentPolicy as (typeof ATTACHMENT_POLICIES)[number])
      : "PRESERVE_METADATA",
    threadingEnabled: m.threadingEnabled !== false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// The authorization SEAM. Returns what a deployment needs to start an OAuth authorization-code flow for
// this provider, from configuration the connection already holds. It performs no network call and holds no
// secret: the client id and redirect origin are deployment configuration passed in by the caller, and the
// exchange itself happens in a trusted context that reads the bound secret by name. This exists so the
// missing piece is a real credential rather than a missing design.
export interface AuthorizationRequest {
  authorizationUrl: string;
  scopes: string[];
  /** The provider-side state parameter the callback must return unchanged. Supplied by the caller. */
  state: string;
}

const MICROSOFT_SCOPES = ["offline_access", "https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/Mail.ReadBasic.All"];
const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function buildAuthorizationRequest(
  connection: Pick<EmailConnectionConfig, "provider" | "tenantOrWorkspace" | "connectedAccount">,
  deployment: { clientId: string; redirectUri: string; state: string },
): AuthorizationRequest {
  const clientId = boundedString(deployment?.clientId, 255);
  const redirectUri = boundedString(deployment?.redirectUri, 500);
  const state = boundedString(deployment?.state, 255);
  if (!clientId || !redirectUri || !state) {
    throw new EmailProviderError("clientId, redirectUri and state are deployment configuration and are all required.");
  }
  if (!/^https:\/\//.test(redirectUri)) throw new EmailProviderError("redirectUri must be https.");
  const scopes = connection.provider === "MICROSOFT_365" ? MICROSOFT_SCOPES : GOOGLE_SCOPES;
  const base =
    connection.provider === "MICROSOFT_365"
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Message mappings. One per provider, each producing the SAME NormalizedInboundMessage, which is why
// Gmail needs no change anywhere above this file.
export interface ProviderMessageContext {
  connectionId: string;
  mailboxId: string;
}

const headerValue = (headers: unknown, name: string): string => {
  if (!Array.isArray(headers)) return "";
  const hit = headers.find((h) => h && typeof h === "object" && String((h as Record<string, unknown>).name).toLowerCase() === name);
  return hit ? boundedString((hit as Record<string, unknown>).value, 2000) : "";
};

const splitAddresses = (value: string): string[] =>
  value
    .split(",")
    .map((v) => normalizeEmailAddress(v))
    .filter(Boolean);

const splitReferences = (value: string): string[] => value.split(/\s+/).map((v) => boundedString(v, 255)).filter(Boolean);

/** Microsoft Graph `message` resource -> normalized. */
export function normalizeMicrosoftGraphMessage(raw: unknown, ctx: ProviderMessageContext): NormalizedInboundMessage {
  const m = (raw ?? {}) as Record<string, unknown>;
  const body = (m.body ?? {}) as Record<string, unknown>;
  const headers = m.internetMessageHeaders;
  const address = (entry: unknown): string =>
    normalizeEmailAddress(((entry as Record<string, unknown>)?.emailAddress as Record<string, unknown>)?.address);
  const list = (entries: unknown): string[] => (Array.isArray(entries) ? entries.map(address).filter(Boolean) : []);
  return normalizeInboundMessage({
    provider: "MICROSOFT_365",
    connectionId: ctx.connectionId,
    mailboxId: ctx.mailboxId,
    // The GRAPH item id is the stable per-mailbox handle used to re-fetch the message and its attachments.
    messageId: boundedString(m.id, 255),
    threadId: boundedString(m.conversationId, 255),
    // RFC 5322 ids come from the internet headers; internetMessageId is this message's own.
    inReplyTo: headerValue(headers, "in-reply-to"),
    references: splitReferences(headerValue(headers, "references")),
    receivedAt: Date.parse(boundedString(m.receivedDateTime, 64)) || 0,
    sender: address(m.from ?? m.sender),
    recipients: list(m.toRecipients),
    cc: list(m.ccRecipients),
    subject: m.subject,
    originalBody: body.content,
    originalBodyContentType: String(body.contentType).toLowerCase() === "text" ? "text/plain" : "text/html",
    attachments: (Array.isArray(m.attachments) ? m.attachments : []).map((a) => {
      const att = (a ?? {}) as Record<string, unknown>;
      return { providerAttachmentId: att.id, filename: att.name, mimeType: att.contentType, size: att.size, contentHash: att.contentHash };
    }),
  });
}

/** Gmail API `users.messages` resource (format=full) -> normalized. */
export function normalizeGmailMessage(raw: unknown, ctx: ProviderMessageContext): NormalizedInboundMessage {
  const m = (raw ?? {}) as Record<string, unknown>;
  const payload = (m.payload ?? {}) as Record<string, unknown>;
  const headers = payload.headers;
  const { body, contentType } = readGmailBody(payload);
  return normalizeInboundMessage({
    provider: "GOOGLE_WORKSPACE",
    connectionId: ctx.connectionId,
    mailboxId: ctx.mailboxId,
    messageId: boundedString(m.id, 255),
    threadId: boundedString(m.threadId, 255),
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
function decodeBase64Url(value: unknown): string {
  const raw = typeof value === "string" ? value.replace(/-/g, "+").replace(/_/g, "/") : "";
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** Prefer text/plain; fall back to text/html. Walks nested multiparts (Gmail nests alternative in mixed). */
function readGmailBody(payload: Record<string, unknown>): { body: string; contentType: "text/plain" | "text/html" } {
  const found: { plain?: string; html?: string } = {};
  const walk = (part: Record<string, unknown>, depth: number): void => {
    if (!part || depth > 10) return;
    const mime = String(part.mimeType ?? "").toLowerCase();
    const data = ((part.body ?? {}) as Record<string, unknown>).data;
    if (mime === "text/plain" && found.plain === undefined) found.plain = decodeBase64Url(data);
    if (mime === "text/html" && found.html === undefined) found.html = decodeBase64Url(data);
    for (const child of Array.isArray(part.parts) ? part.parts : []) walk(child as Record<string, unknown>, depth + 1);
  };
  walk(payload, 0);
  if (found.plain) return { body: found.plain, contentType: "text/plain" };
  return { body: found.html ?? "", contentType: "text/html" };
}

function collectGmailAttachments(payload: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const walk = (part: Record<string, unknown>, depth: number): void => {
    if (!part || depth > 10) return;
    const body = (part.body ?? {}) as Record<string, unknown>;
    const filename = boundedString(part.filename, 255);
    if (filename && body.attachmentId) {
      out.push({ providerAttachmentId: body.attachmentId, filename, mimeType: part.mimeType, size: body.size });
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) walk(child as Record<string, unknown>, depth + 1);
  };
  walk(payload, 0);
  return out;
}

/** The one dispatch point. A third provider is a case here plus a mapping function -- nothing above changes. */
export function normalizeProviderMessage(provider: EmailProviderId, raw: unknown, ctx: ProviderMessageContext): NormalizedInboundMessage {
  switch (provider) {
    case "MICROSOFT_365":
      return normalizeMicrosoftGraphMessage(raw, ctx);
    case "GOOGLE_WORKSPACE":
      return normalizeGmailMessage(raw, ctx);
    default:
      throw new EmailProviderError(`Unsupported provider "${String(provider)}".`);
  }
}
