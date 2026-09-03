// Enterprise Inventory Phase 4 -- Transfer operating authority: the trusted command family that
// CREATES and MOVES a `transfer_orders` record. Follows receiveInventoryStockCommand.ts's proven
// pattern: one Firestore transaction per action, all reads before any writes (writes buffered and
// flushed after the last read), a deterministic doc id + fingerprint idempotency guard, one staged
// audit event, and a sanitized error taxonomy. Reuses the SAME inventoryLedger TRANSFER_OUT/TRANSFER_IN
// contract Receiving's ledger foundation already exports -- this command is its first live caller.
//
// LIFECYCLE (reuses the EXISTING TRANSFER_ORDER_STATUSES vocabulary -- no new statuses invented):
//   createTransferOrder   : (none) -> REQUESTED
//   dispatchTransferOrder : REQUESTED -> IN_TRANSIT   (stages TRANSFER_OUT ledger effect(s))
//   receiveTransferOrder  : IN_TRANSIT -> COMPLETED   (stages TRANSFER_IN ledger effect(s))
//   cancelTransferOrder   : REQUESTED -> CANCELLED    (domain-safe only -- no movement has occurred yet)
//
// MOVEMENT AUTHORITY: this command OWNS the movement. Nothing else may mutate quantity or a Serialized
// Asset's location -- the UI never writes inventory_transactions/serialized_assets directly (Rules deny
// it; there is no client write path). A Serialized Asset's `currentLocationId` changes ONLY at
// receiveTransferOrder (transfer completion), per the briefing's constraint; dispatchTransferOrder only
// flips its `inventoryState` to IN_TRANSIT (a STATE change, not a LOCATION change) so it stops appearing
// available at the origin while in transit.
//
// TRUCK / MOBILE: a MOBILE endpoint is resolved through the EXISTING Truck Registry's
// `mobile_locations/{locationId}` authority (transferLocationResolver.ts) -- no second Truck object, no
// independent truck quantity store. Truck "inventory" is whatever the ledger + Serialized Asset records
// say is AT that MOBILE location; this command is what makes that true by moving records there.

import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { INVENTORY_TRANSACTIONS_COLLECTION, SERIALIZED_ASSETS_COLLECTION, TRANSFER_ORDERS_COLLECTION } from "../constants/collections.js";
import { stageOperationalMovement } from "../inventoryLedger/operationalMovementRepository.js";
import { classifyLedgerDoc, deserializeOperationalMovement } from "../inventoryLedger/operationalMovementRepository.js";
import { serializedAssetDocId } from "../serializedAsset/serializedAssetRegistration.js";
import {
  UnauthorizedTransferError,
  TransferNotFoundError,
  OriginInvalidError,
  DestinationInvalidError,
  SameLocationError,
  TransferPartInvalidError,
  TransferSerialInvalidError,
  InsufficientStockError,
  TransferStatusInvalidError,
  TransferIdempotencyConflictError,
  TransferMalformedStoredRecordError,
  TransferIntegrityError,
  type TransferActor,
  type TransferLocationRef,
  type TransferOrderStatus,
  type TransferCreateOutcome,
} from "./transferOrderTypes.js";
import { validateCreateTransferInput } from "./transferOrderValidation.js";
import { transferOrderDocId, fingerprintTransferOrder, serializeTransferOrder, deserializeTransferOrder, transitionFields } from "./transferOrderRepository.js";
import { allocateTransferOrderNumber } from "./transferOrderNumbering.js";

// Re-exported for callers/tests that import the error taxonomy alongside the command functions
// (mirrors receiveInventoryStockCommand.ts, which defines its errors locally; here they live in
// transferOrderTypes.ts because transferOrderRepository.ts and transferLocationResolver.ts need them
// too, but this module stays the single place a caller imports both from).
export {
  UnauthorizedTransferError,
  TransferNotFoundError,
  OriginInvalidError,
  DestinationInvalidError,
  SameLocationError,
  TransferPartInvalidError,
  TransferSerialInvalidError,
  InsufficientStockError,
  TransferStatusInvalidError,
  TransferIdempotencyConflictError,
  TransferMalformedStoredRecordError,
  TransferIntegrityError,
} from "./transferOrderTypes.js";

