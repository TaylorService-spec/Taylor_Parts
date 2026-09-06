// Email Connections -- REAL DELIVERY, end to end against a Firestore emulator.
//
// The provider itself is a scripted adapter rather than a live tenant: what this suite proves is
// everything between the provider and the Work Order -- the connection lifecycle, the poll, the cursor,
// duplicate safety, threading, attachment custody, retry, and the fact that Accept still produces exactly
// one governed Work Order. The provider-side mappings are proven separately, from real payload shapes, in
// emailTransport.test.mjs.
//
// Prerequisite:
//   node node_modules/firebase-tools/lib/bin/firebase.js emulators:start --only firestore \
//     --project eos-platform-sandbox --config ../firebase.json
//   npm run build && node --test test/emailTransportEmulator.test.mjs
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
process.env.GCLOUD_PROJECT = "eos-platform-sandbox";

import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import admin from "firebase-admin";

import { upsertEmailConnection, upsertEmailMailbox, upsertEmailRoutingRule } from "../lib/inboundWork/emailAdminCommands.js";
import { readInboundWorkRequest, readMailbox, readEmailIntakeConfiguration } from "../lib/inboundWork/inboundWorkReadService.js";
import { acceptInboundWorkRequest } from "../lib/inboundWork/inboundDecisionCommands.js";
import { inboundRequestDocId } from "../lib/inboundWork/inboundIntakeCommand.js";
import { pollMailboxOnce, retryDelivery } from "../lib/inboundWork/emailDeliveryService.js";
import { runDeliveryCycle } from "../lib/inboundWork/emailDeliverySchedule.js";
import {
  completeConnectionAuthorization,
  disconnectConnection,
  startConnectionAuthorization,
  testConnection,
} from "../lib/inboundWork/emailConnectionCommands.js";
import { hashAuthorizationState } from "../lib/inboundWork/providerAuthorizationState.js";
import { ProviderTransportError } from "../lib/inboundWork/providerTransport.js";
import { createInMemoryVault, forgetAccessToken } from "../lib/inboundWork/providerCredentialVault.js";
import { createInMemoryAttachmentStore } from "../lib/inboundWork/attachmentCustody.js";
import { SANDBOX_RECORDS } from "../scripts/fixtures/inboundWorkFixtures.mjs";

admin.initializeApp({ projectId: "eos-platform-sandbox" });
const db = admin.firestore();

const CONNECTION_ID = "tx-conn-m365";
const MAILBOX_ID = "tx-mb-warranty";
const GMAIL_CONNECTION_ID = "tx-conn-google";
const GMAIL_MAILBOX_ID = "tx-mb-service";
const ADMIN = "tx-admin-uid";
const REVIEWER = "tx-reviewer-uid";
const SYSTEM = "tx-system";
const NOW = 1_757_100_000_000;

/** A Microsoft Graph message, in the provider's own shape, so the real normalizer does the work. */
const graphMessage = (id, overrides = {}) => ({
  id,
  conversationId: overrides.conversationId ?? `conv-${id}`,
  receivedDateTime: "2026-09-04T10:00:00Z",
  subject: overrides.subject ?? "Warranty service required",
  from: { emailAddress: { address: "dispatch@corporate.example" } },
  toRecipients: [{ emailAddress: { address: "warranty@sandbox.example" } }],
  body: {
    contentType: "HTML",
    content: overrides.body ?? "<p>Authorization: WR-9001<br/>Serial: SBX-SN-0001<br/>Problem: the unit is not cooling</p>",
  },
  internetMessageHeaders: overrides.headers ?? [],
  attachments: overrides.attachments ?? [{ id: `att-${id}`, name: "authorization.pdf", contentType: "application/pdf", size: 11 }],
});

/**
 * A scripted provider. Every method records that it was called, so a test can assert what the transport
 * did as well as what came out of it -- "the cursor did not advance" is only meaningful alongside "the
 * message was fetched and failed".
 */
