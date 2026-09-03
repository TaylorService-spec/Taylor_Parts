// Enterprise Inventory -- EI Phase-2 Receiving: the trusted `receiveInventoryStock` command. One
// Firestore transaction, all-or-nothing, governed by the ratified spec
// (docs/specifications/enterprise-inventory-receiving-phase2.md §7). Reuses the merged Phase-A
// receiving repository + the merged inventoryLedger repository; touches no existing writer.
//
// HEADER CORRECTED 2026-09-02 (FIN-BLOCK-003 reconciliation). This block previously said the command
// was "INERT, UNEXPORTED", "NOT exported from functions/src/index.ts; no callable; production-inert
// (no caller)". That described Phase B and became false when Phase C wired it: the callable is
// defined at `inventoryReceiving/receivingCallables.ts:220` and exported from
// `functions/src/index.ts` as `receiveInventoryStock`.
//
// The staleness was worth correcting rather than leaving: a reader asking "could receiving carry a
// cost fact?" -- exactly the FIN-BLOCK-003 question -- would have read this header, concluded the
// receiving path was not live, and stopped looking. It IS live, and it records NO monetary value of
// any kind, which is a materially different finding from "the path does not run".
//
// WHAT IS STILL TRUE, and is the reason the correction is narrow: exporting a callable is not
// deployment authorization, and this command writes no cost. The receipt it stages carries quantity,
// part, location, actor and time -- there is no unit cost, extended cost or currency on a receipt,
// and none is derived from the purchase order it receives against.
//
// The server-derived ACTOR is TRUSTED COMMAND CONTEXT (deps.actor, derived by the caller from
// request.auth.uid) -- it is NEVER read from the untrusted request payload. Authorization and audit are
// INJECTED seams (Phase C registers the real capability + AuditAction). The command reads authorization
// commit-time through the transaction (so a concurrent revocation conflicts the commit), performs ALL
// Firestore reads before any writes (writes buffered + flushed after the last read), never writes
// reorder_purchase_orders (byte-identical), transitions only reorder_requests ORDERED->RECEIVED, and
// stages exactly one RECEIVED ledger event + one immutable audit event.

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import { INVENTORY_TRANSACTIONS_COLLECTION, SERIALIZED_ASSETS_COLLECTION } from "../constants/collections.js";
import { serializedAssetDocId, buildSerializedAssetForReceipt } from "../serializedAsset/serializedAssetRegistration.js";
import { stageOperationalMovement } from "../inventoryLedger/operationalMovementRepository.js";
import { RECEIVING_ORDERS_COLLECTION, RECEIVING_SOURCE_TYPES, CANONICAL_SOURCE_TYPE, type ReceivingActor } from "./receivingTypes.js";
import {
  stageReceivingOrderValue,
  receivingOrderDocId,
  canonicalReceivingOrderDocId,
  deserializeReceivingOrder,
  type ReceivingIdempotencyStore,
} from "./receivingRepository.js";
import { resolveReceivingSource } from "./receivingSourceResolver.js";
import { validateReceivingBatch, type ResolvedPartAuthority } from "./receivingBatchValidation.js";
import { allocateReceivingOrderNumber } from "./receivingOrderNumbering.js";
import {
  ACQUISITION_COST_COLLECTION,
  acquisitionCostDocId,
  buildAcquisitionCostFact,
  governedPurchasePrice,
} from "../finance/acquisitionCost.js";

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
  | "SERIAL_IDENTITY_CONFLICT"
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
// A serial already registered by a DIFFERENT receipt: the same physical unit cannot be received twice.
export class SerialIdentityConflictError extends ReceiveCommandError { constructor(m = "serial number is already registered to another receipt") { super("SERIAL_IDENTITY_CONFLICT", m); } }

export interface ResolvedPart { readonly partId: string; readonly trackingMode: string; readonly active: boolean; }

