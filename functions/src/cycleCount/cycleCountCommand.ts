// Enterprise Inventory -- Cycle Count operating authority: the trusted command family that CREATES,
// RECORDS, and RECONCILES a `cycle_counts` record. Follows receiveInventoryStockCommand.ts /
// transferOrderCommand.ts's proven pattern: one Firestore transaction per action, all reads before any
// writes (writes buffered and flushed after the last read), a deterministic doc id + fingerprint
// idempotency guard, one staged audit event per action, and a sanitized error taxonomy.
//
// MOVEMENT AUTHORITY BOUNDARY: this command never moves stock between locations (that remains Transfer's
// exclusive authority) and never overwrites stock truth directly. reconcileCycleCount corrects the
// expected-quantity authority ONLY by staging an ADJUSTED ledger event -- the same operational-ledger
// contract Transfer/Receiving already write -- so the correction is evidence-backed and auditable, never
// a silent field overwrite.
//
// SERIAL "MISSING" DISPOSITION (the smallest isolated Owner decision this module could not resolve on its
// own -- see the report): the governed serialized_assets lifecycle (serializedAsset/types.ts's
// SERIALIZED_ASSET_STATES) is an exact 8-value set with NO "missing/lost" terminal state, and it is
// mirrored verbatim from the frontend's serializedAssetIdentity.js contract -- inventing a 9th state here
// would be a material, cross-cutting governance change outside a Cycle Count authority's scope. This
// command therefore stages ADJUSTED ledger EVIDENCE for every missing serial (so the fact a unit did not
// reconcile at this location is durably recorded and audited) but does NOT flip the serialized_assets
// document's inventoryState -- the unit remains AVAILABLE at its last-known location until a future,
// separately-authorized decision defines what "confirmed missing" means for that registry. The same
// posture applies to "unexpected" serials found during a count: they are recorded as evidence (never
// silently relocated into this location, which would be an uninvited Transfer).

import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { CYCLE_COUNTS_COLLECTION, INVENTORY_TRANSACTIONS_COLLECTION } from "../constants/collections.js";
import { stageOperationalMovement } from "../inventoryLedger/operationalMovementRepository.js";
import {
  UnauthorizedCycleCountError,
  CycleCountNotFoundError,
  CycleCountLocationInvalidError,
  CycleCountPartInvalidError,
  CycleCountReasonRequiredError,
  CycleCountStatusInvalidError,
  CycleCountIdempotencyConflictError,
  CycleCountMalformedStoredRecordError,
  CycleCountIntegrityError,
  type CycleCountActor,
  type CycleCountLocationRef,
  type CycleCountCreateOutcome,
  type CycleCountActionOutcome,
  type SerialVariance,
} from "./cycleCountTypes.js";
import { validateCreateCycleCountInput, validateSubmitCycleCountInput, validateReconcileCycleCountInput } from "./cycleCountValidation.js";
import {
  cycleCountDocId,
  fingerprintCycleCount,
  toIdentity,
  serializeCycleCount,
  deserializeCycleCount,
  submitFields,
  reconcileFields,
  cancelFields,
} from "./cycleCountRepository.js";
import { computeExpectedQuantityThroughTxn, computeExpectedSerialsThroughTxn } from "./cycleCountExpectedQuantity.js";

export {
  UnauthorizedCycleCountError,
  CycleCountNotFoundError,
  CycleCountLocationInvalidError,
  CycleCountPartInvalidError,
  CycleCountReasonRequiredError,
  CycleCountStatusInvalidError,
  CycleCountIdempotencyConflictError,
  CycleCountMalformedStoredRecordError,
  CycleCountIntegrityError,
} from "./cycleCountTypes.js";

const CREATE_CAPABILITY = "inventory.cycleCount.create";
const SUBMIT_CAPABILITY = "inventory.cycleCount.submit";
const RECONCILE_CAPABILITY = "inventory.cycleCount.reconcile";
const CANCEL_CAPABILITY = "inventory.cycleCount.cancel";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
function requireActor(actor: unknown): CycleCountActor {
  if (!isPlainObject(actor) || (actor.kind !== "USER" && actor.kind !== "SYSTEM") || !str(actor.id)) {
    throw new UnauthorizedCycleCountError("trusted actor context missing");
  }
  return { kind: actor.kind, id: actor.id as string };
}

export interface ResolvedCycleCountPart {
  readonly partId: string;
  readonly trackingMode: string;
  readonly active: boolean;
}

