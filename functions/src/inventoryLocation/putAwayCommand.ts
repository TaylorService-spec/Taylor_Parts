// PUT-AWAY — recording WHERE stock was stowed, without changing WHAT there is.
//
// ============================ THE LOAD-BEARING INVARIANT ============================
//
// DECISIONS #116: the warehouse is the inventory custody authority; a bin is a descriptive physical
// sub-location. **PUTTING STOCK INTO A BIN MUST NOT REMOVE IT FROM WAREHOUSE ON-HAND OR AVAILABLE.**
//
// Every governed authority — availability, receiving, transfer, cycle count — counts a movement only
// at `type === "WAREHOUSE"`. If put-away wrote a ledger event moving stock to a BIN, the moment a
// receipt was stowed it would disappear from sellable on-hand, from transfer sufficiency and from
// cycle-count expected quantity. That is precisely the failure #116 was decided to prevent.
//
// So this command writes a PLACEMENT RECORD and NOTHING ELSE. It writes no ledger event, changes no
// quantity, and touches no balance. A test asserts the module never imports the ledger, a movement
// type, or any balance function — because a comment promising it is not enough.
//
// ============================ PLACEMENT IS AN EVENT, NOT A BALANCE ============================
//
// A bin is not a custody location, so there is no authoritative "how many are in A-14". What IS
// authoritative is what somebody recorded doing: "on this date, N units of PRT-1001 were stowed in
// A-14". Placements are therefore append-only EVENTS, and any "where is it" answer is explicitly
// "where it was last put", not "what is there now".
//
// That limitation is the honest cost of #116 and is stated in the docs rather than papered over. If
// warehouse operations later need bin-level accuracy, that is the separate custody decision the
// assessment already frames — not something to smuggle in here by accumulating a balance.
//
// ============================ SERIALIZED UNITS ARE PLACED INDIVIDUALLY ============================
//
// A serialized unit has its own place. Each serial gets its own placement record, so "where is
// SN-42" has a single answer rather than "somewhere among the twelve we stowed that day".
//
// ============================ NO QUARANTINE ============================
//
// DECISIONS #117: quarantine and inspection are excluded from initial put-away and stay a future
// explicit workflow. This command records placement. It does not classify condition, does not hold
// stock pending inspection, and does not gate availability.

import type { Firestore, Transaction } from "firebase-admin/firestore";
import { SERIALIZED_ASSETS_COLLECTION } from "../constants/collections.js";
import { BINS_COLLECTION } from "./binCommands.js";
import { deriveBinDocId, normalizeBinCode, resolveBin } from "./binRegistry.js";

export const BIN_PLACEMENTS_COLLECTION = "bin_placements";

/**
 * The capability that authorizes recording a placement.
 *
 * SEPARATE from `inventory.location.bin.manage` (labelling racking) and from
 * `inventory.location.bin.read` (checking a bin is real): stowing stock is a third audience again.
 * A warehouse operator stows all day and should never be able to retire a rack.
 *
 * Also separate from `inventory.stock.receive`: receiving is a custody event that changes what the
 * company has; put-away only says where it went. Reusing the receive capability would make every
 * stow look like an authority to accept stock.
 */
export const PLACEMENT_RECORD_CAPABILITY = "inventory.placement.record";

export class PlacementInvalidError extends Error {}
export class PlacementUnauthorizedError extends Error {}
export class PlacementBinError extends Error {
  constructor(public readonly resolution: string) { super(resolution); }
}

export interface PutAwayDeps {
  readonly db: Firestore;
  readonly actor: { readonly kind: "USER" | "SYSTEM"; readonly id: string };
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly now: () => Date;
}

export interface PlacementOutcome {
  readonly outcome: "recorded" | "replayed";
  readonly placementIds: readonly string[];
  readonly warehouseId: string;
  readonly binCode: string;
  readonly partId: string;
  /** Quantity placed for a NONE-mode part; null for serialized, where the serials are the answer. */
  readonly quantity: number | null;
  readonly serialNumbers: readonly string[];
}

const isNonBlank = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * The deterministic placement id.
 *
 * Derived from the idempotency key plus the SERIAL (or the part, for a quantity placement), so a
 * retried submission of the same stow writes the same documents rather than doubling the record. A
 * placement is not a balance, but a duplicated placement would still make "where was it last put"
 * ambiguous, and a warehouse phone on a bad connection retries.
 */
export function derivePlacementId(idempotencyKey: string, discriminator: string): string {
  return `plc_${idempotencyKey}__${discriminator}`;
}

