// Email Connections -- AUTOMATIC DELIVERY. The orchestration that turns "a message exists in a connected
// mailbox" into "an inbound request exists in EOS", without a person submitting anything.
//
// IT ADDS NO INTAKE PATH. Every message it fetches goes through the SAME normalizer and the SAME
// `ingestInboundMessage` the delivery seam in PR #1811 uses, so routing, extraction, candidate resolution,
// threading and duplicate protection are the ones already built and already tested. This file is
// transport: get the credential, ask what is new, fetch it, hand it over, record what happened.
//
// DUPLICATE SAFETY IS NOT RE-IMPLEMENTED HERE, and that is deliberate. Providers re-announce messages,
// pages overlap, cursors get replayed after a crash, and a recovery re-lists on purpose. Intake's
// deterministic document id (mailbox + provider message id) makes all of that converge on one record, so
// the honest design is to let the poll be at-least-once and the intake be exactly-once.
//
// A TRANSPORT FAILURE NEVER CORRUPTS INBOUND WORK. Failures land in `email_delivery_failures` with their
// classification and attempt count; the intake collection only ever gains records that were fully taken in.
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { EMAIL_CONNECTIONS_COLLECTION, EMAIL_DELIVERY_FAILURES_COLLECTION, EMAIL_MAILBOXES_COLLECTION } from "../constants/collections";
import { stageAuditEvent, recordStandaloneAuditEvent } from "../access/auditEventWriter";
import { boundedString } from "./inboundWorkModel";
import { normalizeProviderMessage, type EmailProviderId } from "./emailProvider";
import { ingestInboundMessage, type MailboxRecord } from "./inboundIntakeCommand";
import { readRoutingRules } from "./inboundWorkReadService";
import {
  MAX_DELIVERY_ATTEMPTS,
  ProviderTransportError,
  dispositionOf,
  nextRetryDelayMs,
  type DeliveryCursor,
  type EmailTransportAdapter,
  type ProviderMessageList,
  type TransportFailureCode,
} from "./providerTransport";
import { forgetAccessToken, resolveAccessToken, type CredentialVault } from "./providerCredentialVault";
import { fetchAndStoreAttachments, type AttachmentStore } from "./attachmentCustody";

/** How many messages one poll of one mailbox will take in. Bounded so a backlog drains steadily. */
export const DELIVERY_BATCH_LIMIT = 25;

export interface ConnectionRecord {
  id: string;
  provider: EmailProviderId;
  tenantOrWorkspace: string;
  connectedAccount: string;
  inboundEnabled: boolean;
  oauthStatus: string;
}

export interface DeliveryDeps {
  adapter: EmailTransportAdapter;
  vault: CredentialVault;
  store: AttachmentStore;
  actorUid: string;
  now?: () => number;
  limit?: number;
}

export interface DeliveryResult {
  mailboxId: string;
  fetched: number;
  created: number;
  duplicates: number;
  threadMatched: number;
  attachmentsStored: number;
  attachmentsFailed: number;
  failures: number;
  truncated: boolean;
  /** Set when the poll itself could not run: no credential, mailbox gone, provider down. */
  transportFailure: TransportFailureCode | null;
}

const emptyResult = (mailboxId: string): DeliveryResult => ({
  mailboxId,
  fetched: 0,
  created: 0,
  duplicates: 0,
  threadMatched: 0,
  attachmentsStored: 0,
  attachmentsFailed: 0,
  failures: 0,
  truncated: false,
  transportFailure: null,
});

/**
 * Record one transport failure so it is visible, classified and retryable.
 *
 * Keyed deterministically per (mailbox, subject-of-failure) so a repeating failure increments an attempt
 * count on ONE record instead of filling the exceptions list with the same sentence a hundred times.
 */