const CREATE_CAPABILITY = "inventory.transfer.create";
const DISPATCH_CAPABILITY = "inventory.transfer.dispatch";
const RECEIVE_CAPABILITY = "inventory.transfer.receive";
const CANCEL_CAPABILITY = "inventory.transfer.cancel";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
function requireActor(actor: unknown): TransferActor {
  if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !str(actor.id)) {
    throw new UnauthorizedTransferError("trusted actor context missing");
  }
  return { kind: actor.kind, id: actor.id as string };
}

export interface ResolvedTransferPart {
  readonly partId: string;
  readonly trackingMode: string;
  readonly active: boolean;
}

export interface TransferAuditInput {
  readonly action: "createTransferOrder" | "dispatchTransferOrder" | "receiveTransferOrder" | "cancelTransferOrder";
  readonly actorId: string;
  readonly transferOrderId: string;
  readonly partId: string;
  readonly quantity: number;
  readonly origin: TransferLocationRef;
  readonly destination: TransferLocationRef;
  readonly serialCount?: number;
}

export interface TransferCommandDeps {
  readonly db: Firestore;
  readonly actor: TransferActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedTransferPart | null>;
  readonly resolveLocationActive: (txn: Transaction, location: TransferLocationRef) => Promise<boolean>;
  readonly stageAudit: (txn: Transaction, audit: TransferAuditInput) => void;
  readonly now: () => Date;
}

// -------- write-buffering helper (Firestore requires all reads before any writes) --------
type BufferedWrite = { op: "create" | "update"; ref: DocumentReference; data: Record<string, unknown> };

function ledgerIdKey(transferOrderId: string, suffix: string): string {
  return "trfmv_" + createHash("sha256").update(JSON.stringify([transferOrderId, suffix])).digest("hex").slice(0, 40);
}
function serialLedgerIdKey(transferOrderId: string, suffix: string, serialNo: string): string {
  return "trfmvsn_" + createHash("sha256").update(JSON.stringify([transferOrderId, suffix, serialNo])).digest("hex").slice(0, 40);
}

// -------- NONE-mode on-hand sufficiency: sum the OPERATIONAL ledger at (partId, location) --------
// Bounded, honest, and single-source-of-truth (the ledger IS the movement authority): RECEIVED /
// RETURNED / TRANSFER_IN are +; TRANSFER_OUT / SCRAPPED are -; ADJUSTED is its own signed delta.
// LIMITATION (documented, not silently resolved): a physical count is an observation and moves no
// stock; only the manager-approved cycle-count reconciliation does, as a signed ADJUSTED that this
// sum already reads. So a location whose on-hand has drifted from a count that was never reconciled
// will not be reflected here. Reconciling it is the count workflow's job, not this transfer
// authority's -- and there is no on-hand/available aggregation authority here to build one on.
async function computeNoneOnHandThroughTxn(txn: Transaction, db: Firestore, partId: string, location: TransferLocationRef): Promise<number> {
  const snap = await txn.get(db.collection(INVENTORY_TRANSACTIONS_COLLECTION).where("partId", "==", partId));
  let onHand = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (classifyLedgerDoc(data) !== "operational") continue;
    let mv;
    try {
      mv = deserializeOperationalMovement(data);
    } catch {
      continue; // a malformed operational record is skipped, not trusted -- never inflates on-hand
    }
    const v = mv.value;
    if (v.location.type !== location.type || v.location.locationId !== location.locationId) continue;
    if (v.type === "RECEIVED" || v.type === "RETURNED" || v.type === "TRANSFER_IN") onHand += v.quantity;
    else if (v.type === "TRANSFER_OUT" || v.type === "SCRAPPED") onHand -= v.quantity;
    else if (v.type === "ADJUSTED") onHand += v.quantity; // ADJUSTED is already signed (direction SIGNED)
  }
  return onHand;
}

