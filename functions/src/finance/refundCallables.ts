// Finance — governed REFUND callable (thin onCall over the pure core). Records an explicit refund (money
// returned after payment) and reverses the applied payment on the invoice — in one transaction:
//   • actor identity from request.auth.uid;
//   • authorization = capability `finance.refund.record`, fail-closed via the trusted effective-access feed;
//     registered active:false ⇒ hard DENY until a separate Owner grant;
//   • the transaction reads the invoice, writes the refund record (Admin SDK), updates the invoice's
//     transactionally-maintained AR projection (applied reduced, outstanding/state re-derived — the invoice's
//     issued facts are never rewritten), and stages an append-only AUDIT event;
//   • idempotent via a deterministic audit id.
// `refunds` is Admin-SDK-only (deny-all client Rules). EXPORT != DEPLOY, REGISTER != GRANT.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { INVOICES_COLLECTION, REFUNDS_COLLECTION } from "../constants/collections";
import { stageAuditEventWithId, auditEventDocRef } from "../access/auditEventWriter";
import { buildRefund, RefundCommandError, type RecordRefundInput, type RefundInvoiceState } from "./refundCommands";

export const FINANCE_REFUND_RECORD_CAPABILITY = "finance.refund.record";

function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof RefundCommandError) {
    switch (err.code) {
      case "INVOICE_VOID":
      case "EXCEEDS_APPLIED":
      case "CURRENCY_MISMATCH":
        return new HttpsError("failed-precondition", err.message);
      case "INVOICE_NOT_FOUND":
        return new HttpsError("not-found", err.message);
      default:
        return new HttpsError("invalid-argument", err.message);
    }
  }
  return new HttpsError("internal", "Refund failed.");
}

async function requireRefundRecord(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [FINANCE_REFUND_RECORD_CAPABILITY] });
    allowed = decisions[FINANCE_REFUND_RECORD_CAPABILITY] === true;
  } catch (err) {
    console.error(`[requireRefundRecord] capability resolution failed for ${FINANCE_REFUND_RECORD_CAPABILITY}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to record refunds.");
}

const auditId = (actorUid: string, invoiceId: string, idempotencyKey: string): string =>
  `recordRefund_${createHash("sha256").update(`${actorUid}|${invoiceId}|${idempotencyKey}`).digest("hex").slice(0, 40)}`;

interface RecordRefundRequest extends RecordRefundInput {
  idempotencyKey: string;
}

export const recordRefund = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireRefundRecord(request.auth.uid);

  const data = (request.data ?? {}) as RecordRefundRequest;
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  if (typeof data.invoiceId !== "string" || data.invoiceId.trim().length === 0) throw new HttpsError("invalid-argument", "invoiceId is required.");
  const actorUid = request.auth.uid;
  const aid = auditId(actorUid, data.invoiceId, data.idempotencyKey);
  const db = getFirestore();

  try {
    return await db.runTransaction(async (tx) => {
      const prior = await tx.get(auditEventDocRef(aid));
      if (prior.exists) return { success: true as const, replayed: true as const, refundId: ((prior.data() ?? {}).targetId as string) ?? null };
      const invoiceRef = db.collection(INVOICES_COLLECTION).doc(data.invoiceId);
      const invSnap = await tx.get(invoiceRef);
      if (!invSnap.exists) throw new RefundCommandError("INVOICE_NOT_FOUND", `no invoice with id ${data.invoiceId}`);
      const invoice = invSnap.data() as RefundInvoiceState;

      const { refund, invoicePatch } = buildRefund(data, invoice, { nowMillis: Date.now() });

      const refundRef = db.collection(REFUNDS_COLLECTION).doc();
      tx.set(refundRef, { ...refund, recordedBy: actorUid, recordedAt: FieldValue.serverTimestamp() });
      tx.update(invoiceRef, { appliedMinor: invoicePatch.appliedMinor, outstandingMinor: invoicePatch.outstandingMinor, state: invoicePatch.state, updatedAt: FieldValue.serverTimestamp() });
      stageAuditEventWithId(tx, aid, {
        actorUid,
        action: "recordRefund",
        targetType: "refund",
        targetId: refundRef.id,
        outcome: "applied",
        summary: `refunded ${refund.amountMinor} ${refund.currency} on invoice ${data.invoiceId} (state ${invoicePatch.state}, outstanding ${invoicePatch.outstandingMinor}) reason=${refund.reason}`,
      });
      return { success: true as const, replayed: false as const, refundId: refundRef.id, invoiceState: invoicePatch.state, outstandingMinor: invoicePatch.outstandingMinor };
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});
