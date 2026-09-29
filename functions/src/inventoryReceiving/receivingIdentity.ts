// RECEIPT IDENTITY AND REQUEST FINGERPRINT -- the pure derivations, in one place.
//
// EXTRACTED, NOT REWRITTEN. Every function here moved verbatim out of `receivingRepository.ts`,
// which imports `firebase-admin/firestore` for its Timestamp handling. The PostgreSQL receiving
// authority needs the SAME derivations and must not carry a Firebase dependency to get them, and
// the one thing that must never happen is two implementations of "which receipt is this" -- a
// second, subtly different hash would make a genuine retry apply twice.
//
// So the derivations live here, with no imports beyond node:crypto, and `receivingRepository.ts`
// re-exports them. Every existing caller and test is unaffected.

import { createHash } from "node:crypto";

/** Key-sorted encoding, so an identity can never depend on property insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// 16-hex fingerprint over the request-derived value only (not the server-authored actor/timestamps):
// replay iff equal, conflict iff not (mirrors the ledger/truck-registry precedent).
export function fingerprintReceivingOrder(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}

// LEGACY receipt identity: deterministic and path-safe, derived from the caller idempotencyKey ALONE.
//
// PRESERVED EXACTLY, and deliberately not "fixed". Deployed callers already hold receipts at these
// ids, and changing the derivation would orphan every one of them -- a genuine retry would hash to a
// new id, find nothing, and RE-APPLY. Its narrowness is contained instead: legacy receipts are
// full-quantity, one-shot, and additionally serialized by the source transition the command
// performs, so a key reused across two legacy purchase orders is caught by that transition rather
// than silently replayed.
//
// THE POSTGRESQL AUTHORITY USES THIS SAME DERIVATION, deliberately. Owner ruling: preserve existing
// semantics per source authority, and do not silently promote the legacy chain to the canonical
// target-scoped identity.
export function receivingOrderDocId(idempotencyKey: string): string {
  return "rcv_" + createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40);
}

export interface CanonicalReceivingNamespace {
  readonly operation: "receiveInventoryStock";
  readonly sourceType: string;
  readonly purchaseOrderId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

/**
 * CANONICAL receipt identity -- TARGET-SCOPED, not key-scoped.
 *
 * The `rcvc_` prefix is what makes the legacy and canonical namespaces PROVABLY disjoint while
 * sharing one collection: a canonical id can never equal a legacy id, whatever the inputs.
 */
export function canonicalReceivingOrderDocId(ns: CanonicalReceivingNamespace): string {
  return "rcvc_" + createHash("sha256").update(canonicalJson(ns)).digest("hex").slice(0, 40);
}

/** Either namespace's id shape. */
export const RECEIVING_ID_RE = /^rcvc?_[0-9a-f]{40}$/;

// ════════════════════ PER-MOVEMENT REPLAY KEYS ════════════════════
//
// Collision-free deterministic idempotency keys for the inventory movements one receipt stages.
// Both hash a JSON TUPLE -- JSON quoting makes the components unambiguous, unlike raw delimiter
// concatenation, so no pair of (receiptId, lineId) can collide with another by containing the
// delimiter.
//
// SHARED BY BOTH AUTHORITIES. The Firestore receiving command and the PostgreSQL receiving command
// derive movement replay keys from the same function, so a movement written by one is recognized as
// the same movement by the other. Two derivations here would mean a retry after the cutover
// double-posts stock, which is the worst available outcome for an inventory ledger.

/** One movement per NONE-tracked receipt line. */
export function receiptLineMovementIdempotencyKey(receivingId: string, lineId: string): string {
  return "recvln_" + createHash("sha256").update(JSON.stringify([receivingId, lineId])).digest("hex").slice(0, 40);
}

/**
 * One movement PER UNIT for a SERIAL-tracked receipt line.
 *
 * Not a choice either authority makes: the ledger requires quantity 1 and a serial number for a
 * SERIAL part, so each unit is its own movement and therefore needs its own key.
 */
export function receiptSerialMovementIdempotencyKey(receivingId: string, lineId: string, serialNo: string): string {
  return "recvsn_" + createHash("sha256").update(JSON.stringify([receivingId, lineId, serialNo])).digest("hex").slice(0, 40);
}
