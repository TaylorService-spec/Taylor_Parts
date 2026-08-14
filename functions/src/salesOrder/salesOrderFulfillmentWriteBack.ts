// P1.1 (Sales->Cash fulfillment spine) -- PURE governed write-back core (framework-independent; unit-tested,
// no Firestore/firebase-functions imports). Computes the next Sales Order `lines` array when a Work Order
// Complete accepts fulfillment against it.
//
// Owner-ratified decisions (docs/design/p1-fulfillment-billing-spine-spec.md):
//   - fulfilledQty is ADDITIVE across partial fulfillments -- never inferred, never decremented.
//   - Matching is PRIMARILY by the SO line's stable `lineId` (pass4 B-2), NOT (ref,kind) -- two SO lines can
//     legitimately share the same (ref,kind) (e.g. the same part ordered on two separate lines, a SUPPORTED
//     and tested scenario -- see allocateSalesOrderAllocation.test.mjs's duplicate-ref-lines coverage), and a
//     bare (ref,kind) match returns only the FIRST such line, so a summed acceptance gets checked against just
//     that one line's remainingQty -- a false OVERAGE that permanently deadlocks Complete on the Work Order.
//     When an acceptance carries a `lineId`, ONLY a line with that exact lineId can match (no (ref,kind)
//     fallback for it -- silently falling back would reintroduce the same collision). When an acceptance has
//     NO lineId (legacy Work Orders created before this field existed, or explicit non-PART declarations that
//     predate it), matching falls back to (ref,kind) exactly as before -- this is a purely additive change.
//   - Overage FAILS CLOSED: if an acceptance's qty would push fulfilledQty past orderedQty, this throws --
//     no silent cap, no clamp, no placeholder. The governed overage/additional-part path is a separate,
//     later build (decision #2).
//   - An acceptance with no matching line is NOT applied (and does not throw) -- it is returned in
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
  // Stable SO line identifier (pass4 B-2) -- the PRIMARY match key. Optional: legacy lines predating this
  // field fall back to (ref,kind) matching (see this file's header comment).
  lineId?: string;
  // Other SO line fields (allocatedQty, unitPrice, ...) pass through unchanged -- this module only ever
  // touches `fulfilledQty` on a matched line.
  [key: string]: unknown;
}

export interface FulfillmentAcceptance {
  ref: string;
  kind: string;
  qty: number;
  // pass4 B-2: when present, matching uses ONLY this (no ref/kind fallback) -- see header comment.
  lineId?: string;
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

// pass4 B-2: resolve which SO line an acceptance targets. A lineId-bearing acceptance matches ONLY the line
// with that exact lineId (never falls back to ref/kind -- see header comment on why a fallback would
// reintroduce the duplicate-ref collision). A lineId-less acceptance (legacy) matches by (ref,kind), exactly
// the pre-existing behavior.
function findMatchIndex(lines: SalesOrderFulfillmentLine[], acc: FulfillmentAcceptance): number {
  if (typeof acc.lineId === "string" && acc.lineId.trim().length > 0) {
    return lines.findIndex((l) => typeof l.lineId === "string" && l.lineId === acc.lineId);
  }
  return lines.findIndex((l) => l.ref === acc.ref && l.kind === acc.kind);
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

    const idx = findMatchIndex(lines, acc);
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
