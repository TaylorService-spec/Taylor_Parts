// Email Connections -- GOOGLE WORKSPACE / GMAIL TRANSPORT. The same six methods as Microsoft, and the
// same rule: everything provider-specific stops here.
//
// HISTORY POLLING, NOT WATCH + PUB/SUB, for the same proportionality reason the Microsoft adapter records.
// `users.watch` expires in seven days and delivers through a Pub/Sub topic, which means a topic, an IAM
// binding for Gmail's publisher, a push endpoint or subscriber, and a renewal job -- and a missed
// notification is still silent data loss, so a poll has to exist underneath it regardless.
// `users.history.list` from a stored historyId gives exactly-once catch-up with none of that.
//
// EXPIRED HISTORY IS A REAL CASE, NOT AN EDGE CASE. Gmail keeps history for a limited window; a mailbox
// that goes quiet for long enough returns 404 for its stored historyId. Recovery is a bounded re-list of
// recent messages -- and because intake deduplicates on the provider message id, re-listing is safe:
// anything already taken in is recognised as a duplicate rather than worked twice.
import {
  ProviderTransportError,
  classifyHttpStatus,
  readProviderJson,
  readRetryAfterSeconds,
  tokenSetFrom,
  type EmailTransportAdapter,
  type MailboxValidation,
  type ProviderAttachmentBytes,
  type ProviderMessageList,
  type ProviderTokenSet,
} from "./providerTransport";
import { boundedString, normalizeEmailAddress } from "./inboundWorkModel";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * LEAST PRIVILEGE. `gmail.readonly` and nothing else: it reads messages and attachments, which is the
 * entire requirement. DELIBERATELY ABSENT: gmail.send, gmail.modify and gmail.labels -- outbound reply is
 * a separate unbuilt feature, and EOS never marks, moves or deletes a message in the customer's mailbox.
 */
export const GOOGLE_INBOUND_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
}

/** How far back a history-expiry recovery re-lists. Bounded on purpose: recovery, not a mailbox import. */
export const GMAIL_RECOVERY_QUERY = "newer_than:2d";

async function postToken(body: Record<string, string>, now: number, previousRefreshToken: string | null): Promise<ProviderTokenSet> {
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
  } catch {
    throw new ProviderTransportError("PROVIDER_UNAVAILABLE", "Google's token endpoint could not be reached.");
  }
  return tokenSetFrom(await readProviderJson(response, "auth"), now, previousRefreshToken);
}

