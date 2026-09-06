// Email Connections -- MICROSOFT 365 TRANSPORT. Implements EmailTransportAdapter and nothing else: it
// authorizes, validates, lists, fetches. It does not route, extract, thread, deduplicate or decide.
//
// DELTA POLLING, NOT CHANGE NOTIFICATIONS, and the reason is proportionality rather than preference.
// Graph mail subscriptions expire in under three days, so a notification design needs a renewal job on top
// of a publicly reachable HTTPS endpoint that must answer the validation handshake, verify a clientState
// it was given at creation, tolerate replays, and be safe while unauthenticated -- and it still needs a
// poll behind it, because a missed notification is silent data loss. `messages/delta` gives the same
// property (every message since the last look, exactly once) with a stored cursor, no public endpoint,
// and no renewal at all. When notification latency is genuinely required, it becomes an ADDITIONAL
// trigger for this same poll rather than a second delivery path.
//
// THE FIRST POLL INGESTS NOTHING. `$deltatoken=latest` asks Graph for a cursor representing "now" without
// returning a single message, so connecting a mailbox that has ten years of mail in it does not enqueue
// ten years of Inbound Work. Connecting is not importing.
import {
  ProviderTransportError,
  classifyHttpStatus,
  readProviderJson,
  readRetryAfterSeconds,
  tokenSetFrom,
  type DeliveryCursor,
  type EmailTransportAdapter,
  type MailboxValidation,
  type ProviderAttachmentBytes,
  type ProviderMessageList,
  type ProviderTokenSet,
} from "./providerTransport";
import { boundedString, normalizeEmailAddress } from "./inboundWorkModel";

const GRAPH = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com";

/**
 * LEAST PRIVILEGE, and each scope is here because the implementation cannot work without it:
 *   offline_access  -- a refresh token, so intake keeps working without an administrator present.
 *   Mail.Read       -- read the connected account's own mail.
 *   Mail.Read.Shared-- read the SHARED Service / Warranty / Parts mailboxes the connected account has
 *                      been granted, which is the actual deployment shape; without it a shared mailbox
 *                      returns 403 no matter what the mailbox configuration says.
 * DELIBERATELY ABSENT: Mail.Send, Mail.ReadWrite, and Mail.ReadBasic.All. Outbound is a separate,
 * unbuilt feature (asking for its scope now would be asking for authority nothing exercises), and
 * nothing here modifies or deletes a provider-side message.
 */
export const MICROSOFT_INBOUND_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Mail.Read.Shared",
];

/** The deployment's own OAuth client. Never a per-connection value, never stored in Firestore. */
export interface MicrosoftClientConfig {
  clientId: string;
  clientSecret: string;
}

const form = (fields: Record<string, string>): string => new URLSearchParams(fields).toString();

async function postToken(tenant: string, body: Record<string, string>, now: number, previousRefreshToken: string | null): Promise<ProviderTokenSet> {
  let response: Response;
  try {
    response = await fetch(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form(body),
    });
  } catch {
    // A network failure is not an authorization failure. Calling it one would disconnect a healthy
    // connection because a DNS lookup blipped.
    throw new ProviderTransportError("PROVIDER_UNAVAILABLE", "The provider's token endpoint could not be reached.");
  }
  return tokenSetFrom(await readProviderJson(response, "auth"), now, previousRefreshToken);
}

async function graphGet(accessToken: string, url: string, context: "mailbox" | "message" | "attachment"): Promise<Response> {
  try {
    return await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new ProviderTransportError("PROVIDER_UNAVAILABLE", "Microsoft Graph could not be reached.");
  }
}

/** The message fields the existing normalizer reads -- asked for by name, so a mailbox poll stays small. */
const MESSAGE_SELECT = "id,conversationId,internetMessageId,receivedDateTime,subject,from,sender,toRecipients,ccRecipients,body,hasAttachments,internetMessageHeaders";

