// Email Connections + Inbound Work -- INTAKE. One inbound provider message becomes exactly one governed
// intake record, or is preserved onto the one it belongs to, in a single transaction.
//
// WHY THE DOCUMENT ID IS DETERMINISTIC. Duplicate protection cannot rest on a query: two deliveries of the
// same message racing each other both read an empty result and both write. The intake document id is a
// hash of (mailbox, provider message id), so the SECOND writer's transactional read finds the first
// document and the collision is impossible rather than unlikely. Thread association -- a reply, whose
// message id is genuinely new -- is a separate, weaker question and does use queries, which is safe because
// its worst case (a concurrent reply landing twice) is a reviewable duplicate, not a duplicate Work Order.
//
// NOTHING IS EVER DROPPED. An unknown mailbox, a disabled mailbox, or a processing failure produces a
// RETAINED record (QUARANTINED / FAILED) carrying the original message, not a discarded email. An operator
// can see what arrived and why it was not queued.
import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { INBOUND_WORK_REQUESTS_COLLECTION } from "../constants/collections";
import { stageAuditEvent } from "../access/auditEventWriter";
import {
  MAX_ATTACHMENTS,
  boundedString,
  toPlainText,
  type InboundAttachmentRef,
  type InboundWorkStatus,
  type NormalizedInboundMessage,
} from "./inboundWorkModel";
import { evaluateRouting, type RoutingRule } from "./inboundRouting";
import {
  EMPTY_PROCESSING_RESULT,
  normalizeProcessingResult,
  processInboundMessageNatively,
  type InboundProcessingResult,
} from "./inboundProcessing";
import { associateInboundMessage, type ExistingIntakeRef } from "./inboundThreading";
import { resolveInboundCandidates } from "./inboundCandidateResolution";
import type { EmailMailboxConfig } from "./emailProvider";
import type { InboundProcessingProvider } from "./inboundWorkModel";

/** How many replies one intake keeps inline. Beyond this the thread is preserved by id only. */
export const MAX_THREAD_MESSAGES = 50;

export function inboundRequestDocId(mailboxId: string, messageId: string): string {
  const digest = createHash("sha256").update(`${mailboxId}|${messageId}`).digest("hex").slice(0, 40);
  return `inbound_${digest}`;
}

export interface MailboxRecord extends EmailMailboxConfig {
  id: string;
  status: "ACTIVE" | "DISABLED";
}

export interface IngestInput {
  message: NormalizedInboundMessage;
  /** The configured mailbox this message arrived in, or null when the mailbox is unknown to EOS. */
  mailbox: MailboxRecord | null;
  rules: readonly RoutingRule[];
  /** Who/what performed the intake. A system ingest actor, never an end user's claim. */
  actorUid: string;
  /** Which processing provider produced `providerResult`. Defaults to base EOS native processing. */
  processingProvider?: InboundProcessingProvider;
  /** An external/VDX provider's raw result, normalized through the provider-neutral contract. */
  providerResult?: unknown;
}

export interface IngestOutcome {
  requestId: string;
  outcome: "CREATED" | "DUPLICATE" | "THREAD_MATCH" | "AMBIGUOUS" | "QUARANTINED" | "FAILED";
  status: InboundWorkStatus;
}

function threadCandidateFrom(id: string, data: Record<string, unknown>): ExistingIntakeRef {
  return {
    id,
    sourceMessageId: boundedString(data.sourceMessageId, 255),
    sourceThreadId: boundedString(data.sourceThreadId, 255) || null,
    messageIds: Array.isArray(data.messageIds) ? data.messageIds.map((m) => boundedString(m, 255)).filter(Boolean) : [],
    status: (data.status as InboundWorkStatus) ?? "AWAITING_DECISION",
    workItemId: boundedString(data.workItemId, 255) || null,
  };
}

/**
 * Every intake in this mailbox that could plausibly be this message's thread. Three single-field equality /
 * array-contains queries -- Firestore maintains single-field indexes automatically, so this adds no
 * composite index -- unioned and bounded. Subject text is deliberately NOT among the keys.
 */
async function readThreadCandidates(
  tx: Transaction,
  db: Firestore,
  message: NormalizedInboundMessage,
): Promise<ExistingIntakeRef[]> {
  const col = db.collection(INBOUND_WORK_REQUESTS_COLLECTION);
  const referenced = [message.inReplyTo, ...message.references].filter((v): v is string => Boolean(v)).slice(0, 10);
  const queries = [
    message.threadId ? col.where("sourceThreadId", "==", message.threadId).limit(10) : null,
    referenced.length ? col.where("messageIds", "array-contains-any", referenced).limit(10) : null,
  ].filter((q): q is NonNullable<typeof q> => q !== null);
  const byId = new Map<string, ExistingIntakeRef>();
  for (const query of queries) {
    const snap = await tx.get(query);
    for (const doc of snap.docs) byId.set(doc.id, threadCandidateFrom(doc.id, doc.data() as Record<string, unknown>));
  }
  return [...byId.values()];
}

