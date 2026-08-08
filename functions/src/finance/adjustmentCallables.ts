// Finance — governed invoice ADJUSTMENT callable (thin onCall over the pure command core). Records an explicit
// linked credit/charge/write-off record and maintains the invoice's derived AR projection — in one
// transaction. Supplies only I/O + auth:
//   • actor identity from request.auth.uid;
//   • authorization = capability `finance.adjustment.record`, fail-closed via the trusted effective-access
//     feed; registered active:false ⇒ hard DENY until a separate Owner grant;
//   • the transaction reads the invoice, writes the adjustment (Admin SDK), updates the invoice's
//     transactionally-maintained AR projection (credits/charges/writeoffs; outstanding re-derived — the
//     invoice is NEVER rewritten to erase history), and stages an append-only AUDIT event;
//   • idempotency via a deterministic audit id.
// `invoice_adjustments` is Admin-SDK-only (deny-all client Rules). EXPORT != DEPLOY, REGISTER != GRANT.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { INVOICES_COLLECTION, INVOICE_ADJUSTMENTS_COLLECTION } from "../constants/collections";
import { stageAuditEventWithId, auditEventDocRef } from "../access/auditEventWriter";
import { buildAdjustment, AdjustmentCommandError, type RecordAdjustmentInput, type InvoiceAdjustState } from "./adjustmentCommands";

export const FINANCE_ADJUSTMENT_RECORD_CAPABILITY = "finance.adjustment.record";

function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof AdjustmentCommandError) {
    switch (err.code) {
      case "INVOICE_VOID":
      case "EXCEEDS_OUTSTANDING":
      case "CURRENCY_MISMATCH":
        return new HttpsError("failed-precondition", err.message);
      case "INVOICE_NOT_FOUND":
        return new HttpsError("not-found", err.message);
      default:
        return new HttpsError("invalid-argument", err.message);
    }
  }
  return new HttpsError("internal", "Adjustment failed.");
}

async function requireAdjustmentRecord(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [FINANCE_ADJUSTMENT_RECORD_CAPABILITY] });
    allowed = decisions[FINANCE_ADJUSTMENT_RECORD_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to record invoice adjustments.");
}

const auditId = (actorUid: string, invoiceId: string, idempotencyKey: string): string =>
  `recordInvoiceAdjustment_${createHash("sha256").update(`${actorUid}|${invoiceId}|${idempotencyKey}`).digest("hex").slice(0, 40)}`;

interface RecordAdjustmentRequest extends RecordAdjustmentInput {
  idempotencyKey: string;
}

export const recordInvoiceAdjustment = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireAdjustmentRecord(request.auth.uid);

  const data = (request.data ?? {}) as RecordAdjustmentRequest;
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  if (typeof data.invoiceId !== "string" || data.invoiceId.trim().length === 0) throw new HttpsError("invalid-argument", "invoiceId is required.");
  const actorUid = request.auth.uid;
  const aid = auditId(actorUid, data.invoiceId, data.idempotencyKey);
  const db = getFirestore();

  try {
    return await db.runTransaction(async (tx) => {
      const prior = await tx.get(auditEventDocRef(aid));
      if (prior.exists) {
        const d = prior.data() ?? {};
        return { success: true as const, replayed: true as const, adjustmentId: (d.targetId as string) ?? null };
      }
      const invoiceRef = db.collection(INVOICES_COLLECTION).doc(data.invoiceId);
      const invSnap = await tx.get(invoiceRef);
      if (!invSnap.exists) throw new AdjustmentCommandError("INVOICE_NOT_FOUND", `no invoice with id ${data.invoiceId}`);
      const invoice = invSnap.data() as InvoiceAdjustState;

      const { adjustment, invoicePatch } = buildAdjustment(data, invoice, { nowMillis: Date.now() });

      // Explicit linked adjustment record — never a rewrite of the issued invoice.
      const adjRef = db.collection(INVOICE_ADJUSTMENTS_COLLECTION).doc();
      tx.set(adjRef, { ...adjustment, recordedBy: actorUid, recordedAt: FieldValue.serverTimestamp() });
      // Invoice AR projection maintained in the SAME transaction (state left unchanged — a credit/write-off is
      // not a payment; only outstanding + the adjustment tallies move).
      const patch: Record<string, unknown> = { outstandingMinor: invoicePatch.outstandingMinor, updatedAt: FieldValue.serverTimestamp() };
      if (invoicePatch.creditsMinor !== undefined) patch.creditsMinor = invoicePatch.creditsMinor;
      if (invoicePatch.chargesMinor !== undefined) patch.chargesMinor = invoicePatch.chargesMinor;
      if (invoicePatch.writeOffMinor !== undefined) patch.writeOffMinor = invoicePatch.writeOffMinor;
      tx.update(invoiceRef, patch);

      stageAuditEventWithId(tx, aid, {
        actorUid,
        action: "recordInvoiceAdjustment",
        targetType: "invoiceAdjustment",
        targetId: adjRef.id,
        outcome: "applied",
        summary: `${adjustment.type} ${adjustment.amountMinor} ${adjustment.currency} on invoice ${data.invoiceId} (outstanding ${invoicePatch.outstandingMinor}) reason=${adjustment.reason}`,
      });
      return { success: true as const, replayed: false as const, adjustmentId: adjRef.id, type: adjustment.type, outstandingMinor: invoicePatch.outstandingMinor };
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});