// =====================================================================================================
// createTransferOrder -- (none) -> REQUESTED
// =====================================================================================================
export async function createTransferOrder(request: unknown, deps: TransferCommandDeps): Promise<TransferCreateOutcome> {
  const actor = requireActor(deps.actor);

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    const writes: BufferedWrite[] = [];

    // ---- 1. authorization (commit-time authoritative) ----
    if (!(await deps.authorize(txn, actor.id, CREATE_CAPABILITY))) throw new UnauthorizedTransferError();

    // ---- 2. authoritative Part ----
    if (!isPlainObject(request) || !str(request.partId)) throw new TransferPartInvalidError("partId missing");
    const part = await deps.resolvePart(txn, request.partId as string);
    if (part === null) throw new TransferPartInvalidError("part not found");
    if (part.active !== true) throw new TransferPartInvalidError("part is not active");
    if (part.partId !== request.partId) throw new TransferPartInvalidError("resolved part identity incoherent");

    // ---- 3. structural + shape validation, bound to the authoritative Part ----
    const authority = { part: { partId: part.partId, trackingMode: part.trackingMode } };
    const validated = validateCreateTransferInput(request, authority);
    if (!validated.valid) {
      const reason = validated.reason ?? "unknown";
      if (reason === "origin_invalid") throw new OriginInvalidError("origin is malformed or not a WAREHOUSE/MOBILE reference");
      if (reason === "destination_invalid") throw new DestinationInvalidError("destination is malformed or not a WAREHOUSE/MOBILE reference");
      if (reason === "same_location") throw new SameLocationError();
      if (reason.startsWith("serial_")) throw new TransferSerialInvalidError(`transfer input invalid: ${reason}`);
      if (reason === "tracking_mode_unsupported") throw new TransferPartInvalidError("tracking mode not supported (LOT deferred)");
      throw new TransferPartInvalidError(`transfer input invalid: ${reason}`);
    }
    const value = validated.value;
    const transferOrderId = transferOrderDocId(value.idempotencyKey);
    const fingerprint = fingerprintTransferOrder(value);

    // ---- idempotency read (before any location/stock reads, cheapest fail-fast) ----
    const existingSnap = await txn.get(deps.db.collection(TRANSFER_ORDERS_COLLECTION).doc(transferOrderId));
    if (existingSnap.exists) {
      const stored = deserializeTransferOrder(transferOrderId, existingSnap.data());
      if (transferOrderDocId(stored.value.idempotencyKey) !== transferOrderId) {
        throw new TransferMalformedStoredRecordError("stored idempotencyKey does not derive its document id");
      }
      const storedRecomputed = fingerprintTransferOrder(stored.value);
      if (storedRecomputed !== stored.fingerprint) throw new TransferMalformedStoredRecordError("stored fingerprint does not match stored value");
      if (storedRecomputed !== fingerprint) throw new TransferIdempotencyConflictError();
      return { outcome: "replayed", transferOrderId, fingerprint };
    }

    // ---- 4. origin / destination must be ACTIVE governed locations ----
    if (!(await deps.resolveLocationActive(txn, value.origin))) throw new OriginInvalidError("origin is not an active governed location");
    if (!(await deps.resolveLocationActive(txn, value.destination))) throw new DestinationInvalidError("destination is not an active governed location");

    // ---- 5. origin stock sufficiency ----
    if (value.trackingMode === "SERIAL") {
      const serials = value.serialNumbers ?? [];
      for (const serialNo of serials) {
        const assetId = serializedAssetDocId(part.partId, serialNo);
        const assetSnap = await txn.get(deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(assetId));
        if (!assetSnap.exists) throw new InsufficientStockError(`serial ${serialNo} is not a known unit of this part`);
        const asset = assetSnap.data() ?? {};
        if (asset.partId !== part.partId) throw new InsufficientStockError(`serial ${serialNo} belongs to a different part`);
        if (asset.currentLocationId !== value.origin.locationId) throw new InsufficientStockError(`serial ${serialNo} is not at the origin location`);
        if (asset.inventoryState !== "AVAILABLE") throw new InsufficientStockError(`serial ${serialNo} is not AVAILABLE for transfer`);
      }
    } else {
      const onHand = await computeNoneOnHandThroughTxn(txn, deps.db, part.partId, value.origin);
      if (onHand < value.quantity) throw new InsufficientStockError(`origin on-hand (${onHand}) is less than the requested quantity (${value.quantity})`);
    }

    // ---- 5b. allocate the TO-YYYY-###### reference number ----
    //
    // This is the transaction's LAST read (transferOrderNumbering.ts's allocateTransferOrderNumber does
    // one txn.get + one txn.set on the shared per-year counter doc) — it must run only after every other
    // read above (part/idempotency/location/stock-sufficiency) has completed, because its own tx.set is
    // a real write and Firestore requires all reads before any writes in a transaction. Everything after
    // this point is either a buffered write (flushed below) or deps.stageAudit's own immediate write.
    const { transferOrderNumber } = await allocateTransferOrderNumber(txn, now.getUTCFullYear());

    // ---- 6. stage the create ----
    writes.push({ op: "create", ref: deps.db.collection(TRANSFER_ORDERS_COLLECTION).doc(transferOrderId), data: serializeTransferOrder(value, actor, now, fingerprint, transferOrderNumber) });

    // ---- 7. audit ----
    deps.stageAudit(txn, {
      action: "createTransferOrder",
      actorId: actor.id,
      transferOrderId,
      partId: part.partId,
      quantity: value.quantity,
      origin: value.origin,
      destination: value.destination,
      ...(value.serialNumbers ? { serialCount: value.serialNumbers.length } : {}),
    });

    for (const w of writes) {
      if (w.op === "create") txn.create(w.ref, w.data);
      else txn.update(w.ref, w.data);
    }
    return { outcome: "applied", transferOrderId, fingerprint, transferOrderNumber };
  });
}

