// ACQUISITION — a specific serialized unit the company already owns, entering EOS without a purchase.
//
// ============================ THE ASYMMETRY THIS CLOSES ============================
//
// Quantity-tracked stock can already enter without a purchase order: an ADJUSTED movement sourced
// from an ADJUSTMENT says "we already hold 571 of these", and that is how the Certification World's
// opening balances exist at all.
//
// Serialized stock could not. `serialized_assets` had exactly one creator --
// buildSerializedAssetForReceipt, called only by receiveInventoryStockCommand -- and receiving accepts
// only REORDER_PURCHASE_ORDER or PURCHASE_ORDER. So the platform could say "we already own 571 of
// these" and could not say "we already own THIS machine" without inventing a purchase that never
// happened.
//
// ============================ WHY NOT JUST RECEIVE IT ============================
//
// Because it would be a lie with consequences. A receipt asserts a supplier delivered goods against
// an order: it advances that order's progress, contributes to receiving throughput, and leaves a
// receiving_orders record. Reporting would count an opening balance as this month's purchasing
// activity, and the fabricated order would sit in the world forever looking exactly like a real one.
//
// The same reasoning already produced the ADJUSTED/ADJUSTMENT opening-balance model for quantity
// stock. This is that decision applied to serialized units.
//
// ============================ WHAT IT IS NOT ============================
//
// Not purchasing, not receiving, not a return, not a transfer, not installation. It says one thing:
// this specific unit is already owned and is now under managed custody. It creates no Equipment, no
// customer relationship, and no purchasing history.
//
// It is deliberately NOT a general bypass around procurement -- every acquisition must name a reason
// from a closed set, and "we bought it" is not one of them.
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { SERIALIZED_ASSETS_COLLECTION } from "../constants/collections.js";
import { serializedAssetDocId } from "./serializedAssetRegistration.js";
import { projectSerializedAsset } from "./serializedAssetReadService.js";
import { SERIALIZED_ASSET_SCHEMA_VERSION } from "./types.js";
import type { SerializedAssetState } from "./types.js";

/** The capability this command requires. High trust: it creates owned inventory with no purchase. */
export const SERIALIZED_ASSET_ACQUIRE_CAPABILITY = "inventory.serializedAsset.acquire";

/**
 * Why a unit is entering EOS without a purchase order.
 *
 * A CLOSED SET, and the closure is the point. An open text field would make this command a general
 * way around procurement -- somebody types "purchase" and the distinction this whole module exists to
 * preserve is gone. Every value below describes a unit the company ALREADY owns:
 *
 *   OPENING_BALANCE      it was already on the floor when EOS started counting
 *   LEGACY_MIGRATION     it is being carried across from a prior system
 *   EXISTING_COMPANY_ASSET  owned equipment being brought under management for the first time
 *
 * Conspicuously absent: anything meaning "we bought it". A purchase is a receipt, and receipts have
 * their own authority.
 */
export const ACQUISITION_REASONS = Object.freeze([
  "OPENING_BALANCE",
  "LEGACY_MIGRATION",
  "EXISTING_COMPANY_ASSET",
] as const);
export type AcquisitionReason = (typeof ACQUISITION_REASONS)[number];

/**
 * The state an acquired unit starts in.
 *
 * AVAILABLE, not RECEIVED. RECEIVED means a delivery arrived at a dock and has not been put away --
 * a claim about an event that did not happen here. An already-owned unit under managed custody is
 * exactly what AVAILABLE describes.
 */
export const ACQUIRED_INITIAL_STATE: SerializedAssetState = "AVAILABLE";

/** Marks the asset's origin forever, so no report can mistake it for purchasing activity. */
export const ACQUISITION_PROVENANCE = "NON_PO_ACQUISITION";

export type AcquireFailureCode =
  | "PERMISSION_DENIED"
  | "REQUEST_INVALID"
  | "PART_NOT_FOUND"
  | "PART_NOT_SERIALIZED"
  | "LOCATION_INVALID"
  | "ALREADY_EXISTS_CONFLICT"
  | "ACQUIRE_INTEGRITY";

export class AcquireCommandError extends Error {
  readonly code: AcquireFailureCode;
  constructor(code: AcquireFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = "AcquireCommandError";
  }
}

