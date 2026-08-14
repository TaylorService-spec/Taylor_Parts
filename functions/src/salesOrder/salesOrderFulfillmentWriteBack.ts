// P1.1 (Sales->Cash fulfillment spine) -- PURE governed write-back core (framework-independent; unit-tested,
// no Firestore/firebase-functions imports). Computes the next Sales Order `lines` array when a Work Order
// Complete accepts fulfillment against it.
//
// Owner-ratified decisions (docs/design/p1-fulfillment-billing-spine-spec.md):
//   - fulfilledQty is ADDITIVE across partial fulfillments -- never inferred, never decremented.
//   - Matching is by (ref,kind), NOT bare ref -- a bare-ref match is the P1.7 find()-by-ref bug class (two
//     lines with the same ref but different kind would silently collide on the wrong one).
//   - Overage FAILS CLOSED: if an acceptance's qty would push fulfilledQty past orderedQty, this throws --
//     no silent cap, no clamp, no placeholder. The governed overage/additional-part path is a separate,
//     later build (decision #2).
//   - An acceptance with no matching (ref,kind) line is NOT applied (and does not throw) -- it is returned in
//     `unmatched` so the caller can decide what that means (e.g. a Work Order used a part that isn't an SO
//     line at all, which is not itself an SO-fulfillment event).

export type FulfillmentWriteBackErrorCode = "INVALID" | "QTY_INVALID" | "OVERAGE";

export class FulfillmentWriteBackError extends Error {
  code: FulfillmentWriteBackErrorCode;
  constructor(code: FulfillmentWriteBackErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "FulfillmentWriteBackError";
  }
}

export interface SalesOrderFulfillmentLine {
  kind: string;
  ref: string;
  orderedQty: number;
  fulfilledQty?: number;
  // Other SO line fields (allocatedQty, unitPrice, ...) pass through unchanged -- this module only ever
  // touches `fulfilledQty` on a matched line.
  [key: string]: unknown;
}

export interface FulfillmentAcceptance {
  ref: string;
  kind: string;
  qty: number;
}

export interface ApplyFulfillmentAcceptanceResult {
  nextLines: SalesOrderFulfillmentLine[];
  // Keyed "kind:ref" -- the total qty actually applied to that line across all acceptances passed in this call.
  appliedByRef: Record<string, number>;
  // Acceptances that matched no (ref,kind) line on `currentLines` -- not applied, not an error.
  unmatched: FulfillmentAcceptance[];
}

function keyOf(kind: string, ref: string): string {
  return `${kind}:${ref}`;
}

// Additive increment of fulfilledQty per (ref,kind)-matched line. Never mutates its inputs. Fail-closed on
// overage (acceptance.qty > remainingQty for that line) -- throws FulfillmentWriteBackError("OVERAGE") so the
// caller's transaction aborts rather than silently capping or fabricating a value.
export function applyFulfillmentAcceptance(
  currentLines: SalesOrderFulfillmentLine[] | undefined,
  acceptances: FulfillmentAcceptance[]
): ApplyFulfillmentAcceptanceResult {
  const lines = (Array.isArray(currentLines) ? currentLines : []).map((l) => ({ ...l }));
  const appliedByRef: Record<string, number> = {};
  const unmatched: FulfillmentAcceptance[] = [];

  for (const acc of Array.isArray(acceptances) ? acceptances : []) {
    if (!acc || typeof acc !== "object" || typeof acc.ref !== "string" || acc.ref.trim().length === 0 || typeof acc.kind !== "string" || acc.kind.trim().length === 0) {
      throw new FulfillmentWriteBackError("INVALID", "Each acceptance requires a non-empty ref and kind.");
    }
    if (typeof acc.qty !== "number" || !Number.isFinite(acc.qty) || acc.qty <= 0) {
      throw new FulfillmentWriteBackError("QTY_INVALID", `Acceptance qty must be a positive number for ref "${acc.ref}" kind "${acc.kind}".`);
    }

    const idx = lines.findIndex((l) => l.ref === acc.ref && l.kind === acc.kind);
    if (idx === -1) {
      unmatched.push(acc);
      continue;
    }

    const line = lines[idx];
    const orderedQty = typeof line.orderedQty === "number" ? line.orderedQty : 0;
    const priorFulfilled = typeof line.fulfilledQty === "number" ? line.fulfilledQty : 0;
    const remainingQty = orderedQty - priorFulfilled;
    if (acc.qty > remainingQty) {
      throw new FulfillmentWriteBackError(
        "OVERAGE",
        `Acceptance qty ${acc.qty} exceeds remaining ${remainingQty} for line ref "${acc.ref}" kind "${acc.kind}" (orderedQty=${orderedQty}, fulfilledQty=${priorFulfilled}).`
      );
    }

    lines[idx] = { ...line, fulfilledQty: priorFulfilled + acc.qty };
    const key = keyOf(acc.kind, acc.ref);
    appliedByRef[key] = (appliedByRef[key] ?? 0) + acc.qty;
  }

  return { nextLines: lines, appliedByRef, unmatched };
}