// -------- shared status-transition scaffold for dispatch/receive/cancel --------
interface TransitionRequest {
  readonly transferOrderId: string;
}
function requireTransferOrderId(request: unknown): string {
  if (!isPlainObject(request) || !str(request.transferOrderId)) throw new TransferNotFoundError("transferOrderId missing");
  return request.transferOrderId as string;
}

export interface TransferActionOutcome {
  readonly outcome: "applied" | "replayed";
  readonly transferOrderId: string;
  readonly ledgerEventIds?: readonly string[];
}

// =====================================================================================================
// dispatchTransferOrder -- REQUESTED -> IN_TRANSIT (stages TRANSFER_OUT effect(s))
// =====================================================================================================
export async function dispatchTransferOrder(request: unknown, deps: TransferCommandDeps): Promise<TransferActionOutcome> {
  const actor = requireActor(deps.actor);
  const transferOrderId = requireTransferOrderId(request);

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    const writes: BufferedWrite[] = [];

    if (!(await deps.authorize(txn, actor.id, DISPATCH_CAPABILITY))) throw new UnauthorizedTransferError();

    const ref = deps.db.collection(TRANSFER_ORDERS_COLLECTION).doc(transferOrderId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new TransferNotFoundError();
    const stored = deserializeTransferOrder(transferOrderId, snap.data());

    if (stored.status !== "REQUESTED" && stored.status !== "IN_TRANSIT") {
      throw new TransferStatusInvalidError(`transfer order is ${stored.status}, cannot dispatch`);
    }
    const alreadyDispatched = stored.status === "IN_TRANSIT";

    const part = await deps.resolvePart(txn, stored.value.partId);
    if (part === null || part.partId !== stored.value.partId) throw new TransferPartInvalidError("part not found");

    const ledgerEventBase = {
      type: "TRANSFER_OUT" as const,
      partId: stored.value.partId,
      location: stored.value.origin,
      counterpartyLocation: stored.value.destination,
      sourceObject: { type: "TRANSFER_ORDER" as const, id: transferOrderId },
      actor: { kind: actor.kind, id: actor.id },
      occurredAt: stored.createdAt,
    };
    const isSerial = stored.value.trackingMode === "SERIAL";
    const serials = stored.value.serialNumbers ?? [];

    if (!alreadyDispatched && isSerial) {
      // Re-verify at commit time -- a serial could have moved between create and dispatch.
      for (const serialNo of serials) {
        const assetId = serializedAssetDocId(part.partId, serialNo);
        const assetSnap = await txn.get(deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(assetId));
        if (!assetSnap.exists) throw new InsufficientStockError(`serial ${serialNo} is not a known unit of this part`);
        const asset = assetSnap.data() ?? {};
        if (asset.currentLocationId !== stored.value.origin.locationId || asset.inventoryState !== "AVAILABLE") {
          throw new InsufficientStockError(`serial ${serialNo} is no longer available at the origin`);
        }
      }
    }

    const ledgerEvents = isSerial
      ? serials.map((serialNo) => ({ ...ledgerEventBase, quantity: 1, serialNo, idempotencyKey: serialLedgerIdKey(transferOrderId, "out", serialNo) }))
      : [{ ...ledgerEventBase, quantity: stored.value.quantity, idempotencyKey: ledgerIdKey(transferOrderId, "out") }];

    const bufferedStore = {
      async read(docId: string) {
        const s = await txn.get(deps.db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
        return s.exists ? (s.data() ?? {}) : null;
      },
      create(docId: string, data: Record<string, unknown>) {
        writes.push({ op: "create", ref: deps.db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data });
      },
    };
    const outcomes = [];
    for (const ev of ledgerEvents) {
      outcomes.push(await stageOperationalMovement(bufferedStore, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now }));
    }
    const ledgerEventIds = outcomes.map((o) => o.docId);

    if (alreadyDispatched) {
      if (outcomes.some((o) => o.outcome !== "replayed")) throw new TransferIntegrityError("transfer already dispatched but ledger did not replay coherently");
      return { outcome: "replayed", transferOrderId, ledgerEventIds };
    }
    if (outcomes.some((o) => o.outcome !== "applied")) throw new TransferIntegrityError("dispatch ledger effect did not apply coherently");

    if (isSerial) {
      for (const serialNo of serials) {
        const assetRef = deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(serializedAssetDocId(part.partId, serialNo));
        writes.push({ op: "update", ref: assetRef, data: { inventoryState: "IN_TRANSIT", updatedAtMillis: now.getTime(), updatedByUid: actor.id } });
      }
    }
    writes.push({ op: "update", ref, data: transitionFields("IN_TRANSIT", stored.version + 1, actor, now) });

    deps.stageAudit(txn, {
      action: "dispatchTransferOrder",
      actorId: actor.id,
      transferOrderId,
      partId: stored.value.partId,
      quantity: stored.value.quantity,
      origin: stored.value.origin,
      destination: stored.value.destination,
      ...(isSerial ? { serialCount: serials.length } : {}),
    });

    for (const w of writes) {
      if (w.op === "create") txn.create(w.ref, w.data);
      else txn.update(w.ref, w.data);
    }
    return { outcome: "applied", transferOrderId, ledgerEventIds };
  });
}

