"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.associateInboundMessage = associateInboundMessage;
const clean = (v) => (typeof v === "string" ? v.trim() : "");
function unique(ids) {
    return [...new Set(ids.filter(Boolean))];
}
function associateInboundMessage(incoming, existing) {
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
        if (byThread.length === 1)
            return { outcome: "THREAD_MATCH", requestId: byThread[0], matchedOn: "providerThreadId", candidateIds: byThread };
        if (byThread.length > 1)
            return { outcome: "AMBIGUOUS", requestId: null, matchedOn: "providerThreadId", candidateIds: byThread };
    }
    // 3. The message ids this message answers.
    const referenced = unique([clean(incoming?.inReplyTo), ...(incoming?.references ?? []).map(clean)]);
    if (referenced.length > 0) {
        const byReference = unique(candidates
            .filter((c) => referenced.includes(c.sourceMessageId) || (c.messageIds ?? []).some((m) => referenced.includes(m)))
            .map((c) => c.id));
        if (byReference.length === 1) {
            return { outcome: "THREAD_MATCH", requestId: byReference[0], matchedOn: "messageReferences", candidateIds: byReference };
        }
        if (byReference.length > 1) {
            return { outcome: "AMBIGUOUS", requestId: null, matchedOn: "messageReferences", candidateIds: byReference };
        }
    }
    return { outcome: "NEW", requestId: null, matchedOn: "", candidateIds: [] };
}
//# sourceMappingURL=inboundThreading.js.map