// Injected dependencies + TRUSTED command context. `actor` is server-derived (from request.auth.uid at
// the caller boundary) and passed here as trusted context -- never taken from the request. authorize /
// resolvePart / resolveLocationActive read THROUGH the transaction. __after*Hook are TEST-ONLY seams.
export interface ReceiveInventoryStockDeps {
  readonly db: Firestore;
  readonly actor: ReceivingActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedPart | null>;
  readonly resolveLocationActive: (txn: Transaction, location: { type: string; locationId: string }) => Promise<boolean>;
  readonly stageAudit: (txn: Transaction, audit: ReceiveAuditInput) => void;
  readonly now: () => Date;
  readonly __afterAuthReadHook?: () => Promise<void>;
  readonly __afterSourceReadHook?: () => Promise<void>;
  readonly __afterLocationReadHook?: () => Promise<void>;
}

// Sanitized audit input (no supplier/commercial fields, no raw errors).
export interface ReceiveAuditInput {
  readonly action: "receiveInventoryStock";
  readonly actorId: string;
  readonly receivingId: string;
  // LEGACY ONLY -- absent for a canonical receipt, which has no reorder request.
  readonly reorderRequestId?: string;
  readonly purchaseOrderId: string;
  readonly sourceType: string;
  // SINGLE-LINE ONLY. Kept so an existing audit reader is unaffected, and deliberately ABSENT on a
  // multi-line receipt: reporting one line's part and quantity as if it were the whole receipt would
  // be a false summary of what happened.
  readonly partId?: string;
  readonly quantity?: number;
  // Always present, and honest for both shapes.
  readonly lineCount: number;
  readonly totalQuantity: number;
  readonly locationType: string;
  readonly locationId: string;
  readonly ledgerEventId: string;
  // SERIAL receipts only: how many Serialized Assets this receipt activated. Absent for NONE.
  readonly serialCount?: number;
}

/** One PO line's outcome in this receipt, all quantities server-derived. */
export interface ReceiveLineResult {
  readonly lineId: string;
  readonly partId: string;
  readonly orderedQuantity: number;
  readonly previouslyReceived: number;
  readonly receivedNow: number;
  readonly remainingQuantity: number;
  readonly state: string;
}

export interface ReceiveInventoryStockOutcome {
  readonly outcome: "applied" | "replayed";
  readonly receivingId: string;
  readonly purchaseOrderId: string;
  readonly sourceType: string;
  // The FIRST staged ledger event. A SERIAL receipt stages one per unit; ledgerEventIds carries all of
  // them, and for a NONE receipt it is that single id. Kept alongside the original field so existing
  // callers are unaffected.
  readonly ledgerEventId: string;
  readonly ledgerEventIds: readonly string[];
  // Every line of the PO, not only the ones received now -- a caller needs the whole picture to know
  // what is still outstanding.
  readonly lines: readonly ReceiveLineResult[];
  /** DERIVED receipt progress: NOT_RECEIVED | PARTIALLY_RECEIVED | RECEIVED. Never persisted. */
  readonly derivedState: string;
  /** STORED procurement lifecycle after this receipt. A different concept from derivedState. */
  readonly storedStatus: string | null;
  readonly serializedAssetIds?: readonly string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null { return typeof v === "string" && v.trim() !== "" ? v : null; }

// Collision-free deterministic per-line ledger idempotency key: sha256 over a JSON tuple of the fixed
// receivingId + lineId (JSON quoting makes the components unambiguous, unlike raw delimiter concatenation).
function ledgerLineIdempotencyKey(receivingId: string, lineId: string): string {
  return "recvln_" + createHash("sha256").update(JSON.stringify([receivingId, lineId])).digest("hex").slice(0, 40);
}

// SERIAL receipts stage ONE ledger event PER UNIT (the ledger requires quantity === 1 and a serialNo for
// SERIAL-tracked parts -- see inventoryLedger/operationalMovementValidation.ts). Each therefore needs its
// own idempotency key, derived from the same fixed inputs so an exact retry reproduces it exactly.
function ledgerSerialIdempotencyKey(receivingId: string, lineId: string, serialNo: string): string {
  return "recvsn_" + createHash("sha256").update(JSON.stringify([receivingId, lineId, serialNo])).digest("hex").slice(0, 40);
}

// The trusted command. `request` is the UNTRUSTED receive payload ONLY (no actor). The server-derived
// actor comes from deps.actor (trusted context).
export async function receiveInventoryStock(request: unknown, deps: ReceiveInventoryStockDeps): Promise<ReceiveInventoryStockOutcome> {
  const actor = deps.actor;
  if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !str(actor.id)) {
    throw new UnauthorizedReceivingError("trusted actor context missing");
  }
  if (!isPlainObject(request)) throw new SourceNotReceivableError("request is not an object");
  // ONE REQUEST CONTRACT, TWO AUTHORITIES. The legacy transport shape IS the one-line case of the
  // batch shape -- same top-level keys, same line keys, with `expectedQuantity` optional. So there is
  // no translation step and no second domain service: the legacy payload passes through unchanged and
  // is distinguished only by `source.type`, which the resolver validates against a closed set.
  //
  // Nothing about the source is inspected here. Which authority a request addresses, and whether its
  // identity fields are coherent, is the resolver's single responsibility -- checking a legacy field
  // here would have made a canonical request fail before it ever reached the discriminator.
  const batch = request as Record<string, unknown>;