function retainedRecord(
  message: NormalizedInboundMessage,
  normalizedBody: string,
  status: InboundWorkStatus,
  note: string,
): Record<string, unknown> {
  return {
    sourceChannel: "EMAIL",
    sourceProvider: message.provider,
    sourceConnectionId: message.connectionId,
    sourceMailboxId: message.mailboxId,
    sourceMessageId: message.messageId,
    sourceThreadId: message.threadId,
    messageIds: [message.messageId],
    receivedAt: message.receivedAt,
    sender: message.sender,
    recipients: message.recipients,
    cc: message.cc,
    subject: message.subject,
    originalBody: message.originalBody,
    originalBodyContentType: message.originalBodyContentType,
    normalizedBody,
    attachmentRefs: message.attachments,
    status,
    statusNote: note,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Take one normalized message into the intake queue.
 *
 * The whole decision -- duplicate, reply, quarantine, or new -- happens inside ONE transaction, so a retry
 * of the same delivery converges on the same record rather than racing itself.
 */
export async function ingestInboundMessage(db: Firestore, input: IngestInput): Promise<IngestOutcome> {
  const { message, mailbox, rules, actorUid } = input;
  const normalizedBody = toPlainText(message.originalBody, message.originalBodyContentType);
  const docId = inboundRequestDocId(message.mailboxId, message.messageId);
  const docRef = db.collection(INBOUND_WORK_REQUESTS_COLLECTION).doc(docId);

  // Processing runs BEFORE the transaction: it is pure for EOS_NATIVE and an already-delivered payload for
  // any other provider, and a failure here must produce a retained FAILED record rather than an exception
  // that loses the message.
  const provider: InboundProcessingProvider = input.processingProvider ?? "EOS_NATIVE";
  let processing: InboundProcessingResult = EMPTY_PROCESSING_RESULT;
  let processingError = "";
  try {
    processing =
      provider === "EOS_NATIVE"
        ? processInboundMessageNatively(message, normalizedBody)
        : normalizeProcessingResult(input.providerResult, provider);
  } catch (err) {
    processingError = boundedString(err instanceof Error ? err.message : String(err), 500) || "processing failed";
  }

  // Record lookup for the candidates, outside the transaction for the same reason -- and never trusted as
  // identity: acceptance re-reads and re-validates whatever the reviewer finally chooses.
  let candidates = {
    customerCandidate: processing.customerCandidate,
    locationCandidate: processing.locationCandidate,
    equipmentCandidate: processing.equipmentCandidate,
  };
  if (!processingError && !candidates.equipmentCandidate.id && !candidates.customerCandidate.id) {
    try {
      candidates = await resolveInboundCandidates(db, { senderEmail: message.sender, serialNumber: processing.serialNumber });
    } catch (err) {
      console.error("[ingestInboundMessage] candidate resolution failed", err);
    }
  }

  return db.runTransaction(async (tx) => {
    // 1. THE SAME MESSAGE, TWICE. Deterministic id, transactional read: structurally impossible to double.
    const existing = await tx.get(docRef);
    if (existing.exists) {
      return {
        requestId: docId,
        outcome: "DUPLICATE" as const,
        status: (existing.data()?.status as InboundWorkStatus) ?? "AWAITING_DECISION",
      };
    }

    // 2. AN UNKNOWN OR DISABLED MAILBOX IS QUARANTINED, NOT DISCARDED.
    if (!mailbox || mailbox.status === "DISABLED" || mailbox.inboundEnabled === false) {
      tx.set(
        docRef,
        retainedRecord(
          message,
          normalizedBody,
          "QUARANTINED",
          mailbox ? "Mailbox is not accepting inbound work." : "Message arrived in a mailbox EOS does not know.",
        ),
      );
      stageAuditEvent(tx, {
        actorUid,
        action: "quarantineInboundWorkRequest",
        targetType: "inboundWorkRequest",
        targetId: docId,
        outcome: "denied",
        summary: `quarantined inbound message in mailbox ${message.mailboxId}`,
      });
      return { requestId: docId, outcome: "QUARANTINED" as const, status: "QUARANTINED" as InboundWorkStatus };
    }

    // 3. A REPLY ON WORK WE ALREADY HAVE.
    const threadCandidates = mailbox.threadingEnabled === false ? [] : await readThreadCandidates(tx, db, message);
    const association = associateInboundMessage(
      { messageId: message.messageId, threadId: message.threadId, inReplyTo: message.inReplyTo, references: message.references },
      threadCandidates,
    );
    if (association.outcome === "DUPLICATE" || association.outcome === "THREAD_MATCH") {
      const targetRef = db.collection(INBOUND_WORK_REQUESTS_COLLECTION).doc(association.requestId as string);
      const target = await tx.get(targetRef);
      if (target.exists) {
        const data = target.data() as Record<string, unknown>;
        const attachments = (Array.isArray(data.attachmentRefs) ? (data.attachmentRefs as InboundAttachmentRef[]) : [])
          .concat(message.attachments)
          .slice(0, MAX_ATTACHMENTS * 4);
        const thread = (Array.isArray(data.threadMessages) ? data.threadMessages : []).slice(0, MAX_THREAD_MESSAGES - 1);
        tx.update(targetRef, {
          messageIds: FieldValue.arrayUnion(message.messageId),
          attachmentRefs: attachments,
          threadMessages: [
            ...thread,
            {
              messageId: message.messageId,
              receivedAt: message.receivedAt,
              sender: message.sender,
              subject: message.subject,
              normalizedBody,
            },
          ],
          updatedAt: FieldValue.serverTimestamp(),
        });
        stageAuditEvent(tx, {
          actorUid,
          action: "linkInboundWorkThreadMessage",
          targetType: "inboundWorkRequest",
          targetId: association.requestId as string,
          outcome: "applied",
          summary: `preserved reply ${message.messageId} on existing intake (${association.matchedOn})`,
        });
        return {
          requestId: association.requestId as string,
          outcome: association.outcome,
          status: (data.status as InboundWorkStatus) ?? "AWAITING_DECISION",
        };
      }
    }

    // 4. A NEW INTAKE. Routing decides classification and whether a person must look at it first.
    const routing = evaluateRouting(rules, {
      mailboxId: message.mailboxId,
      sender: message.sender,
      subject: message.subject,
      normalizedBody,
      hasAttachments: message.attachments.length > 0,
    });
    const ambiguous = association.outcome === "AMBIGUOUS";
    const status: InboundWorkStatus = processingError
      ? "FAILED"
      : ambiguous || routing.outcome.manualReview === true
        ? "NEEDS_REVIEW"
        : "AWAITING_DECISION";

    tx.set(docRef, {
      ...retainedRecord(message, normalizedBody, status, ambiguous ? "Reply matched more than one open intake." : ""),
      // Classification is the ROUTING rule's, never the sender's and never the extractor's.
      requestType: routing.outcome.requestType ?? processing.requestType ?? null,
      destination: routing.outcome.destination ?? mailbox.destination ?? "SERVICE",
      queue: routing.outcome.queue ?? mailbox.defaultQueue ?? null,
      // Operating company comes from EOS configuration -- the mailbox, or a rule an administrator wrote.
      // An inbound message never names its own operating company.
      operatingCompanyId: routing.outcome.operatingCompanyId ?? mailbox.operatingCompanyId ?? null,
      priority: routing.outcome.priority ?? processing.priority ?? null,
      routingRuleId: routing.ruleId,
      routingOutcome: routing.reason,
      threadAssociation: association.outcome,
      threadAssociationCandidateIds: association.candidateIds,
      customerCandidate: candidates.customerCandidate,
      locationCandidate: candidates.locationCandidate,
      equipmentCandidate: candidates.equipmentCandidate,
      externalReference: processing.externalReference,
      authorizationNumber: processing.authorizationNumber,
      problemDescription: processing.problemDescription,
      serialNumber: processing.serialNumber,
      modelNumber: processing.modelNumber,
      warnings: processing.warnings,
      processingProvider: provider,
      processingMetadata: processing.providerMetadata,
      processingError: processingError || null,
      customerId: null,
      customerLocationId: null,
      equipmentId: null,
      workItemId: null,
      decision: null,
      decisionReason: null,
      decisionBy: null,
      decisionAt: null,
    });
    stageAuditEvent(tx, {
      actorUid,
      action: "createInboundWorkRequest",
      targetType: "inboundWorkRequest",
      targetId: docId,
      outcome: processingError ? "denied" : "applied",
      summary: `inbound ${routing.outcome.requestType ?? "SERVICE"} request from ${message.sender || "unknown sender"} routed by ${routing.ruleId ?? "no rule"} (${status})`,
    });
    return {
      requestId: docId,
      outcome: processingError ? ("FAILED" as const) : ambiguous ? ("AMBIGUOUS" as const) : ("CREATED" as const),
      status,
    };
  });
}