// =====================================================================================================
// receiveTransferOrder -- IN_TRANSIT -> COMPLETED (stages TRANSFER_IN effect(s); Serialized Asset
// LOCATION updates happen HERE, and only here).
// =====================================================================================================
export async function receiveTransferOrder(request: unknown, deps: TransferCommandDeps): Promise<TransferActionOutcome> {
  const actor = requireActor(deps.actor);
  const transferOrderId = requireTransferOrderId(request);

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    const writes: BufferedWrite[] = [];

    if (!(await deps.authorize(txn, actor.id, RECEIVE_CAPABILITY))) throw new UnauthorizedTransferError();

    const ref = deps.db.collection(TRANSFER_ORDERS_COLLECTION).doc(transferOrderId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new TransferNotFoundError();
    const stored = deserializeTransferOrder(transferOrderId, snap.data());

    if (stored.status !== "IN_TRANSIT" && stored.status !== "COMPLETED") {
      throw new TransferStatusInvalidError(`transfer order is ${stored.status}, cannot receive`);
    }
    const alreadyReceived = stored.status === "COMPLETED";

    const part = await deps.resolvePart(txn, stored.value.partId);
    if (part === null || part.partId !== stored.value.partId) throw new TransferPartInvalidError("part not found");

    const isSerial = stored.value.trackingMode === "SERIAL";
    const serials = stored.value.serialNumbers ?? [];
    const ledgerEventBase = {
      type: "TRANSFER_IN" as const,
      partId: stored.value.partId,
      location: stored.value.destination,
      counterpartyLocation: stored.value.origin,
      sourceObject: { type: "TRANSFER_ORDER" as const, id: transferOrderId },
      actor: { kind: actor.kind, id: actor.id },
      occurredAt: now.getTime(),
    };
    const ledgerEvents = isSerial
      ? serials.map((serialNo) => ({ ...ledgerEventBase, quantity: 1, serialNo, idempotencyKey: serialLedgerIdKey(transferOrderId, "in", serialNo) }))
      : [{ ...ledgerEventBase, quantity: stored.value.quantity, idempotencyKey: ledgerIdKey(transferOrderId, "in") }];

    const bufferedStore = {
      async read(docId: string) {
        const s = await txn.get(deps.db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
        return s.exists ? (s.data() ?? {}) : null;
      },
      create(docId: string, data: Record<string, unknown>) {
        writes.push({ op: "create", ref: deps.db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data });
      },
    };
    const outcomes = [];
    for (const ev of ledgerEvents) {
      outcomes.push(await stageOperationalMovement(bufferedStore, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now }));
    }
    const ledgerEventIds = outcomes.map((o) => o.docId);

    if (alreadyReceived) {
      if (outcomes.some((o) => o.outcome !== "replayed")) throw new TransferIntegrityError("transfer already received but ledger did not replay coherently");
      return { outcome: "replayed", transferOrderId, ledgerEventIds };
    }
    if (outcomes.some((o) => o.outcome !== "applied")) throw new TransferIntegrityError("receive ledger effect did not apply coherently");

    if (isSerial) {
      for (const serialNo of serials) {
        const assetRef = deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(serializedAssetDocId(part.partId, serialNo));
        // The canonical transfer-completion authority: this is the ONLY place a Serialized Asset's
        // currentLocationId changes as part of a transfer.
        writes.push({
          op: "update",
          ref: assetRef,
          data: { currentLocationId: stored.value.destination.locationId, inventoryState: "AVAILABLE", updatedAtMillis: now.getTime(), updatedByUid: actor.id },
        });
      }
    }
    writes.push({ op: "update", ref, data: transitionFields("COMPLETED", stored.version + 1, actor, now) });

    deps.stageAudit(txn, {
      action: "receiveTransferOrder",
      actorId: actor.id,
      transferOrderId,
      partId: stored.value.partId,
      quantity: stored.value.quantity,
      origin: stored.value.origin,
      destination: stored.value.destination,
      ...(isSerial ? { serialCount: serials.length } : {}),
    });

    for (const w of writes) {
      if (w.op === "create") txn.create(w.ref, w.data);
      else txn.update(w.ref, w.data);
    }
    return { outcome: "applied", transferOrderId, ledgerEventIds };
  });
}

