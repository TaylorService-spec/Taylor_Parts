// Finance — governed invoice ISSUANCE callable (thin onCall over the pure command core). Supplies only I/O +
// auth + the trusted transaction:
//   • actor identity from request.auth.uid (never trusted from the payload);
//   • authorization = capability `finance.invoice.issue`, resolved fail-closed via the trusted effective-access
//     feed; registered active:false ⇒ hard DENY for everyone until a separate Owner grant;
//   • the transaction allocates a per-company invoice number (concurrency-safe), writes the immutable ISSUED
//     invoice via the Admin SDK, and stages an append-only AUDIT event (Finance is sensitive/audited);
//   • idempotency: a deterministic audit id makes a retried issuance a no-op replay (no duplicate invoice /
//     no burned sequence number).
// firestore.rules denies ALL direct client access to `invoices`, so this trusted command is the only write
// path. EXPORT != DEPLOY, REGISTER != GRANT, MERGE != ACTIVATION.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { INVOICES_COLLECTION, SALES_ORDERS_COLLECTION } from "../constants/collections";
import { stageAuditEventWithId, auditEventDocRef } from "../access/auditEventWriter";
import { allocateInvoiceNumber } from "./invoiceNumbering";
import {
  buildInvoiceRecord,
  applyBilledQuantities,
  verifySalesOrderMatch,
  InvoiceCommandError,
  type IssueInvoiceInput,
  type SalesOrderSnapshot,
} from "./invoiceCommands";

export const FINANCE_INVOICE_ISSUE_CAPABILITY = "finance.invoice.issue";

function mapCommandError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof InvoiceCommandError) {
    switch (err.code) {
      case "NOT_BILLABLE":
      case "TAX_REQUIRES_REVIEW":
      case "UNPRICED":
        return new HttpsError("failed-precondition", err.message);
      default:
        return new HttpsError("invalid-argument", err.message);
    }
  }
  return new HttpsError("internal", "Invoice issuance failed.");
}

async function requireInvoiceIssue(uid: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [FINANCE_INVOICE_ISSUE_CAPABILITY] });
    allowed = decisions[FINANCE_INVOICE_ISSUE_CAPABILITY] === true;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to issue invoices.");
}

const auditId = (actorUid: string, salesOrderId: string, idempotencyKey: string): string =>
  `issueInvoice_${createHash("sha256").update(`${actorUid}|${salesOrderId}|${idempotencyKey}`).digest("hex").slice(0, 40)}`;

interface IssueInvoiceRequest extends IssueInvoiceInput {
  idempotencyKey: string;
}

// Transactional core of issueInvoice, exported so tests can exercise the SO cross-check + idempotency
// invariant directly (below the capability gate — finance.invoice.issue is registered active:false, a hard
// deny for everyone until a separate Owner grant), exactly the pattern persistTransitionedSalesOrder already
// established in salesOrderCallables.ts. Reads the GOVERNED Sales Order inside the transaction — the client's
// own claims (unitPrice, qty, accountId, currency) are never trusted; they are cross-checked against this
// snapshot via verifySalesOrderMatch before amounts are recomputed.
export async function persistIssuedInvoice(db: Firestore, tx: Transaction, data: IssueInvoiceRequest, actorUid: string) {
  const aid = auditId(actorUid, data.salesOrderId, data.idempotencyKey);
  // Idempotency / replay: a prior audit event at this id means this exact issuance already applied.
  const prior = await tx.get(auditEventDocRef(aid));
  if (prior.exists) {
    const d = prior.data() ?? {};
    // Replay: the invoice was already issued for this idempotency key — return its canonical id, do not
    // re-issue or burn a new sequence number.
    return { success: true as const, replayed: true as const, invoiceId: (d.targetId as string) ?? null };
  }
  const soSnap = await tx.get(db.collection(SALES_ORDERS_COLLECTION).doc(data.salesOrderId));
  if (!soSnap.exists) {
    throw new HttpsError("failed-precondition", `No Sales Order with id ${data.salesOrderId}`);
  }
  const salesOrder = soSnap.data() as SalesOrderSnapshot;
  const nextLines = applyBilledQuantities(data, salesOrder);

  // Allocate the per-company number INSIDE the transaction (concurrency-safe; never reused).
  const allocated = await allocateInvoiceNumber(tx, data.companyId);
  const record = buildInvoiceRecord(data, { invoiceNumber: allocated.invoiceNumber, sequence: allocated.sequence, nowMillis: Date.now() });
  const invoiceRef = db.collection(INVOICES_COLLECTION).doc(); // canonical opaque identity, distinct from the number
  tx.update(soSnap.ref, { lines: nextLines, updatedAt: FieldValue.serverTimestamp() });
  tx.set(invoiceRef, { ...record, issuedAt: FieldValue.serverTimestamp() });
  stageAuditEventWithId(tx, aid, {
    actorUid,
    action: "issueInvoice",
    targetType: "invoice",
    targetId: invoiceRef.id,
    outcome: "applied",
    summary: `issued invoice ${record.invoiceNumber} for salesOrder ${record.salesOrderId} total=${record.totalMinor} ${record.currency}`,
  });
  return { success: true as const, replayed: false as const, invoiceId: invoiceRef.id, invoiceNumber: record.invoiceNumber, totalMinor: record.totalMinor };
}

// Issue an invoice for a Sales Order's billable lines. The server RE-COMPUTES authoritative amounts (integer
// minor units) from the committed unit-price snapshot + injected tax determination and fails closed on any
// gap; the client never supplies the invoice number, the total, or the tax authority.
export const issueInvoice = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be signed in.");
  await requireInvoiceIssue(request.auth.uid);

  const data = (request.data ?? {}) as IssueInvoiceRequest;
  if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.trim().length === 0) {
    throw new HttpsError("invalid-argument", "idempotencyKey is required.");
  }
  if (typeof data.salesOrderId !== "string" || data.salesOrderId.trim().length === 0) {
    throw new HttpsError("invalid-argument", "salesOrderId is required.");
  }
  const actorUid = request.auth.uid;
  const db = getFirestore();

  try {
    return await db.runTransaction((tx) => persistIssuedInvoice(db, tx, data, actorUid));
  } catch (err) {
    throw mapCommandError(err);
  }
});
