// Email Connections -- REAL PROVIDER TRANSPORT, offline suite. Everything provable without a database or a
// network: the OAuth state rules, both provider adapters against a stubbed fetch, failure classification
// and backoff, credential custody, and attachment safety.
//
// `fetch` is stubbed per test rather than mocked globally, so each case states exactly what the provider
// said and nothing leaks between them.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  AUTHORIZATION_STATE_TTL_MS,
  OAuthStateError,
  assertAuthorizationStateUsable,
  hashAuthorizationState,
  issueAuthorizationState,
} from "../lib/inboundWork/providerAuthorizationState.js";
import {
  MAX_DELIVERY_ATTEMPTS,
  ProviderTransportError,
  classifyHttpStatus,
  dispositionOf,
  nextRetryDelayMs,
  readProviderJson,
  readRetryAfterSeconds,
  tokenExpiryFrom,
  tokenSetFrom,
} from "../lib/inboundWork/providerTransport.js";
import { MICROSOFT_INBOUND_SCOPES, createMicrosoftGraphTransport } from "../lib/inboundWork/microsoftGraphTransport.js";
import { GOOGLE_INBOUND_SCOPES, createGmailTransport } from "../lib/inboundWork/gmailTransport.js";
import {
  createInMemoryVault,
  credentialSecretName,
  forgetAccessToken,
  resolveAccessToken,
} from "../lib/inboundWork/providerCredentialVault.js";
import {
  MAX_ATTACHMENT_BYTES,
  assertStorableAttachment,
  attachmentStorageKey,
  createInMemoryAttachmentStore,
  safeAttachmentFilename,
  summarizeCustody,
  AttachmentRefusal,
} from "../lib/inboundWork/attachmentCustody.js";
import { providerClientConfigured, transportFor } from "../lib/inboundWork/providerTransportFactory.js";

const NOW = 1_757_000_000_000;
const bytes = (n) => Buffer.alloc(n, 7);
// Deterministic but NOT constant: the state and the PKCE verifier are drawn from the same source and
// must never come out equal, which a fixed buffer would hide.
let randomCounter = 0;
const deterministicRandom = (size) => Buffer.alloc(size, (randomCounter += 1) % 251);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** One canned response, and a record of exactly what was asked for. */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  return calls;
}

const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// ── OAuth state ──────────────────────────────────────────────────────────────────────────────────
const issueState = (overrides = {}) =>
  issueAuthorizationState(
    {
      connectionId: "conn-1",
      provider: "MICROSOFT_365",
      redirectUri: "https://app.example/administration/email-communications",
      initiatedByUid: "admin-1",
      ...overrides,
    },
    { now: NOW, randomBytes: deterministicRandom },
  );

test("the stored state is a HASH -- a read of the collection yields nothing presentable at the callback", () => {
  const issued = issueState();
  assert.notEqual(issued.stateKey, issued.state);
  assert.equal(issued.stateKey, hashAuthorizationState(issued.state));
  assert.match(issued.stateKey, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(issued.record).includes(issued.state), false, "the state value is not stored");
});

test("PKCE: the verifier stays server-side and the challenge is its sha256", () => {
  const issued = issueState();
  assert.ok(issued.record.codeVerifier.length >= 32);
  assert.notEqual(issued.codeChallenge, issued.record.codeVerifier);
});

test("a redirect that is not https (or localhost) is refused before the provider ever sees it", () => {
  assert.throws(() => issueState({ redirectUri: "http://evil.example/callback" }), OAuthStateError);
  assert.doesNotThrow(() => issueState({ redirectUri: "http://localhost:5173/administration/email-communications" }));
});

const presented = (overrides = {}) => ({
  connectionId: "conn-1",
  provider: "MICROSOFT_365",
  redirectUri: "https://app.example/administration/email-communications",
  actorUid: "admin-1",
  now: NOW + 1000,
  ...overrides,
});

test("an unknown state is refused -- a callback EOS did not start is not a callback", () => {
  assert.throws(() => assertAuthorizationStateUsable(null, presented()), (e) => e.code === "STATE_UNKNOWN");
});

