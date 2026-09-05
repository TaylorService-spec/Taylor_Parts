// Email Connections -- THE TRANSPORT CALLABLE SURFACE: connect a real mailbox, test it, disconnect it,
// poll it now, retry a failed delivery, and read an attachment's bytes.
//
// EVERY ONE OF THESE IS NON-PRODUCTION ONLY, and the guard is the same one Data Import and the #1811
// delivery seam already use: the runtime's own project identity, checked before any authority is even
// evaluated, refusing `taylor-parts` by name and every registry environment whose role is production.
// Production provider binding, production mailbox polling and production attachment ingestion are not
// authorized, so the code refuses them rather than relying on nobody clicking.
//
// AUTHORITY REUSES #1811's, deliberately: connecting and testing are `administration.emailIntake.manage`,
// and reading an attachment is `service.inboundWork.read` -- the SAME capability that opens the inbound
// request the attachment belongs to. Inventing an `attachment.read` capability would create a permission
// somebody could hold without being able to open the record it describes, which is not a boundary anyone
// wants to administer.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { assertNonProductionImportTarget } from "../dataImport/importTargetGuard";
import { EMAIL_CONNECTIONS_COLLECTION, EMAIL_DELIVERY_FAILURES_COLLECTION, EMAIL_MAILBOXES_COLLECTION, INBOUND_WORK_REQUESTS_COLLECTION } from "../constants/collections";
import { boundedString } from "./inboundWorkModel";
import { isEmailProviderId } from "./emailProvider";
import { readMailbox } from "./inboundWorkReadService";
import { OAuthStateError } from "./providerAuthorizationState";
import { ProviderTransportError } from "./providerTransport";
import { EMAIL_PROVIDER_SECRETS, providerClientConfigured, transportFor } from "./providerTransportFactory";
import { createSecretManagerVault } from "./providerCredentialVault";
import { createCloudAttachmentStore } from "./attachmentCustody";
import {
  completeConnectionAuthorization,
  disconnectConnection,
  startConnectionAuthorization,
  testConnection,
  type ConnectionCommandDeps,
} from "./emailConnectionCommands";
import { pollMailboxOnce, retryDelivery, type ConnectionRecord } from "./emailDeliveryService";

const REGION = "us-central1";
const ADMIN_EMAIL_INTAKE_MANAGE = "administration.emailIntake.manage";
const INBOUND_WORK_READ = "service.inboundWork.read";

/** Bytes returned inline to the browser. Bigger files need a streaming download, which is P2. */
export const MAX_INLINE_ATTACHMENT_BYTES = 6 * 1024 * 1024;

function projectId(): string {
  return process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
}

/** The production boundary. Called FIRST in every callable below, before authority resolution. */
function assertNonProductionRuntime(): void {
  try {
    assertNonProductionImportTarget(projectId());
  } catch (err) {
    throw new HttpsError("failed-precondition", `Real email provider transport is not available in this environment. ${(err as Error).message}`);
  }
}

