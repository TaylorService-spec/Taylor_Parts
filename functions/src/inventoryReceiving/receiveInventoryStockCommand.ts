// Enterprise Inventory -- EI Phase-2 Receiving, Phase B: the INERT, UNEXPORTED trusted
// `receiveInventoryStock` command. One Firestore transaction, all-or-nothing, governed by the ratified
// spec (docs/specifications/enterprise-inventory-receiving-phase2.md §7). NOT exported from
// functions/src/index.ts; no callable; production-inert (no caller). Reuses the merged Phase-A receiving
// repository + the merged inventoryLedger repository; touches no existing writer.
//
// Authorization and audit are INJECTED seams (Phase C registers the real capability + AuditAction). The
// command reads authorization commit-time through the transaction (so a concurrent revocation conflicts
// the commit), performs ALL Firestore reads before any writes (writes are buffered and flushed after the
// last read), never writes reorder_purchase_orders (byte-identical), transitions only reorder_requests
// ORDERED->RECEIVED, and stages exactly one RECEIVED ledger event + one immutable audit event.

import { Timestamp } from "firebase-admin/firestore";
import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import { INVENTORY_TRANSACTIONS_COLLECTION } from "../constants/collections.js";
import { stageOperationalMovement } from "../inventoryLedger/operationalMovementRepository.js";
import {
  RECEIVING_ORDERS_COLLECTION,
  type ReceivingActor,
} from "./receivingTypes.js";
import { validateReceivingOrderInput } from "./receivingValidation.js";
import { stageReceivingOrder, type ReceivingIdempotencyStore } from "./receivingRepository.js";

const REORDER_PURCHASE_ORDERS_COLLECTION = "reorder_purchase_orders";
const REORDER_REQUESTS_COLLECTION = "reorder_requests";
const RECEIVE_CAPABILITY = "inventory.stock.receive";
const ORDERED = "ORDERED";
const RECEIVED = "RECEIVED";

// -------- sanitized command error taxonomy (no raw Firestore/auth/document data in messages) --------
export type ReceiveCommandFailureCode =
  | "PERMISSION_DENIED"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_NOT_RECEIVABLE"
  | "DESTINATION_INVALID"
  | "PART_INVALID"
  | "RECEIVING_INTEGRITY";