async function gmailGet(accessToken: string, path: string): Promise<Response> {
  try {
    return await fetch(`${GMAIL}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new ProviderTransportError("PROVIDER_UNAVAILABLE", "The Gmail API could not be reached.");
  }
}

export function createGmailTransport(config: GoogleClientConfig, deps: { now?: () => number } = {}): EmailTransportAdapter {
  const now = deps.now ?? (() => Date.now());
  if (!config?.clientId || !config?.clientSecret) {
    throw new ProviderTransportError("CONFIGURATION_INVALID", "This environment has no Google Workspace OAuth client configured.");
  }

  return {
    provider: "GOOGLE_WORKSPACE",

    buildAuthorizationUrl({ connectedAccount, redirectUri, state, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: GOOGLE_INBOUND_SCOPES.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        login_hint: connectedAccount,
        // Both are required to receive a refresh token at all: Google returns one only for an offline
        // grant, and only on a consent it treats as new.
        access_type: "offline",
        prompt: "consent",
      });
      return `${GOOGLE_AUTHORIZE}?${params.toString()}`;
    },

    exchangeAuthorizationCode: ({ code, codeVerifier, redirectUri }) =>
      postToken(
        {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "authorization_code",
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        },
        now(),
        null,
      ),

    refreshAccessToken: ({ refreshToken }) =>
      postToken(
        { client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken },
        now(),
        // Google does not return the refresh token on a refresh; the stored one remains authoritative.
        refreshToken,
      ),

    /**
     * The authorized account IS the mailbox for Gmail, so validation is an identity check as much as an
     * access check: if the profile's address is not the configured mailbox, an administrator has
     * authorized the wrong account, and silently polling it would file another mailbox's mail as this one.
     */
    async validateMailboxAccess({ accessToken, mailboxAddress }): Promise<MailboxValidation> {
      const address = normalizeEmailAddress(mailboxAddress);
      if (!address) return { ok: false, detail: "The mailbox address is not a valid email address." };
      const response = await gmailGet(accessToken, "/profile");
      if (!response.ok) {
        const code = classifyHttpStatus(response.status, "mailbox");
        return {
          ok: false,
          detail:
            code === "MAILBOX_ACCESS_DENIED"
              ? "The authorization does not permit reading this mailbox."
              : `Gmail refused the mailbox check (HTTP ${response.status}).`,
        };
      }
      const profile = (await response.json()) as Record<string, unknown>;
      const authorized = normalizeEmailAddress(profile.emailAddress);
      if (authorized !== address) {
        return { ok: false, detail: `The authorized Google account is ${authorized || "unknown"}, not ${address}. Reauthorize as the mailbox owner.` };
      }
      return { ok: true, detail: `Mailbox readable for ${address}.` };
    },

    async listNewMessageIds({ accessToken, mailboxAddress, cursor, limit }): Promise<ProviderMessageList> {
      const bounded = Math.max(Math.min(limit, 100), 1);

      // FIRST POLL: take the mailbox's current historyId and no messages. Connecting is not importing.
      if (!cursor?.value || cursor.expired === true) {
        const profile = await readProviderJson(await gmailGet(accessToken, "/profile"), "mailbox");
        const historyId = boundedString(profile.historyId, 64);
        if (!cursor?.expired) return { messageIds: [], cursor: { value: historyId || null }, truncated: false };
        // RECOVERY after an expired history id: a bounded window of recent messages, re-listed. Intake's
        // duplicate protection is what makes this safe to do rather than something to avoid.
        const listed = await readProviderJson(
          await gmailGet(accessToken, `/messages?maxResults=${bounded}&q=${encodeURIComponent(GMAIL_RECOVERY_QUERY)}`),
          "message",
        );
        const messages = Array.isArray(listed.messages) ? listed.messages : [];
        return {
          messageIds: messages.map((m) => boundedString((m as Record<string, unknown>)?.id, 128)).filter(Boolean),
          cursor: { value: historyId || null },
          truncated: Boolean(listed.nextPageToken),
        };
      }

      const response = await gmailGet(
        accessToken,
        `/history?startHistoryId=${encodeURIComponent(cursor.value)}&historyTypes=messageAdded&maxResults=${bounded}`,
      );
      if (response.status === 404) {
        // Not an error to retry blindly: the stored cursor is simply too old to be honoured.
        throw new ProviderTransportError("CURSOR_EXPIRED", "The stored Gmail history point is no longer available.");
      }
      if (!response.ok) {
        throw new ProviderTransportError(
          classifyHttpStatus(response.status, "message"),
          `Gmail refused the history list (HTTP ${response.status}).`,
          readRetryAfterSeconds(response.headers),
        );
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const history = Array.isArray(payload.history) ? payload.history : [];
      const messageIds: string[] = [];
      for (const entry of history) {
        const added = Array.isArray((entry as Record<string, unknown>)?.messagesAdded) ? ((entry as Record<string, unknown>).messagesAdded as unknown[]) : [];
        for (const item of added) {
          const id = boundedString(((item as Record<string, unknown>)?.message as Record<string, unknown>)?.id, 128);
          // The same message can appear in several history records; the poll de-duplicates here as well,
          // even though intake would catch it -- one fetch is cheaper than one fetch plus a duplicate.
          if (id && !messageIds.includes(id)) messageIds.push(id);
        }
      }
      return {
        messageIds: messageIds.slice(0, bounded),
        cursor: { value: boundedString(payload.historyId, 64) || cursor.value },
        truncated: Boolean(payload.nextPageToken),
      };
    },

    async fetchMessage({ accessToken, messageId }) {
      return readProviderJson(await gmailGet(accessToken, `/messages/${encodeURIComponent(messageId)}?format=full`), "message");
    },

    async fetchAttachment({ accessToken, messageId, attachmentId }): Promise<ProviderAttachmentBytes> {
      const response = await gmailGet(accessToken, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
      if (!response.ok) {
        throw new ProviderTransportError(
          classifyHttpStatus(response.status, "attachment"),
          `Gmail refused the attachment (HTTP ${response.status}).`,
          readRetryAfterSeconds(response.headers),
        );
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const data = typeof payload.data === "string" ? payload.data : "";
      if (!data) throw new ProviderTransportError("ATTACHMENT_FETCH_FAILED", "Gmail returned an attachment with no content.");
      return { bytes: Buffer.from(data, "base64url"), mimeType: "application/octet-stream", filename: "" };
    },
  };
}
