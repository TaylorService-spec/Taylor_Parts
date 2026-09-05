// Email Connections -- THE PROVIDER TRANSPORT CONTRACT.
//
// WHERE THIS SITS. Everything provider-specific lives at or below this contract; everything above it is
// provider-neutral EOS. A Microsoft message and a Gmail message differ in how they are authorized, listed
// and fetched -- and in nothing else. Once an adapter hands back a raw provider message, the existing
// normalizer (emailProvider.ts) and the existing intake command (inboundIntakeCommand.ts) do the rest, the
// same for both. There is no ingestMicrosoftWork() and no ingestGoogleWork(), and there must never be.
//
// WHAT AN ADAPTER MAY NOT DO. It does not route, extract, classify, thread, deduplicate, decide, or write
// an intake record. It authorizes, lists, fetches, and reports failure honestly. Six methods, no
// registry, no plugin framework: a third provider is a third file implementing this interface.
import { boundedString } from "./inboundWorkModel";

/** Short-lived provider credentials. The access token is NEVER persisted -- see providerCredentialVault. */
export interface ProviderTokenSet {
  accessToken: string;
  /** Present on the first exchange, and on a refresh when the provider rotates it. */
  refreshToken: string | null;
  /** Absolute expiry in epoch ms, computed from the provider's relative expires_in. */
  expiresAt: number;
  scope: string;
}

/** Where a mailbox poll resumed from, and where it should resume next time. Provider-shaped, opaque here. */
export interface DeliveryCursor {
  /** Microsoft: a Graph delta link. Gmail: a history id. Absent on the first ever poll. */
  value: string | null;
  /** True when the provider says this cursor is no longer usable and a bounded re-list is required. */
  expired?: boolean;
}

export interface ProviderMessageList {
  messageIds: string[];
  cursor: DeliveryCursor;
  /** True when the provider had more than one page and this poll stopped early. */
  truncated: boolean;
}

export interface ProviderAttachmentBytes {
  bytes: Buffer;
  mimeType: string;
  filename: string;
}

export interface MailboxValidation {
  ok: boolean;
  /** Operator-readable, and safe: never a token, never a raw provider payload. */
  detail: string;
}

export interface AuthorizationExchangeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  tenantOrWorkspace: string;
}

