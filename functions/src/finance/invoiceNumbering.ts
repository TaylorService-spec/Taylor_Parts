// Finance — transaction-safe, PER-COMPANY invoice number allocation (Owner §6). Mirrors the Work Order
// numbering pattern (woNumbering.ts): the counter is read and incremented inside the SAME transaction that
// writes the invoice, so Firestore's optimistic-concurrency retry makes concurrent issuance safe and a number
// is NEVER reused. The sequence authority is trusted + server-side; the human invoice number is derived from
// it but the invoice's canonical document identity stays separate (the Firestore doc id). Numbers are NOT
// derived from a Sales Order id, Work Order id, timestamp, or a client counter.
import type { Transaction, DocumentReference } from "firebase-admin/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { COUNTERS_COLLECTION } from "../constants/collections";

interface InvoiceCounterDoc {
  companyId: string;
  sequence: number;
  updatedAt: FirebaseFirestore.FieldValue;
}

// One counter document per company (keyed inside the already-Admin-SDK-only `counters` collection). Distinct
// from the Work Order year-counters; the key namespace prevents collision.
function invoiceCounterRef(companyId: string): DocumentReference {
  return getFirestore().collection(COUNTERS_COLLECTION).doc(`invoices_${companyId}`);
}

export interface AllocatedInvoiceNumber {
  invoiceNumber: string;
  sequence: number;
}

export class InvoiceNumberingError extends Error {
  constructor(message: string) { super(message); this.name = "InvoiceNumberingError"; }
}

// Default human presentation. Deployment-specific prefix/width can be layered later WITHOUT changing the
// canonical sequence or the immutable doc identity.
export function formatInvoiceNumber(sequence: number, { prefix = "INV-", width = 6 } = {}): string {
  return `${prefix}${String(sequence).padStart(width, "0")}`;
}

// Must be called with a transaction the caller already opened: exactly one read + one write on the company's
// counter, inside that transaction; commits nothing itself. Concurrency-safe by Firestore transaction retry.
export async function allocateInvoiceNumber(
  tx: Transaction,
  companyId: string,
  opts: { prefix?: string; width?: number } = {},
): Promise<AllocatedInvoiceNumber> {
  if (typeof companyId !== "string" || companyId.trim().length === 0) {
    throw new InvoiceNumberingError("companyId is required to allocate a per-company invoice number");
  }
  const ref = invoiceCounterRef(companyId);
  const snap = await tx.get(ref);
  const sequence = snap.exists ? (snap.data() as InvoiceCounterDoc).sequence + 1 : 1;
  tx.set(ref, { companyId, sequence, updatedAt: FieldValue.serverTimestamp() });
  return { invoiceNumber: formatInvoiceNumber(sequence, opts), sequence };
}