export class ReceiveCommandError extends Error {
  readonly code: ReceiveCommandFailureCode;
  constructor(code: ReceiveCommandFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}
export class UnauthorizedReceivingError extends ReceiveCommandError { constructor(m = "actor is not authorized to receive stock") { super("PERMISSION_DENIED", m); } }
export class SourceNotFoundError extends ReceiveCommandError { constructor(m: string) { super("SOURCE_NOT_FOUND", m); } }
export class SourceNotReceivableError extends ReceiveCommandError { constructor(m: string) { super("SOURCE_NOT_RECEIVABLE", m); } }
export class DestinationInvalidError extends ReceiveCommandError { constructor(m: string) { super("DESTINATION_INVALID", m); } }
export class PartInvalidError extends ReceiveCommandError { constructor(m: string) { super("PART_INVALID", m); } }
export class ReceivingIntegrityError extends ReceiveCommandError { constructor(m: string) { super("RECEIVING_INTEGRITY", m); } }

export interface ResolvedPart { readonly partId: string; readonly trackingMode: string; readonly active: boolean; }

// Injected dependencies. Authorization / part / location resolution read THROUGH the transaction (so a
// concurrent revocation conflicts the commit); audit staging is a write seam. now() supplies the server
// clock. __afterAuthReadHook is a TEST-ONLY seam to inject a concurrent write after the authz read.
export interface ReceiveInventoryStockDeps {
  readonly db: Firestore;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedPart | null>;
  readonly resolveLocationActive: (txn: Transaction, location: { type: string; locationId: string }) => Promise<boolean>;
  readonly stageAudit: (txn: Transaction, audit: ReceiveAuditInput) => void;
  readonly now: () => Date;
  readonly __afterAuthReadHook?: () => Promise<void>;
  readonly __afterSourceReadHook?: () => Promise<void>;
}

// Sanitized audit input (no supplier/commercial fields, no raw errors).
export interface ReceiveAuditInput {
  readonly action: "receiveInventoryStock";
  readonly actorId: string;
  readonly receivingId: string;
  readonly reorderRequestId: string;
  readonly partId: string;
  readonly quantity: number;
  readonly locationType: string;
  readonly locationId: string;
  readonly ledgerEventId: string;
}

export interface ReceiveInventoryStockOutcome {
  readonly outcome: "applied" | "replayed";
  readonly receivingId: string;
  readonly ledgerEventId: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null { return typeof v === "string" && v.trim() !== "" ? v : null; }

// The trusted command. `request` is the untrusted receive request PLUS the server-derived actor.
export async function receiveInventoryStock(request: unknown, deps: ReceiveInventoryStockDeps): Promise<ReceiveInventoryStockOutcome> {
  if (!isPlainObject(request)) throw new SourceNotReceivableError("request is not an object");
  const actorRaw = request.actor;
  if (!isPlainObject(actorRaw) || (actorRaw.kind !== "USER" && actorRaw.kind !== "SYSTEM") || !str(actorRaw.id)) {
    throw new UnauthorizedReceivingError("actor identity missing");
  }
  const actor: ReceivingActor = { kind: actorRaw.kind as "USER" | "SYSTEM", id: actorRaw.id as string };
  const source = request.source;
  if (!isPlainObject(source) || !str(source.reorderRequestId)) throw new SourceNotReceivableError("source reorderRequestId missing");
  const reorderRequestId = source.reorderRequestId as string;
  const { actor: _actor, ...receivingInput } = request; // stripped input for the Phase-A validator (no actor)

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    // Buffered writes: created/updated only AFTER all reads (Firestore requires reads-before-writes).
    const writes: Array<{ op: "create" | "update"; ref: DocumentReference; data: Record<string, unknown> }> = [];
    const bufferedStore = (collection: string): ReceivingIdempotencyStore => ({
      async read(docId) { const snap = await txn.get(deps.db.collection(collection).doc(docId)); return snap.exists ? (snap.data() ?? {}) : null; },
      create(docId, data) { writes.push({ op: "create", ref: deps.db.collection(collection).doc(docId), data }); },
    });

    // ---- 1. AUTHORIZATION (commit-time authoritative; read through the txn) ----
    const authorized = await deps.authorize(txn, actor.id, RECEIVE_CAPABILITY);
    if (!authorized) throw new UnauthorizedReceivingError();
    if (deps.__afterAuthReadHook) await deps.__afterAuthReadHook();

    // ---- 3. SOURCE PO (read-only; never written) ----
    const poRef = deps.db.collection(REORDER_PURCHASE_ORDERS_COLLECTION).doc(reorderRequestId);
    const poSnap = await txn.get(poRef);
    if (!poSnap.exists) throw new SourceNotFoundError("purchase order not found");
    const po = poSnap.data() ?? {};
    if (po.status !== ORDERED) throw new SourceNotReceivableError("purchase order is not ORDERED");
    if (po.reorderRequestId !== reorderRequestId) throw new SourceNotReceivableError("purchase order identity incoherent");
    const poPartId = str(po.partId);
    if (poPartId === null) throw new SourceNotReceivableError("purchase order partId invalid");
    if (typeof po.orderedQuantity !== "number" || !Number.isFinite(po.orderedQuantity) || po.orderedQuantity <= 0) {
      throw new SourceNotReceivableError("purchase order orderedQuantity invalid");
    }
    const orderedQuantity = po.orderedQuantity;

    // ---- 4. LINKED REORDER REQUEST (read) ----
    const reqRef = deps.db.collection(REORDER_REQUESTS_COLLECTION).doc(reorderRequestId);
    const reqSnap = await txn.get(reqRef);
    if (!reqSnap.exists) throw new SourceNotFoundError("reorder request not found");
    const req = reqSnap.data() ?? {};
    if (req.partId !== poPartId) throw new SourceNotReceivableError("reorder request partId does not match purchase order");
    if (req.purchaseOrderId !== undefined && req.purchaseOrderId !== reorderRequestId) throw new SourceNotReceivableError("reorder request purchaseOrderId incoherent");
    if (deps.__afterSourceReadHook) await deps.__afterSourceReadHook();

    // ---- 6. PART authority (active + NONE) ----
    const part = await deps.resolvePart(txn, poPartId);
    if (part === null) throw new PartInvalidError("part not found");
    if (part.active !== true) throw new PartInvalidError("part is not active");
    if (part.partId !== poPartId) throw new PartInvalidError("resolved part identity incoherent");

    // ---- 5. DESTINATION location (active) ----
    if (!isPlainObject(receivingInput.receivingLocation)) throw new DestinationInvalidError("destination missing");
    const locActive = await deps.resolveLocationActive(txn, receivingInput.receivingLocation as { type: string; locationId: string });
    if (locActive !== true) throw new DestinationInvalidError("destination is not an active governed location");

    // ---- 7. validate + bind the receiving value against the authoritative Part + orderedQuantity ----
    const authority = { part: { partId: part.partId, trackingMode: part.trackingMode }, orderedQuantity };
    const validated = validateReceivingOrderInput(receivingInput, authority);
    if (!validated.valid) {
      if (validated.reason === "tracking_mode_unsupported") throw new PartInvalidError("tracking mode not supported (SERIAL/LOT deferred)");
      throw new SourceNotReceivableError(`receiving input invalid: ${validated.reason}`);
    }
    const value = validated.value;
    const line = value.lines[0];

    // ---- 8. stage the Receiving Order (reads idempotency doc; buffers create if applying) ----
    const receivingStore = bufferedStore(RECEIVING_ORDERS_COLLECTION);
    const receivingOutcome = await stageReceivingOrder(receivingStore, receivingInput, authority, { actor, now });
    const receivingId = receivingOutcome.receivingId;

    // ---- 9. stage exactly one RECEIVED ledger event (reads ledger idempotency doc; buffers create) ----
    const ledgerStore = bufferedStore(INVENTORY_TRANSACTIONS_COLLECTION);
    const ledgerEvent = {
      type: "RECEIVED",
      partId: part.partId,
      location: { type: value.receivingLocation.type, locationId: value.receivingLocation.locationId },
      quantity: orderedQuantity,
      sourceObject: { type: "RECEIVING_ORDER", id: receivingId },
      idempotencyKey: `recv:${value.idempotencyKey}:${line.lineId}`,
      actor: { kind: actor.kind, id: actor.id },
      occurredAt: now.getTime(),
    };
    const ledgerOutcome = await stageOperationalMovement(ledgerStore, ledgerEvent, { partId: part.partId, trackingMode: part.trackingMode }, { now });
    const ledgerEventId = ledgerOutcome.docId;

    // ---- decide apply vs replay (coherence: the two must agree) ----
    if (receivingOutcome.outcome === "replayed") {
      if (ledgerOutcome.outcome !== "replayed") throw new ReceivingIntegrityError("receiving replayed but ledger did not");
      return { outcome: "replayed", receivingId, ledgerEventId };
    }
    if (ledgerOutcome.outcome !== "applied") throw new ReceivingIntegrityError("receiving applied but ledger did not");

    // ---- 10. transition ONLY reorder_requests ORDERED -> RECEIVED (apply path) ----
    if (req.status !== ORDERED) throw new SourceNotReceivableError("reorder request is not ORDERED");
    writes.push({ op: "update", ref: reqRef, data: { status: RECEIVED, receivedAt: Timestamp.fromDate(now), receivedBy: actor.id } });

    // ---- 12. one immutable audit event (sanitized) ----
    deps.stageAudit(txn, {
      action: "receiveInventoryStock",
      actorId: actor.id,
      receivingId,
      reorderRequestId,
      partId: part.partId,
      quantity: orderedQuantity,
      locationType: value.receivingLocation.type,
      locationId: value.receivingLocation.locationId,
      ledgerEventId,
    });

    // ---- 13. flush all buffered writes (creates + the reorder_requests update). reorder_purchase_orders
    // is never written. Commit is all-or-nothing (the enclosing runTransaction). ----
    for (const w of writes) {
      if (w.op === "create") txn.create(w.ref, w.data);
      else txn.update(w.ref, w.data);
    }
    return { outcome: "applied", receivingId, ledgerEventId };
  });
}