  // FAIL FAST on a request that cannot possibly resolve, BEFORE opening a transaction. This is a
  // shape check only -- it asserts that an authority was named and that the name is in the closed
  // set. Everything else about the source (identity coherence, existence, receivable state) belongs
  // to the resolver, which needs reads.
  //
  // Deliberately AUTHORITY-AGNOSTIC. The check that used to live here demanded a reorderRequestId,
  // which was correct when there was one authority and would now reject every canonical request
  // before it ever reached the discriminator.
  const declaredSource = batch.source;
  if (!isPlainObject(declaredSource)) throw new SourceNotReceivableError("source missing");
  if (!RECEIVING_SOURCE_TYPES.includes(declaredSource.type as never)) {
    throw new SourceNotReceivableError("source type is not a supported receiving authority");
  }

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    // Buffered writes: created/updated only AFTER all reads (Firestore requires reads-before-writes).
    const writes: Array<{ op: "create" | "update" | "set"; ref: DocumentReference; data: Record<string, unknown> }> = [];
    const bufferedStore = (collection: string): ReceivingIdempotencyStore => ({
      async read(docId) { const snap = await txn.get(deps.db.collection(collection).doc(docId)); return snap.exists ? (snap.data() ?? {}) : null; },
      create(docId, data) { writes.push({ op: "create", ref: deps.db.collection(collection).doc(docId), data }); },
    });

    // ---- 1. AUTHORIZATION (commit-time authoritative; read through the txn) ----
    const authorized = await deps.authorize(txn, actor.id, RECEIVE_CAPABILITY);
    if (!authorized) throw new UnauthorizedReceivingError();
    if (deps.__afterAuthReadHook) await deps.__afterAuthReadHook();

    // ---- 2. SOURCE AUTHORITY (read). Canonical: the concurrency anchor (see the transaction-order
    // spec §1). Legacy: read-only, never written -- its immutability contract is preserved. ----
    const resolved = await resolveReceivingSource(txn, deps.db, batch.source);
    if (deps.__afterSourceReadHook) await deps.__afterSourceReadHook();