export interface AcquireActor { readonly kind: "USER" | "SYSTEM"; readonly id: string; }

export interface AcquireAuditInput {
  readonly actorId: string;
  readonly serializedAssetId: string;
  readonly partId: string;
  readonly serialNo: string;
  readonly locationId: string;
  readonly reason: AcquisitionReason;
  readonly provenanceNote: string | null;
}

export interface ResolvedAcquirePart {
  readonly partId: string;
  readonly trackingMode: string;
  readonly active: boolean;
}

export interface AcquireCommandDeps {
  readonly db: Firestore;
  readonly actor: AcquireActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedAcquirePart | null>;
  readonly resolveLocationActive: (txn: Transaction, locationId: string) => Promise<boolean>;
  readonly stageAudit: (txn: Transaction, audit: AcquireAuditInput) => void;
  readonly now: () => Date;
}

export interface AcquireOutcome {
  readonly outcome: "acquired" | "replayed";
  readonly serializedAssetId: string;
  readonly partId: string;
  readonly serialNo: string;
  readonly locationId: string;
  readonly state: SerializedAssetState;
  readonly reason: AcquisitionReason;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const ALLOWED_KEYS = new Set([
  "partId", "serialNo", "locationId", "reason", "provenanceNote", "idempotencyKey",
]);

export interface ValidatedAcquireRequest {
  readonly partId: string;
  readonly serialNo: string;
  readonly locationId: string;
  readonly reason: AcquisitionReason;
  readonly idempotencyKey: string;
  readonly provenanceNote: string | null;
}

export function validateAcquireRequest(input: unknown): ValidatedAcquireRequest {
  if (!isPlainObject(input)) throw new AcquireCommandError("REQUEST_INVALID", "request is not an object");
  for (const k of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(k)) throw new AcquireCommandError("REQUEST_INVALID", `unknown field ${k}`);
  }
  const partId = str(input.partId);
  const serialNo = str(input.serialNo);
  const locationId = str(input.locationId);
  const idempotencyKey = str(input.idempotencyKey);
  if (!partId) throw new AcquireCommandError("REQUEST_INVALID", "partId required");
  if (!serialNo) throw new AcquireCommandError("REQUEST_INVALID", "serialNo required");
  if (!locationId) throw new AcquireCommandError("REQUEST_INVALID", "locationId required");
  if (!idempotencyKey) throw new AcquireCommandError("REQUEST_INVALID", "idempotencyKey required");

  // An UNRECOGNISED reason is REFUSED, never coerced to a default. The same rule the returns intake
  // applies to condition: a value nobody recognises is not a value nobody supplied.
  const reason = input.reason;
  if (typeof reason !== "string" || !(ACQUISITION_REASONS as readonly string[]).includes(reason)) {
    throw new AcquireCommandError("REQUEST_INVALID",
      `reason must be one of ${ACQUISITION_REASONS.join("/")}`);
  }

  const provenanceNote = input.provenanceNote === undefined ? null : str(input.provenanceNote);
  if (input.provenanceNote !== undefined && provenanceNote === null) {
    throw new AcquireCommandError("REQUEST_INVALID", "provenanceNote must be a non-empty string when present");
  }
  return {
    partId, serialNo, locationId, idempotencyKey,
    reason: reason as AcquisitionReason,
    provenanceNote,
  };
}

/**
 * Bring one already-owned serialized unit under managed custody.
 *
 * IDENTITY IS THE EXISTING ONE. serializedAssetDocId(partId, serialNo) -- the same derivation
 * receiving uses, deliberately scoped to the PAIR because a serial is only unique within a
 * manufacturer's product line. A second identity scheme here would mean the same physical unit could
 * exist twice under two ids, which is the one thing serial identity exists to prevent.
 *
 * Because the id is derived, `create` IS the duplicate check -- and a pre-existing asset at that id
 * is not automatically an error: the same unit acquired twice with the same intent is a replay.
 */
