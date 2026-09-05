// Email Connections + Inbound Work -- the TRUSTED READS.
//
// The client gets NO direct Firestore access to any of these four collections: firestore.rules has no match
// block for them, so every client read is denied by default and these projections are the only way in. That
// is the same posture opportunities / sales_orders / crm_activities already have, and it is why this
// feature needs no Rules change.
//
// THE RAW HTML BODY NEVER CROSSES THE WIRE. The original message is retained in the store as evidence, but
// the detail projection returns `originalBodyText` -- the same plain-text conversion the intake stored --
// and never the markup. A surface cannot render what it was never given, which makes "inbound email cannot
// become an XSS path" structural rather than a rule the next screen has to remember.
import type { Firestore } from "firebase-admin/firestore";
import {
  EMAIL_CONNECTIONS_COLLECTION,
  EMAIL_MAILBOXES_COLLECTION,
  EMAIL_DELIVERY_FAILURES_COLLECTION,
  EMAIL_ROUTING_RULES_COLLECTION,
  INBOUND_WORK_REQUESTS_COLLECTION,
} from "../constants/collections";
import { boundedString, toPlainText, type InboundWorkStatus } from "./inboundWorkModel";
import { normalizeOutcome, type RoutingRule } from "./inboundRouting";
import type { MailboxRecord } from "./inboundIntakeCommand";

export const DEFAULT_QUEUE_LIMIT = 100;
export const MAX_QUEUE_LIMIT = 300;

const str = (v: unknown, max = 255): string => boundedString(v, max);
const strOrNull = (v: unknown, max = 255): string | null => str(v, max) || null;

export interface InboundWorkQueueRow {
  id: string;
  status: InboundWorkStatus;
  receivedAt: number;
  sender: string;
  subject: string;
  requestType: string | null;
  priority: number | null;
  queue: string | null;
  operatingCompanyId: string | null;
  customerCandidateId: string | null;
  equipmentCandidateId: string | null;
  attachmentCount: number;
  warnings: string[];
  workItemId: string | null;
}

function queueRow(id: string, d: Record<string, unknown>): InboundWorkQueueRow {
  const candidate = (v: unknown): string | null => strOrNull((v as Record<string, unknown> | undefined)?.id);
  return {
    id,
    status: (d.status as InboundWorkStatus) ?? "AWAITING_DECISION",
    receivedAt: typeof d.receivedAt === "number" ? d.receivedAt : 0,
    sender: str(d.sender),
    subject: str(d.subject, 500),
    requestType: strOrNull(d.requestType, 60),
    priority: typeof d.priority === "number" ? d.priority : null,
    queue: strOrNull(d.queue, 120),
    operatingCompanyId: strOrNull(d.operatingCompanyId, 120),
    customerCandidateId: candidate(d.customerCandidate),
    equipmentCandidateId: candidate(d.equipmentCandidate),
    attachmentCount: Array.isArray(d.attachmentRefs) ? d.attachmentRefs.length : 0,
    warnings: Array.isArray(d.warnings) ? d.warnings.map((w) => str(w, 120)).filter(Boolean) : [],
    workItemId: strOrNull(d.workItemId),
  };
}

/**
 * The queue. A single-field `status in [...]` filter -- Firestore maintains the single-field index for it,
 * so this adds no composite index -- bounded by limit, sorted newest-first in code rather than by an
 * `orderBy` that would require one.
 */
export async function readInboundWorkQueue(
  db: Firestore,
  options: { statuses?: readonly InboundWorkStatus[]; limit?: number } = {},
): Promise<{ rows: InboundWorkQueueRow[]; truncated: boolean }> {
  const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_QUEUE_LIMIT, 1), MAX_QUEUE_LIMIT);
  const statuses =
    options.statuses && options.statuses.length
      ? options.statuses.slice(0, 10)
      : (["AWAITING_DECISION", "NEEDS_REVIEW", "FAILED", "QUARANTINED", "ACCEPTED", "DECLINED", "ATTACHED"] as InboundWorkStatus[]);
  const snap = await db
    .collection(INBOUND_WORK_REQUESTS_COLLECTION)
    .where("status", "in", statuses as unknown as string[])
    .limit(limit + 1)
    .get();
  const truncated = snap.size > limit;
  const rows = snap.docs
    .slice(0, limit)
    .map((d) => queueRow(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => b.receivedAt - a.receivedAt);
  return { rows, truncated };
}