export interface CycleCountAuditInput {
  readonly action: "createCycleCount" | "submitCycleCount" | "reconcileCycleCount" | "cancelCycleCount";
  readonly actorId: string;
  readonly cycleCountId: string;
  readonly partId: string;
  readonly location: CycleCountLocationRef;
  readonly variance?: number;
  readonly serialVariance?: SerialVariance;
}

export interface CycleCountCommandDeps {
  readonly db: Firestore;
  readonly actor: CycleCountActor;
  readonly authorize: (txn: Transaction, actorId: string, capability: string) => Promise<boolean>;
  readonly resolvePart: (txn: Transaction, partId: string) => Promise<ResolvedCycleCountPart | null>;
  readonly resolveLocationActive: (txn: Transaction, location: CycleCountLocationRef) => Promise<boolean>;
  readonly stageAudit: (txn: Transaction, audit: CycleCountAuditInput) => void;
  readonly now: () => Date;
}

type BufferedWrite = { op: "create" | "update"; ref: DocumentReference; data: Record<string, unknown> };

function serialLedgerIdKey(cycleCountId: string, suffix: string, serialNo: string): string {
  return "cycmv_" + createHash("sha256").update(JSON.stringify([cycleCountId, suffix, serialNo])).digest("hex").slice(0, 40);
}
function noneLedgerIdKey(cycleCountId: string): string {
  return "cycmv_" + createHash("sha256").update(JSON.stringify([cycleCountId, "adjust"])).digest("hex").slice(0, 40);
}

// =====================================================================================================
// createCycleCount -- (none) -> OPEN. Snapshots expected quantity/serials from the ledger/registry
// authority at creation time (never accepted from input).
// =====================================================================================================
export async function createCycleCount(request: unknown, deps: CycleCountCommandDeps): Promise<CycleCountCreateOutcome> {
  const actor = requireActor(deps.actor);

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();

    if (!(await deps.authorize(txn, actor.id, CREATE_CAPABILITY))) throw new UnauthorizedCycleCountError();

    if (!isPlainObject(request) || !str(request.partId)) throw new CycleCountPartInvalidError("partId missing");
    const part = await deps.resolvePart(txn, request.partId as string);
    if (part === null) throw new CycleCountPartInvalidError("part not found");
    if (part.active !== true) throw new CycleCountPartInvalidError("part is not active");
    if (part.partId !== request.partId) throw new CycleCountPartInvalidError("resolved part identity incoherent");

    const authority = { part: { partId: part.partId, trackingMode: part.trackingMode } };
    const validated = validateCreateCycleCountInput(request, authority);
    if (!validated.valid) {
      const reason = validated.reason ?? "unknown";
      if (reason === "location_invalid") throw new CycleCountLocationInvalidError("location is malformed or not a WAREHOUSE/MOBILE reference");
      if (reason === "tracking_mode_unsupported") throw new CycleCountPartInvalidError("tracking mode not supported (LOT deferred)");
      throw new CycleCountPartInvalidError(`cycle count input invalid: ${reason}`);
    }
    const inputValue = validated.value;

    // ---- idempotency read (before location/ledger reads, cheapest fail-fast) ----
    const idempotencyKey = inputValue.idempotencyKey;
    const cycleCountId = cycleCountDocId(idempotencyKey);
    const existingSnap = await txn.get(deps.db.collection(CYCLE_COUNTS_COLLECTION).doc(cycleCountId));
    const requestFingerprint = fingerprintCycleCount(inputValue);

    if (existingSnap.exists) {
      // A replay is judged against the STORED identity (taken at first create), NEVER a freshly
      // recomputed expected-quantity snapshot -- the snapshot is intentionally frozen at creation time,
      // so a later ledger movement must not make an already-created count's replay look like a conflict.
      const stored = deserializeCycleCount(cycleCountId, existingSnap.data());
      if (cycleCountDocId(stored.value.idempotencyKey) !== cycleCountId) {
        throw new CycleCountMalformedStoredRecordError("stored idempotencyKey does not derive its document id");
      }
      const storedRecomputed = fingerprintCycleCount(toIdentity(stored.value));
      if (storedRecomputed !== stored.fingerprint) throw new CycleCountMalformedStoredRecordError("stored fingerprint does not match stored value");
      if (storedRecomputed !== requestFingerprint) throw new CycleCountIdempotencyConflictError();
      return {
        outcome: "replayed",
        cycleCountId,
        fingerprint: stored.fingerprint,
        partId: stored.value.partId,
        trackingMode: stored.value.trackingMode,
        location: stored.value.location,
        expectedQuantity: stored.value.expectedQuantity,
        ...(stored.value.expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers: stored.value.expectedSerialNumbers }),
        status: stored.status,
      };
    }

    if (!(await deps.resolveLocationActive(txn, inputValue.location))) {
      throw new CycleCountLocationInvalidError("location is not an active governed location");
    }

    // ---- compute the expected-quantity snapshot from the authority (ledger for NONE, registry for SERIAL) ----
    const expectedSerialNumbers =
      inputValue.trackingMode === "SERIAL" ? await computeExpectedSerialsThroughTxn(txn, deps.db, part.partId, inputValue.location) : undefined;
    const expectedQuantity =
      inputValue.trackingMode === "NONE"
        ? await computeExpectedQuantityThroughTxn(txn, deps.db, part.partId, inputValue.location)
        : (expectedSerialNumbers as string[]).length;

    const value = { ...inputValue, expectedQuantity, ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers }) };

    txn.create(deps.db.collection(CYCLE_COUNTS_COLLECTION).doc(cycleCountId), serializeCycleCount(value, actor, now, requestFingerprint));

    deps.stageAudit(txn, { action: "createCycleCount", actorId: actor.id, cycleCountId, partId: part.partId, location: value.location });

    return {
      outcome: "applied",
      cycleCountId,
      fingerprint: requestFingerprint,
      partId: value.partId,
      trackingMode: value.trackingMode,
      location: value.location,
      expectedQuantity: value.expectedQuantity,
      ...(expectedSerialNumbers === undefined ? {} : { expectedSerialNumbers }),
      status: "OPEN",
    };
  });
}