export function createMicrosoftGraphTransport(
  config: MicrosoftClientConfig,
  deps: { now?: () => number } = {},
): EmailTransportAdapter {
  const now = deps.now ?? (() => Date.now());
  if (!config?.clientId || !config?.clientSecret) {
    throw new ProviderTransportError("CONFIGURATION_INVALID", "This environment has no Microsoft 365 OAuth client configured.");
  }

  return {
    provider: "MICROSOFT_365",

    buildAuthorizationUrl({ tenantOrWorkspace, connectedAccount, redirectUri, state, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        response_mode: "query",
        scope: MICROSOFT_INBOUND_SCOPES.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        login_hint: connectedAccount,
        // The administrator must be able to see and accept exactly what is being granted.
        prompt: "consent",
      });
      return `${LOGIN}/${encodeURIComponent(tenantOrWorkspace)}/oauth2/v2.0/authorize?${params.toString()}`;
    },

    exchangeAuthorizationCode: ({ code, codeVerifier, redirectUri, tenantOrWorkspace }) =>
      postToken(
        tenantOrWorkspace,
        {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
          scope: MICROSOFT_INBOUND_SCOPES.join(" "),
        },
        now(),
        null,
      ),

    refreshAccessToken: ({ refreshToken, tenantOrWorkspace }) =>
      postToken(
        tenantOrWorkspace,
        {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: MICROSOFT_INBOUND_SCOPES.join(" "),
        },
        now(),
        // Microsoft rotates refresh tokens; when it does not, the existing one stays valid.
        refreshToken,
      ),

    /**
     * A token is not access. This reads the CONFIGURED mailbox's inbox -- the thing intake actually
     * depends on -- so a connection cannot be marked CONNECTED because consent succeeded against an
     * account that cannot open the mailbox somebody typed into the mailbox form.
     */
    async validateMailboxAccess({ accessToken, mailboxAddress }): Promise<MailboxValidation> {
      const address = normalizeEmailAddress(mailboxAddress);
      if (!address) return { ok: false, detail: "The mailbox address is not a valid email address." };
      const response = await graphGet(accessToken, `${GRAPH}/users/${encodeURIComponent(address)}/mailFolders/inbox?$select=id,totalItemCount`, "mailbox");
      if (response.ok) return { ok: true, detail: `Inbox readable for ${address}.` };
      const code = classifyHttpStatus(response.status, "mailbox");
      return {
        ok: false,
        detail:
          code === "MAILBOX_NOT_FOUND"
            ? `Microsoft 365 has no mailbox ${address} in this tenant.`
            : code === "MAILBOX_ACCESS_DENIED"
              ? `The connected account is not permitted to read ${address}. Grant it access to the shared mailbox, then test again.`
              : `Microsoft 365 refused the mailbox check (HTTP ${response.status}).`,
      };
    },

    async listNewMessageIds({ accessToken, mailboxAddress, cursor, limit }): Promise<ProviderMessageList> {
      const address = encodeURIComponent(normalizeEmailAddress(mailboxAddress));
      const url =
        cursor?.value && !cursor.expired
          ? cursor.value
          : // FIRST POLL: a cursor for "now", and no messages. See the file header.
            `${GRAPH}/users/${address}/mailFolders/inbox/messages/delta?$select=id&$deltatoken=latest`;
      const response = await graphGet(accessToken, url, "message");
      if (!response.ok) {
        throw new ProviderTransportError(
          classifyHttpStatus(response.status, "message"),
          `Microsoft Graph refused the message list (HTTP ${response.status}).`,
          readRetryAfterSeconds(response.headers),
        );
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const value = Array.isArray(payload.value) ? payload.value : [];
      const messageIds = value
        .map((m) => boundedString((m as Record<string, unknown>)?.id, 512))
        .filter(Boolean)
        // A delta page can carry deletions and moves as well as new mail; they carry no usable id for
        // fetching, and this poll is only interested in messages it can read.
        .slice(0, Math.max(limit, 1));
      const nextLink = boundedString(payload["@odata.nextLink"], 4000);
      const deltaLink = boundedString(payload["@odata.deltaLink"], 4000);
      return {
        messageIds,
        // Whichever link Graph gave is the resume point: nextLink means more pages now, deltaLink means
        // caught up. Storing whichever one came back is what makes the poll resumable either way.
        cursor: { value: nextLink || deltaLink || cursor?.value || null },
        truncated: Boolean(nextLink),
      };
    },

    async fetchMessage({ accessToken, mailboxAddress, messageId }) {
      const address = encodeURIComponent(normalizeEmailAddress(mailboxAddress));
      const url =
        `${GRAPH}/users/${address}/messages/${encodeURIComponent(messageId)}` +
        `?$select=${MESSAGE_SELECT}&$expand=attachments($select=id,name,contentType,size,isInline)`;
      const response = await graphGet(accessToken, url, "message");
      return readProviderJson(response, "message");
    },

    async fetchAttachment({ accessToken, mailboxAddress, messageId, attachmentId }): Promise<ProviderAttachmentBytes> {
      const address = encodeURIComponent(normalizeEmailAddress(mailboxAddress));
      // `/$value` returns the bytes themselves rather than a JSON envelope carrying base64 -- one third
      // less transfer and no decode step that could silently truncate.
      const url = `${GRAPH}/users/${address}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`;
      const response = await graphGet(accessToken, url, "attachment");
      if (!response.ok) {
        throw new ProviderTransportError(
          classifyHttpStatus(response.status, "attachment"),
          `Microsoft Graph refused the attachment (HTTP ${response.status}).`,
          readRetryAfterSeconds(response.headers),
        );
      }
      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        // The provider's own content type is a claim, not a fact; attachment custody validates it.
        mimeType: boundedString(response.headers.get("content-type"), 255) || "application/octet-stream",
        filename: "",
      };
    },
  };
}