function scriptedTransport(script = {}) {
  const calls = { list: 0, fetch: [], attachments: [], refresh: 0, validate: 0 };
  return {
    calls,
    provider: script.provider ?? "MICROSOFT_365",
    buildAuthorizationUrl: () => "https://provider.example/authorize?state=x",
    exchangeAuthorizationCode: async () =>
      script.exchange ? script.exchange() : { accessToken: "at-1", refreshToken: "rt-1", expiresAt: NOW + 3_600_000, scope: "" },
    refreshAccessToken: async () => {
      calls.refresh += 1;
      if (script.refreshThrows) throw script.refreshThrows;
      return { accessToken: "at-1", refreshToken: "rt-1", expiresAt: NOW + 3_600_000, scope: "" };
    },
    validateMailboxAccess: async () => {
      calls.validate += 1;
      return script.validation ?? { ok: true, detail: "Inbox readable." };
    },
    listNewMessageIds: async ({ cursor }) => {
      calls.list += 1;
      if (script.listThrows) throw script.listThrows;
      return script.list ? script.list(cursor, calls.list) : { messageIds: [], cursor: { value: "cursor-1" }, truncated: false };
    },
    fetchMessage: async ({ messageId }) => {
      calls.fetch.push(messageId);
      if (script.fetchThrows) throw script.fetchThrows;
      return script.message ? script.message(messageId) : graphMessage(messageId);
    },
    fetchAttachment: async ({ messageId, attachmentId }) => {
      calls.attachments.push(`${messageId}:${attachmentId}`);
      if (script.attachmentThrows) throw script.attachmentThrows;
      return { bytes: Buffer.from("PDF-CONTENT"), mimeType: "application/pdf", filename: "" };
    },
  };
}

const connectionRecord = (overrides = {}) => ({
  id: CONNECTION_ID,
  provider: "MICROSOFT_365",
  tenantOrWorkspace: "tenant-1",
  connectedAccount: "intake@sandbox.example",
  inboundEnabled: true,
  oauthStatus: "CONNECTED",
  ...overrides,
});

async function mailboxWithCursor(mailboxId = MAILBOX_ID) {
  const mailbox = await readMailbox(db, mailboxId);
  const snap = await db.collection("email_mailboxes").doc(mailboxId).get();
  return { ...mailbox, deliveryCursor: snap.data()?.deliveryCursor ?? null };
}

const deps = (adapter, extra = {}) => ({
  adapter,
  vault: extra.vault ?? createInMemoryVault({ [CONNECTION_ID]: "rt-1", [GMAIL_CONNECTION_ID]: "rt-1" }),
  store: extra.store ?? createInMemoryAttachmentStore(),
  actorUid: SYSTEM,
  now: () => NOW,
  ...extra,
});

async function clear(collection) {
  for (const doc of await db.collection(collection).listDocuments()) await doc.delete();
}

before(async () => {
  await clear("auditEvents");
  await upsertEmailConnection(db, {
    id: CONNECTION_ID,
    actorUid: ADMIN,
    config: { connectionName: "Transport M365", provider: "MICROSOFT_365", tenantOrWorkspace: "tenant-1", connectedAccount: "intake@sandbox.example" },
  });
  await upsertEmailConnection(db, {
    id: GMAIL_CONNECTION_ID,
    actorUid: ADMIN,
    config: { connectionName: "Transport Google", provider: "GOOGLE_WORKSPACE", tenantOrWorkspace: "sandbox.example", connectedAccount: "service@sandbox.example" },
  });
  await upsertEmailMailbox(db, {
    id: MAILBOX_ID,
    actorUid: ADMIN,
    config: { connectionId: CONNECTION_ID, displayName: "Warranty", emailAddress: "warranty@sandbox.example", purpose: "WARRANTY" },
  });
  await upsertEmailMailbox(db, {
    id: GMAIL_MAILBOX_ID,
    actorUid: ADMIN,
    config: { connectionId: GMAIL_CONNECTION_ID, displayName: "Service", emailAddress: "service@sandbox.example", purpose: "SERVICE" },
  });
  await upsertEmailRoutingRule(db, {
    id: "tx-rule-warranty",
    actorUid: ADMIN,
    rule: { name: "Corporate warranty", order: 10, when: { senderDomain: "corporate.example" }, then: { requestType: "WARRANTY", destination: "SERVICE", priority: 2 } },
  });
  await db.collection("accounts").doc(SANDBOX_RECORDS.accountId).set(SANDBOX_RECORDS.account);
  await db.collection("locations").doc(SANDBOX_RECORDS.locationId).set(SANDBOX_RECORDS.location);
  await db.collection("equipment").doc(SANDBOX_RECORDS.equipmentId).set(SANDBOX_RECORDS.equipment);
});