    // ---- 3. LINKED REORDER REQUEST (LEGACY ONLY) ----
    //
    // A canonical purchase order has no reorder request. Reading one would be inventing a link, and
    // transitioning one would be closing a workflow the receipt has nothing to do with.
    let reqRef: DocumentReference | null = null;
    let reqStatus: unknown = null;
    if (!resolved.isCanonical) {
      const reorderRequestId = resolved.reorderRequestId as string;
      reqRef = deps.db.collection(REORDER_REQUESTS_COLLECTION).doc(reorderRequestId);
      const reqSnap = await txn.get(reqRef);
      if (!reqSnap.exists) throw new SourceNotFoundError("reorder request not found");
      const req = reqSnap.data() ?? {};
      reqStatus = req.status;
      const legacyPartId = resolved.canonical.lines[0].partId;
      if (req.partId !== legacyPartId) throw new SourceNotReceivableError("reorder request partId does not match purchase order");
      if (req.purchaseOrderId !== undefined && req.purchaseOrderId !== reorderRequestId) {
        throw new SourceNotReceivableError("reorder request purchaseOrderId incoherent");
      }
    }

    // ---- 4. PART authority, once per DISTINCT part on the submitted lines ----
    //
    // Deduplicated deliberately: two lines for the same part must resolve to the SAME Part record, and
    // reading it twice would allow two answers to one question. Resolved from the PO's own line
    // definitions rather than from the caller's claimed partId -- the caller's claim is checked
    // against the PO in validation, and resolving what the caller said would let a wrong claim pick
    // which Part authority to consult.
    const submittedLineIds: string[] = Array.isArray(batch.lines)
      ? batch.lines.map((l) => (isPlainObject(l) ? str((l as Record<string, unknown>).lineId) : null)).filter((v): v is string => v !== null)
      : [];
    // A LEGACY receipt's line label is the caller's own and does not match the normalized "L1", so it
    // is matched by position rather than by id -- a legacy order has exactly one line, so "the line
    // being received" is unambiguous. Canonical receipts match by id, which is the only thing that
    // distinguishes several lines.
    const targetedLines = resolved.isCanonical
      ? resolved.derived.lines.filter((l) => submittedLineIds.includes(l.lineId))
      : resolved.derived.lines;
    const distinctPartIds = [...new Set(targetedLines.map((l) => l.partId))];
    const partsByPartId = new Map<string, ResolvedPartAuthority>();
    for (const partId of distinctPartIds) {
      const part = await deps.resolvePart(txn, partId);
      if (part === null) throw new PartInvalidError("part not found");
      if (part.partId !== partId) throw new PartInvalidError("resolved part identity incoherent");
      partsByPartId.set(partId, part);
    }

    // ---- 5. DESTINATION location (active) ----
    if (!isPlainObject(batch.receivingLocation)) throw new DestinationInvalidError("destination missing");
    const locActive = await deps.resolveLocationActive(txn, batch.receivingLocation as { type: string; locationId: string });
    if (locActive !== true) throw new DestinationInvalidError("destination is not an active governed location");
    if (deps.__afterLocationReadHook) await deps.__afterLocationReadHook();

    // ---- 6. VALIDATE THE WHOLE BATCH -- before any write, so a rejected batch leaves nothing ----
    const validated = validateReceivingBatch(batch, { resolved, partsByPartId });
    if (!validated.valid) {
      if (validated.reason === "tracking_mode_unsupported") throw new PartInvalidError("tracking mode not supported (LOT deferred)");
      if (validated.reason === "part_inactive") throw new PartInvalidError("part is not active");
      throw new SourceNotReceivableError(`receiving input invalid: ${validated.reason}`);
    }
    const value = validated.value;

    // ---- 7. RECEIPT IDENTITY, per namespace ----
    //
    // Legacy keeps its key-only derivation exactly (deployed callers hold receipts at those ids).
    // Canonical is TARGET-SCOPED, so the same raw client key against a different purchase order is a
    // different receipt rather than a false replay of the first one.
    const receivingId = resolved.isCanonical
      ? canonicalReceivingOrderDocId({
          operation: "receiveInventoryStock",
          sourceType: CANONICAL_SOURCE_TYPE,
          purchaseOrderId: resolved.purchaseOrderId,
          actorId: actor.id,
          idempotencyKey: value.idempotencyKey,
        })
      : receivingOrderDocId(value.idempotencyKey);

