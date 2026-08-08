// Finance — governed payment APPLICATION callable (thin onCall over the pure command core). Records a CASH
// RECEIPT and its PAYMENT APPLICATION to one invoice, and maintains the invoice's AR projection — all in one
// transaction. Supplies only I/O + auth + the trusted transaction:
//   • actor identity from request.auth.uid;
//   • authorization = capability `finance.payment.apply`, fail-closed via the trusted effective-access feed;
//     registered active:false ⇒ hard DENY until a separate Owner grant;
//   • the transaction reads the invoice, writes the receipt + the application (Admin SDK), updates the
//     invoice's transactionally-maintained AR projection (outstanding/state derived from the application
//     fact — NOT an independent authority), and stages an append-only AUDIT event;
//   • idempotency: a deterministic audit id makes a retried apply a no-op replay (no double receipt / no
//     double application / no drift).
// `payments` and `payment_applications` are Admin-SDK-only (deny-all client Rules). EXPORT != DEPLOY,
// REGISTER != GRANT, MERGE != ACTIVATION.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { INVOICES_COLLECTION, PAYMENTS_COLLECTION, PAYMENT_APPLICATIONS_COLLECTION } from "../constants/collections";
import { stageAuditEventWithId, auditEventDocRef } from "../access/auditEventWriter";
import { buildApplyPayment, PaymentCommandError, type ApplyPaymentInput, type InvoiceProjectionState } from "./paymentCommands";

export const FINANCE_PAYMENT_APPLY_CAPABILITY = "finance.payment.apply";

function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof PaymentCommandError) {
    switch (err.code) {
      case "ALREADY_PAID":
      case "INVOICE_VOID":
      case "NOT_OPEN":
      case "OVER_APPLICATION":
      case "CURRENCY_MISMATCH":
        return new HttpsError("failed-precondition", err.message);
      case "INVOICE_NOT_FOUND":
        return new HttpsError("not-found", err.message);
      default:
        return new HttpsError("invalid-argument", err.message);
    }
  }
  return new HttpsError("internal", "Payment application failed.");
}

async function requirePaymentApply(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [FINANCE_PAYMENT_APPLY_CAPABILITY] });
    allowed = decisions[FINANCE_PAYMENT_APPLY_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to apply payments.");
}

const auditId = (actorUid: string, invoiceId: string, idempotencyKey: string): string =>
  `applyPayment_${createHash("sha256").update(`${actorUid}|${invoiceId}|${idempotencyKey}`).digest("hex").slice(0, 40)}`;

interface ApplyPaymentRequest extends ApplyPaymentInput {
  idempotencyKey: string;
}

export const applyPayment = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requirePaymentApply(request.auth.uid);

  const data = (request.data ?? {}) as ApplyPaymentRequest;
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  if (typeof data.invoiceId !== "string" || data.invoiceId.trim().length === 0) throw new HttpsError("invalid-argument", "invoiceId is required.");
  const actorUid = request.auth.uid;
  const aid = auditId(actorUid, data.invoiceId, data.idempotencyKey);
  const db = getFirestore();

  try {
    return await db.runTransaction(async (tx) => {
      // Idempotency / replay.
      const prior = await tx.get(auditEventDocRef(aid));
      if (prior.exists) {
        const d = prior.data() ?? {};
        return { success: true as const, replayed: true as const, paymentId: (d.targetId as string) ?? null };
      }
      const invoiceRef = db.collection(INVOICES_COLLECTION).doc(data.invoiceId);
      const invSnap = await tx.get(invoiceRef);
      if (!invSnap.exists) throw new PaymentCommandError("INVOICE_NOT_FOUND", `no invoice with id ${data.invoiceId}`);
      const invoice = invSnap.data() as InvoiceProjectionState;

      const { receipt, application, invoicePatch } = buildApplyPayment(data, invoice, { nowMillis: Date.now() });

      // Cash receipt (money received) — its own record.
      const paymentRef = db.collection(PAYMENTS_COLLECTION).doc();
      tx.set(paymentRef, { ...receipt, receivedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
      // Payment application (how it is applied) — a separate fact referencing the receipt + invoice.
      const applicationRef = db.collection(PAYMENT_APPLICATIONS_COLLECTION).doc();
      tx.set(applicationRef, { ...application, paymentId: paymentRef.id, createdAt: FieldValue.serverTimestamp() });
      // Invoice AR projection maintained in the SAME transaction as the application fact (no drift).
      tx.update(invoiceRef, { appliedMinor: invoicePatch.appliedMinor, outstandingMinor: invoicePatch.outstandingMinor, state: invoicePatch.state, updatedAt: FieldValue.serverTimestamp() });

      stageAuditEventWithId(tx, aid, {
        actorUid,
        action: "applyPayment",
        targetType: "payment",
        targetId: paymentRef.id,
        outcome: "applied",
        summary: `applied ${application.appliedAmountMinor} ${application.currency} to invoice ${data.invoiceId} (state ${invoicePatch.state}, outstanding ${invoicePatch.outstandingMinor})`,
      });
      return {
        success: true as const,
        replayed: false as const,
        paymentId: paymentRef.id,
        applicationId: applicationRef.id,
        invoiceState: invoicePatch.state,
        outstandingMinor: invoicePatch.outstandingMinor,
      };
    });
  } catch (err) {
    throw mapCommandError(err);
  }
});