beforeEach(async () => {
  await clear("inbound_work_requests");
  await clear("email_delivery_failures");
  await clear("email_oauth_states");
  await db.collection("email_mailboxes").doc(MAILBOX_ID).set({ deliveryCursor: null }, { merge: true });
  await db.collection("email_mailboxes").doc(GMAIL_MAILBOX_ID).set({ deliveryCursor: null }, { merge: true });
  forgetAccessToken(CONNECTION_ID);
  forgetAccessToken(GMAIL_CONNECTION_ID);
});

// ── The connection lifecycle ─────────────────────────────────────────────────────────────────────
test("starting an authorization stores the state by HASH and marks the connection pending", async () => {
  const adapter = scriptedTransport();
  const started = await startConnectionAuthorization(
    db,
    { connectionId: CONNECTION_ID, actorUid: ADMIN, redirectUri: "https://app.example/administration/email-communications" },
    { transportFor: () => adapter, vault: createInMemoryVault(), now: () => NOW },
  );
  const stored = await db.collection("email_oauth_states").doc(hashAuthorizationState(started.state)).get();
  assert.equal(stored.exists, true);
  assert.equal(stored.data().consumedAt, null);
  const byValue = await db.collection("email_oauth_states").doc(started.state).get();
  assert.equal(byValue.exists, false, "the state value itself is never a document id");
  const connection = await db.collection("email_connections").doc(CONNECTION_ID).get();
  assert.equal(connection.data().oauthStatus, "PENDING_AUTHORIZATION");
});

test("completing an authorization exchanges the code, takes custody of the credential, and proves the mailbox", async () => {
  const adapter = scriptedTransport();
  const vault = createInMemoryVault();
  const commandDeps = { transportFor: () => adapter, vault, now: () => NOW };
  const started = await startConnectionAuthorization(
    db,
    { connectionId: CONNECTION_ID, actorUid: ADMIN, redirectUri: "https://app.example/cb" },
    commandDeps,
  );
  const completion = await completeConnectionAuthorization(
    db,
    { connectionId: CONNECTION_ID, actorUid: ADMIN, state: started.state, code: "auth-code", redirectUri: "https://app.example/cb" },
    commandDeps,
  );

  assert.equal(completion.oauthStatus, "CONNECTED");
  assert.equal(completion.connectionStatus, "CONNECTED");
  assert.equal(completion.health, "HEALTHY");
  assert.ok(completion.mailboxesValidated >= 1, "the configured mailbox was actually read");
  assert.equal(vault.store.get(CONNECTION_ID), "rt-1", "the refresh token went to the vault");

  const stored = (await db.collection("email_connections").doc(CONNECTION_ID).get()).data();
  assert.equal(JSON.stringify(stored).includes("rt-1"), false, "no credential value is in the connection document");
  assert.equal(JSON.stringify(stored).includes("at-1"), false);
  assert.ok(stored.credentialSecretName, "the connection records WHERE the credential is");
  assert.ok(stored.authorizedAt);
});

