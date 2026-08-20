// Receiving BATCH validation — one submission, one purchase order, one or more lines.
//
// This is the single validation path both transports converge on (§9). The legacy transport reaches
// it through an adapter that shapes its one line into a batch; the canonical transport reaches it
// directly. There is exactly one implementation of "is this receipt allowed", so the two cannot drift
// into disagreeing.
//
// EVERYTHING PASSES BEFORE ANYTHING IS WRITTEN. This returns a validated value or throws; the caller
// performs no write until it returns. That ordering — not cleanup afterwards — is what makes a
// rejected batch leave zero inventory, ledger, serialized-asset and audit effects.
//
// OVER-RECEIPT IS MEASURED AGAINST REMAINING, NEVER ORDERED. A line ordered 10 and already received 7
// has 3 remaining; receiving 5 is an over-receipt even though 5 < 10. Measuring against ordered would
// let repeated partial receipts sum past the order.

import { validateLocationRef, isPlainObject, isNonEmptyString } from "../inventoryLedger/operationalMovementValidation.js";
import {
  RECEIVING_SUPPORTED_TRACKING_MODES,
  RECEIVING_LINE_STATUS,
  RECEIVING_INITIAL_VERSION,
  LEGACY_SOURCE_TYPE,
  type ReceivingLineTrackingMode,
  type ReceivingLineValue,
  type ReceivingOrderValue,
  type ReceivingSourceType,
} from "./receivingTypes.js";
import type { ResolvedReceivingSource } from "./receivingSourceResolver.js";
import type { DerivedLine } from "../purchasing/purchaseOrderNormalization.js";

/** A Part as the trusted Part authority resolved it. */
export interface ResolvedPartAuthority {
  readonly partId: string;
  readonly trackingMode: string;
  readonly active: boolean;
}

export type BatchValidationResult =
  | { readonly valid: true; readonly value: ReceivingOrderValue }
  | { readonly valid: false; readonly reason: string; readonly lineId: string | null };

const fail = (reason: string, lineId: string | null = null): BatchValidationResult => ({ valid: false, reason, lineId });

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0;

const ALLOWED_TOP_KEYS = new Set(["source", "receivingLocation", "lines", "idempotencyKey", "expectedVersion"]);
// `expectedQuantity` is OPTIONAL and is the caller's CLAIM about what remained, not the source of
// truth. The legacy transport sends it and its original validator required it to equal the ordered
// quantity; simply dropping it in the adapter would silently accept a caller whose belief about the
// outstanding amount was wrong. So it is accepted, and checked against the server-derived remaining.
const ALLOWED_LINE_KEYS = new Set(["lineId", "partId", "receivedQuantity", "expectedQuantity", "serialNumbers"]);

export interface BatchValidationContext {
  readonly resolved: ResolvedReceivingSource;
  /** Every distinct partId on the submitted lines, as the Part authority resolved it. */
  readonly partsByPartId: ReadonlyMap<string, ResolvedPartAuthority>;
}

/**
 * Validate a canonical receipt batch.
 *
 * The submitted line carries NO expectedQuantity: what remains is a SERVER fact derived from
 * committed receipts, and accepting a client's opinion of it would let a caller widen its own limit.
 * The stored line's `expectedQuantity` is set from the derived remaining, so the receipt records what
 * was actually outstanding when it was taken.
 */