/** The six things a provider must be able to do. Nothing above this file knows which provider it has. */
export interface EmailTransportAdapter {
  readonly provider: string;
  buildAuthorizationUrl(input: { tenantOrWorkspace: string; connectedAccount: string; redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeAuthorizationCode(input: AuthorizationExchangeInput): Promise<ProviderTokenSet>;
  refreshAccessToken(input: { refreshToken: string; tenantOrWorkspace: string }): Promise<ProviderTokenSet>;
  validateMailboxAccess(input: { accessToken: string; mailboxAddress: string }): Promise<MailboxValidation>;
  listNewMessageIds(input: { accessToken: string; mailboxAddress: string; cursor: DeliveryCursor; limit: number }): Promise<ProviderMessageList>;
  fetchMessage(input: { accessToken: string; mailboxAddress: string; messageId: string }): Promise<unknown>;
  fetchAttachment(input: { accessToken: string; mailboxAddress: string; messageId: string; attachmentId: string }): Promise<ProviderAttachmentBytes>;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FAILURE, CLASSIFIED. The difference that matters operationally is not which HTTP code came back but
// what a person should do about it: wait, refresh, or go and fix the connection. Everything below sorts
// provider failures into exactly those three.
export const TRANSPORT_FAILURES = [
  "AUTH_EXPIRED",
  "AUTH_REVOKED",
  "MAILBOX_NOT_FOUND",
  "MAILBOX_ACCESS_DENIED",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
  "MESSAGE_FETCH_FAILED",
  "ATTACHMENT_FETCH_FAILED",
  "CURSOR_EXPIRED",
  "CONFIGURATION_INVALID",
  "DELIVERY_RETRY_EXHAUSTED",
] as const;
export type TransportFailureCode = (typeof TRANSPORT_FAILURES)[number];

export type FailureDisposition = "RETRYABLE" | "REFRESH_THEN_RETRY" | "REQUIRES_ADMIN_ACTION";

export class ProviderTransportError extends Error {
  readonly code: TransportFailureCode;
  /** Seconds the provider asked us to wait, when it said so. Never invented. */
  readonly retryAfterSeconds: number | null;
  constructor(code: TransportFailureCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ProviderTransportError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function dispositionOf(code: TransportFailureCode): FailureDisposition {
  switch (code) {
    case "PROVIDER_RATE_LIMIT":
    case "PROVIDER_UNAVAILABLE":
    case "MESSAGE_FETCH_FAILED":
    case "ATTACHMENT_FETCH_FAILED":
      return "RETRYABLE";
    case "AUTH_EXPIRED":
      return "REFRESH_THEN_RETRY";
    // A cursor the provider no longer honours is not a failure to retry blindly: the poll recovers by
    // re-listing a bounded window, which the orchestration does explicitly.
    case "CURSOR_EXPIRED":
      return "RETRYABLE";
    default:
      return "REQUIRES_ADMIN_ACTION";
  }
}

/** Exponential backoff with a ceiling, honouring the provider's own Retry-After when it gave one. */
export const MAX_DELIVERY_ATTEMPTS = 5;
export function nextRetryDelayMs(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 15 * 60_000);
  }
  const bounded = Math.min(Math.max(attempt, 1), MAX_DELIVERY_ATTEMPTS);
  return Math.min(2 ** bounded * 1000, 15 * 60_000);
}

/**
 * One HTTP status -> one failure code, for every provider. Both APIs use the same status semantics for
 * these cases, so a second copy of this table per provider would be two places to get it wrong.
 */
export function classifyHttpStatus(status: number, context: "auth" | "mailbox" | "message" | "attachment"): TransportFailureCode {
  if (status === 401) return "AUTH_EXPIRED";
  if (status === 403) return context === "auth" ? "AUTH_REVOKED" : "MAILBOX_ACCESS_DENIED";
  if (status === 404) return context === "attachment" ? "ATTACHMENT_FETCH_FAILED" : context === "message" ? "MESSAGE_FETCH_FAILED" : "MAILBOX_NOT_FOUND";
  if (status === 410) return "CURSOR_EXPIRED";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  if (context === "attachment") return "ATTACHMENT_FETCH_FAILED";
  if (context === "message") return "MESSAGE_FETCH_FAILED";
  return "CONFIGURATION_INVALID";
}

/** Retry-After, in seconds, when the provider sent a usable one. Never guessed. */
export function readRetryAfterSeconds(headers: { get(name: string): string | null } | null | undefined): number | null {
  const raw = headers?.get?.("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * The ONE place a provider HTTP response becomes either JSON or a classified failure.
 *
 * NOTHING FROM THE RESPONSE BODY REACHES THE ERROR MESSAGE. A failed token exchange echoes back request
 * parameters, and an error string built from a provider body is how an authorization code or a token ends
 * up in a log line, an audit summary and a support ticket. The status and the context are enough to act
 * on; the body is read only to be discarded.
 */
export async function readProviderJson(response: Response, context: "auth" | "mailbox" | "message" | "attachment"): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new ProviderTransportError(
      classifyHttpStatus(response.status, context),
      `The provider refused the ${context} request (HTTP ${response.status}).`,
      readRetryAfterSeconds(response.headers),
    );
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ProviderTransportError(classifyHttpStatus(502, context), `The provider returned an unreadable ${context} response.`);
  }
}

/** Turn a provider `expires_in` into an absolute expiry, with a safety margin so we never race it. */
export const TOKEN_EXPIRY_SAFETY_MS = 60_000;
export function tokenExpiryFrom(expiresInSeconds: unknown, now: number): number {
  const seconds = typeof expiresInSeconds === "number" && Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600;
  return now + Math.max(seconds * 1000 - TOKEN_EXPIRY_SAFETY_MS, 30_000);
}

/** A token set from a provider token response, with the shape (not the value) validated. */
export function tokenSetFrom(payload: Record<string, unknown>, now: number, previousRefreshToken: string | null = null): ProviderTokenSet {
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new ProviderTransportError("CONFIGURATION_INVALID", "The provider returned no access token.");
  const rotated = typeof payload.refresh_token === "string" && payload.refresh_token ? payload.refresh_token : null;
  return {
    accessToken,
    // A provider that does not rotate the refresh token returns none; keeping the previous one is what
    // makes refresh work at all, and taking a rotated one is what keeps working when it does rotate.
    refreshToken: rotated ?? previousRefreshToken,
    expiresAt: tokenExpiryFrom(payload.expires_in, now),
    scope: boundedString(payload.scope, 500),
  };
}