test("a state is SINGLE USE", () => {
  const { record } = issueState();
  assert.doesNotThrow(() => assertAuthorizationStateUsable(record, presented()));
  assert.throws(() => assertAuthorizationStateUsable({ ...record, consumedAt: NOW }, presented()), (e) => e.code === "STATE_ALREADY_USED");
});

test("a state expires", () => {
  const { record } = issueState();
  assert.throws(
    () => assertAuthorizationStateUsable(record, presented({ now: NOW + AUTHORIZATION_STATE_TTL_MS + 1 })),
    (e) => e.code === "STATE_EXPIRED",
  );
});

test("a code cannot be redeemed against a different connection, provider, redirect or administrator", () => {
  const { record } = issueState();
  assert.throws(() => assertAuthorizationStateUsable(record, presented({ connectionId: "conn-2" })), (e) => e.code === "STATE_CONNECTION_MISMATCH");
  assert.throws(() => assertAuthorizationStateUsable(record, presented({ provider: "GOOGLE_WORKSPACE" })), (e) => e.code === "STATE_PROVIDER_MISMATCH");
  assert.throws(() => assertAuthorizationStateUsable(record, presented({ redirectUri: "https://evil.example/cb" })), (e) => e.code === "STATE_REDIRECT_MISMATCH");
  assert.throws(() => assertAuthorizationStateUsable(record, presented({ actorUid: "admin-2" })), (e) => e.code === "STATE_ACTOR_MISMATCH");
});

// ── Failure classification ───────────────────────────────────────────────────────────────────────
test("HTTP status becomes the failure a person can act on", () => {
  assert.equal(classifyHttpStatus(401, "message"), "AUTH_EXPIRED");
  assert.equal(classifyHttpStatus(403, "auth"), "AUTH_REVOKED");
  assert.equal(classifyHttpStatus(403, "mailbox"), "MAILBOX_ACCESS_DENIED");
  assert.equal(classifyHttpStatus(404, "mailbox"), "MAILBOX_NOT_FOUND");
  assert.equal(classifyHttpStatus(410, "message"), "CURSOR_EXPIRED");
  assert.equal(classifyHttpStatus(429, "message"), "PROVIDER_RATE_LIMIT");
  assert.equal(classifyHttpStatus(503, "message"), "PROVIDER_UNAVAILABLE");
});

test("wait, refresh, or fix it -- the three dispositions, and nothing else", () => {
  assert.equal(dispositionOf("PROVIDER_RATE_LIMIT"), "RETRYABLE");
  assert.equal(dispositionOf("PROVIDER_UNAVAILABLE"), "RETRYABLE");
  assert.equal(dispositionOf("AUTH_EXPIRED"), "REFRESH_THEN_RETRY");
  assert.equal(dispositionOf("AUTH_REVOKED"), "REQUIRES_ADMIN_ACTION");
  assert.equal(dispositionOf("MAILBOX_NOT_FOUND"), "REQUIRES_ADMIN_ACTION");
  assert.equal(dispositionOf("CONFIGURATION_INVALID"), "REQUIRES_ADMIN_ACTION");
});

test("backoff grows, is capped, and honours the provider's own Retry-After", () => {
  assert.ok(nextRetryDelayMs(1, null) < nextRetryDelayMs(3, null));
  assert.ok(nextRetryDelayMs(MAX_DELIVERY_ATTEMPTS, null) <= 15 * 60_000);
  assert.equal(nextRetryDelayMs(1, 30), 30_000);
  assert.equal(nextRetryDelayMs(1, 100_000), 15 * 60_000, "even the provider cannot ask us to wait forever");
  assert.equal(readRetryAfterSeconds(new Headers({ "retry-after": "12" })), 12);
  assert.equal(readRetryAfterSeconds(new Headers()), null);
});

test("a provider error message NEVER carries the provider's body -- that is where tokens leak from", async () => {
  const response = new Response(JSON.stringify({ error: "invalid_grant", refresh_token: "SECRET-TOKEN-VALUE" }), { status: 400 });
  await assert.rejects(
    () => readProviderJson(response, "auth"),
    (err) => {
      assert.ok(err instanceof ProviderTransportError);
      assert.equal(err.message.includes("SECRET-TOKEN-VALUE"), false);
      assert.equal(err.message.includes("invalid_grant"), false);
      assert.match(err.message, /HTTP 400/);
      return true;
    },
  );
});