test("a replayed callback is refused -- the state is single-use in the database, not just in code", async () => {
  const adapter = scriptedTransport();
  const commandDeps = { transportFor: () => adapter, vault: createInMemoryVault(), now: () => NOW };
  const started = await startConnectionAuthorization(db, { connectionId: CONNECTION_ID, actorUid: ADMIN, redirectUri: "https://app.example/cb" }, commandDeps);
  const input = { connectionId: CONNECTION_ID, actorUid: ADMIN, state: started.state, code: "auth-code", redirectUri: "https://app.example/cb" };
  await completeConnectionAuthorization(db, input, commandDeps);
  await assert.rejects(() => completeConnectionAuthorization(db, input, commandDeps), (err) => err.code === "STATE_ALREADY_USED");
});

test("another administrator cannot finish an authorization somebody else started", async () => {
  const commandDeps = { transportFor: () => scriptedTransport(), vault: createInMemoryVault(), now: () => NOW };
  const started = await startConnectionAuthorization(db, { connectionId: CONNECTION_ID, actorUid: ADMIN, redirectUri: "https://app.example/cb" }, commandDeps);
  await assert.rejects(
    () =>
      completeConnectionAuthorization(
        db,
        { connectionId: CONNECTION_ID, actorUid: "someone-else", state: started.state, code: "c", redirectUri: "https://app.example/cb" },
        commandDeps,
      ),
    (err) => err.code === "STATE_ACTOR_MISMATCH",
  );
});

test("a connection whose mailbox cannot be read is authorized but NOT connected, and says why", async () => {
  const adapter = scriptedTransport({ validation: { ok: false, detail: "The connected account is not permitted to read warranty@sandbox.example." } });
  const commandDeps = { transportFor: () => adapter, vault: createInMemoryVault(), now: () => NOW };
  const started = await startConnectionAuthorization(db, { connectionId: CONNECTION_ID, actorUid: ADMIN, redirectUri: "https://app.example/cb" }, commandDeps);
  const completion = await completeConnectionAuthorization(
    db,
    { connectionId: CONNECTION_ID, actorUid: ADMIN, state: started.state, code: "c", redirectUri: "https://app.example/cb" },
    commandDeps,
  );
  assert.equal(completion.oauthStatus, "CONNECTED");
  assert.equal(completion.connectionStatus, "FAILED", "consent is not access");
  assert.match(completion.detail, /not permitted/);
});

test("Test connection reads and changes nothing else", async () => {
  const adapter = scriptedTransport();
  const before = (await db.collection("inbound_work_requests").get()).size;
  const result = await testConnection(db, { connectionId: CONNECTION_ID, actorUid: ADMIN }, { transportFor: () => adapter, vault: createInMemoryVault({ [CONNECTION_ID]: "rt-1" }), now: () => NOW });
  assert.equal(result.health, "HEALTHY");
  assert.ok(adapter.calls.validate >= 1);
  assert.equal((await db.collection("inbound_work_requests").get()).size, before, "a test creates no work");
});

test("disconnecting DESTROYS the credential rather than unreferencing it", async () => {
  const vault = createInMemoryVault({ [CONNECTION_ID]: "rt-1" });
  await disconnectConnection(db, { connectionId: CONNECTION_ID, actorUid: ADMIN }, { transportFor: () => scriptedTransport(), vault, now: () => NOW });
  assert.equal(vault.store.has(CONNECTION_ID), false);
  const stored = (await db.collection("email_connections").doc(CONNECTION_ID).get()).data();
  assert.equal(stored.oauthStatus, "REVOKED");
  assert.equal(stored.credentialSecretName, null);
  assert.equal(stored.inboundEnabled, false);
});

// ── Automatic delivery ───────────────────────────────────────────────────────────────────────────
test("the FIRST poll takes a cursor and ingests nothing -- connecting is not importing", async () => {
  const adapter = scriptedTransport({ list: () => ({ messageIds: [], cursor: { value: "cursor-1" }, truncated: false }) });
  const result = await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter));
  assert.equal(result.fetched, 0);
  assert.equal((await db.collection("inbound_work_requests").get()).size, 0);
  assert.equal((await db.collection("email_mailboxes").doc(MAILBOX_ID).get()).data().deliveryCursor.value, "cursor-1");
});