export async function recordDeliveryFailure(
  db: Firestore,
  input: {
    connectionId: string;
    mailboxId: string;
    subjectId: string;
    code: TransportFailureCode;
    detail: string;
    retryAfterSeconds?: number | null;
    now: number;
    actorUid: string;
  },
): Promise<{ id: string; attempts: number; exhausted: boolean }> {
  const id = `${input.mailboxId}__${input.subjectId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 400);
  const ref = db.collection(EMAIL_DELIVERY_FAILURES_COLLECTION).doc(id);
  const disposition = dispositionOf(input.code);

  const attempts = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? Number((snap.data() as Record<string, unknown>).attempts ?? 0) : 0;
    const next = previous + 1;
    const exhausted = disposition !== "REQUIRES_ADMIN_ACTION" && next >= MAX_DELIVERY_ATTEMPTS;
    tx.set(
      ref,
      {
        connectionId: input.connectionId,
        mailboxId: input.mailboxId,
        subjectId: input.subjectId,
        // The CODE is the operator-facing fact. No provider body, no token, no raw payload -- an
        // exceptions list is read by people and copied into tickets.
        code: input.code,
        detail: boundedString(input.detail, 300),
        disposition: exhausted ? "REQUIRES_ADMIN_ACTION" : disposition,
        attempts: next,
        exhausted,
        status: exhausted ? "DELIVERY_RETRY_EXHAUSTED" : "OPEN",
        nextAttemptAt: exhausted ? null : input.now + nextRetryDelayMs(next, input.retryAfterSeconds ?? null),
        firstFailedAt: snap.exists ? (snap.data() as Record<string, unknown>).firstFailedAt ?? input.now : input.now,
        lastFailedAt: input.now,
      },
      { merge: true },
    );
    return next;
  });

  const exhausted = disposition !== "REQUIRES_ADMIN_ACTION" && attempts >= MAX_DELIVERY_ATTEMPTS;
  await recordStandaloneAuditEvent({
    actorUid: input.actorUid,
    action: "providerDeliveryFailed",
    targetType: "emailMailbox",
    targetId: input.mailboxId,
    outcome: "denied",
    summary: `delivery failure ${input.code} (attempt ${attempts}${exhausted ? ", retries exhausted" : ""})`,
  });
  return { id, attempts, exhausted };
}

/** Clear a resolved failure. Called on the next success, so a fixed connection stops shouting. */
async function clearDeliveryFailures(db: Firestore, mailboxId: string): Promise<void> {
  const snap = await db.collection(EMAIL_DELIVERY_FAILURES_COLLECTION).where("mailboxId", "==", mailboxId).where("status", "==", "OPEN").limit(50).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.update({ status: "RESOLVED", resolvedAt: Date.now() })));
}

async function updateConnectionHealth(
  db: Firestore,
  connectionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await db.collection(EMAIL_CONNECTIONS_COLLECTION).doc(connectionId).set(patch, { merge: true });
}

/**
 * Poll ONE mailbox once.
 *
 * The shape is deliberately linear: credential, list, fetch, ingest, attachments, cursor. Each step's
 * failure is classified and recorded, and the cursor advances only over messages that were actually taken
 * in -- a message that could not be fetched leaves the cursor where it was, so the next poll sees it again
 * rather than stepping over it silently. Reprocessing is safe (intake deduplicates); skipping is not.
 */
export async function pollMailboxOnce(
  db: Firestore,
  connection: ConnectionRecord,
  mailbox: MailboxRecord & { deliveryCursor?: DeliveryCursor | null },
  deps: DeliveryDeps,
): Promise<DeliveryResult> {
  const now = (deps.now ?? Date.now)();
  const result = emptyResult(mailbox.id);
  if (mailbox.status === "DISABLED" || mailbox.inboundEnabled === false || connection.inboundEnabled === false) return result;

  let accessToken: string;
  try {
    accessToken = await resolveAccessToken(db, deps.vault, deps.adapter, {
      connectionId: connection.id,
      tenantOrWorkspace: connection.tenantOrWorkspace,
    });
  } catch (err) {
    const code = err instanceof ProviderTransportError ? err.code : "CONFIGURATION_INVALID";
    result.transportFailure = code;
    await recordDeliveryFailure(db, {
      connectionId: connection.id,
      mailboxId: mailbox.id,
      subjectId: "credential",
      code,
      detail: err instanceof Error ? err.message : "The connection credential could not be used.",
      now,
      actorUid: deps.actorUid,
    });
    await updateConnectionHealth(db, connection.id, {
      health: "FAILED",
      oauthStatus: code === "AUTH_REVOKED" ? "REVOKED" : code === "AUTH_EXPIRED" ? "EXPIRED" : "CONNECTED",
      connectionStatus: "FAILED",
      lastProviderErrorAt: now,
      providerErrorCode: code,
    });
    return result;
  }

  const limit = Math.max(1, Math.min(deps.limit ?? DELIVERY_BATCH_LIMIT, 100));
  const startingCursor: DeliveryCursor = mailbox.deliveryCursor ?? { value: null };

  // FAILING THE LIST is one outcome with one recording, whatever produced it -- so it is written once
  // here rather than at each of the three places the list can go wrong.
  const failList = async (err: unknown): Promise<DeliveryResult> => {
    const code = err instanceof ProviderTransportError ? err.code : "PROVIDER_UNAVAILABLE";
    result.transportFailure = code;
    await recordDeliveryFailure(db, {
      connectionId: connection.id,
      mailboxId: mailbox.id,
      subjectId: "list",
      code,
      detail: err instanceof Error ? err.message : "The mailbox could not be listed.",
      retryAfterSeconds: err instanceof ProviderTransportError ? err.retryAfterSeconds : null,
      now,
      actorUid: deps.actorUid,
    });
    await updateConnectionHealth(db, connection.id, {
      health: dispositionOf(code) === "REQUIRES_ADMIN_ACTION" ? "FAILED" : "DEGRADED",
      lastProviderErrorAt: now,
      providerErrorCode: code,
    });
    return result;
  };

  let listed: ProviderMessageList;
  try {
    listed = await deps.adapter.listNewMessageIds({ accessToken, mailboxAddress: mailbox.emailAddress, cursor: startingCursor, limit });
  } catch (err) {
    if (!(err instanceof ProviderTransportError) || err.code !== "CURSOR_EXPIRED") return failList(err);
    // RECOVERY, not failure: the provider will not honour our resume point, so this poll re-lists a
    // bounded recent window and lets intake's duplicate protection absorb the overlap.
    try {
      listed = await deps.adapter.listNewMessageIds({
        accessToken,
        mailboxAddress: mailbox.emailAddress,
        cursor: { value: startingCursor.value, expired: true },
        limit,
      });
    } catch (recoveryError) {
      return failList(recoveryError);
    }
  }

  const rules = await readRoutingRules(db);
  let lastGoodCursor = listed.cursor;
  let lastMessageReceivedAt = 0;
  result.truncated = listed.truncated;

  for (const messageId of listed.messageIds) {
    try {
      const raw = await deps.adapter.fetchMessage({ accessToken, mailboxAddress: mailbox.emailAddress, messageId });
      const message = normalizeProviderMessage(connection.provider, raw, { connectionId: connection.id, mailboxId: mailbox.id });
      const outcome = await ingestInboundMessage(db, { message, mailbox, rules, actorUid: deps.actorUid });
      result.fetched += 1;
      if (outcome.outcome === "CREATED" || outcome.outcome === "AMBIGUOUS" || outcome.outcome === "FAILED") result.created += 1;
      if (outcome.outcome === "DUPLICATE") result.duplicates += 1;
      if (outcome.outcome === "THREAD_MATCH") result.threadMatched += 1;
      if (message.receivedAt > lastMessageReceivedAt) lastMessageReceivedAt = message.receivedAt;

      if (message.attachments.length > 0 && mailbox.attachmentPolicy !== "IGNORE") {
        const custody = await fetchAndStoreAttachments(db, outcome.requestId, {
          store: deps.store,
          adapter: deps.adapter,
          accessToken,
          mailboxAddress: mailbox.emailAddress,
          actorUid: deps.actorUid,
          now: () => now,
        });
        result.attachmentsStored += custody.stored;
        result.attachmentsFailed += custody.failed;
        if (custody.failed > 0) {
          await recordDeliveryFailure(db, {
            connectionId: connection.id,
            mailboxId: mailbox.id,
            subjectId: `attachments_${outcome.requestId}`,
            code: "ATTACHMENT_FETCH_FAILED",
            detail: `${custody.failed} attachment(s) on this message could not be retrieved.`,
            now,
            actorUid: deps.actorUid,
          });
        }
      }
    } catch (err) {
      result.failures += 1;
      const code = err instanceof ProviderTransportError ? err.code : "MESSAGE_FETCH_FAILED";
      await recordDeliveryFailure(db, {
        connectionId: connection.id,
        mailboxId: mailbox.id,
        subjectId: `message_${messageId}`,
        code,
        detail: err instanceof Error ? err.message : "The message could not be taken in.",
        retryAfterSeconds: err instanceof ProviderTransportError ? err.retryAfterSeconds : null,
        now,
        actorUid: deps.actorUid,
      });
      // The cursor does NOT advance past a message this poll could not take in.
      lastGoodCursor = startingCursor;
      break;
    }
  }

  await db.collection(EMAIL_MAILBOXES_COLLECTION).doc(mailbox.id).set(
    {
      deliveryCursor: lastGoodCursor,
      lastPolledAt: now,
      ...(result.fetched > 0 ? { lastSuccessfulDeliveryAt: now } : {}),
      ...(lastMessageReceivedAt > 0 ? { lastMessageReceivedAt } : {}),
    },
    { merge: true },
  );

  if (result.failures === 0) {
    await clearDeliveryFailures(db, mailbox.id);
    await updateConnectionHealth(db, connection.id, {
      health: "HEALTHY",
      connectionStatus: "CONNECTED",
      lastSuccessfulSync: now,
      ...(lastMessageReceivedAt > 0 ? { lastMessageReceived: lastMessageReceivedAt } : {}),
      providerErrorCode: null,
    });
  }
  return result;
}

/**
 * Retry one recorded failure, from the Exceptions surface.
 *
 * A retry is the SAME poll, not a special path: the credential is re-resolved (which is what makes a
 * reauthorized connection start working again), the cached access token is dropped first so a stale one
 * cannot be reused, and the outcome is recorded the same way.
 */
export async function retryDelivery(
  db: Firestore,
  connection: ConnectionRecord,
  mailbox: MailboxRecord & { deliveryCursor?: DeliveryCursor | null },
  failureId: string,
  deps: DeliveryDeps,
): Promise<DeliveryResult> {
  forgetAccessToken(connection.id);
  const result = await pollMailboxOnce(db, connection, mailbox, deps);
  if (result.transportFailure === null && result.failures === 0) {
    await db
      .collection(EMAIL_DELIVERY_FAILURES_COLLECTION)
      .doc(failureId)
      .set({ status: "RESOLVED", resolvedAt: (deps.now ?? Date.now)() }, { merge: true });
  }
  return result;
}

/** Audit that a delivery cycle ran, with counts. Staged by the scheduler, not by each message. */
export function stageDeliveryCycleAudit(
  writer: Parameters<typeof stageAuditEvent>[0],
  input: { actorUid: string; mailboxId: string; result: DeliveryResult },
): void {
  stageAuditEvent(writer, {
    actorUid: input.actorUid,
    action: "providerDeliveryCycle",
    targetType: "emailMailbox",
    targetId: input.mailboxId,
    outcome: input.result.transportFailure ? "denied" : "applied",
    summary: `polled mailbox: ${input.result.fetched} fetched, ${input.result.created} new, ${input.result.duplicates} duplicate, ${input.result.attachmentsStored} attachment(s) stored`,
  });
}