// =====================================================================================================
// cancelTransferOrder -- REQUESTED -> CANCELLED. Domain-safe ONLY: legal iff no movement has been
// dispatched yet (IN_TRANSIT/COMPLETED refuse; a CANCELLED order accepts a replay as a no-op).
// =====================================================================================================
export async function cancelTransferOrder(request: unknown, deps: TransferCommandDeps): Promise<TransferActionOutcome> {
  const actor = requireActor(deps.actor);
  const transferOrderId = requireTransferOrderId(request);

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();

    if (!(await deps.authorize(txn, actor.id, CANCEL_CAPABILITY))) throw new UnauthorizedTransferError();

    const ref = deps.db.collection(TRANSFER_ORDERS_COLLECTION).doc(transferOrderId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new TransferNotFoundError();
    const stored = deserializeTransferOrder(transferOrderId, snap.data());

    if (stored.status === "CANCELLED") return { outcome: "replayed", transferOrderId };
    if (stored.status !== "REQUESTED") {
      throw new TransferStatusInvalidError(`transfer order is ${stored.status}, cancellation is only domain-safe before dispatch`);
    }

    txn.update(ref, transitionFields("CANCELLED", stored.version + 1, actor, now));
    deps.stageAudit(txn, {
      action: "cancelTransferOrder",
      actorId: actor.id,
      transferOrderId,
      partId: stored.value.partId,
      quantity: stored.value.quantity,
      origin: stored.value.origin,
      destination: stored.value.destination,
    });
    return { outcome: "applied", transferOrderId };
  });
}

export type { TransferOrderStatus };