test("a delivered message becomes ONE inbound request, with its attachment held by EOS", async () => {
  const store = createInMemoryAttachmentStore();
  const adapter = scriptedTransport({ list: () => ({ messageIds: ["m-1"], cursor: { value: "cursor-2" }, truncated: false }) });
  const result = await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter, { store }));

  assert.equal(result.fetched, 1);
  assert.equal(result.created, 1);
  assert.equal(result.attachmentsStored, 1);

  const requestId = inboundRequestDocId(MAILBOX_ID, "m-1");
  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal(detail.status, "AWAITING_DECISION");
  assert.equal(detail.requestType, "WARRANTY", "the administrator's routing rule classified it");
  assert.equal(detail.authorizationNumber, "WR-9001");
  assert.equal(detail.attachmentCustody, "COMPLETE");
  assert.equal(detail.attachmentRefs[0].custody, "STORED");
  assert.equal(store.objects.size, 1);
  assert.equal([...store.objects.values()][0].toString(), "PDF-CONTENT");
});

test("the governed read never hands a browser the storage key", async () => {
  const adapter = scriptedTransport({ list: () => ({ messageIds: ["m-key"], cursor: { value: "c" }, truncated: false }) });
  await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter));
  const requestId = inboundRequestDocId(MAILBOX_ID, "m-key");
  const stored = (await db.collection("inbound_work_requests").doc(requestId).get()).data();
  assert.ok(stored.attachmentRefs[0].storageKey, "the key is on the record");
  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal("storageKey" in detail.attachmentRefs[0], false, "and it is not projected");
  assert.equal(detail.attachmentRefs[0].providerAttachmentId, "att-m-key");
});

test("the same provider message announced twice produces ONE request and fetches its attachment once", async () => {
  const store = createInMemoryAttachmentStore();
  const adapter = scriptedTransport({ list: () => ({ messageIds: ["m-dup"], cursor: { value: "c" }, truncated: false }) });
  await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter, { store }));
  const second = await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter, { store }));

  assert.equal(second.duplicates, 1);
  assert.equal((await db.collection("inbound_work_requests").get()).size, 1);
  assert.equal(store.objects.size, 1, "the attachment was not stored a second time");
  assert.equal(adapter.calls.attachments.length, 1, "and it was not even fetched a second time");
});

test("a reply on the same thread attaches to the existing request and creates no second one", async () => {
  const adapter = scriptedTransport({
    list: (cursor, call) => ({ messageIds: [call === 1 ? "m-orig" : "m-reply"], cursor: { value: `c${call}` }, truncated: false }),
    message: (id) =>
      id === "m-orig"
        ? graphMessage("m-orig", { conversationId: "conv-thread" })
        : graphMessage("m-reply", { conversationId: "conv-thread", subject: "RE: Warranty service required", body: "<p>Any update?</p>", attachments: [] }),
  });
  await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter));
  const second = await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter));

  assert.equal(second.threadMatched, 1);
  assert.equal((await db.collection("inbound_work_requests").get()).size, 1);
  const detail = await readInboundWorkRequest(db, inboundRequestDocId(MAILBOX_ID, "m-orig"));
  assert.equal(detail.threadMessages.length, 1);
});