    // ---- occurredAt STABILITY: the ledger event's business time is the Receiving Order's authoritative
    // createdAt, so an exact retry at a later clock reproduces the same fingerprint (replay, not conflict).
    const receivingStore = bufferedStore(RECEIVING_ORDERS_COLLECTION);
    const existingReceiving = await receivingStore.read(receivingId);
    const occurredAtMillis = existingReceiving === null ? now.getTime() : deserializeReceivingOrder(existingReceiving).createdAt;

    // ---- 8. stage the Receiving Order through the ONE core (reads the idempotency doc; buffers the
    // create if applying) ----
    const receivingWriteIndex = writes.length;
    const receivingOutcome = await stageReceivingOrderValue(receivingStore, value, receivingId, { actor, now });

    // ---- 8b. RECEIVING ORDER REFERENCE NUMBER (RO-YYYY-######) -- allocated ONLY on a genuine new
    // create, never on replay. allocateReceivingOrderNumber performs a READ ONLY here; its counter
    // WRITE is buffered so it flushes atomically with everything else. ----
    if (receivingOutcome.outcome === "applied") {
      const allocated = await allocateReceivingOrderNumber(txn, now.getUTCFullYear());
      writes[receivingWriteIndex].data.receivingOrderNumber = allocated.receivingOrderNumber;
      writes.push({ op: "set", ref: allocated.counterWrite.ref, data: allocated.counterWrite.data });
    }

    // ---- 9. stage the RECEIVED ledger effect(s), PER LINE ----
    //
    // NONE  -> exactly one event per line carrying that line's received quantity.
    // SERIAL-> one event PER UNIT, each quantity 1 and carrying its serialNo. Not a choice made here:
    //          the ledger's own validator requires quantity === 1 and a serialNo for a SERIAL part.
    // The single append-only ledger stays the one movement authority; this only stages the shape it
    // already defines. NO new ledger vocabulary -- every event is RECEIVED.
    const ledgerStore = bufferedStore(INVENTORY_TRANSACTIONS_COLLECTION);
    const ledgerOutcomes: Array<{ outcome: string; docId: string }> = [];
    const serializedAssetIds: string[] = [];
    // FIN-BLOCK-003A -- the acquisition-cost facts this receipt produced. Empty is a legitimate and
    // common outcome (an unpriced purchase order), and it means UNKNOWN, not free.
    const acquisitionCostIds: string[] = [];
    let anySerial = false;