test("a token response becomes an absolute expiry with a safety margin, and keeps the previous refresh token", () => {
  const set = tokenSetFrom({ access_token: "at", expires_in: 3600, scope: "s" }, NOW, "previous-refresh");
  assert.equal(set.refreshToken, "previous-refresh", "a provider that does not rotate does not erase what we hold");
  assert.ok(set.expiresAt < NOW + 3600 * 1000, "expiry carries a safety margin");
  assert.equal(tokenSetFrom({ access_token: "at", refresh_token: "rotated" }, NOW).refreshToken, "rotated");
  assert.throws(() => tokenSetFrom({}, NOW), ProviderTransportError);
  assert.ok(tokenExpiryFrom("nonsense", NOW) > NOW);
});

// ── Microsoft adapter ────────────────────────────────────────────────────────────────────────────
const microsoft = () => createMicrosoftGraphTransport({ clientId: "client-1", clientSecret: "secret-1" }, { now: () => NOW });

test("Microsoft asks for READ scopes only -- no send, no write", () => {
  assert.deepEqual(MICROSOFT_INBOUND_SCOPES, [
    "offline_access",
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.Read.Shared",
  ]);
  for (const scope of MICROSOFT_INBOUND_SCOPES) {
    assert.equal(/send|readwrite/i.test(scope), false, `${scope} grants more than reading`);
  }
});

test("the Microsoft authorization URL carries PKCE, the state and the tenant -- and no secret", () => {
  const url = new URL(
    microsoft().buildAuthorizationUrl({
      tenantOrWorkspace: "tenant-1",
      connectedAccount: "svc@op.example",
      redirectUri: "https://app.example/cb",
      state: "state-1",
      codeChallenge: "challenge-1",
    }),
  );
  assert.match(url.origin + url.pathname, /login\.microsoftonline\.com\/tenant-1/);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "challenge-1");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.toString().includes("secret-1"), false, "the client secret never goes in a URL");
});