test("a failed attachment leaves the request intact, PARTIAL, and retryable -- never silently complete", async () => {
  const adapter = scriptedTransport({
    list: () => ({ messageIds: ["m-att-fail"], cursor: { value: "c" }, truncated: false }),
    attachmentThrows: new ProviderTransportError("ATTACHMENT_FETCH_FAILED", "provider refused"),
  });
  const result = await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter));
  assert.equal(result.created, 1, "the message itself was taken in");
  assert.equal(result.attachmentsFailed, 1);

  const detail = await readInboundWorkRequest(db, inboundRequestDocId(MAILBOX_ID, "m-att-fail"));
  assert.equal(detail.attachmentCustody, "FAILED");
  assert.equal(detail.attachmentRefs[0].custody, "FAILED");
  assert.equal(detail.attachmentRefs[0].failureCode, "ATTACHMENT_FETCH_FAILED");
  assert.ok(detail.originalBodyText.length > 0, "the message is fully readable regardless");

  const failures = await db.collection("email_delivery_failures").where("mailboxId", "==", MAILBOX_ID).get();
  assert.ok(failures.size >= 1, "and the failure is visible in Exceptions");
});

test("retrying a failed attachment stores it once, without a second request or a second object", async () => {
  const store = createInMemoryAttachmentStore();
  let failing = true;
  const adapter = scriptedTransport({ list: () => ({ messageIds: ["m-retry"], cursor: { value: "c" }, truncated: false }) });
  const originalFetch = adapter.fetchAttachment;
  adapter.fetchAttachment = async (input) => {
    if (failing) throw new ProviderTransportError("ATTACHMENT_FETCH_FAILED", "temporary");
    return originalFetch(input);
  };

  await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter, { store }));
  const requestId = inboundRequestDocId(MAILBOX_ID, "m-retry");
  assert.equal((await readInboundWorkRequest(db, requestId)).attachmentCustody, "FAILED");

  failing = false;
  const failureId = (await db.collection("email_delivery_failures").where("mailboxId", "==", MAILBOX_ID).limit(1).get()).docs[0].id;
  await db.collection("email_mailboxes").doc(MAILBOX_ID).set({ deliveryCursor: { value: null } }, { merge: true });
  await retryDelivery(db, connectionRecord(), await mailboxWithCursor(), failureId, deps(adapter, { store }));

  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal(detail.attachmentCustody, "COMPLETE");
  assert.equal((await db.collection("inbound_work_requests").get()).size, 1, "no second request");
  assert.equal(store.objects.size, 1, "no second object");
});

test("a message that could not be fetched does not advance the cursor -- reprocessing is safe, skipping is not", async () => {
  await db.collection("email_mailboxes").doc(MAILBOX_ID).set({ deliveryCursor: { value: "cursor-before" } }, { merge: true });
  const adapter = scriptedTransport({
    list: () => ({ messageIds: ["m-bad"], cursor: { value: "cursor-after" }, truncated: false }),
    fetchThrows: new ProviderTransportError("MESSAGE_FETCH_FAILED", "refused"),
  });
  const result = await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter));

  assert.equal(result.failures, 1);
  assert.equal((await db.collection("email_mailboxes").doc(MAILBOX_ID).get()).data().deliveryCursor.value, "cursor-before");
  const failure = (await db.collection("email_delivery_failures").where("mailboxId", "==", MAILBOX_ID).get()).docs[0].data();
  assert.equal(failure.code, "MESSAGE_FETCH_FAILED");
  assert.equal(failure.disposition, "RETRYABLE");
  assert.ok(failure.nextAttemptAt > NOW, "a retryable failure says when to try again");
});

test("an expired cursor recovers by re-listing rather than failing", async () => {
  await db.collection("email_mailboxes").doc(MAILBOX_ID).set({ deliveryCursor: { value: "stale" } }, { merge: true });
  const adapter = scriptedTransport({
    list: (cursor) => {
      if (!cursor.expired) throw new ProviderTransportError("CURSOR_EXPIRED", "too old");
      return { messageIds: ["m-recovered"], cursor: { value: "fresh" }, truncated: false };
    },
  });
  const result = await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter));
  assert.equal(result.created, 1);
  assert.equal((await db.collection("email_mailboxes").doc(MAILBOX_ID).get()).data().deliveryCursor.value, "fresh");
});