export interface InboundWorkDetail extends InboundWorkQueueRow {
  sourceProvider: string;
  sourceConnectionId: string;
  sourceMailboxId: string;
  sourceMessageId: string;
  sourceThreadId: string | null;
  recipients: string[];
  cc: string[];
  /** Plain text ONLY. The stored markup is deliberately not projected -- see the file header. */
  originalBodyText: string;
  normalizedBody: string;
  attachmentRefs: Record<string, unknown>[];
  /** NONE | PENDING | PARTIAL | COMPLETE | FAILED -- whether EOS actually holds the files. */
  attachmentCustody: string;
  threadMessages: unknown[];
  customerCandidate: unknown;
  locationCandidate: unknown;
  equipmentCandidate: unknown;
  externalReference: string | null;
  authorizationNumber: string | null;
  problemDescription: string | null;
  serialNumber: string | null;
  modelNumber: string | null;
  routingRuleId: string | null;
  routingOutcome: string | null;
  threadAssociation: string | null;
  processingProvider: string;
  processingError: string | null;
  decision: string | null;
  decisionReason: string | null;
  decisionBy: string | null;
  customerId: string | null;
  customerLocationId: string | null;
  equipmentId: string | null;
}

export async function readInboundWorkRequest(db: Firestore, requestId: string): Promise<InboundWorkDetail | null> {
  const id = str(requestId);
  if (!id) return null;
  const snap = await db.collection(INBOUND_WORK_REQUESTS_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  const normalizedBody = str(d.normalizedBody, 20_000);
  return {
    ...queueRow(snap.id, d),
    sourceProvider: str(d.sourceProvider, 64),
    sourceConnectionId: str(d.sourceConnectionId),
    sourceMailboxId: str(d.sourceMailboxId),
    sourceMessageId: str(d.sourceMessageId),
    sourceThreadId: strOrNull(d.sourceThreadId),
    recipients: Array.isArray(d.recipients) ? d.recipients.map((v) => str(v)).filter(Boolean) : [],
    cc: Array.isArray(d.cc) ? d.cc.map((v) => str(v)).filter(Boolean) : [],
    // Converted again on the way out rather than trusted: a record written before this projection
    // existed, or by a future path, still cannot deliver markup to a browser.
    originalBodyText: normalizedBody || toPlainText(d.originalBody, d.originalBodyContentType === "text/plain" ? "text/plain" : "text/html"),
    normalizedBody,
    // PROJECTED, NOT PASSED THROUGH. `storageKey` is internal: the governed attachment read takes a
    // provider attachment id and looks the key up server-side, so a client never holds one and cannot
    // name a different object. What a reviewer needs is the file's identity and whether EOS has it.
    attachmentRefs: (Array.isArray(d.attachmentRefs) ? d.attachmentRefs.slice(0, 200) : []).map((a) => {
      const ref = (a ?? {}) as Record<string, unknown>;
      return {
        filename: str(ref.filename, 255),
        mimeType: str(ref.mimeType, 255),
        size: typeof ref.size === "number" ? ref.size : 0,
        contentHash: strOrNull(ref.contentHash, 128),
        providerAttachmentId: str(ref.providerAttachmentId, 255),
        sourceMessageId: str(ref.sourceMessageId, 255),
        receivedAt: typeof ref.receivedAt === "number" ? ref.receivedAt : 0,
        custody: str(ref.custody, 40) || "PENDING",
        failureCode: strOrNull(ref.failureCode, 60),
        attempts: typeof ref.attempts === "number" ? ref.attempts : 0,
      };
    }),
    attachmentCustody: str(d.attachmentCustody, 40) || (Array.isArray(d.attachmentRefs) && d.attachmentRefs.length ? "PENDING" : "NONE"),
    threadMessages: Array.isArray(d.threadMessages)
      ? d.threadMessages.slice(0, 50).map((m) => {
          const t = (m ?? {}) as Record<string, unknown>;
          return {
            messageId: str(t.messageId),
            receivedAt: typeof t.receivedAt === "number" ? t.receivedAt : 0,
            sender: str(t.sender),
            subject: str(t.subject, 500),
            normalizedBody: toPlainText(t.normalizedBody, "text/plain"),
          };
        })
      : [],
    customerCandidate: d.customerCandidate ?? null,
    locationCandidate: d.locationCandidate ?? null,
    equipmentCandidate: d.equipmentCandidate ?? null,
    externalReference: strOrNull(d.externalReference, 120),
    authorizationNumber: strOrNull(d.authorizationNumber, 120),
    problemDescription: strOrNull(d.problemDescription, 500),
    serialNumber: strOrNull(d.serialNumber, 120),
    modelNumber: strOrNull(d.modelNumber, 120),
    routingRuleId: strOrNull(d.routingRuleId),
    routingOutcome: strOrNull(d.routingOutcome, 60),
    threadAssociation: strOrNull(d.threadAssociation, 60),
    processingProvider: str(d.processingProvider, 60) || "EOS_NATIVE",
    processingError: strOrNull(d.processingError, 500),
    decision: strOrNull(d.decision, 60),
    decisionReason: strOrNull(d.decisionReason, 60),
    decisionBy: strOrNull(d.decisionBy),
    customerId: strOrNull(d.customerId),
    customerLocationId: strOrNull(d.customerLocationId),
    equipmentId: strOrNull(d.equipmentId),
  };
}

/** The mailbox a delivered message belongs to, by configured mailbox document id. */
export async function readMailbox(db: Firestore, mailboxId: string): Promise<MailboxRecord | null> {
  const id = str(mailboxId);
  if (!id) return null;
  const snap = await db.collection(EMAIL_MAILBOXES_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  return {
    id: snap.id,
    connectionId: str(d.connectionId),
    displayName: str(d.displayName, 120),
    emailAddress: str(d.emailAddress),
    purpose: (d.purpose as MailboxRecord["purpose"]) ?? "OTHER",
    operatingCompanyId: strOrNull(d.operatingCompanyId, 120),
    destination: str(d.destination, 60) || "SERVICE",
    defaultQueue: strOrNull(d.defaultQueue, 120),
    inboundEnabled: d.inboundEnabled !== false,
    processingMode: (d.processingMode as MailboxRecord["processingMode"]) ?? "REVIEW_REQUIRED",
    routingPolicyId: strOrNull(d.routingPolicyId),
    attachmentPolicy: (d.attachmentPolicy as MailboxRecord["attachmentPolicy"]) ?? "PRESERVE_METADATA",
    threadingEnabled: d.threadingEnabled !== false,
    status: d.status === "DISABLED" ? "DISABLED" : "ACTIVE",
  };
}

export async function readRoutingRules(db: Firestore): Promise<RoutingRule[]> {
  const snap = await db.collection(EMAIL_ROUTING_RULES_COLLECTION).limit(200).get();
  return snap.docs.map((doc) => {
    const d = doc.data() as Record<string, unknown>;
    return {
      id: doc.id,
      name: str(d.name, 120),
      enabled: d.enabled !== false,
      order: typeof d.order === "number" ? d.order : 100,
      when: (d.when ?? {}) as RoutingRule["when"],
      then: normalizeOutcome(d.then),
    };
  });
}

export interface EmailIntakeConfiguration {
  connections: Record<string, unknown>[];
  mailboxes: Record<string, unknown>[];
  rules: RoutingRule[];
  /** Open provider-transport failures: what could not be delivered, why, and whether a retry is left. */
  exceptions: Record<string, unknown>[];
  overview: { total: number; byStatus: Record<string, number>; attachmentCustody: Record<string, number> };
}

/**
 * Everything the Administration → Email & Communications area shows, in ONE read.
 *
 * The overview counts come from the intake records themselves -- there is no seeded number and no
 * fabricated health figure. An environment with no intake shows zeroes, which is the honest answer.
 */
export async function readEmailIntakeConfiguration(db: Firestore): Promise<EmailIntakeConfiguration> {
  const [connections, mailboxes, rules, requests, failures] = await Promise.all([
    db.collection(EMAIL_CONNECTIONS_COLLECTION).limit(50).get(),
    db.collection(EMAIL_MAILBOXES_COLLECTION).limit(200).get(),
    readRoutingRules(db),
    db.collection(INBOUND_WORK_REQUESTS_COLLECTION).limit(MAX_QUEUE_LIMIT).get(),
    db.collection(EMAIL_DELIVERY_FAILURES_COLLECTION).where("status", "in", ["OPEN", "DELIVERY_RETRY_EXHAUSTED"]).limit(50).get(),
  ]);
  const byStatus: Record<string, number> = {};
  // Attachment custody is counted beside status because they answer different questions: one is what a
  // reviewer must decide, the other is whether the evidence for deciding actually arrived.
  const attachmentCustody: Record<string, number> = {};
  for (const doc of requests.docs) {
    const data = doc.data() as Record<string, unknown>;
    const status = str(data.status, 60) || "UNKNOWN";
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const custody = str(data.attachmentCustody, 60);
    if (custody && custody !== "NONE") attachmentCustody[custody] = (attachmentCustody[custody] ?? 0) + 1;
  }
  return {
    connections: connections.docs.map((d) => {
      const c = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        connectionName: str(c.connectionName, 120),
        provider: str(c.provider, 64),
        tenantOrWorkspace: str(c.tenantOrWorkspace),
        connectedAccount: str(c.connectedAccount),
        connectionStatus: str(c.connectionStatus, 60),
        oauthStatus: str(c.oauthStatus, 60),
        health: str(c.health, 60),
        inboundEnabled: c.inboundEnabled !== false,
        outboundEnabled: c.outboundEnabled === true,
        // The NAME of the bound secret, never a value. There is no field on this document that holds one.
        credentialSecretName: strOrNull(c.credentialSecretName),
        lastSuccessfulSync: typeof c.lastSuccessfulSync === "number" ? c.lastSuccessfulSync : null,
        lastMessageReceived: typeof c.lastMessageReceived === "number" ? c.lastMessageReceived : null,
        authorizedAt: typeof c.authorizedAt === "number" ? c.authorizedAt : null,
        lastTokenRefreshAt: typeof c.lastTokenRefreshAt === "number" ? c.lastTokenRefreshAt : null,
        lastHealthCheckAt: typeof c.lastHealthCheckAt === "number" ? c.lastHealthCheckAt : null,
        lastProviderErrorAt: typeof c.lastProviderErrorAt === "number" ? c.lastProviderErrorAt : null,
        providerErrorCode: strOrNull(c.providerErrorCode, 60),
      };
    }),
    mailboxes: mailboxes.docs.map((d) => {
      const m = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        connectionId: str(m.connectionId),
        displayName: str(m.displayName, 120),
        emailAddress: str(m.emailAddress),
        purpose: str(m.purpose, 60),
        destination: str(m.destination, 60),
        defaultQueue: strOrNull(m.defaultQueue, 120),
        operatingCompanyId: strOrNull(m.operatingCompanyId, 120),
        processingMode: str(m.processingMode, 60),
        attachmentPolicy: str(m.attachmentPolicy, 60),
        threadingEnabled: m.threadingEnabled !== false,
        inboundEnabled: m.inboundEnabled !== false,
        status: str(m.status, 60) || "ACTIVE",
        mailboxReadable: m.mailboxReadable === true,
        mailboxValidationDetail: strOrNull(m.mailboxValidationDetail, 300),
        lastPolledAt: typeof m.lastPolledAt === "number" ? m.lastPolledAt : null,
        lastMessageReceivedAt: typeof m.lastMessageReceivedAt === "number" ? m.lastMessageReceivedAt : null,
        // Whether delivery has a resume point at all -- never the cursor itself, which is provider state.
        deliveryConnected: Boolean((m.deliveryCursor as Record<string, unknown> | undefined)?.value),
      };
    }),
    rules,
    exceptions: failures.docs.map((d) => {
      const f = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        connectionId: str(f.connectionId),
        mailboxId: str(f.mailboxId),
        code: str(f.code, 60),
        // The operator-facing sentence, bounded. No provider body, no token, no raw payload.
        detail: str(f.detail, 300),
        disposition: str(f.disposition, 40),
        attempts: typeof f.attempts === "number" ? f.attempts : 0,
        status: str(f.status, 40),
        exhausted: f.exhausted === true,
        lastFailedAt: typeof f.lastFailedAt === "number" ? f.lastFailedAt : 0,
        nextAttemptAt: typeof f.nextAttemptAt === "number" ? f.nextAttemptAt : null,
      };
    }),
    overview: { total: requests.size, byStatus, attachmentCustody },
  };
}
