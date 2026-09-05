// Email Connections + Inbound Work -- THREAD ASSOCIATION AND DUPLICATE PROTECTION. Pure.
//
// THE DEFECT THIS PREVENTS. A vendor replies "any update?" on the same thread and EOS opens a second job.
// The reply is preserved against the work that already exists, or -- if the evidence is ambiguous -- it
// goes to a person. It is never silently attached to the wrong job, which is the failure mode a
// subject-line match produces and the reason subject text is not consulted here at all.
//
// THE EVIDENCE, in decreasing strength:
//   1. the SAME provider message id      -> the identical message, delivered twice. DUPLICATE.
//   2. the provider conversation/thread id -> the provider's own threading, the strongest link available.
//   3. RFC 5322 In-Reply-To / References  -> the message ids this message answers.
// A single candidate at any level associates. TWO OR MORE distinct candidates is AMBIGUOUS: it fails to
// review rather than picking one.
import type { InboundWorkStatus } from "./inboundWorkModel";

/** The minimal projection of an existing intake record this decision needs. */
export interface ExistingIntakeRef {
  id: string;
  sourceMessageId: string;
  sourceThreadId: string | null;
  /** Every provider message id already preserved on this intake (the original plus later replies). */
  messageIds: string[];
  status: InboundWorkStatus;
  workItemId: string | null;
}

export interface IncomingMessageIdentity {
  messageId: string;
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
}

export type ThreadAssociationOutcome = "DUPLICATE" | "THREAD_MATCH" | "AMBIGUOUS" | "NEW";

export interface ThreadAssociation {
  outcome: ThreadAssociationOutcome;
  /** The existing intake this message belongs to, for DUPLICATE and THREAD_MATCH. */
  requestId: string | null;
  /** Which evidence decided it -- recorded on the intake so the association is auditable, never implied. */
  matchedOn: "providerMessageId" | "providerThreadId" | "messageReferences" | "";
  /** For AMBIGUOUS: the candidates a reviewer must choose between. */
  candidateIds: string[];
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export function associateInboundMessage(
  incoming: IncomingMessageIdentity,
  existing: readonly ExistingIntakeRef[],
): ThreadAssociation {
  const candidates = existing ?? [];
  const messageId = clean(incoming?.messageId);

  // 1. The identical message, twice. Checked FIRST and unconditionally: a redelivery is a duplicate even
  //    when it also carries thread evidence, and taking it in again would double the queue on a retry.
  const sameMessage = candidates.find((c) => c.sourceMessageId === messageId || (c.messageIds ?? []).includes(messageId));
  if (messageId && sameMessage) {
    return { outcome: "DUPLICATE", requestId: sameMessage.id, matchedOn: "providerMessageId", candidateIds: [sameMessage.id] };
  }

  // 2. The provider's own conversation id.
  const threadId = clean(incoming?.threadId);
  if (threadId) {
    const byThread = unique(candidates.filter((c) => clean(c.sourceThreadId) === threadId).map((c) => c.id));
    if (byThread.length === 1) return { outcome: "THREAD_MATCH", requestId: byThread[0], matchedOn: "providerThreadId", candidateIds: byThread };
    if (byThread.length > 1) return { outcome: "AMBIGUOUS", requestId: null, matchedOn: "providerThreadId", candidateIds: byThread };
  }

  // 3. The message ids this message answers.
  const referenced = unique([clean(incoming?.inReplyTo), ...(incoming?.references ?? []).map(clean)]);
  if (referenced.length > 0) {
    const byReference = unique(
      candidates
        .filter((c) => referenced.includes(c.sourceMessageId) || (c.messageIds ?? []).some((m) => referenced.includes(m)))
        .map((c) => c.id),
    );
    if (byReference.length === 1) {
      return { outcome: "THREAD_MATCH", requestId: byReference[0], matchedOn: "messageReferences", candidateIds: byReference };
    }
    if (byReference.length > 1) {
      return { outcome: "AMBIGUOUS", requestId: null, matchedOn: "messageReferences", candidateIds: byReference };
    }
  }

  return { outcome: "NEW", requestId: null, matchedOn: "", candidateIds: [] };
}