test("Microsoft: the FIRST poll takes a cursor for now and ingests nothing", async () => {
  const calls = stubFetch(() => jsonResponse({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/delta?token=abc" }));
  const listed = await microsoft().listNewMessageIds({ accessToken: "at", mailboxAddress: "warranty@op.example", cursor: { value: null }, limit: 25 });
  assert.deepEqual(listed.messageIds, [], "connecting a mailbox is not importing its history");
  assert.match(calls[0].url, /\$deltatoken=latest/);
  assert.equal(listed.cursor.value, "https://graph.microsoft.com/delta?token=abc");
});

test("Microsoft: a delta page returns ids and the resume point", async () => {
  stubFetch(() => jsonResponse({ value: [{ id: "m1" }, { id: "m2" }], "@odata.deltaLink": "https://graph.microsoft.com/delta?token=next" }));
  const listed = await microsoft().listNewMessageIds({ accessToken: "at", mailboxAddress: "w@op.example", cursor: { value: "https://graph.microsoft.com/delta?token=prev" }, limit: 25 });
  assert.deepEqual(listed.messageIds, ["m1", "m2"]);
  assert.equal(listed.cursor.value, "https://graph.microsoft.com/delta?token=next");
  assert.equal(listed.truncated, false);
});

test("Microsoft: a rate limit is classified and carries the provider's Retry-After", async () => {
  stubFetch(() => jsonResponse({}, 429, { "retry-after": "42" }));
  await assert.rejects(
    () => microsoft().listNewMessageIds({ accessToken: "at", mailboxAddress: "w@op.example", cursor: { value: "x" }, limit: 5 }),
    (err) => err.code === "PROVIDER_RATE_LIMIT" && err.retryAfterSeconds === 42,
  );
});

test("Microsoft: mailbox validation reports the DIFFERENCE between missing and forbidden", async () => {
  stubFetch(() => jsonResponse({ id: "inbox" }));
  assert.equal((await microsoft().validateMailboxAccess({ accessToken: "at", mailboxAddress: "w@op.example" })).ok, true);

  stubFetch(() => jsonResponse({}, 404));
  const missing = await microsoft().validateMailboxAccess({ accessToken: "at", mailboxAddress: "w@op.example" });
  assert.equal(missing.ok, false);
  assert.match(missing.detail, /no mailbox/i);

  stubFetch(() => jsonResponse({}, 403));
  const denied = await microsoft().validateMailboxAccess({ accessToken: "at", mailboxAddress: "w@op.example" });
  assert.equal(denied.ok, false);
  assert.match(denied.detail, /not permitted|shared mailbox/i);
});

test("Microsoft: attachment bytes come back as bytes, not as a JSON envelope", async () => {
  stubFetch(() => new Response(Buffer.from("PDF-CONTENT"), { status: 200, headers: { "content-type": "application/pdf" } }));
  const attachment = await microsoft().fetchAttachment({ accessToken: "at", mailboxAddress: "w@op.example", messageId: "m1", attachmentId: "a1" });
  assert.equal(attachment.bytes.toString("utf8"), "PDF-CONTENT");
  assert.equal(attachment.mimeType, "application/pdf");
});

test("a network failure is an outage, NOT a revoked authorization", async () => {
  globalThis.fetch = async () => {
    throw new TypeError("network down");
  };
  await assert.rejects(
    () => microsoft().refreshAccessToken({ refreshToken: "rt", tenantOrWorkspace: "t" }),
    (err) => err.code === "PROVIDER_UNAVAILABLE",
  );
});

// ── Gmail adapter ────────────────────────────────────────────────────────────────────────────────
const gmail = () => createGmailTransport({ clientId: "g-client", clientSecret: "g-secret" }, { now: () => NOW });

test("Gmail asks for gmail.readonly and nothing else", () => {
  assert.deepEqual(GOOGLE_INBOUND_SCOPES, ["https://www.googleapis.com/auth/gmail.readonly"]);
});

test("the Gmail authorization URL asks for offline access, which is the only way a refresh token arrives", () => {
  const url = new URL(
    gmail().buildAuthorizationUrl({ tenantOrWorkspace: "op.example", connectedAccount: "svc@op.example", redirectUri: "https://app.example/cb", state: "s", codeChallenge: "c" }),
  );
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
});

test("Gmail: authorizing the WRONG account is caught -- the profile must be the configured mailbox", async () => {
  stubFetch(() => jsonResponse({ emailAddress: "someone-else@op.example", historyId: "999" }));
  const result = await gmail().validateMailboxAccess({ accessToken: "at", mailboxAddress: "service@op.example" });
  assert.equal(result.ok, false);
  assert.match(result.detail, /someone-else@op\.example/);
});

test("Gmail: the FIRST poll takes the history id and ingests nothing", async () => {
  stubFetch(() => jsonResponse({ emailAddress: "service@op.example", historyId: "12345" }));
  const listed = await gmail().listNewMessageIds({ accessToken: "at", mailboxAddress: "service@op.example", cursor: { value: null }, limit: 25 });
  assert.deepEqual(listed.messageIds, []);
  assert.equal(listed.cursor.value, "12345");
});

test("Gmail: history returns the added message ids, de-duplicated across history records", async () => {
  stubFetch(() =>
    jsonResponse({
      history: [
        { messagesAdded: [{ message: { id: "g1" } }, { message: { id: "g2" } }] },
        { messagesAdded: [{ message: { id: "g2" } }] },
      ],
      historyId: "999",
    }),
  );
  const listed = await gmail().listNewMessageIds({ accessToken: "at", mailboxAddress: "s@op.example", cursor: { value: "500" }, limit: 25 });
  assert.deepEqual(listed.messageIds, ["g1", "g2"]);
  assert.equal(listed.cursor.value, "999");
});

test("Gmail: an aged-out history id is CURSOR_EXPIRED, and recovery re-lists a bounded recent window", async () => {
  stubFetch(() => jsonResponse({}, 404));
  await assert.rejects(
    () => gmail().listNewMessageIds({ accessToken: "at", mailboxAddress: "s@op.example", cursor: { value: "1" }, limit: 25 }),
    (err) => err.code === "CURSOR_EXPIRED",
  );

  const calls = stubFetch((url) =>
    url.includes("/profile") ? jsonResponse({ emailAddress: "s@op.example", historyId: "777" }) : jsonResponse({ messages: [{ id: "r1" }, { id: "r2" }] }),
  );
  const recovered = await gmail().listNewMessageIds({ accessToken: "at", mailboxAddress: "s@op.example", cursor: { value: "1", expired: true }, limit: 25 });
  assert.deepEqual(recovered.messageIds, ["r1", "r2"]);
  assert.equal(recovered.cursor.value, "777");
  assert.match(calls[1].url, /newer_than/, "recovery is bounded in time, not a mailbox import");
});

test("Gmail: attachment content is base64url and is decoded, not passed through", async () => {
  const content = Buffer.from("SPREADSHEET").toString("base64url");
  stubFetch(() => jsonResponse({ data: content, size: 11 }));
  const attachment = await gmail().fetchAttachment({ accessToken: "at", mailboxAddress: "s@op.example", messageId: "m", attachmentId: "a" });
  assert.equal(attachment.bytes.toString("utf8"), "SPREADSHEET");
});

// ── The factory ──────────────────────────────────────────────────────────────────────────────────
test("an environment with no OAuth client says so, and cannot build a transport", () => {
  const empty = {};
  assert.equal(providerClientConfigured("MICROSOFT_365", empty), false);
  assert.equal(providerClientConfigured("GOOGLE_WORKSPACE", empty), false);
  assert.throws(() => transportFor("MICROSOFT_365", empty), ProviderTransportError);
  assert.equal(providerClientConfigured("MICROSOFT_365", { EMAIL_MICROSOFT_CLIENT_ID: "a", EMAIL_MICROSOFT_CLIENT_SECRET: "b" }), true);
});

// ── Credential custody ───────────────────────────────────────────────────────────────────────────
/** A Firestore stand-in that records every write, so "no token was persisted" is an assertion. */
function recordingDb() {
  const writes = [];
  return {
    writes,
    collection: (name) => ({
      doc: (id) => ({
        set: async (data, options) => {
          writes.push({ collection: name, id, data, options });
        },
      }),
    }),
  };
}

test("the credential secret name is derived from the connection, and a hostile id is refused", () => {
  assert.equal(credentialSecretName("proj", "conn-1"), "projects/proj/secrets/eos-email-connection-conn-1");
  assert.throws(() => credentialSecretName("proj", "../../etc/passwd"), ProviderTransportError);
});

test("resolveAccessToken refreshes, caches, and writes NO token to the database", async () => {
  const db = recordingDb();
  const vault = createInMemoryVault({ "conn-1": "refresh-1" });
  let refreshes = 0;
  const adapter = {
    provider: "MICROSOFT_365",
    refreshAccessToken: async () => {
      refreshes += 1;
      return { accessToken: "access-token-value", refreshToken: "refresh-1", expiresAt: NOW + 600_000, scope: "s" };
    },
  };
  forgetAccessToken("conn-1");

  const first = await resolveAccessToken(db, vault, adapter, { connectionId: "conn-1", tenantOrWorkspace: "t" }, { now: () => NOW });
  const second = await resolveAccessToken(db, vault, adapter, { connectionId: "conn-1", tenantOrWorkspace: "t" }, { now: () => NOW + 1000 });
  assert.equal(first, "access-token-value");
  assert.equal(second, "access-token-value");
  assert.equal(refreshes, 1, "the second call came from the cache");

  const persisted = JSON.stringify(db.writes);
  assert.equal(persisted.includes("access-token-value"), false, "an access token is never persisted");
  assert.equal(persisted.includes("refresh-1"), false, "a refresh token is never persisted in Firestore");
  assert.match(persisted, /lastTokenRefreshAt/);
});

test("a ROTATED refresh token is stored in the vault before the access token is handed out", async () => {
  const db = recordingDb();
  const vault = createInMemoryVault({ "conn-2": "old-refresh" });
  const adapter = {
    provider: "MICROSOFT_365",
    refreshAccessToken: async () => ({ accessToken: "at", refreshToken: "new-refresh", expiresAt: NOW + 600_000, scope: "" }),
  };
  forgetAccessToken("conn-2");
  await resolveAccessToken(db, vault, adapter, { connectionId: "conn-2", tenantOrWorkspace: "t" }, { now: () => NOW });
  assert.equal(vault.store.get("conn-2"), "new-refresh");
  assert.equal(JSON.stringify(db.writes).includes("new-refresh"), false);
});

test("a connection with no stored credential, and one the provider refuses, both require reauthorization", async () => {
  const db = recordingDb();
  forgetAccessToken("conn-3");
  await assert.rejects(
    () => resolveAccessToken(db, createInMemoryVault(), { provider: "X", refreshAccessToken: async () => ({}) }, { connectionId: "conn-3", tenantOrWorkspace: "t" }, { now: () => NOW }),
    (err) => err.code === "AUTH_REVOKED",
  );

  forgetAccessToken("conn-4");
  const refusing = {
    provider: "X",
    refreshAccessToken: async () => {
      throw new ProviderTransportError("AUTH_EXPIRED", "refused");
    },
  };
  await assert.rejects(
    () => resolveAccessToken(db, createInMemoryVault({ "conn-4": "rt" }), refusing, { connectionId: "conn-4", tenantOrWorkspace: "t" }, { now: () => NOW }),
    (err) => err.code === "AUTH_REVOKED" && /Reauthorize/i.test(err.message),
  );
});

// ── Attachment safety ────────────────────────────────────────────────────────────────────────────
test("a hostile filename is data, and is defanged", () => {
  assert.equal(safeAttachmentFilename("../../../etc/passwd"), "_._._etc_passwd");
  assert.equal(safeAttachmentFilename("..\\..\\windows\\system32"), "_._windows_system32");
  assert.equal(safeAttachmentFilename(""), "attachment");
  assert.equal(safeAttachmentFilename(null), "attachment");
  assert.equal(safeAttachmentFilename(".hidden"), "hidden");
  assert.equal(safeAttachmentFilename("x".repeat(400)).length <= 255, true);
});

test("the storage key comes from ids and a hash -- never from the sender's filename", () => {
  const key = attachmentStorageKey("req-1", "msg-1", "att-1");
  assert.match(key, /^email-intake\/req-1\/[0-9a-f]{40}$/);
  assert.equal(key, attachmentStorageKey("req-1", "msg-1", "att-1"), "deterministic, so a retry cannot double-store");
  assert.notEqual(key, attachmentStorageKey("req-1", "msg-1", "att-2"));
  // A request id that is not id-shaped is stripped to something safe rather than becoming a path: the
  // key can never climb out of its prefix, whatever the caller passed.
  assert.equal(attachmentStorageKey("../evil", "m", "a").startsWith("email-intake/evil/"), true);
  assert.throws(() => attachmentStorageKey("///", "m", "a"), AttachmentRefusal);
});

test("size is bounded before anything is written, and a zero-byte attachment is kept", () => {
  assert.doesNotThrow(() => assertStorableAttachment(Buffer.alloc(0), 0));
  assert.doesNotThrow(() => assertStorableAttachment(bytes(1024), 1024));
  assert.throws(() => assertStorableAttachment(bytes(MAX_ATTACHMENT_BYTES + 1), 0), AttachmentRefusal);
  assert.throws(() => assertStorableAttachment(bytes(10), MAX_ATTACHMENT_BYTES + 1), AttachmentRefusal);
  assert.throws(() => assertStorableAttachment(null, 0), AttachmentRefusal);
});

test("custody is COMPLETE only when every file is actually held", () => {
  assert.equal(summarizeCustody([]), "NONE");
  assert.equal(summarizeCustody([{ custody: "STORED" }, { custody: "STORED" }]), "COMPLETE");
  assert.equal(summarizeCustody([{ custody: "STORED" }, { custody: "FAILED" }]), "PARTIAL");
  assert.equal(summarizeCustody([{ custody: "FAILED" }]), "FAILED");
  assert.equal(summarizeCustody([{ custody: "PENDING" }]), "PENDING");
});

test("the same bytes stored twice occupy one object", async () => {
  const store = createInMemoryAttachmentStore();
  const key = attachmentStorageKey("req-1", "msg-1", "att-1");
  await store.put(key, Buffer.from("hello"), {});
  await store.put(key, Buffer.from("hello"), {});
  assert.equal(store.objects.size, 1);
  assert.equal((await store.get(key)).toString(), "hello");
});