// =====================================================================================================
// submitCycleCount -- OPEN -> COUNTED. Records the counted quantity/serials and computes variance
// evidence. Stages NO ledger writes (pure recording) -- reconcileCycleCount is what corrects the
// authority, and only after a reason is supplied when required.
// =====================================================================================================
export async function submitCycleCount(request: unknown, deps: CycleCountCommandDeps): Promise<CycleCountActionOutcome> {
  const actor = requireActor(deps.actor);
  if (!isPlainObject(request) || !str(request.cycleCountId)) throw new CycleCountNotFoundError("cycleCountId missing");
  const cycleCountId = request.cycleCountId as string;

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();

    if (!(await deps.authorize(txn, actor.id, SUBMIT_CAPABILITY))) throw new UnauthorizedCycleCountError();

    const ref = deps.db.collection(CYCLE_COUNTS_COLLECTION).doc(cycleCountId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new CycleCountNotFoundError();
    const stored = deserializeCycleCount(cycleCountId, snap.data());

    if (stored.status !== "OPEN" && stored.status !== "COUNTED") {
      throw new CycleCountStatusInvalidError(`cycle count is ${stored.status}, cannot submit a count`);
    }
    const alreadySubmitted = stored.status === "COUNTED";

    const validated = validateSubmitCycleCountInput(request, stored.value.trackingMode);
    if (!validated.valid) throw new CycleCountMalformedStoredRecordError(`submit input invalid: ${validated.reason}`);
    const submitted = validated.value;

    if (stored.value.trackingMode === "NONE") {
      const countedQuantity = submitted.countedQuantity as number;
      const variance = countedQuantity - stored.value.expectedQuantity;
      if (alreadySubmitted) {
        if (stored.countedQuantity !== countedQuantity) {
          throw new CycleCountIdempotencyConflictError("cycle count was already submitted with a different counted quantity");
        }
        return { outcome: "replayed", cycleCountId, status: stored.status, countedQuantity, variance: stored.variance };
      }
      txn.update(ref, submitFields(stored.version + 1, actor, now, countedQuantity, undefined, variance, undefined));
      deps.stageAudit(txn, { action: "submitCycleCount", actorId: actor.id, cycleCountId, partId: stored.value.partId, location: stored.value.location, variance });
      return { outcome: "applied", cycleCountId, status: "COUNTED", countedQuantity, variance };
    }

    // SERIAL
    const counted = submitted.countedSerialNumbers as readonly string[];
    const expectedSet = new Set(stored.value.expectedSerialNumbers ?? []);
    const countedSet = new Set(counted);
    const missing = [...expectedSet].filter((s) => !countedSet.has(s)).sort();
    const unexpected = [...countedSet].filter((s) => !expectedSet.has(s)).sort();
    const serialVariance: SerialVariance = { missing, unexpected };

    if (alreadySubmitted) {
      const priorCounted = new Set(stored.countedSerialNumbers ?? []);
      const same = priorCounted.size === countedSet.size && [...priorCounted].every((s) => countedSet.has(s));
      if (!same) throw new CycleCountIdempotencyConflictError("cycle count was already submitted with different counted serials");
      return { outcome: "replayed", cycleCountId, status: stored.status, countedSerialNumbers: counted, serialVariance: stored.serialVariance };
    }
    txn.update(ref, submitFields(stored.version + 1, actor, now, undefined, counted, undefined, serialVariance));
    deps.stageAudit(txn, { action: "submitCycleCount", actorId: actor.id, cycleCountId, partId: stored.value.partId, location: stored.value.location, serialVariance });
    return { outcome: "applied", cycleCountId, status: "COUNTED", countedSerialNumbers: counted, serialVariance };
  });
}