test("a rate limit is recorded as retryable, with the provider's own wait honoured", async () => {
  const adapter = scriptedTransport({ listThrows: new ProviderTransportError("PROVIDER_RATE_LIMIT", "slow down", 30) });
  const result = await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter));
  assert.equal(result.transportFailure, "PROVIDER_RATE_LIMIT");
  const failure = (await db.collection("email_delivery_failures").where("mailboxId", "==", MAILBOX_ID).get()).docs[0].data();
  assert.equal(failure.disposition, "RETRYABLE");
  assert.equal(failure.nextAttemptAt, NOW + 30_000);
  const connection = (await db.collection("email_connections").doc(CONNECTION_ID).get()).data();
  assert.equal(connection.health, "DEGRADED", "a rate limit is not a broken connection");
});

test("a revoked authorization stops delivery and tells the operator to reauthorize", async () => {
  const adapter = scriptedTransport({ refreshThrows: new ProviderTransportError("AUTH_REVOKED", "gone") });
  const result = await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter, { vault: createInMemoryVault({ [CONNECTION_ID]: "rt-1" }) }));
  assert.equal(result.transportFailure, "AUTH_REVOKED");
  const connection = (await db.collection("email_connections").doc(CONNECTION_ID).get()).data();
  assert.equal(connection.oauthStatus, "REVOKED");
  assert.equal(connection.health, "FAILED");
  const failure = (await db.collection("email_delivery_failures").where("mailboxId", "==", MAILBOX_ID).get()).docs[0].data();
  assert.equal(failure.disposition, "REQUIRES_ADMIN_ACTION", "no amount of retrying fixes a revoked grant");
});

test("a disabled mailbox is not polled at all", async () => {
  const adapter = scriptedTransport();
  const mailbox = { ...(await mailboxWithCursor()), status: "DISABLED" };
  const result = await pollMailboxOnce(db, connectionRecord(), mailbox, deps(adapter));
  assert.equal(adapter.calls.list, 0);
  assert.equal(result.fetched, 0);
});

// ── Provider parity ──────────────────────────────────────────────────────────────────────────────
test("an equivalent Gmail message produces an equivalent inbound request -- parity below the adapter", async () => {
  const microsoft = scriptedTransport({ list: () => ({ messageIds: ["p-ms"], cursor: { value: "c" }, truncated: false }) });
  await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(microsoft));

  const body = Buffer.from("Authorization: WR-9001\nSerial: SBX-SN-0001\nProblem: the unit is not cooling").toString("base64url");
  const gmail = scriptedTransport({
    provider: "GOOGLE_WORKSPACE",
    list: () => ({ messageIds: ["p-gm"], cursor: { value: "c" }, truncated: false }),
    message: () => ({
      id: "p-gm",
      threadId: "gthread-1",
      internalDate: String(Date.parse("2026-09-04T10:00:00Z")),
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "dispatch@corporate.example" },
          { name: "To", value: "service@sandbox.example" },
          { name: "Subject", value: "Warranty service required" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: body } },
          { mimeType: "application/pdf", filename: "authorization.pdf", body: { attachmentId: "gatt-1", size: 11 } },
        ],
      },
    }),
  });
  await pollMailboxOnce(
    db,
    connectionRecord({ id: GMAIL_CONNECTION_ID, provider: "GOOGLE_WORKSPACE", connectedAccount: "service@sandbox.example" }),
    await mailboxWithCursor(GMAIL_MAILBOX_ID),
    deps(gmail),
  );

  const fromMicrosoft = await readInboundWorkRequest(db, inboundRequestDocId(MAILBOX_ID, "p-ms"));
  const fromGmail = await readInboundWorkRequest(db, inboundRequestDocId(GMAIL_MAILBOX_ID, "p-gm"));
  for (const field of ["requestType", "authorizationNumber", "serialNumber", "problemDescription", "status"]) {
    assert.equal(fromGmail[field], fromMicrosoft[field], `${field} must not depend on which provider delivered it`);
  }
  assert.equal(fromGmail.customerCandidate.id, fromMicrosoft.customerCandidate.id);
  assert.equal(fromGmail.equipmentCandidate.id, fromMicrosoft.equipmentCandidate.id);
  assert.equal(fromGmail.attachmentCustody, "COMPLETE");
  assert.notEqual(fromGmail.sourceProvider, fromMicrosoft.sourceProvider, "only the provenance differs");
});