export function validateReceivingBatch(input: unknown, ctx: BatchValidationContext): BatchValidationResult {
  if (!isPlainObject(input)) return fail("not_object");
  if (Object.keys(input).some((k) => !ALLOWED_TOP_KEYS.has(k))) return fail("unknown_field");
  if (!isNonEmptyString(input.idempotencyKey)) return fail("idempotency_key_invalid");

  const receivingLocation = validateLocationRef(input.receivingLocation);
  if (receivingLocation === null) return fail("receiving_location_invalid");

  const { resolved, partsByPartId } = ctx;

  // OPTIMISTIC CONCURRENCY, when the caller states a version. Checked here rather than only relied on
  // through the transaction abort: a caller that loaded the PO, thought about it, and submitted
  // against a version that has since moved should be told so, not silently applied against newer
  // state it never saw.
  if (input.expectedVersion !== undefined) {
    if (typeof input.expectedVersion !== "number" || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
      return fail("expected_version_invalid");
    }
    if (input.expectedVersion !== resolved.version) return fail("version_conflict");
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) return fail("lines_invalid");

  const derivedByLineId = new Map<string, DerivedLine>(resolved.derived.lines.map((l) => [l.lineId, l]));
  const seen = new Set<string>();
  const validatedLines: ReceivingLineValue[] = [];

  for (const raw of input.lines) {
    if (!isPlainObject(raw)) return fail("line_invalid");
    const line = raw as Record<string, unknown>;
    // Server-authored and derived fields are rejected on the way in -- a caller cannot declare its own
    // expectedQuantity, status or trackingMode.
    if (Object.keys(line).some((k) => !ALLOWED_LINE_KEYS.has(k))) return fail("line_unknown_field");
    if (!isNonEmptyString(line.lineId)) return fail("line_id_invalid");
    const lineId = line.lineId as string;

    // DUPLICATE SUBMITTED LINE. Two entries for one PO line make the intended quantity ambiguous, and
    // summing them would pick an answer nobody asked for.
    if (seen.has(lineId)) return fail("line_duplicate", lineId);
    seen.add(lineId);

    // BELONGS TO THIS PO. Not "exists somewhere" -- exists on the order being received.
    //
    // LEGACY LINE IDENTITY IS CLIENT-SUPPLIED, and must stay that way. A legacy purchase order is one
    // part by construction, so it normalizes to the single line "L1" -- but deployed callers generate
    // their own line label and have always been free to, because with exactly one line there was
    // never any ambiguity about which line was meant. Requiring "L1" would reject every deployed
    // client, so a legacy receipt resolves to that one line WHATEVER it is called, and the caller's
    // own label is preserved in the stored receipt and in the derived ledger idempotency key exactly
    // as it is today.
    //
    // Canonical receipts get no such latitude: a multi-line order has several lines and the id is the
    // only thing distinguishing them, so an unrecognized id there is genuinely ambiguous and fails.
    const isLegacy = resolved.sourceType === LEGACY_SOURCE_TYPE;
    const target = isLegacy ? resolved.derived.lines[0] : derivedByLineId.get(lineId);
    if (target === undefined) return fail("line_unknown", lineId);
    // A legacy purchase order has exactly one line, so a legacy receipt naming two is incoherent
    // rather than merely unsupported -- both entries would resolve to the same line.
    if (isLegacy && (input.lines as unknown[]).length !== 1) return fail("legacy_line_count_invalid", lineId);

    if (!isNonEmptyString(line.partId)) return fail("line_part_id_invalid", lineId);
    // The submitted part must be the part the PO line is for. A receipt that names the right line and
    // the wrong part would move stock for something the order never covered.
    if (line.partId !== target.partId) return fail("part_mismatch", lineId);

    const part = partsByPartId.get(target.partId);
    if (part === undefined) return fail("part_unresolved", lineId);
    if (part.active !== true) return fail("part_inactive", lineId);
    if (part.partId !== target.partId) return fail("part_identity_incoherent", lineId);
    if (!(RECEIVING_SUPPORTED_TRACKING_MODES as readonly string[]).includes(part.trackingMode)) {
      return fail("tracking_mode_unsupported", lineId); // LOT still deferred, still fails closed
    }
    const trackingMode = part.trackingMode as ReceivingLineTrackingMode;

    // QUANTITY. Integer and positive -- zero is not a receipt and negative is not a quantity.
    if (!isPositiveInt(line.receivedQuantity)) return fail("quantity_invalid", lineId);
    const receivedQuantity = line.receivedQuantity as number;

    // ALREADY SATISFIED lines have zero remaining, so this is also the "receipt against a satisfied
    // line" rejection -- one rule, not two that could disagree.
    if (target.remainingQuantity <= 0) return fail("line_already_satisfied", lineId);
    if (receivedQuantity > target.remainingQuantity) return fail("over_receipt", lineId);

    // The caller's CLAIM about what remained, when it makes one. Checked rather than trusted or
    // ignored: a caller working from a stale view believes a different amount is outstanding, and
    // letting that pass silently would record a receipt against an order state that never existed.
    if (line.expectedQuantity !== undefined && line.expectedQuantity !== target.orderedQuantity) {
      return fail("expected_quantity_mismatch", lineId);
    }

    // LEGACY FULL-QUANTITY CONSTRAINT (§2). The adapter normalizes a legacy PO to line L1 so it can
    // share this path, but legacy documents are immutable and cannot carry cumulative state -- so a
    // partial legacy receipt would be unrepresentable and unfinishable. Enforced HERE, before commit,
    // rather than being left implicit in the adapter.
    if (isLegacy && receivedQuantity !== target.remainingQuantity) {
      return fail("legacy_partial_receipt_unsupported", lineId);
    }

    // SERIAL identity. Trimmed only -- case is manufacturer identity and is significant, and this is
    // the same comparison the registry's deterministic document id uses, so "accepted here" and
    // "unique there" cannot disagree.
    let serialNumbers: string[] | undefined;
    if (trackingMode === "SERIAL") {
      if (!Array.isArray(line.serialNumbers)) return fail("serial_numbers_missing", lineId);
      const trimmed: string[] = [];
      for (const s of line.serialNumbers) {
        if (!isNonEmptyString(s)) return fail("serial_number_invalid", lineId);
        trimmed.push((s as string).trim());
      }
      if (trimmed.length !== receivedQuantity) return fail("serial_count_mismatch", lineId);
      if (new Set(trimmed).size !== trimmed.length) return fail("serial_numbers_duplicated", lineId);
      serialNumbers = trimmed;
    } else if (line.serialNumbers !== undefined) {
      return fail("serial_numbers_not_allowed", lineId); // a NONE line carries no serial identity
    }

    validatedLines.push({
      lineId,
      partId: target.partId,
      trackingMode,
      // THE LINE'S ORDERED QUANTITY -- a server fact, never the caller's claim, and deliberately not
      // the REMAINING quantity.
      //
      // Remaining would have been the more descriptive value and it is wrong here, for a reason worth
      // stating: the receipt's fingerprint covers this value, and remaining legitimately CHANGES the
      // moment the receipt commits. An identical retry would then compute a different fingerprint and
      // be rejected as a payload conflict instead of replaying -- turning the idempotency mechanism
      // into the thing that breaks idempotency.
      //
      // Ordered quantity is stable for the life of the order, and it is also exactly what the legacy
      // contract meant by expectedQuantity (its validator required expected === ordered), so legacy
      // records keep their existing shape and fingerprint unchanged.
      expectedQuantity: target.orderedQuantity,
      receivedQuantity,
      status: RECEIVING_LINE_STATUS,
      ...(serialNumbers === undefined ? {} : { serialNumbers }),
    });
  }

  // A SERIAL cannot be repeated ACROSS lines within one batch either. Per-line uniqueness alone would
  // let one physical unit be received twice under two line ids, and the registry's create would then
  // fail mid-transaction rather than being refused up front.
  const allSerials = validatedLines.flatMap((l) => l.serialNumbers ?? []);
  if (new Set(allSerials).size !== allSerials.length) return fail("serial_numbers_duplicated_across_lines");

  const value: ReceivingOrderValue = {
    source: {
      type: resolved.sourceType as ReceivingSourceType,
      ...(resolved.reorderRequestId === undefined ? {} : { reorderRequestId: resolved.reorderRequestId }),
      purchaseOrderId: resolved.purchaseOrderId,
    },
    receivingLocation: { type: receivingLocation.type, locationId: receivingLocation.locationId },
    status: "PUTAWAY_COMPLETE",
    version: RECEIVING_INITIAL_VERSION,
    lines: validatedLines,
    idempotencyKey: input.idempotencyKey as string,
  };
  return { valid: true, value };
}