    for (const line of value.lines) {
      const part = partsByPartId.get(line.partId);
      if (part === undefined) throw new ReceivingIntegrityError("part authority missing for a validated line");
      const isSerialLine = line.trackingMode === "SERIAL";
      if (isSerialLine) anySerial = true;
      const lineSerials = line.serialNumbers ?? [];

      const ledgerEventBase = {
        type: "RECEIVED",
        partId: line.partId,
        location: { type: value.receivingLocation.type, locationId: value.receivingLocation.locationId },
        sourceObject: { type: "RECEIVING_ORDER", id: receivingId },
        actor: { kind: actor.kind, id: actor.id },
        occurredAt: occurredAtMillis,
      };

      const ledgerEvents = isSerialLine
        ? lineSerials.map((serialNo) => ({
            ...ledgerEventBase,
            quantity: 1,
            serialNo,
            idempotencyKey: ledgerSerialIdempotencyKey(receivingId, line.lineId, serialNo),
          }))
        : [{ ...ledgerEventBase, quantity: line.receivedQuantity, idempotencyKey: ledgerLineIdempotencyKey(receivingId, line.lineId) }];

      for (const ev of ledgerEvents) {
        ledgerOutcomes.push(await stageOperationalMovement(ledgerStore, ev, { partId: line.partId, trackingMode: part.trackingMode }, { now }));
      }

      // ---- 9b. SERIAL: activate one Serialized Asset per unit, in THIS transaction ----
      //
      // Identity is deterministic on (partId, serialNo), so `create` IS the uniqueness check -- there
      // is no read-then-write race. A pre-existing document is only acceptable when THIS receipt
      // created it (activatedByReceivingId matches), which is the replay case; any other owner means
      // the same physical unit is being received twice, and the whole receipt fails closed.
      if (isSerialLine) {
        for (const serialNo of lineSerials) {
          const assetId = serializedAssetDocId(line.partId, serialNo);
          const assetRef = deps.db.collection(SERIALIZED_ASSETS_COLLECTION).doc(assetId);
          const assetSnap = await txn.get(assetRef); // read stays before the buffered write flush
          if (assetSnap.exists) {
            const existing = assetSnap.data() ?? {};
            if (existing.activatedByReceivingId !== receivingId) throw new SerialIdentityConflictError();
            // Same receipt -> replay; do not re-create.
          } else {
            writes.push({
              op: "create",
              ref: assetRef,
              data: buildSerializedAssetForReceipt({
                partId: line.partId,
                serialNo,
                locationId: value.receivingLocation.locationId,
                receivingId,
                actorId: actor.id,
                now,
              }),
            });
          }
          serializedAssetIds.push(assetId);
        }
      }

      // ---- 9c. GOVERNED ACQUISITION COST EVIDENCE (FIN-BLOCK-003A) ----
      //
      // ONE immutable fact per receipt line, for the quantity received NOW, priced at the price
      // governing THIS receipt. Partial receipts therefore need no rule of their own: receiving 4 of
      // 10 records evidence for 4, and the remaining 6 later record their own fact against whatever
      // price governs then. Nothing recomputes the earlier one -- nothing can, because it is a
      // separate document keyed by its own receipt.
      //
      // IN THIS TRANSACTION, BY CONSTRUCTION. The quantity and its cost evidence cannot disagree
      // because one write succeeded and the other did not: this is buffered into the same `writes`
      // array as the receipt and the ledger events and flushed by the same all-or-nothing commit.
      //
      // IDEMPOTENT BY IDENTITY, not by a check. The document id is derived from (receivingId,
      // lineId), and the write is a `create`. A replayed receipt returns before the flush (step 11),
      // so a retry writes nothing at all -- and even if it reached the flush, the deterministic id
      // plus `create` would refuse the duplicate. A duplicated cost event is a financial defect, so
      // it is prevented by the shape rather than by remembering to look.
      //
      // NO PRICE MEANS UNKNOWN, NEVER ZERO. A line with no governed price -- every canonical line,
      // and every legacy purchase order recorded before this authority existed -- produces NO fact.
      // The stock is still received and the workflow is untouched; the cost of that receipt is simply
      // not known, and the absence of a document is how that is said. Writing a zero-cost fact would
      // be the single worst outcome available here: it reads as "this was free" and would silently
      // inflate every margin computed from it.
      const poLine = resolved.isCanonical
        ? resolved.derived.lines.find((l) => l.lineId === line.lineId)
        : resolved.derived.lines[0];
      // Re-validated rather than trusted: the price crossed a stored-document boundary, and the
      // finance authority is the only thing entitled to say what a governed price is.
      const linePrice = poLine === undefined ? null : governedPurchasePrice({ unitPriceMinor: poLine.unitPriceMinor, currency: poLine.currency });
      // A price with no governed company yields no fact. An acquisition cost that cannot say whether
      // it is Taylor's or Ventana's is not evidence, and the company is never inferred from the
      // receiving warehouse -- which is precisely the inference that would look most reasonable here.
      if (linePrice !== null && poLine !== undefined && resolved.canonical.operatingCompanyId !== null) {
        const costFact = buildAcquisitionCostFact({
          price: linePrice,
          operatingCompanyId: resolved.canonical.operatingCompanyId,
          purchaseOrderId: resolved.purchaseOrderId,
          purchaseOrderLineId: poLine.lineId,
          purchaseOrderSourceType: resolved.sourceType,
          // Legacy is immutable by Rules and has no revisions, so null is the true statement.
          purchaseOrderVersion: resolved.isCanonical ? resolved.version : null,
          supplierId: resolved.canonical.supplierId,
          supplierName: resolved.canonical.supplierName,
          partId: line.partId,
          receivedQuantity: line.receivedQuantity,
          receivingId,
          receivingLineId: line.lineId,
          // The receipt's own governed business event time -- the same instant the ledger events
          // carry, never a write clock (G-05 ruling 14).
          receivedAtMillis: occurredAtMillis,
          receivingLocationType: value.receivingLocation.type,
          receivingLocationId: value.receivingLocation.locationId,
        });
        writes.push({
          op: "create",
          ref: deps.db.collection(ACQUISITION_COST_COLLECTION).doc(acquisitionCostDocId(receivingId, line.lineId)),
          data: { ...costFact, createdAt: Timestamp.fromDate(now), createdBy: actor.id },
        });
        acquisitionCostIds.push(acquisitionCostDocId(receivingId, line.lineId));
      }
    }