// ── The whole point ──────────────────────────────────────────────────────────────────────────────
test("a REAL delivered message accepts into exactly one governed Work Order, attachment and all", async () => {
  const store = createInMemoryAttachmentStore();
  const adapter = scriptedTransport({ list: () => ({ messageIds: ["m-accept"], cursor: { value: "c" }, truncated: false }) });
  await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter, { store }));

  const requestId = inboundRequestDocId(MAILBOX_ID, "m-accept");
  const before = (await db.collection("fieldops_wos").get()).size;
  const accepted = await acceptInboundWorkRequest(db, {
    requestId,
    actorUid: REVIEWER,
    customerId: SANDBOX_RECORDS.accountId,
    locationId: SANDBOX_RECORDS.locationId,
    equipmentId: SANDBOX_RECORDS.equipmentId,
    requestType: "WARRANTY",
  });
  assert.equal((await db.collection("fieldops_wos").get()).size, before + 1, "exactly one Work Order");

  const wo = (await db.collection("fieldops_wos").doc(accepted.workItemId).get()).data();
  assert.equal(wo.type, "WARRANTY");
  assert.equal(wo.authorizationNumber, "WR-9001");
  assert.equal(wo.inboundWorkRequestId, requestId);
  assert.match(wo.complaint, /not cooling/);

  const detail = await readInboundWorkRequest(db, requestId);
  assert.equal(detail.workItemId, accepted.workItemId);
  assert.equal(detail.attachmentCustody, "COMPLETE", "the attachment stays with the accepted work");
  assert.equal(detail.attachmentRefs[0].custody, "STORED");
});

// ── The schedule ─────────────────────────────────────────────────────────────────────────────────
test("the delivery cycle polls connected mailboxes and skips unauthorized ones", async () => {
  await db.collection("email_connections").doc(CONNECTION_ID).set({ oauthStatus: "CONNECTED", inboundEnabled: true }, { merge: true });
  await db.collection("email_connections").doc(GMAIL_CONNECTION_ID).set({ oauthStatus: "NOT_CONNECTED" }, { merge: true });
  const adapter = scriptedTransport({ list: () => ({ messageIds: ["m-cycle"], cursor: { value: "c" }, truncated: false }) });

  const results = await runDeliveryCycle(db, {
    transportFor: () => adapter,
    vaultFor: () => createInMemoryVault({ [CONNECTION_ID]: "rt-1" }),
    store: createInMemoryAttachmentStore(),
    projectId: "eos-platform-sandbox",
    now: () => NOW,
  });

  assert.equal(results.length, 1, "the unauthorized connection's mailbox was skipped, not failed");
  assert.equal(results[0].mailboxId, MAILBOX_ID);
  assert.equal((await db.collection("inbound_work_requests").get()).size, 1);
});

test("Administration sees the real delivery state: health, custody counts and open failures", async () => {
  const adapter = scriptedTransport({ listThrows: new ProviderTransportError("PROVIDER_UNAVAILABLE", "down") });
  await pollMailboxOnce(db, connectionRecord(), await mailboxWithCursor(), deps(adapter));
  const config = await readEmailIntakeConfiguration(db);
  assert.ok(config.exceptions.length >= 1);
  assert.equal(config.exceptions[0].code, "PROVIDER_UNAVAILABLE");
  assert.equal(config.exceptions[0].detail.includes("token"), false, "an exceptions list carries no credential material");
  assert.ok("attachmentCustody" in config.overview);
});