export async function acquireSerializedAsset(request: unknown, deps: AcquireCommandDeps): Promise<AcquireOutcome> {
  const actor = deps.actor;
  if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !str(actor.id)) {
    throw new AcquireCommandError("PERMISSION_DENIED", "trusted actor context missing");
  }
  const req = validateAcquireRequest(request);
  const assetId = serializedAssetDocId(req.partId, req.serialNo);

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();

    // ---- 1. AUTHORIZATION, read through the transaction.
    if (!(await deps.authorize(txn, actor.id, SERIALIZED_ASSET_ACQUIRE_CAPABILITY))) {
      throw new AcquireCommandError("PERMISSION_DENIED", "actor is not authorized to acquire serialized assets");
    }

    // ---- 2. THE PART. Serialized only -- a quantity part has no individual units to acquire.
    const part = await deps.resolvePart(txn, req.partId);
    if (part === null) throw new AcquireCommandError("PART_NOT_FOUND", `part ${req.partId} not found`);
    if (part.active !== true) throw new AcquireCommandError("PART_NOT_FOUND", `part ${req.partId} is not active`);
    if (part.trackingMode !== "SERIAL") {
      throw new AcquireCommandError("PART_NOT_SERIALIZED",
        `part ${req.partId} is ${part.trackingMode}; only SERIAL parts have individually identified units`);
    }

    // ---- 3. CUSTODY. A real, governed, ACTIVE company location -- never a customer's.
    if (!(await deps.resolveLocationActive(txn, req.locationId))) {
      throw new AcquireCommandError("LOCATION_INVALID",
        `${req.locationId} is not an active governed company location`);
    }

    // ---- 4. THE UNIT. Existing is a replay if the intent matches, a conflict if it does not.
    const ref = deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(assetId);
    const snap = await txn.get(ref);
    if (snap.exists) {
      const stored = snap.data() ?? {};
      const existing = projectSerializedAsset(assetId, stored);
      if (existing === null) {
        throw new AcquireCommandError("ACQUIRE_INTEGRITY", "an asset exists at this identity but is malformed");
      }
      // A unit that arrived by RECEIPT is not the same fact as one acquired without a purchase, and
      // overwriting the first with the second would erase real purchasing history.
      if (stored.acquisitionReason === undefined) {
        throw new AcquireCommandError("ALREADY_EXISTS_CONFLICT",
          "this unit already exists from a receipt; acquisition must not overwrite purchasing history");
      }
      if (stored.acquisitionReason !== req.reason || existing.currentLocationId !== req.locationId) {
        throw new AcquireCommandError("ALREADY_EXISTS_CONFLICT",
          `this unit was already acquired as ${String(stored.acquisitionReason)} at ${existing.currentLocationId}`);
      }
      return {
        outcome: "replayed" as const,
        serializedAssetId: assetId,
        partId: existing.partId,
        serialNo: existing.serialNo,
        locationId: existing.currentLocationId,
        state: existing.inventoryState,
        reason: req.reason,
      };
    }

    // ---- 5. CREATE. Same governed shape receipt produces, with acquisition provenance instead of a
    //         receiving order -- the field that keeps these two populations distinguishable forever.
    txn.create(ref, {
      schemaVersion: SERIALIZED_ASSET_SCHEMA_VERSION,
      serialNo: req.serialNo,
      partId: req.partId,
      currentLocationId: req.locationId,
      inventoryState: ACQUIRED_INITIAL_STATE,
      currentEquipmentId: null,
      ownership: "COMPANY",
      // NOT activatedByReceivingId. A report asking "what did we receive?" filters on that field, and
      // an acquired unit must never answer. These two provenance fields are mutually exclusive by
      // construction, which is what makes the distinction survive into Reporting.
      acquisitionReason: req.reason,
      acquisitionProvenance: ACQUISITION_PROVENANCE,
      ...(req.provenanceNote === null ? {} : { acquisitionNote: req.provenanceNote }),
      acquisitionIdempotencyKey: req.idempotencyKey,
      createdAtMillis: now.getTime(),
      createdByUid: actor.id,
      updatedAtMillis: now.getTime(),
      updatedByUid: actor.id,
    });

    deps.stageAudit(txn, {
      actorId: actor.id,
      serializedAssetId: assetId,
      partId: req.partId,
      serialNo: req.serialNo,
      locationId: req.locationId,
      reason: req.reason,
      provenanceNote: req.provenanceNote,
    });

    return {
      outcome: "acquired" as const,
      serializedAssetId: assetId,
      partId: req.partId,
      serialNo: req.serialNo,
      locationId: req.locationId,
      state: ACQUIRED_INITIAL_STATE,
      reason: req.reason,
    };
  });
}