    const ledgerEventIds = ledgerOutcomes.map((o) => o.docId);
    const ledgerEventId = ledgerEventIds[0];

    // ---- 10. PER-LINE RESULT, derived. Computed for BOTH the apply and replay paths so a replayed
    // receipt reports the same truthful progress as the original. ----
    // Keyed by the PO's OWN line id, not the receipt's. They are the same for canonical; for legacy
    // the receipt carries the caller's label while the PO line is "L1", so a naive key would report
    // receivedNow: 0 for the very line just received.
    const receiptByLineId = resolved.isCanonical
      ? new Map(value.lines.map((l) => [l.lineId, l.receivedQuantity]))
      : new Map([[resolved.derived.lines[0].lineId, value.lines[0].receivedQuantity]]);
    const perLine = resolved.derived.lines.map((l) => {
      const receivedNow = receiptByLineId.get(l.lineId) ?? 0;
      // On a REPLAY the derivation already includes this receipt (it is committed), so adding it again
      // would double-count. `alreadyCounted` is what keeps the replayed answer equal to the original.
      const alreadyCounted = receivingOutcome.outcome === "replayed";
      const previouslyReceived = alreadyCounted ? l.receivedQuantity - receivedNow : l.receivedQuantity;
      const remainingAfter = Math.max(0, l.orderedQuantity - previouslyReceived - receivedNow);
      return {
        lineId: l.lineId,
        partId: l.partId,
        orderedQuantity: l.orderedQuantity,
        previouslyReceived,
        receivedNow,
        remainingQuantity: remainingAfter,
        state: remainingAfter === 0 ? "RECEIVED" : previouslyReceived + receivedNow === 0 ? "NOT_RECEIVED" : "PARTIALLY_RECEIVED",
      };
    });
    const fullyReceived = perLine.every((l) => l.remainingQuantity === 0);
    const derivedState = fullyReceived
      ? "RECEIVED"
      : perLine.every((l) => l.previouslyReceived + l.receivedNow === 0)
        ? "NOT_RECEIVED"
        : "PARTIALLY_RECEIVED";

    // ---- 11. decide apply vs replay (coherence: receiving and EVERY ledger effect must agree) ----
    const replayResult = {
      receivingId,
      purchaseOrderId: resolved.purchaseOrderId,
      sourceType: resolved.sourceType,
      ledgerEventId,
      ledgerEventIds,
      lines: perLine,
      derivedState,
      storedStatus: resolved.storedStatus,
      ...(anySerial ? { serializedAssetIds } : {}),
    };
    if (receivingOutcome.outcome === "replayed") {
      if (ledgerOutcomes.some((o) => o.outcome !== "replayed")) throw new ReceivingIntegrityError("receiving replayed but ledger did not");
      return { outcome: "replayed", ...replayResult };
    }
    if (ledgerOutcomes.some((o) => o.outcome !== "applied")) throw new ReceivingIntegrityError("receiving applied but ledger did not");