// =====================================================================================================
// reconcileCycleCount -- COUNTED -> RECONCILED. Requires a reason on any non-zero variance; stages
// ADJUSTED ledger evidence (never overwrites stock truth directly); idempotent; atomic.
// =====================================================================================================
export async function reconcileCycleCount(request: unknown, deps: CycleCountCommandDeps): Promise<CycleCountActionOutcome> {
  const actor = requireActor(deps.actor);
  if (!isPlainObject(request) || !str(request.cycleCountId)) throw new CycleCountNotFoundError("cycleCountId missing");
  const cycleCountId = request.cycleCountId as string;
  const validatedReq = validateReconcileCycleCountInput(request);
  if (!validatedReq.valid) throw new CycleCountMalformedStoredRecordError(`reconcile input invalid: ${validatedReq.reason}`);
  const suppliedReason = validatedReq.value.reason;

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();
    const writes: BufferedWrite[] = [];

    if (!(await deps.authorize(txn, actor.id, RECONCILE_CAPABILITY))) throw new UnauthorizedCycleCountError();

    const ref = deps.db.collection(CYCLE_COUNTS_COLLECTION).doc(cycleCountId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new CycleCountNotFoundError();
    const stored = deserializeCycleCount(cycleCountId, snap.data());

    if (stored.status !== "COUNTED" && stored.status !== "RECONCILED") {
      throw new CycleCountStatusInvalidError(`cycle count is ${stored.status}, cannot reconcile (submit a count first)`);
    }
    const alreadyReconciled = stored.status === "RECONCILED";

    const part = await deps.resolvePart(txn, stored.value.partId);
    if (part === null || part.partId !== stored.value.partId) throw new CycleCountPartInvalidError("part not found");

    const isSerial = stored.value.trackingMode === "SERIAL";
    const hasVariance = isSerial
      ? (stored.serialVariance?.missing.length ?? 0) > 0 || (stored.serialVariance?.unexpected.length ?? 0) > 0
      : (stored.variance ?? 0) !== 0;
    if (hasVariance && !alreadyReconciled && !suppliedReason) throw new CycleCountReasonRequiredError();

    const bufferedStore = {
      async read(docId: string) {
        const s = await txn.get(deps.db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId));
        return s.exists ? (s.data() ?? {}) : null;
      },
      create(docId: string, data: Record<string, unknown>) {
        writes.push({ op: "create", ref: deps.db.collection(INVENTORY_TRANSACTIONS_COLLECTION).doc(docId), data });
      },
    };

    const ledgerEventIds: string[] = [];
    if (isSerial) {
      // Missing serials get ADJUSTED ledger EVIDENCE (see this module's header note on why the
      // serialized_assets registry itself is intentionally NOT flipped). "Unexpected" serials are
      // recorded as evidence on the cycle count document only (already staged at submit time) -- they
      // are never staged as a ledger movement here, since doing so without a genuine Transfer would be
      // an uninvited relocation of stock this authority does not own.
      for (const serialNo of stored.serialVariance?.missing ?? []) {
        const ev = {
          type: "ADJUSTED" as const,
          partId: stored.value.partId,
          location: stored.value.location,
          quantity: 1,
          sourceObject: { type: "ADJUSTMENT" as const, id: cycleCountId },
          actor: { kind: actor.kind, id: actor.id },
          occurredAt: now.getTime(),
          serialNo,
          idempotencyKey: serialLedgerIdKey(cycleCountId, "missing", serialNo),
        };
        const outcome = await stageOperationalMovement(bufferedStore, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now });
        ledgerEventIds.push(outcome.docId);
        if (!alreadyReconciled && outcome.outcome !== "applied") throw new CycleCountIntegrityError("reconciliation ledger effect did not apply coherently");
        if (alreadyReconciled && outcome.outcome !== "replayed") throw new CycleCountIntegrityError("cycle count already reconciled but ledger did not replay coherently");
      }
    } else if ((stored.variance ?? 0) !== 0) {
      const ev = {
        type: "ADJUSTED" as const,
        partId: stored.value.partId,
        location: stored.value.location,
        quantity: stored.variance as number,
        sourceObject: { type: "ADJUSTMENT" as const, id: cycleCountId },
        actor: { kind: actor.kind, id: actor.id },
        occurredAt: now.getTime(),
        idempotencyKey: noneLedgerIdKey(cycleCountId),
      };
      const outcome = await stageOperationalMovement(bufferedStore, ev, { partId: part.partId, trackingMode: part.trackingMode }, { now });
      ledgerEventIds.push(outcome.docId);
      if (!alreadyReconciled && outcome.outcome !== "applied") throw new CycleCountIntegrityError("reconciliation ledger effect did not apply coherently");
      if (alreadyReconciled && outcome.outcome !== "replayed") throw new CycleCountIntegrityError("cycle count already reconciled but ledger did not replay coherently");
    }

    if (alreadyReconciled) {
      const priorIds = new Set(stored.ledgerEventIds ?? []);
      const same = priorIds.size === ledgerEventIds.length && ledgerEventIds.every((id) => priorIds.has(id));
      if (!same) throw new CycleCountIntegrityError("cycle count already reconciled but ledger evidence did not replay coherently");
      return { outcome: "replayed", cycleCountId, status: stored.status, ledgerEventIds, ...(stored.reconciliationReason === undefined ? {} : { reconciliationReason: stored.reconciliationReason }) };
    }

    writes.push({ op: "update", ref, data: reconcileFields(stored.version + 1, actor, now, suppliedReason, ledgerEventIds) });

    deps.stageAudit(txn, {
      action: "reconcileCycleCount",
      actorId: actor.id,
      cycleCountId,
      partId: stored.value.partId,
      location: stored.value.location,
      ...(isSerial ? { serialVariance: stored.serialVariance } : { variance: stored.variance }),
    });

    for (const w of writes) {
      if (w.op === "create") txn.create(w.ref, w.data);
      else txn.update(w.ref, w.data);
    }
    return { outcome: "applied", cycleCountId, status: "RECONCILED", ledgerEventIds, ...(suppliedReason === null ? {} : { reconciliationReason: suppliedReason }) };
  });
}