async function requireCapability(uid: string, capability: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capability] });
    allowed = decisions[capability] === true;
  } catch (err) {
    console.error(`[emailTransport] capability resolution failed for ${capability}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to perform this action.");
}

function callerUid(request: { auth?: { uid?: string } | null }): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  return uid;
}

/**
 * Domain error -> client error, with the failure code preserved and the provider's own words discarded.
 * An OAuth state refusal is `permission-denied` because that is what it is: the caller presented
 * something EOS will not accept as proof.
 */
function toHttpsError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof OAuthStateError) return new HttpsError("permission-denied", err.message, { code: err.code });
  if (err instanceof ProviderTransportError) {
    const code = err.code === "AUTH_REVOKED" || err.code === "AUTH_EXPIRED" ? "failed-precondition" : err.code === "CONFIGURATION_INVALID" ? "invalid-argument" : "unavailable";
    return new HttpsError(code, err.message, { code: err.code });
  }
  console.error("[emailTransport] unexpected failure", err);
  return new HttpsError("internal", "That action is temporarily unavailable.");
}

const commandDeps = (): ConnectionCommandDeps => ({ transportFor, vault: createSecretManagerVault(projectId()) });

// ── Connect ──────────────────────────────────────────────────────────────────────────────────────
export const startEmailConnectionAuthorization = onCall({ region: REGION, secrets: EMAIL_PROVIDER_SECRETS }, async (request) => {
  assertNonProductionRuntime();
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  const d = (request.data ?? {}) as Record<string, unknown>;
  try {
    return await startConnectionAuthorization(
      getFirestore(),
      { connectionId: boundedString(d.connectionId, 255), actorUid: uid, redirectUri: boundedString(d.redirectUri, 500) },
      commandDeps(),
    );
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const completeEmailConnectionAuthorization = onCall({ region: REGION, secrets: EMAIL_PROVIDER_SECRETS }, async (request) => {
  assertNonProductionRuntime();
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  const d = (request.data ?? {}) as Record<string, unknown>;
  try {
    return await completeConnectionAuthorization(
      getFirestore(),
      {
        connectionId: boundedString(d.connectionId, 255),
        actorUid: uid,
        state: boundedString(d.state, 500),
        code: boundedString(d.code, 4000),
        redirectUri: boundedString(d.redirectUri, 500),
      },
      commandDeps(),
    );
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const testEmailConnection = onCall({ region: REGION, secrets: EMAIL_PROVIDER_SECRETS }, async (request) => {
  assertNonProductionRuntime();
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  try {
    return await testConnection(getFirestore(), { connectionId: boundedString((request.data as Record<string, unknown>)?.connectionId, 255), actorUid: uid }, commandDeps());
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const disconnectEmailConnection = onCall({ region: REGION, secrets: EMAIL_PROVIDER_SECRETS }, async (request) => {
  assertNonProductionRuntime();
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  try {
    return await disconnectConnection(getFirestore(), { connectionId: boundedString((request.data as Record<string, unknown>)?.connectionId, 255), actorUid: uid }, commandDeps());
  } catch (err) {
    throw toHttpsError(err);
  }
});

/** What this runtime can actually offer, so Administration can say so instead of guessing. */
export const getEmailProviderReadiness = onCall({ region: REGION, secrets: EMAIL_PROVIDER_SECRETS }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, "administration.emailIntake.read");
  let productionRefusal: string | null = null;
  try {
    assertNonProductionImportTarget(projectId());
  } catch (err) {
    productionRefusal = (err as Error).message;
  }
  return {
    // No secret value, and no hint of one: only whether this runtime has a client at all.
    microsoftConfigured: providerClientConfigured("MICROSOFT_365"),
    googleConfigured: providerClientConfigured("GOOGLE_WORKSPACE"),
    transportAvailable: productionRefusal === null,
    productionRefusal,
  };
});

// ── Deliver ──────────────────────────────────────────────────────────────────────────────────────
async function loadConnectionAndMailbox(mailboxId: string): Promise<{ connection: ConnectionRecord; mailbox: Awaited<ReturnType<typeof readMailbox>> }> {
  const db = getFirestore();
  const mailbox = await readMailbox(db, mailboxId);
  if (!mailbox) throw new HttpsError("not-found", "That mailbox is not configured.");
  const snap = await db.collection(EMAIL_CONNECTIONS_COLLECTION).doc(mailbox.connectionId).get();
  if (!snap.exists) throw new HttpsError("not-found", "That mailbox's connection no longer exists.");
  const data = snap.data() as Record<string, unknown>;
  const provider = data.provider;
  if (!isEmailProviderId(provider)) throw new HttpsError("failed-precondition", "That connection has no valid provider.");
  return {
    connection: {
      id: snap.id,
      provider,
      tenantOrWorkspace: boundedString(data.tenantOrWorkspace, 255),
      connectedAccount: boundedString(data.connectedAccount, 255),
      inboundEnabled: data.inboundEnabled !== false,
      oauthStatus: boundedString(data.oauthStatus, 60),
    },
    mailbox,
  };
}

/**
 * POLL NOW. The same poll the schedule runs, on demand -- so an administrator finishing a connection can
 * see it work rather than waiting for the next tick. It is not a second delivery path: it calls the same
 * function with the same arguments.
 */
export const pollEmailMailboxNow = onCall({ region: REGION, secrets: EMAIL_PROVIDER_SECRETS, timeoutSeconds: 300 }, async (request) => {
  assertNonProductionRuntime();
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  const mailboxId = boundedString((request.data as Record<string, unknown>)?.mailboxId, 255);
  try {
    const { connection, mailbox } = await loadConnectionAndMailbox(mailboxId);
    const db = getFirestore();
    const cursorSnap = await db.collection(EMAIL_MAILBOXES_COLLECTION).doc(mailboxId).get();
    return await pollMailboxOnce(
      db,
      connection,
      { ...mailbox!, deliveryCursor: (cursorSnap.data() as Record<string, unknown>)?.deliveryCursor as never },
      { adapter: transportFor(connection.provider), vault: createSecretManagerVault(projectId()), store: createCloudAttachmentStore(), actorUid: uid },
    );
  } catch (err) {
    throw toHttpsError(err);
  }
});

/** Retry one recorded delivery failure after the operator has fixed whatever caused it. */
export const retryEmailDelivery = onCall({ region: REGION, secrets: EMAIL_PROVIDER_SECRETS, timeoutSeconds: 300 }, async (request) => {
  assertNonProductionRuntime();
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  const failureId = boundedString((request.data as Record<string, unknown>)?.failureId, 400);
  try {
    const db = getFirestore();
    const failure = await db.collection(EMAIL_DELIVERY_FAILURES_COLLECTION).doc(failureId).get();
    if (!failure.exists) throw new HttpsError("not-found", "That delivery failure no longer exists.");
    const mailboxId = boundedString((failure.data() as Record<string, unknown>).mailboxId, 255);
    const { connection, mailbox } = await loadConnectionAndMailbox(mailboxId);
    const cursorSnap = await db.collection(EMAIL_MAILBOXES_COLLECTION).doc(mailboxId).get();
    return await retryDelivery(
      db,
      connection,
      { ...mailbox!, deliveryCursor: (cursorSnap.data() as Record<string, unknown>)?.deliveryCursor as never },
      failureId,
      { adapter: transportFor(connection.provider), vault: createSecretManagerVault(projectId()), store: createCloudAttachmentStore(), actorUid: uid },
    );
  } catch (err) {
    throw toHttpsError(err);
  }
});

// ── Read an attachment ───────────────────────────────────────────────────────────────────────────
/**
 * The ONLY route to attachment bytes.
 *
 * Authority is the inbound request's, resolved server-side; the storage key is read from the record
 * rather than accepted from the caller, so there is no key to guess and no way to name a different
 * object. The bytes come back inline, base64, bounded -- a signed URL would hand out a credential that
 * outlives the authorization check, and a streaming endpoint is a public surface this does not need.
 */
export const getInboundWorkAttachment = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, INBOUND_WORK_READ);
  const d = (request.data ?? {}) as Record<string, unknown>;
  const requestId = boundedString(d.requestId, 255);
  const providerAttachmentId = boundedString(d.providerAttachmentId, 255);
  try {
    const db = getFirestore();
    const snap = await db.collection(INBOUND_WORK_REQUESTS_COLLECTION).doc(requestId).get();
    if (!snap.exists) throw new HttpsError("not-found", "That inbound request does not exist.");
    const refs = (snap.data() as Record<string, unknown>).attachmentRefs;
    const match = (Array.isArray(refs) ? refs : []).find(
      (r) => boundedString((r as Record<string, unknown>)?.providerAttachmentId, 255) === providerAttachmentId,
    ) as Record<string, unknown> | undefined;
    if (!match) throw new HttpsError("not-found", "That attachment is not part of this request.");
    const storageKey = boundedString(match.storageKey, 500);
    if (!storageKey || match.custody !== "STORED") {
      throw new HttpsError("failed-precondition", "That attachment has not been retrieved yet. Retry it from Administration → Email & Communications.");
    }
    const size = typeof match.size === "number" ? match.size : 0;
    if (size > MAX_INLINE_ATTACHMENT_BYTES) {
      throw new HttpsError("failed-precondition", "That attachment is too large to open here. Downloading large files is a later capability.");
    }
    const bytes = await createCloudAttachmentStore().get(storageKey);
    if (!bytes) throw new HttpsError("not-found", "The stored attachment could not be read.");
    return {
      filename: boundedString(match.filename, 255),
      // The DECLARED type, travelling as data. The bytes were stored as application/octet-stream and are
      // returned base64 for the client to save -- never rendered.
      declaredMimeType: boundedString(match.mimeType, 255),
      size: bytes.length,
      contentHash: boundedString(match.contentHash, 128),
      contentBase64: bytes.toString("base64"),
    };
  } catch (err) {
    throw toHttpsError(err);
  }
});