    // ---- 12. LIFECYCLE writes, per authority ----
    let storedStatusAfter = resolved.storedStatus;
    if (resolved.isCanonical) {
      // THE CONCURRENCY SERIALIZATION POINT. The version increment is written on EVERY canonical
      // receipt, including a partial one, because that is what makes a concurrent transaction which
      // read the prior version abort and retry against committed state. It is concurrency control
      // ONLY -- it never represents quantity received, quantity remaining, receipt count, or business
      // progress.
      const poUpdate: Record<string, unknown> = {
        version: resolved.version + 1,
        updatedAt: Timestamp.fromDate(now),
      };
      // Stored lifecycle moves to RECEIVED only when every line has zero remaining. A partial receipt
      // leaves it SENT. There is deliberately NO persisted PARTIALLY_RECEIVED status -- partial
      // progress is derived from the receipts, so it cannot drift from them.
      if (fullyReceived) {
        poUpdate.status = RECEIVED;
        storedStatusAfter = RECEIVED;
      }
      writes.push({ op: "update", ref: resolved.poRef, data: poUpdate });
    } else {
      // LEGACY: transition ONLY reorder_requests ORDERED -> RECEIVED. The legacy PO document is never
      // written. Legacy receipts are full-quantity by validation, so this always completes the order.
      if (reqStatus !== ORDERED) throw new SourceNotReceivableError("reorder request is not ORDERED");
      writes.push({ op: "update", ref: reqRef as DocumentReference, data: { status: RECEIVED, receivedAt: Timestamp.fromDate(now), receivedBy: actor.id } });
    }

    // ---- 13. one immutable audit event (sanitized) ----
    const totalQuantity = value.lines.reduce((sum, l) => sum + l.receivedQuantity, 0);
    deps.stageAudit(txn, {
      action: "receiveInventoryStock",
      actorId: actor.id,
      receivingId,
      ...(resolved.reorderRequestId === undefined ? {} : { reorderRequestId: resolved.reorderRequestId }),
      purchaseOrderId: resolved.purchaseOrderId,
      sourceType: resolved.sourceType,
      // The single-line fields are kept ONLY when the receipt really is one line, so an existing
      // reader is unaffected and a multi-line receipt never reports one part as if it were the whole
      // receipt. lineCount/totalQuantity describe the batch honestly in both cases.
      ...(value.lines.length === 1 ? { partId: value.lines[0].partId, quantity: value.lines[0].receivedQuantity } : {}),
      lineCount: value.lines.length,
      totalQuantity,
      locationType: value.receivingLocation.type,
      locationId: value.receivingLocation.locationId,
      ledgerEventId,
      ...(anySerial ? { serialCount: serializedAssetIds.length } : {}),
    });

    // ---- 14. flush all buffered writes. The LEGACY purchase order is never written. Commit is
    // all-or-nothing (the enclosing runTransaction). ----
    for (const w of writes) {
      if (w.op === "create") txn.create(w.ref, w.data);
      else if (w.op === "set") txn.set(w.ref, w.data);
      else txn.update(w.ref, w.data);
    }
    // acquisitionCostIds is reported on the APPLY path only. On a replay the ids would be derivable
    // (they are deterministic), but a receipt committed before this authority existed has no cost
    // facts to point at -- and naming documents that do not exist is exactly the kind of confident
    // falsehood a cost surface must not produce.
    return {
      outcome: "applied",
      ...replayResult,
      storedStatus: storedStatusAfter,
      ...(acquisitionCostIds.length > 0 ? { acquisitionCostIds } : {}),
    };
  });
}