interface PutAwayRequest {
  readonly warehouseId: string;
  readonly binCode: string;
  readonly partId: string;
  readonly quantity?: number;
  readonly serialNumbers?: readonly string[];
  readonly idempotencyKey: string;
  /**
   * The demand this placement was gathered FOR, when it is a pick rather than a stow (Phase M).
   *
   * A pick is the same act as a put-away — stock moving to a place inside the warehouse it already
   * belongs to — with one extra fact: why it went there. So it is the same record with a tag, not a
   * second command with its own idea of what a placement is.
   *
   * IT STILL RESERVES NOTHING. Reservation is a Work Order LIFECYCLE effect (DISPATCHED ->
   * reserveParts), not an operator action, and picking does not pre-empt it.
   */
  readonly pickedForWorkOrderId?: string;
  /**
   * An operator's exception note (Phase N): why this stow or pick was not routine.
   *
   * FREE TEXT, STORED AS WRITTEN. It is never parsed, matched or acted on — a note explains a
   * placement to the next human, and giving it meaning to the system would make what someone typed
   * into an input the system obeys.
   */
  readonly note?: string;
}

/** Long enough for a real explanation; short enough that it is a note and not a document. */
export const MAX_PLACEMENT_NOTE = 500;

/** Shape validation only. What is TRUE about the bin and the serials is checked in the transaction. */
export function validatePutAwayRequest(input: unknown): { valid: true; value: PutAwayRequest } | { valid: false; reason: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false, reason: "not_object" };
  const d = input as Record<string, unknown>;

  if (!isNonBlank(d.warehouseId)) return { valid: false, reason: "warehouse_required" };
  if (!isNonBlank(d.partId)) return { valid: false, reason: "part_required" };
  if (!isNonBlank(d.idempotencyKey)) return { valid: false, reason: "idempotency_key_required" };

  const binCode = normalizeBinCode(d.binCode);
  if (!binCode.valid) return { valid: false, reason: binCode.reason };

  let note: string | undefined;
  if (d.note !== undefined && d.note !== null) {
    if (typeof d.note !== "string") return { valid: false, reason: "note_invalid" };
    const trimmed = d.note.trim();
    // Refused, never truncated: silently cutting an explanation in half is worse than not taking it.
    if (trimmed.length > MAX_PLACEMENT_NOTE) return { valid: false, reason: "note_too_long" };
    if (trimmed !== "") note = trimmed;
  }

  const hasSerials = d.serialNumbers !== undefined;
  const hasQuantity = d.quantity !== undefined;

  // EXACTLY ONE shape. A request carrying both is ambiguous about what was actually stowed, and
  // guessing which the caller meant is how a serialized unit ends up recorded as bulk.
  if (hasSerials === hasQuantity) return { valid: false, reason: "quantity_or_serials_required" };

  if (hasSerials) {
    if (!Array.isArray(d.serialNumbers) || d.serialNumbers.length === 0) return { valid: false, reason: "serials_invalid" };
    if (!d.serialNumbers.every(isNonBlank)) return { valid: false, reason: "serials_invalid" };
    const seen = new Set(d.serialNumbers.map((s) => (s as string).trim().toLowerCase()));
    if (seen.size !== d.serialNumbers.length) return { valid: false, reason: "serials_duplicated" };
    return {
      valid: true,
      value: {
        warehouseId: d.warehouseId, partId: d.partId, idempotencyKey: d.idempotencyKey,
        binCode: binCode.value.code,
        serialNumbers: (d.serialNumbers as string[]).map((s) => s.trim()),
        ...(isNonBlank(d.pickedForWorkOrderId) ? { pickedForWorkOrderId: d.pickedForWorkOrderId.trim() } : {}),
        ...(note !== undefined ? { note } : {}),
      },
    };
  }

  if (typeof d.quantity !== "number" || !Number.isInteger(d.quantity) || d.quantity <= 0) {
    return { valid: false, reason: "quantity_invalid" };
  }
  return {
    valid: true,
    value: {
      warehouseId: d.warehouseId, partId: d.partId, idempotencyKey: d.idempotencyKey,
      binCode: binCode.value.code, quantity: d.quantity,
      ...(isNonBlank(d.pickedForWorkOrderId) ? { pickedForWorkOrderId: d.pickedForWorkOrderId.trim() } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  };
}

/**
 * Record a put-away.
 *
 * One transaction, so a stow is recorded whole or not at all. Idempotent by derived id: a retry
 * finds the placements already written and reports `replayed`.
 */
export async function recordPutAway(request: unknown, deps: PutAwayDeps): Promise<PlacementOutcome> {
  const validated = validatePutAwayRequest(request);
  if (!validated.valid) throw new PlacementInvalidError(validated.reason);
  const req = validated.value;

  return deps.db.runTransaction(async (txn) => {
    if (!(await deps.authorize(txn, deps.actor.id, PLACEMENT_RECORD_CAPABILITY))) {
      throw new PlacementUnauthorizedError();
    }

    // THE BIN MUST BE REAL, ACTIVE, AND AT THIS WAREHOUSE — read inside the transaction, so a bin
    // retired mid-stow cannot be stowed into.
    const binId = deriveBinDocId(req.warehouseId, req.binCode);
    const binSnap = await txn.get(deps.db.collection(BINS_COLLECTION).doc(binId));
    const resolution = resolveBin(req.binCode, req.warehouseId, binSnap.exists ? (binSnap.data() ?? null) : null);
    if (resolution.result !== "FOUND") throw new PlacementBinError(resolution.result);

    const serials = req.serialNumbers ?? [];

    // A SERIAL must be a real unit of THIS part. Recording a placement for a serial that belongs to
    // another part would make "where is SN-42" answer with the wrong shelf for the wrong thing.
    for (const serialNo of serials) {
      const assetSnap = await txn.get(
        deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(`${req.partId}__${serialNo}`),
      );
      if (!assetSnap.exists) {
        // Fall back to a query-free second convention before refusing: some registries key by serial
        // alone. Refusing a real unit because of a doc-id convention would block honest work.
        const bySerial = await txn.get(deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(serialNo));
        if (!bySerial.exists) throw new PlacementInvalidError("serial_unknown");
        if (bySerial.data()?.partId !== req.partId) throw new PlacementInvalidError("serial_wrong_part");
      } else if (assetSnap.data()?.partId !== req.partId) {
        throw new PlacementInvalidError("serial_wrong_part");
      }
    }

    const now = deps.now();
    const base = {
      warehouseId: req.warehouseId,
      binId,
      binCode: req.binCode,
      partId: req.partId,
      placedAt: now,
      placedBy: deps.actor.id,
      idempotencyKey: req.idempotencyKey,
      // Present only on a PICK. Its absence is what makes a record a plain stow, so it is written
      // as null rather than omitted -- a missing field and a deliberate "not picked for anything"
      // must not be the same thing to a later reader.
      pickedForWorkOrderId: req.pickedForWorkOrderId ?? null,
      // Stored as written. Null rather than omitted, so "no note" is a fact rather than an absence.
      note: req.note ?? null,
      schemaVersion: 1,
    };

    // One record per SERIAL, because a serialized unit has its own place. One record for a quantity
    // stow, because bulk does not.
    const entries = serials.length > 0
      ? serials.map((serialNo) => ({
          id: derivePlacementId(req.idempotencyKey, serialNo),
          data: { ...base, serialNo, quantity: 1 },
        }))
      : [{
          id: derivePlacementId(req.idempotencyKey, req.partId),
          data: { ...base, serialNo: null, quantity: req.quantity ?? 0 },
        }];

    const existing = await Promise.all(
      entries.map((e) => txn.get(deps.db.collection(BIN_PLACEMENTS_COLLECTION).doc(e.id))),
    );
    const allPresent = existing.every((s) => s.exists);
    if (allPresent) {
      return {
        outcome: "replayed" as const,
        placementIds: entries.map((e) => e.id),
        warehouseId: req.warehouseId,
        binCode: req.binCode,
        partId: req.partId,
        quantity: serials.length > 0 ? null : (req.quantity ?? 0),
        serialNumbers: serials,
      };
    }

    entries.forEach((e, i) => {
      // A partially-written retry completes rather than conflicting: the ids are derived, so writing
      // the missing half produces exactly the record a clean run would have.
      if (!existing[i].exists) txn.create(deps.db.collection(BIN_PLACEMENTS_COLLECTION).doc(e.id), e.data);
    });

    return {
      outcome: "recorded" as const,
      placementIds: entries.map((e) => e.id),
      warehouseId: req.warehouseId,
      binCode: req.binCode,
      partId: req.partId,
      quantity: serials.length > 0 ? null : (req.quantity ?? 0),
      serialNumbers: serials,
    };
  });
}