// =====================================================================================================
// cancelCycleCount -- OPEN -> CANCELLED. Domain-safe ONLY: legal iff no count has been submitted yet.
// =====================================================================================================
export async function cancelCycleCount(request: unknown, deps: CycleCountCommandDeps): Promise<CycleCountActionOutcome> {
  const actor = requireActor(deps.actor);
  if (!isPlainObject(request) || !str(request.cycleCountId)) throw new CycleCountNotFoundError("cycleCountId missing");
  const cycleCountId = request.cycleCountId as string;

  return deps.db.runTransaction(async (txn) => {
    const now = deps.now();

    if (!(await deps.authorize(txn, actor.id, CANCEL_CAPABILITY))) throw new UnauthorizedCycleCountError();

    const ref = deps.db.collection(CYCLE_COUNTS_COLLECTION).doc(cycleCountId);
    const snap = await txn.get(ref);
    if (!snap.exists) throw new CycleCountNotFoundError();
    const stored = deserializeCycleCount(cycleCountId, snap.data());

    if (stored.status === "CANCELLED") return { outcome: "replayed", cycleCountId, status: "CANCELLED" };
    if (stored.status !== "OPEN") {
      throw new CycleCountStatusInvalidError(`cycle count is ${stored.status}, cancellation is only domain-safe before a count is submitted`);
    }

    txn.update(ref, cancelFields(stored.version + 1, actor, now));
    deps.stageAudit(txn, { action: "cancelCycleCount", actorId: actor.id, cycleCountId, partId: stored.value.partId, location: stored.value.location });
    return { outcome: "applied", cycleCountId, status: "CANCELLED" };
  });
}
